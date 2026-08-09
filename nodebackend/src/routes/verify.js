const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

// Public — scanning a certificate's QR code hits this.
router.get('/:certId', async (req, res) => {
  const match = await db.getByCertId(req.params.certId);
  if (!match) return res.json({ valid: false });
  if (match.status === 'Revoked') return res.json({ valid: false, revoked: true, certificateId: match.certificateId });
  res.json({
    valid: true,
    name: match.fullName,
    position: match.position,
    department: match.department,
    startDate: match.startDate,
    endDate: match.endDate,
    certificateId: match.certificateId,
    internNo: match.internNo
  });
});

// Admin-only — support/lookup by partial name or email when the person
// doesn't have their certificate ID handy.
router.get('/', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  if (!q) return res.status(400).json({ error: 'Provide ?q=name-or-email' });
  const all = await db.getAll();
  const results = all.filter(r =>
    r.fullName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)
  );
  res.json({ results });
});

module.exports = router;
