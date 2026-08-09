const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('../store');
const auth = require('../auth');
const { clientProjectUpload } = require('../upload');

const router = express.Router();
const COLLECTION = 'clientProjects';

// A client submits requirements + optional files. Requires login (role
// 'client') so they can only see their own projects afterward.
router.post('/', auth.attachUser, auth.requireRole('client', 'admin'), clientProjectUpload.array('files', 10), async (req, res) => {
  const { title, requirements } = req.body || {};
  if (!title || !requirements) return res.status(400).json({ error: 'title and requirements are required.' });
  const files = (req.files || []).map(f => ({
    originalName: f.originalname,
    url: `/storage/uploads/client-projects/${path.basename(f.path)}`
  }));
  const project = await store.insert(COLLECTION, {
    clientId: req.user.sub, title, requirements, files,
    milestones: [], deliverables: [], status: 'submitted'
  });
  res.status(201).json({ project });
});

// Client sees only their own; admin sees everything.
router.get('/', auth.attachUser, auth.requireAuth, async (req, res) => {
  const all = await store.readAll(COLLECTION);
  if (req.user.role === 'admin') return res.json({ projects: all });
  res.json({ projects: all.filter(p => p.clientId === req.user.sub) });
});

router.get('/:id', auth.attachUser, auth.requireAuth, async (req, res) => {
  const project = await store.find(COLLECTION, p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found.' });
  if (req.user.role !== 'admin' && project.clientId !== req.user.sub) {
    return res.status(403).json({ error: 'Not your project.' });
  }
  res.json({ project });
});

// Admin adds/updates milestones.
router.post('/:id/milestones', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const { title, dueDate } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required.' });
  const project = await store.find(COLLECTION, p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found.' });
  const milestone = { id: crypto.randomUUID(), title, dueDate: dueDate || null, status: 'pending' };
  const milestones = [...project.milestones, milestone];
  const updated = await store.updateById(COLLECTION, req.params.id, { milestones });
  res.status(201).json({ project: updated });
});

router.patch('/:id/milestones/:milestoneId', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'in-progress', 'done'].includes(status)) {
    return res.status(400).json({ error: 'status must be pending, in-progress, or done.' });
  }
  const project = await store.find(COLLECTION, p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found.' });
  const milestones = project.milestones.map(m => m.id === req.params.milestoneId ? { ...m, status } : m);
  const updated = await store.updateById(COLLECTION, req.params.id, { milestones });
  res.json({ project: updated });
});

// Admin uploads a deliverable; client (and admin) can then list/download it.
router.post('/:id/deliverables', auth.attachUser, auth.requireRole('admin'), clientProjectUpload.array('files', 10), async (req, res) => {
  const project = await store.find(COLLECTION, p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found.' });
  const newFiles = (req.files || []).map(f => ({
    originalName: f.originalname,
    url: `/storage/uploads/client-projects/${path.basename(f.path)}`,
    uploadedAt: new Date().toISOString()
  }));
  const deliverables = [...project.deliverables, ...newFiles];
  const updated = await store.updateById(COLLECTION, req.params.id, { deliverables });
  res.status(201).json({ project: updated });
});

module.exports = router;
