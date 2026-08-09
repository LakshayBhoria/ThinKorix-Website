const express = require('express');
const auth = require('../auth');
const mailer = require('../mailer');
const config = require('../config');

const router = express.Router();

const ALLOWED_SELF_SIGNUP_ROLES = ['intern', 'client', 'contributor', 'mentor'];

// Public self-signup. Admins are never created this way — see the
// SEED_ADMIN_* env vars, or have an existing admin promote a user via
// PATCH /api/admin/users/:id/role.
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required.' });
    }
    const chosenRole = ALLOWED_SELF_SIGNUP_ROLES.includes(role) ? role : 'contributor';
    const user = await auth.createUser({ name, email, password, role: chosenRole });
    const token = auth.issueToken(user);
    res.status(201).json({ user, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required.' });
  const user = await auth.getUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
  const ok = await auth.checkPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });
  const token = auth.issueToken(user);
  res.json({ user: auth.sanitize(user), token });
});

router.get('/me', auth.requireAuth, async (req, res) => {
  const user = await auth.getUserById(req.user.sub);
  res.json({ user: auth.sanitize(user) });
});

// Always responds the same way whether or not the email exists, so this
// can't be used to check which emails have accounts.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required.' });
  const user = await auth.getUserByEmail(email);
  const generic = { message: "If an account exists for that email, we've sent a reset link." };
  if (!user) return res.json(generic);

  const token = await auth.createResetToken(user);
  const resetUrl = `${config.APP_URL}/reset-password.html?token=${token}&email=${encodeURIComponent(user.email)}`;
  const result = await mailer.sendMail({
    to: user.email,
    subject: `Reset your ${config.COMPANY_NAME} password`,
    text: `Hi ${user.name},\n\nUse this link to reset your password (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`
  });

  // SEND_EMAIL is off by default so the app works with zero setup — in that
  // case (and only that case) return the link directly instead of just
  // logging it, the same way intern registration returns PDF URLs directly.
  if (result.skipped) return res.json(Object.assign({}, generic, { devResetUrl: resetUrl }));
  res.json(generic);
});

router.post('/reset-password', async (req, res) => {
  const { email, token, newPassword } = req.body || {};
  if (!email || !token || !newPassword) {
    return res.status(400).json({ error: 'email, token and newPassword are required.' });
  }
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  const user = await auth.consumeResetToken(email, token);
  if (!user) return res.status(400).json({ error: 'That reset link is invalid or has expired — request a new one.' });
  await auth.resetPassword(user, newPassword);
  res.json({ message: 'Password updated — you can log in now.' });
});

module.exports = router;
