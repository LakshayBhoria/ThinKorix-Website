// Run this ONCE, locally (not on Render), to get a refresh token for
// GOOGLE_OAUTH_REFRESH_TOKEN. It authenticates as *your* personal Google
// account so uploaded PDFs count against your own Drive storage — a
// service account can't be used here (see src/googleDrive.js for why).
//
// Setup before running:
//   1. https://console.cloud.google.com/ → create/select a project.
//   2. APIs & Services → Library → enable "Google Drive API".
//   3. APIs & Services → Credentials → Create Credentials → OAuth client ID
//      → Application type: "Desktop app". Copy the Client ID + Secret.
//   4. In this project's .env, set:
//        GOOGLE_OAUTH_CLIENT_ID=...
//        GOOGLE_OAUTH_CLIENT_SECRET=...
//   5. In Drive, create two folders (e.g. "Thinkorix Offer Letters" and
//      "Thinkorix Certificates") and copy each folder's ID from its URL
//      (the part after /folders/) into DRIVE_OFFERS_FOLDER_ID /
//      DRIVE_CERTS_FOLDER_ID in .env.
//
// Then run:  node scripts/get-drive-refresh-token.js
// It opens a local server on http://localhost:53682, prints a URL to open
// in your browser, and once you approve access, prints the refresh token
// to paste into .env / your Render environment as GOOGLE_OAUTH_REFRESH_TOKEN.

require('dotenv').config();
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first (see comments at the top of this script).');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // forces a refresh_token even if you've authorized this app before
  scope: ['https://www.googleapis.com/auth/drive.file']
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/oauth2callback') { res.end(); return; }

  const code = url.searchParams.get('code');
  if (!code) {
    res.end('No code received — check the terminal for errors.');
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end('Success — you can close this tab and go back to the terminal.');
    server.close();
    console.log('\nAdd this to your .env / Render environment:\n');
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    if (!tokens.refresh_token) {
      console.log(
        'No refresh_token came back — you\'ve likely authorized this app before. Go to ' +
        'https://myaccount.google.com/permissions, remove access for this app, and run this script again.'
      );
    }
  } catch (err) {
    res.end('Token exchange failed — check the terminal.');
    console.error('Token exchange failed:', err.message);
    server.close();
  }
});

server.listen(PORT, () => {
  console.log('Open this URL in your browser and approve access:\n');
  console.log(authUrl + '\n');
});
