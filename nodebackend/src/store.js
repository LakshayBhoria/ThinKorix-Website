// A tiny "collection" store with two interchangeable backends:
//   - local JSON files under /data (DB_DRIVER=local, the default — zero
//     setup, good enough for getting started or small deployments)
//   - Firebase Firestore (DB_DRIVER=firestore — set GOOGLE_APPLICATION_CREDENTIALS
//     or FIREBASE_SERVICE_ACCOUNT_JSON in .env; see README)
//
// Every exported function is async and returns the same shape either way,
// so nothing in the route files needs to know or care which backend is
// active.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { PATHS, DB_DRIVER } = config;

let firestoreDb = null;
if (DB_DRIVER === 'firestore') {
  firestoreDb = require('./firestoreClient').getDb();
}

/* ------------------------- local JSON file backend ------------------------- */
function filePathFor(collection) {
  return path.join(PATHS.dataDir, `${collection}.json`);
}
function readAllLocal(collection) {
  const file = filePathFor(collection);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '[]');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeAllLocal(collection, records) {
  const file = filePathFor(collection);
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
  fs.renameSync(tmp, file);
}

/* ------------------------------ public API ------------------------------ */

async function readAll(collection) {
  if (DB_DRIVER === 'firestore') {
    const snap = await firestoreDb.collection(collection).get();
    return snap.docs.map(d => d.data());
  }
  return readAllLocal(collection);
}

// `predicate` is a plain JS function, so — on either backend — we fetch the
// collection and filter in memory rather than trying to translate arbitrary
// closures into Firestore queries. Fine at this app's scale.
async function find(collection, predicate) {
  const all = await readAll(collection);
  return all.find(predicate) || null;
}

async function filter(collection, predicate) {
  const all = await readAll(collection);
  return predicate ? all.filter(predicate) : all;
}

async function insert(collection, record) {
  const withId = Object.assign({ id: crypto.randomUUID(), createdAt: new Date().toISOString() }, record);
  if (DB_DRIVER === 'firestore') {
    await firestoreDb.collection(collection).doc(withId.id).set(withId);
    return withId;
  }
  const records = readAllLocal(collection);
  records.push(withId);
  writeAllLocal(collection, records);
  return withId;
}

async function updateById(collection, id, patch) {
  if (DB_DRIVER === 'firestore') {
    const ref = firestoreDb.collection(collection).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const merged = Object.assign({}, snap.data(), patch, { updatedAt: new Date().toISOString() });
    await ref.set(merged);
    return merged;
  }
  const records = readAllLocal(collection);
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return null;
  records[idx] = Object.assign({}, records[idx], patch, { updatedAt: new Date().toISOString() });
  writeAllLocal(collection, records);
  return records[idx];
}

async function removeById(collection, id) {
  if (DB_DRIVER === 'firestore') {
    await firestoreDb.collection(collection).doc(id).delete();
    return true;
  }
  const records = readAllLocal(collection);
  const next = records.filter(r => r.id !== id);
  writeAllLocal(collection, next);
  return next.length !== records.length;
}

module.exports = { readAll, find, filter, insert, updateById, removeById };
