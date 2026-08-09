const express = require('express');
const db = require('../db');
const store = require('../store');
const auth = require('../auth');

const router = express.Router();

router.get('/analytics', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const [interns, ideas, research, clientProjects, users] = await Promise.all([
    db.getAll(),
    store.readAll('ideas'),
    store.readAll('research'),
    store.readAll('clientProjects'),
    store.readAll('users')
  ]);

  res.json({
    interns: {
      total: interns.length,
      active: interns.filter(i => i.status === 'Active').length,
      revoked: interns.filter(i => i.status === 'Revoked').length
    },
    ideas: {
      total: ideas.length,
      pending: ideas.filter(i => i.status === 'pending').length,
      approved: ideas.filter(i => i.status === 'approved').length,
      rejected: ideas.filter(i => i.status === 'rejected').length
    },
    research: { total: research.length },
    clientProjects: {
      total: clientProjects.length,
      byStatus: clientProjects.reduce((acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1;
        return acc;
      }, {})
    },
    users: {
      total: users.length,
      byRole: users.reduce((acc, u) => {
        acc[u.role] = (acc[u.role] || 0) + 1;
        return acc;
      }, {})
    }
  });
});

router.get('/users', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  res.json({ users: (await store.readAll('users')).map(auth.sanitize) });
});

router.patch('/users/:id/role', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const { role } = req.body || {};
  const allowed = ['admin', 'mentor', 'intern', 'client', 'contributor'];
  if (!allowed.includes(role)) return res.status(400).json({ error: `role must be one of ${allowed.join(', ')}` });
  const updated = await store.updateById('users', req.params.id, { role });
  if (!updated) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: auth.sanitize(updated) });
});

module.exports = router;
