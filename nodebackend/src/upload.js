const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PATHS } = require('./config');

function makeUploader(subfolder) {
  const dir = path.join(PATHS.uploadsDir, subfolder);
  fs.mkdirSync(dir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    }
  });
  return multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB/file
}

module.exports = {
  ideaUpload: makeUploader('ideas'),
  clientProjectUpload: makeUploader('client-projects')
};
