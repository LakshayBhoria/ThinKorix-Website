const express = require('express');
const store = require('../store');
const auth = require('../auth');

const router = express.Router();
const COLLECTION = 'research';
const TYPES = ['paper', 'whitepaper', 'patent', 'opensource'];
const GROUPS = ['AI', 'Hardware', 'Software'];

// Public listing — filterable by group/type.
router.get('/', async (req, res) => {
  const { group, type } = req.query;
  let items = await store.readAll(COLLECTION);
  if (group) items = items.filter(i => i.group === group);
  if (type) items = items.filter(i => i.type === type);
  res.json({ items });
});

router.get('/:id', async (req, res) => {
  const item = await store.find(COLLECTION, i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found.' });
  res.json({ item });
});

// Admin (or a 'researcher'-flagged mentor/contributor — kept simple as
// admin-only for now; loosen with requireRole('admin','contributor') if
// you want vetted contributors publishing directly).
router.post('/', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const { title, type, group, authors, link, description, publishedAt } = req.body || {};
  if (!title || !TYPES.includes(type) || !GROUPS.includes(group)) {
    return res.status(400).json({ error: `title required; type must be one of ${TYPES.join(', ')}; group must be one of ${GROUPS.join(', ')}.` });
  }
  const item = await store.insert(COLLECTION, {
    title, type, group, authors: authors || '', link: link || '',
    description: description || '', publishedAt: publishedAt || new Date().toISOString()
  });
  res.status(201).json({ item });
});

router.patch('/:id', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const updated = await store.updateById(COLLECTION, req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Not found.' });
  res.json({ item: updated });
});

router.delete('/:id', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const ok = await store.removeById(COLLECTION, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
});

module.exports = router;
