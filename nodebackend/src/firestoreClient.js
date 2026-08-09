// Lazily initializes the Firebase Admin SDK and hands back a Firestore
// instance. Only ever touched when DB_DRIVER=firestore — with the default
// DB_DRIVER=local nothing in this file runs, and firebase-admin doesn't
// even need to be configured.

const fs = require('fs');
const config = require('./config');

let admin = null;
let app = null;
let dbInstance = null;

function loadAdminSdk() {
  try {
    return require('firebase-admin');
  } catch {
    throw new Error(
      'DB_DRIVER=firestore but the "firebase-admin" package isn\'t installed. Run `npm install firebase-admin` ' +
      '(it\'s already in package.json — run `npm install` once) and restart.'
    );
  }
}

function buildCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Raw service-account JSON pasted into an env var — handy on hosts
    // without a writable/persistent filesystem (Vercel, Render, etc.).
    let parsed;
    try {
      parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is set but is not valid JSON.');
    }
    return admin.credential.cert(parsed);
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Standard Google convention: path to the downloaded service account key.
    if (!fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      throw new Error(
        `GOOGLE_APPLICATION_CREDENTIALS points to "${process.env.GOOGLE_APPLICATION_CREDENTIALS}" but that file ` +
        `doesn't exist. Download your key from Firebase Console → Project Settings → Service accounts → ` +
        `Generate new private key, save it in this project, and point GOOGLE_APPLICATION_CREDENTIALS at it.`
      );
    }
    return admin.credential.applicationDefault();
  }

  throw new Error(
    'DB_DRIVER=firestore but no credentials were found. In your .env, set either GOOGLE_APPLICATION_CREDENTIALS ' +
    'to the path of your Firebase service account key JSON file, or FIREBASE_SERVICE_ACCOUNT_JSON to its raw ' +
    'contents. Get the key from Firebase Console → Project Settings → Service accounts → Generate new private key.'
  );
}

function init() {
  if (app) return app;
  admin = loadAdminSdk();
  const credential = buildCredential();
  app = admin.initializeApp({
    credential,
    projectId: config.FIREBASE_PROJECT_ID || undefined
  });
  dbInstance = admin.firestore();
  console.log('[firestore] Connected — DB_DRIVER=firestore, project:', config.FIREBASE_PROJECT_ID || '(from credentials)');
  return app;
}

function getDb() {
  if (!dbInstance) init();
  return dbInstance;
}

function getFieldValue() {
  if (!admin) init();
  return admin.firestore.FieldValue;
}

module.exports = { getDb, getFieldValue };
