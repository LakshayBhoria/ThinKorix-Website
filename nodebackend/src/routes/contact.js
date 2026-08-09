const express = require('express');
const store = require('../store');
const auth = require('../auth');

const router = express.Router();
const COLLECTION = 'contactMessages';

// Public submission — no login required. This is what the homepage
// "Tell us what you're building" form posts to.
router.post('/', async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required.' });
  }
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  if (!emailOk) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  const saved = await store.insert(COLLECTION, {
    name: String(name).trim(),
    email: String(email).trim(),
    message: String(message || '').trim(),
    read: false
  });
  res.status(201).json({ message: saved });
});

// Admin: full list, newest first.
router.get('/', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const items = await store.readAll(COLLECTION);
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ messages: items });
});

// Admin: mark a message read/unread.
router.patch('/:id/read', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const { read } = req.body || {};
  const updated = await store.updateById(COLLECTION, req.params.id, { read: !!read });
  if (!updated) return res.status(404).json({ error: 'Message not found.' });
  res.json({ message: updated });
});

// Admin: delete a message.
router.delete('/:id', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const ok = await store.removeById(COLLECTION, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Message not found.' });
  res.json({ ok: true });
});

module.exports = router;
