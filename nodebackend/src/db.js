// Interns-specific store (kept separate from store.js for the atomic
// intern-number counter). Same dual-backend approach: local JSON file by
// default, or Firestore when DB_DRIVER=firestore — see README.

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { PATHS, START_NUMBER, DB_DRIVER } = config;

let firestoreDb = null;
if (DB_DRIVER === 'firestore') {
  firestoreDb = require('./firestoreClient').getDb();
}

/* ------------------------- local JSON file backend ------------------------- */
function loadLocal() {
  if (!fs.existsSync(PATHS.data)) {
    saveLocal({ counter: START_NUMBER - 1, interns: [] });
  }
  return JSON.parse(fs.readFileSync(PATHS.data, 'utf8'));
}
function saveLocal(state) {
  const tmp = PATHS.data + '.tmp';
  fs.mkdirSync(path.dirname(PATHS.data), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, PATHS.data);
}

/* ------------------------------ public API ------------------------------ */

async function nextInternNumber() {
  if (DB_DRIVER === 'firestore') {
    // A Firestore transaction keeps this atomic even with concurrent
    // registrations — two requests can't ever get the same number.
    const counterRef = firestoreDb.collection('meta').doc('internCounter');
    return firestoreDb.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists && typeof snap.data().value === 'number' ? snap.data().value : START_NUMBER - 1;
      const next = current + 1;
      tx.set(counterRef, { value: next }, { merge: true });
      return next;
    });
  }
  const state = loadLocal();
  state.counter += 1;
  saveLocal(state);
  return state.counter;
}

async function getAll() {
  if (DB_DRIVER === 'firestore') {
    const snap = await firestoreDb.collection('interns').get();
    return snap.docs.map(d => d.data()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  return loadLocal().interns.slice().reverse(); // newest first
}

async function getByInternNo(internNo) {
  if (DB_DRIVER === 'firestore') {
    const snap = await firestoreDb.collection('interns').doc(String(internNo)).get();
    return snap.exists ? snap.data() : null;
  }
  return loadLocal().interns.find(r => String(r.internNo) === String(internNo)) || null;
}

async function getByCertId(certId) {
  if (DB_DRIVER === 'firestore') {
    const snap = await firestoreDb.collection('interns').where('certificateId', '==', certId).limit(1).get();
    return snap.empty ? null : snap.docs[0].data();
  }
  return loadLocal().interns.find(r => r.certificateId === certId) || null;
}

async function append(record) {
  if (DB_DRIVER === 'firestore') {
    await firestoreDb.collection('interns').doc(String(record.internNo)).set(record);
    return record;
  }
  const state = loadLocal();
  state.interns.push(record);
  saveLocal(state);
  return record;
}

async function updateByInternNo(internNo, patch) {
  if (DB_DRIVER === 'firestore') {
    const ref = firestoreDb.collection('interns').doc(String(internNo));
    const snap = await ref.get();
    if (!snap.exists) return null;
    const merged = Object.assign({}, snap.data(), patch, { updatedAt: new Date().toISOString() });
    await ref.set(merged);
    return merged;
  }
  const state = loadLocal();
  const idx = state.interns.findIndex(r => String(r.internNo) === String(internNo));
  if (idx === -1) return null;
  state.interns[idx] = Object.assign({}, state.interns[idx], patch);
  saveLocal(state);
  return state.interns[idx];
}

module.exports = {
  nextInternNumber,
  getAll,
  getByInternNo,
  getByCertId,
  append,
  updateByInternNo
};
