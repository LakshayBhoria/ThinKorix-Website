require('dotenv').config();
const path = require('path');

function bool(v, fallback) {
  if (v === undefined) return fallback;
  return String(v).toLowerCase() === 'true';
}

module.exports = {
  PORT: parseInt(process.env.PORT || '4000', 10),

  COMPANY_NAME: process.env.COMPANY_NAME || 'Thinkorix',
  WEBSITE: process.env.WEBSITE || 'https://www.thinkorix.com',
  FOUNDER_NAME: process.env.FOUNDER_NAME || 'Founder',
  FOUNDER_TITLE: process.env.FOUNDER_TITLE || 'Founder & CEO',

  START_NUMBER: parseInt(process.env.START_NUMBER || '3011', 10),
  YEAR: process.env.YEAR || String(new Date().getFullYear()),

  ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'CHANGE-THIS-SECRET-TOKEN',
  JWT_SECRET: process.env.JWT_SECRET || 'CHANGE-THIS-TOO-ITS-DIFFERENT-FROM-ADMIN-TOKEN',
  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL || 'admin@thinkorix.com',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || 'change-this-password',
  VERIFY_PAGE_URL: process.env.VERIFY_PAGE_URL || 'http://localhost:4000/portal-verify.html',
  APP_URL: process.env.APP_URL || 'http://localhost:4000',

  SEND_EMAIL: bool(process.env.SEND_EMAIL, false),
  MAIL_FROM: process.env.MAIL_FROM || 'Thinkorix <no-reply@thinkorix.com>',

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',

  // 'local' (default, zero setup — JSON files under /data) or 'firestore'.
  // For firestore, also set GOOGLE_APPLICATION_CREDENTIALS (path to your
  // service account key JSON) or FIREBASE_SERVICE_ACCOUNT_JSON (its raw
  // contents) — see README.
  DB_DRIVER: (process.env.DB_DRIVER || 'local').toLowerCase(),
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '',

  // Persistent PDF storage in Google Drive (personal-Gmail-friendly: uses
  // OAuth as your own account, not a service account, since service
  // accounts have zero storage quota on personal Drive). See
  // scripts/get-drive-refresh-token.js to obtain GOOGLE_OAUTH_REFRESH_TOKEN
  // one time. When DRIVE_ENABLED is false, PDFs stay on local disk only —
  // fine for local dev, but lost on every redeploy on hosts like Render.
  DRIVE_ENABLED: bool(process.env.DRIVE_ENABLED, false),
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
  GOOGLE_OAUTH_REFRESH_TOKEN: process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '',
  DRIVE_OFFERS_FOLDER_ID: process.env.DRIVE_OFFERS_FOLDER_ID || '',
  DRIVE_CERTS_FOLDER_ID: process.env.DRIVE_CERTS_FOLDER_ID || '',

  PATHS: {
    root: path.join(__dirname, '..'),
    dataDir: path.join(__dirname, '..', 'data'),
    data: path.join(__dirname, '..', 'data', 'interns.json'),
    assets: path.join(__dirname, '..', 'assets'),
    offerTemplate: path.join(__dirname, '..', 'assets', 'offer_letter_template.jpg'),
    certTemplate: path.join(__dirname, '..', 'assets', 'certificate_template.jpg'),
    offersOut: path.join(__dirname, '..', 'storage', 'offers'),
    certsOut: path.join(__dirname, '..', 'storage', 'certificates'),
    uploadsDir: path.join(__dirname, '..', 'storage', 'uploads'),
    public: path.join(__dirname, '..', 'public')
  }
};
