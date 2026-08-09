const express = require('express');
const store = require('../store');
const auth = require('../auth');

const router = express.Router();
const COLLECTION = 'reviews';

// Public submission — goes in as "pending" until an admin approves it.
router.post('/', async (req, res) => {
  const { name, role, message, rating } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required.' });
  }
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'rating must be a whole number from 1 to 5.' });
  }
  const saved = await store.insert(COLLECTION, {
    name: String(name).trim(),
    role: String(role || '').trim(),
    message: String(message).trim(),
    rating: ratingNum,
    status: 'pending'
  });
  res.status(201).json({ review: saved });
});

// Public — only approved reviews, for the homepage testimonials section.
router.get('/approved', async (req, res) => {
  const items = await store.filter(COLLECTION, r => r.status === 'approved');
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ reviews: items });
});

// Admin: full list (any status), newest first.
router.get('/', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const items = await store.readAll(COLLECTION);
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ reviews: items });
});

// Admin: approve or reject.
router.patch('/:id/status', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved, rejected, or pending.' });
  }
  const updated = await store.updateById(COLLECTION, req.params.id, { status });
  if (!updated) return res.status(404).json({ error: 'Review not found.' });
  res.json({ review: updated });
});

// Admin: delete.
router.delete('/:id', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const ok = await store.removeById(COLLECTION, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Review not found.' });
  res.json({ ok: true });
});

module.exports = router;
