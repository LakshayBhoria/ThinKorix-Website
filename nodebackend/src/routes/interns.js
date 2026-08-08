const express = require('express');
const path = require('path');
const config = require('../config');
const db = require('../db');               // interns collection (offer/cert records)
const store = require('../store');          // tasks/reports/attendance collections
const auth = require('../auth');
const { buildOfferLetter, buildCertificate } = require('../documentEngine');
const { sendMail } = require('../mailer');

const router = express.Router();

const POSITIONS = [
  'Mechanical Head (Onsite)', 'Software Engineering Intern', 'AI & ML Intern',
  'Web & Mobile Development Intern', 'Hardware Intern', 'Cloud & DevOps Intern'
];
const DEPARTMENTS = [
  'Mechanical Department', 'Software Department', 'AI & ML Department',
  'Web & Mobile Department', 'Hardware Department', 'Cloud & DevOps Department'
];
const DURATIONS = { '1 month': 1, '2 months': 2, '3 months': 3, '6 months': 6 };

/* ---------------------------------------------------------------------
 * REGISTRATION — public. Generates + emails the Offer Letter and
 * Certificate PDFs, same as the original Apps Script flow.
 * ------------------------------------------------------------------- */
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, phone, college, position, department, startDate, duration } = req.body || {};

    const missing = ['fullName', 'email', 'phone', 'position', 'department', 'startDate', 'duration']
      .filter(k => !req.body || !req.body[k]);
    if (missing.length) return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
    if (!POSITIONS.includes(position)) return res.status(400).json({ error: 'Invalid position.' });
    if (!DEPARTMENTS.includes(department)) return res.status(400).json({ error: 'Invalid department.' });
    if (!DURATIONS[duration]) return res.status(400).json({ error: 'Invalid duration.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email.' });

    const start = new Date(startDate);
    if (isNaN(start.getTime())) return res.status(400).json({ error: 'Invalid startDate.' });
    const durationMonths = DURATIONS[duration];
    const end = new Date(start);
    end.setMonth(end.getMonth() + durationMonths);

    const internNo = await db.nextInternNumber();
    const offerLetterId = `THX/INT/${config.YEAR}/${internNo}`;
    const certificateId = `THX-INTERN-${config.YEAR}-${internNo}`;

    const offerPath = await buildOfferLetter({
      internNo, offerLetterId, fullName, position, department, startDate: start, durationLabel: duration
    });
    const certPath = await buildCertificate({
      fullName, position, department, startDate: start, endDate: end, certificateId
    });

    const record = {
      internNo, fullName, email, phone, college: college || '',
      position, department,
      startDate: start.toISOString(), endDate: end.toISOString(), durationMonths,
      offerLetterId, certificateId,
      offerLetterFile: path.basename(offerPath), certificateFile: path.basename(certPath),
      mentorId: null, status: 'Active', createdAt: new Date().toISOString()
    };
    await db.append(record);

    if (config.SEND_EMAIL) {
      const verifyUrl = `${config.VERIFY_PAGE_URL}?certId=${encodeURIComponent(certificateId)}`;
      await sendMail({
        to: email,
        subject: `Your ${config.COMPANY_NAME} Internship Offer Letter — ${offerLetterId}`,
        text:
          `Hi ${fullName},\n\nCongratulations! Your internship registration with ${config.COMPANY_NAME} ` +
          `has been confirmed as ${position} (${department}).\n\n` +
          `Your Offer Letter is attached. Your Intern No. is ${internNo}.\n` +
          `Your Certificate of Internship (${certificateId}) is also attached — verify any time at:\n${verifyUrl}\n\n` +
          `Best wishes,\n${config.FOUNDER_NAME}\n${config.FOUNDER_TITLE}, ${config.COMPANY_NAME}`,
        attachments: [
          { filename: path.basename(offerPath), path: offerPath },
          { filename: path.basename(certPath), path: certPath }
        ]
      });
    }

    res.status(201).json({
      ok: true, internNo, offerLetterId, certificateId,
      offerLetterUrl: `/storage/offers/${record.offerLetterFile}`,
      certificateUrl: `/storage/certificates/${record.certificateFile}`
    });
  } catch (err) {
    console.error('Registration failed:', err);
    res.status(500).json({ error: 'Something went wrong generating your documents. Please try again or contact us.' });
  }
});

