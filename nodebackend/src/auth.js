const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('./config');
const store = require('./store');

const COLLECTION = 'users';

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}
async function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, name: user.name },
    config.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch {
    return null;
  }
}

// store.js is async regardless of backend (local JSON files or Firestore —
// see DB_DRIVER in .env), so every data-access function here is async too.
async function getUserByEmail(email) {
  return store.find(COLLECTION, u => u.email.toLowerCase() === String(email).toLowerCase());
}
async function getUserById(id) {
  return store.find(COLLECTION, u => u.id === id);
}

async function createUser({ name, email, password, role }) {
  if (await getUserByEmail(email)) throw new Error('An account with that email already exists.');
  const passwordHash = await hashPassword(password);
  const user = await store.insert(COLLECTION, { name, email, passwordHash, role });
  return sanitize(user);
}

function sanitize(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

// Attaches req.user if a valid Bearer token is present. Does NOT reject
// requests without one — use requireAuth / requireRole for that.
function attachUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const payload = verifyToken(token);
    if (payload) req.user = payload; // { sub, role, email, name }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Login required.' });
  next();
}

// Allows either a matching JWT role OR the static ADMIN_TOKEN (as ?token=
// or Authorization: Bearer <ADMIN_TOKEN>) — the same shortcut the earlier
// admin.html frontend used, kept for convenience/back-compat.
function requireRole(...roles) {
  return (req, res, next) => {
    const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const staticToken = req.query.token || headerToken;
    if (roles.includes('admin') && staticToken && staticToken === config.ADMIN_TOKEN) {
      req.user = req.user || { sub: 'static-admin-token', role: 'admin', name: 'Admin (token)' };
      return next();
    }
    if (!req.user) return res.status(401).json({ error: 'Login required.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    next();
  };
}

// ---- Password reset ----
// Reset tokens are stored on the user record itself (fine for a
// single-collection store); swap for a dedicated collection later if you
// want tokens to expire independently of the user document.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

async function createResetToken(user) {
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenExpiry = Date.now() + RESET_TOKEN_TTL_MS;
  await store.updateById(COLLECTION, user.id, { resetToken, resetTokenExpiry });
  return resetToken;
}

async function consumeResetToken(email, token) {
  const user = await getUserByEmail(email);
  if (!user || !user.resetToken || !user.resetTokenExpiry) return null;
  if (user.resetToken !== token) return null;
  if (Date.now() > user.resetTokenExpiry) return null;
  return user;
}

async function resetPassword(user, newPassword) {
  const passwordHash = await hashPassword(newPassword);
  await store.updateById(COLLECTION, user.id, { passwordHash, resetToken: null, resetTokenExpiry: null });
}

// Ensures at least one admin account exists so you're never locked out.
async function seedAdminIfMissing() {
  const existingAdmin = await store.find(COLLECTION, u => u.role === 'admin');
  if (existingAdmin) return;
  await createUser({
    name: 'Admin',
    email: config.SEED_ADMIN_EMAIL,
    password: config.SEED_ADMIN_PASSWORD,
    role: 'admin'
  });
  console.log(`[auth] Seeded initial admin account: ${config.SEED_ADMIN_EMAIL} (change the password after first login)`);
}

module.exports = {
  hashPassword, checkPassword, issueToken, verifyToken,
  getUserByEmail, getUserById, createUser, sanitize,
  attachUser, requireAuth, requireRole, seedAdminIfMissing,
  createResetToken, consumeResetToken, resetPassword
};
