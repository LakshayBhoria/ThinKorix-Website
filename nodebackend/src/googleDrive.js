// Persistent PDF storage in Google Drive, for a personal Gmail account.
//
// IMPORTANT: this deliberately does NOT use the Firebase/Firestore service
// account. Service accounts have zero storage quota on a personal Google
// Drive — uploads through one fail with "The user's Drive storage quota
// has been exceeded" even if you share a folder with the service account
// as Editor. Instead this authenticates as *you*, via a one-time OAuth
// consent that produces a long-lived refresh token — see
// scripts/get-drive-refresh-token.js.
//
// Only ever touched when DRIVE_ENABLED=true — with the default
// DRIVE_ENABLED=false nothing in this file runs and PDFs stay local-only.

const fs = require('fs');
const config = require('./config');

let google = null;
let driveClient = null;

function loadGoogleapis() {
  try {
    return require('googleapis').google;
  } catch {
    throw new Error(
      'DRIVE_ENABLED=true but the "googleapis" package isn\'t installed. Run `npm install` ' +
      '(it\'s already in package.json) and restart.'
    );
  }
}

function getClient() {
  if (driveClient) return driveClient;
  google = loadGoogleapis();

  const missing = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN']
    .filter(k => !config[k]);
  if (missing.length) {
    throw new Error(
      `DRIVE_ENABLED=true but missing env var(s): ${missing.join(', ')}. Run ` +
      `\`node scripts/get-drive-refresh-token.js\` once to obtain a refresh token, then set all three ` +
      `(plus DRIVE_OFFERS_FOLDER_ID / DRIVE_CERTS_FOLDER_ID) in your .env / Render environment.`
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    config.GOOGLE_OAUTH_CLIENT_ID,
    config.GOOGLE_OAUTH_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: config.GOOGLE_OAUTH_REFRESH_TOKEN });

  driveClient = google.drive({ version: 'v3', auth: oauth2Client });
  return driveClient;
}

/**
 * Uploads a local PDF to a Drive folder, makes it viewable by anyone with
 * the link (same access model as the old local /storage/... static
 * route — no listing, but no login wall either), and returns URLs.
 *
 * If replaceFileId is given, the old Drive file is deleted first so
 * regenerating a document doesn't leave orphaned copies behind.
 */
async function uploadToDrive({ localPath, fileName, folderId, replaceFileId }) {
  if (!folderId) {
    throw new Error('uploadToDrive: folderId is required — set DRIVE_OFFERS_FOLDER_ID / DRIVE_CERTS_FOLDER_ID.');
  }
  const drive = getClient();

  if (replaceFileId) {
    try { await drive.files.delete({ fileId: replaceFileId }); }
    catch (err) { console.warn(`[googleDrive] could not delete old file ${replaceFileId}:`, err.message); }
  }

  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType: 'application/pdf', body: fs.createReadStream(localPath) },
    fields: 'id, webViewLink'
  });
  const fileId = res.data.id;

  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' }
  });

  return {
    fileId,
    viewUrl: res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`
  };
}

module.exports = { uploadToDrive };