/* ---------------------------------------------------------------------
 * LISTING — admin sees everyone; a mentor sees only their assigned
 * interns; an intern sees only their own record.
 * ------------------------------------------------------------------- */
router.get('/', auth.attachUser, auth.requireAuth, async (req, res) => {
  const all = await db.getAll();
  if (req.user.role === 'admin') return res.json({ interns: all });
  if (req.user.role === 'mentor') return res.json({ interns: all.filter(i => i.mentorId === req.user.sub) });
  if (req.user.role === 'intern') return res.json({ interns: all.filter(i => i.email === req.user.email) });
  return res.status(403).json({ error: 'You do not have permission to view this.' });
});

// Admin-token-friendly variant matching the original admin.html contract.
router.get('/admin-list', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  res.json({ interns: await db.getAll() });
});

/* ---------------------------------------------------------------------
 * MENTOR ASSIGNMENT — admin only
 * ------------------------------------------------------------------- */
router.post('/:internNo/assign-mentor', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const { mentorId } = req.body || {};
  if (!mentorId) return res.status(400).json({ error: 'mentorId is required.' });
  const mentor = await auth.getUserById(mentorId);
  if (!mentor || mentor.role !== 'mentor') return res.status(400).json({ error: 'mentorId must belong to a mentor account.' });
  const updated = await db.updateByInternNo(req.params.internNo, { mentorId });
  if (!updated) return res.status(404).json({ error: 'Intern not found.' });
  res.json({ intern: updated });
});

/* ---------------------------------------------------------------------
 * TASKS — mentor/admin assign, intern views/updates their own status
 * ------------------------------------------------------------------- */
router.post('/:internNo/tasks', auth.attachUser, auth.requireRole('admin', 'mentor'), async (req, res) => {
  const { title, description, dueDate } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required.' });
  const task = await store.insert('tasks', {
    internNo: req.params.internNo, title, description: description || '',
    dueDate: dueDate || null, status: 'pending', assignedBy: req.user.sub
  });
  res.status(201).json({ task });
});

router.get('/:internNo/tasks', auth.attachUser, auth.requireAuth, async (req, res) => {
  res.json({ tasks: await store.filter('tasks', t => t.internNo === req.params.internNo) });
});

router.patch('/tasks/:taskId', auth.attachUser, auth.requireAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'in-progress', 'done'].includes(status)) {
    return res.status(400).json({ error: 'status must be pending, in-progress, or done.' });
  }
  const updated = await store.updateById('tasks', req.params.taskId, { status });
  if (!updated) return res.status(404).json({ error: 'Task not found.' });
  res.json({ task: updated });
});

/* ---------------------------------------------------------------------
 * DAILY / WEEKLY REPORTS — intern submits, mentor/admin view
 * ------------------------------------------------------------------- */
router.post('/:internNo/reports', auth.attachUser, auth.requireAuth, async (req, res) => {
  const { type, content } = req.body || {};
  if (!['daily', 'weekly'].includes(type)) return res.status(400).json({ error: 'type must be daily or weekly.' });
  if (!content) return res.status(400).json({ error: 'content is required.' });
  const report = await store.insert('reports', { internNo: req.params.internNo, type, content, date: new Date().toISOString() });
  res.status(201).json({ report });
});

router.get('/:internNo/reports', auth.attachUser, auth.requireAuth, async (req, res) => {
  res.json({ reports: await store.filter('reports', r => r.internNo === req.params.internNo) });
});

/* ---------------------------------------------------------------------
 * ATTENDANCE — mentor/admin marks
 * ------------------------------------------------------------------- */
