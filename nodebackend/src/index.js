const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const auth = require('./auth');

const authRoutes = require('./routes/auth');
const internRoutes = require('./routes/interns');
const verifyRoutes = require('./routes/verify');
const researchRoutes = require('./routes/research');
const ideaRoutes = require('./routes/ideas');
const clientProjectRoutes = require('./routes/clientProjects');
const adminRoutes = require('./routes/admin');
const contactRoutes = require('./routes/contact');
const reviewRoutes = require('./routes/reviews');

// Make sure every directory these routes read/write to actually exists.
for (const dir of [
  config.PATHS.dataDir, config.PATHS.offersOut, config.PATHS.certsOut, config.PATHS.uploadsDir
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json());

// Generated PDFs and uploaded files — served as static files. Fine for an
// internship-program's public offer letters/certificates; if client
// deliverables need to stay private, swap this for an authenticated
// download route before going to production.
app.use('/storage/offers', express.static(config.PATHS.offersOut));
app.use('/storage/certificates', express.static(config.PATHS.certsOut));
app.use('/storage/uploads', express.static(config.PATHS.uploadsDir));

// Frontend pages (index.html, admin.html, verify.html, register.html, etc.)
app.use(express.static(config.PATHS.public));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'thinkorix-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/interns', internRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/research', researchRoutes);
app.use('/api/ideas', ideaRoutes);
app.use('/api/client-projects', clientProjectRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/reviews', reviewRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

// Express 4 doesn't catch rejected promises inside async route handlers on
// its own — an un-caught one used to just hang the request until the host
// (e.g. Render) gave up and returned a 502. This is a last-resort net for
// any route that still misses a try/catch: log it and free the request
// instead of leaving the client hanging.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

auth.seedAdminIfMissing().then(() => {
  app.listen(config.PORT, () => {
    console.log(`Thinkorix backend running on http://localhost:${config.PORT}`);
  });
});
