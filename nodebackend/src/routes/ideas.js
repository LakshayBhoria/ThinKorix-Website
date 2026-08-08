const express = require('express');
const path = require('path');
const store = require('../store');
const auth = require('../auth');
const { ideaUpload } = require('../upload');

const router = express.Router();
const COLLECTION = 'ideas';

// Public submission. submitterType distinguishes students vs employees per
// the portal's card copy. Attach up to 5 files (deck, sketch, doc, etc).
router.post('/', auth.attachUser, ideaUpload.array('attachments', 5), async (req, res) => {
  const { title, description, submitterName, submitterEmail, submitterType } = req.body || {};
  if (!title || !description || !submitterName || !submitterEmail) {
    return res.status(400).json({ error: 'title, description, submitterName and submitterEmail are required.' });
  }
  if (!['student', 'employee'].includes(submitterType)) {
    return res.status(400).json({ error: 'submitterType must be student or employee.' });
  }
  const attachments = (req.files || []).map(f => ({
    originalName: f.originalname,
    url: `/storage/uploads/ideas/${path.basename(f.path)}`
  }));
  const idea = await store.insert(COLLECTION, {
    title, description, submitterName, submitterEmail, submitterType,
    submitterId: req.user ? req.user.sub : null,
    attachments, status: 'pending', reviewNote: ''
  });
  res.status(201).json({ idea });
});

// A submitter can see their own past ideas (by matching email — no login
// required to submit, so we key on email rather than requiring auth).
router.get('/mine', async (req, res) => {
  const email = String(req.query.email || '').toLowerCase();
  if (!email) return res.status(400).json({ error: 'Provide ?email=you@example.com' });
  res.json({ ideas: await store.filter(COLLECTION, i => i.submitterEmail.toLowerCase() === email) });
});

// Admin: full list, filterable by status.
router.get('/', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const { status } = req.query;
  let items = await store.readAll(COLLECTION);
  if (status) items = items.filter(i => i.status === status);
  res.json({ ideas: items });
});

router.patch('/:id/review', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const { status, reviewNote } = req.body || {};
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved, rejected, or pending.' });
  }
  const updated = await store.updateById(COLLECTION, req.params.id, { status, reviewNote: reviewNote || '' });
  if (!updated) return res.status(404).json({ error: 'Idea not found.' });
  res.json({ idea: updated });
});

module.exports = router;