router.post('/:internNo/attendance', auth.attachUser, auth.requireRole('admin', 'mentor'), async (req, res) => {
  const { date, status } = req.body || {};
  if (!['present', 'absent'].includes(status)) return res.status(400).json({ error: 'status must be present or absent.' });
  const record = await store.insert('attendance', { internNo: req.params.internNo, date: date || new Date().toISOString(), status });
  res.status(201).json({ attendance: record });
});

router.get('/:internNo/attendance', auth.attachUser, auth.requireAuth, async (req, res) => {
  res.json({ attendance: await store.filter('attendance', a => a.internNo === req.params.internNo) });
});

/* ---------------------------------------------------------------------
 * LEADERBOARD — public within the org; ranks by tasks completed, with
 * report count as a tiebreaker.
 * ------------------------------------------------------------------- */
router.get('/leaderboard', async (req, res) => {
  const interns = await db.getAll();
  const allTasks = await store.readAll('tasks');
  const allReports = await store.readAll('reports');
  const rows = interns.map(i => {
    const tasksDone = allTasks.filter(t => t.internNo === String(i.internNo) && t.status === 'done').length;
    const reportsSubmitted = allReports.filter(r => r.internNo === String(i.internNo)).length;
    return { internNo: i.internNo, fullName: i.fullName, department: i.department, tasksDone, reportsSubmitted };
  }).sort((a, b) => b.tasksDone - a.tasksDone || b.reportsSubmitted - a.reportsSubmitted);
  res.json({ leaderboard: rows });
});

/* ---------------------------------------------------------------------
 * ADMIN CERTIFICATE ACTIONS
 * ------------------------------------------------------------------- */
router.post('/:internNo/resend', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const r = await db.getByInternNo(req.params.internNo);
  if (!r) return res.status(404).json({ error: 'Intern not found.' });
  await sendMail({
    to: r.email,
    subject: `Your ${config.COMPANY_NAME} Internship Offer Letter — ${r.offerLetterId}`,
    text: `Hi ${r.fullName},\n\nRe-sending your Offer Letter and Certificate of Internship as requested.\n\n` +
      `Best wishes,\n${config.FOUNDER_NAME}\n${config.FOUNDER_TITLE}, ${config.COMPANY_NAME}`,
    attachments: [
      { filename: r.offerLetterFile, path: path.join(config.PATHS.offersOut, r.offerLetterFile) },
      { filename: r.certificateFile, path: path.join(config.PATHS.certsOut, r.certificateFile) }
    ]
  });
  res.json({ ok: true });
});

router.post('/:internNo/revoke', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const updated = await db.updateByInternNo(req.params.internNo, { status: 'Revoked' });
  if (!updated) return res.status(404).json({ error: 'Intern not found.' });
  res.json({ intern: updated });
});

router.post('/:internNo/reinstate', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const updated = await db.updateByInternNo(req.params.internNo, { status: 'Active' });
  if (!updated) return res.status(404).json({ error: 'Intern not found.' });
  res.json({ intern: updated });
});

// Re-renders both PDFs from the current templates/coordinates — useful
// after nudging xPct/yPct in documentEngine.js to fix text placement.
router.post('/:internNo/regenerate', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const r = await db.getByInternNo(req.params.internNo);
  if (!r) return res.status(404).json({ error: 'Intern not found.' });

  const offerPath = await buildOfferLetter({
    internNo: r.internNo, offerLetterId: r.offerLetterId, fullName: r.fullName,
    position: r.position, department: r.department, startDate: r.startDate,
    durationLabel: `${r.durationMonths} month${r.durationMonths > 1 ? 's' : ''}`
  });
  const certPath = await buildCertificate({
    fullName: r.fullName, position: r.position, department: r.department,
    startDate: r.startDate, endDate: r.endDate, certificateId: r.certificateId
  });

  const updated = await db.updateByInternNo(req.params.internNo, {
    offerLetterFile: path.basename(offerPath),
    certificateFile: path.basename(certPath)
  });
  res.json({ intern: updated });
});

module.exports = router;
