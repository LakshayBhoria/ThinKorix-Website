const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db');               // interns collection (offer/cert records)
const store = require('../store');          // tasks/reports/attendance collections
const auth = require('../auth');
const { buildOfferLetter, buildCertificate } = require('../documentEngine');
const { sendMail } = require('../mailer');
const { uploadToDrive } = require('../googleDrive');

// After building offerPath/certPath locally, also push them to Drive when
// enabled and return the URL fields to merge into the intern record. Local
// files are still generated either way — Drive needs a local file to
// upload, and mailer attachments read from local disk — but on hosts with
// ephemeral storage (Render), the Drive URLs are what actually survive a
// redeploy, so the frontend prefers them over the local /storage/ links.
async function persistToDrive({ offerPath, certPath, prevOfferDriveId, prevCertDriveId }) {
  if (!config.DRIVE_ENABLED) return {};
  const [offer, cert] = await Promise.all([
    uploadToDrive({
      localPath: offerPath, fileName: path.basename(offerPath),
      folderId: config.DRIVE_OFFERS_FOLDER_ID, replaceFileId: prevOfferDriveId
    }),
    uploadToDrive({
      localPath: certPath, fileName: path.basename(certPath),
      folderId: config.DRIVE_CERTS_FOLDER_ID, replaceFileId: prevCertDriveId
    })
  ]);
  return {
    offerLetterUrl: offer.downloadUrl, offerLetterDriveId: offer.fileId,
    certificateUrl: cert.downloadUrl, certificateDriveId: cert.fileId
  };
}

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
      ...(await persistToDrive({ offerPath, certPath })),
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
      offerLetterUrl: record.offerLetterUrl || `/storage/offers/${record.offerLetterFile}`,
      certificateUrl: record.certificateUrl || `/storage/certificates/${record.certificateFile}`
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
 * ASSIGNMENTS — an intern submits their work (optionally against a task
 * the admin/mentor assigned); admin/mentor grade it with marks. Marks
 * are what the leaderboard ranks on.
 * ------------------------------------------------------------------- */
router.post('/:internNo/assignments', auth.attachUser, auth.requireAuth, async (req, res) => {
  const { internNo } = req.params;
  if (req.user.role === 'intern') {
    const own = (await db.getAll()).find(i => i.email === req.user.email);
    if (!own || String(own.internNo) !== String(internNo)) {
      return res.status(403).json({ error: 'You can only submit assignments for your own internship.' });
    }
  } else if (!['admin', 'mentor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'You do not have permission to do that.' });
  }
  const { title, description, link, taskId } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required.' });
  const assignment = await store.insert('assignments', {
    internNo, title, description: description || '', link: link || '', taskId: taskId || null,
    status: 'submitted', marks: null, maxMarks: 100, feedback: '',
    gradedBy: null, gradedAt: null, submittedAt: new Date().toISOString()
  });
  res.status(201).json({ assignment });
});

router.get('/:internNo/assignments', auth.attachUser, auth.requireAuth, async (req, res) => {
  res.json({ assignments: await store.filter('assignments', a => a.internNo === req.params.internNo) });
});

// Admin/mentor grading queue — every submitted assignment, across all interns.
router.get('/assignments', auth.attachUser, auth.requireRole('admin', 'mentor'), async (req, res) => {
  res.json({ assignments: await store.readAll('assignments') });
});

router.patch('/assignments/:assignmentId/grade', auth.attachUser, auth.requireRole('admin', 'mentor'), async (req, res) => {
  const { marks, feedback, maxMarks } = req.body || {};
  if (marks === undefined || marks === null || isNaN(Number(marks))) {
    return res.status(400).json({ error: 'marks (a number) is required.' });
  }
  const patch = {
    marks: Number(marks), status: 'graded', feedback: feedback || '',
    gradedBy: req.user.sub, gradedAt: new Date().toISOString()
  };
  if (maxMarks !== undefined && maxMarks !== null && maxMarks !== '') patch.maxMarks = Number(maxMarks);
  const updated = await store.updateById('assignments', req.params.assignmentId, patch);
  if (!updated) return res.status(404).json({ error: 'Assignment not found.' });
  res.json({ assignment: updated });
});

/* ---------------------------------------------------------------------
 * GROUPS — admin organizes interns into groups (team, cohort, project).
 * ------------------------------------------------------------------- */
router.post('/groups', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const { name, description, memberInternNos } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required.' });
  const group = await store.insert('groups', {
    name, description: description || '',
    memberInternNos: Array.isArray(memberInternNos) ? memberInternNos.map(String) : [],
    createdBy: req.user.sub
  });
  res.status(201).json({ group });
});

router.get('/groups', auth.attachUser, auth.requireAuth, async (req, res) => {
  const all = await store.readAll('groups');
  if (req.user.role === 'admin' || req.user.role === 'mentor') return res.json({ groups: all });
  const own = (await db.getAll()).find(i => i.email === req.user.email);
  const myNo = own ? String(own.internNo) : null;
  res.json({ groups: myNo ? all.filter(g => g.memberInternNos.includes(myNo)) : [] });
});

router.patch('/groups/:groupId', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const { name, description, memberInternNos } = req.body || {};
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (memberInternNos !== undefined) patch.memberInternNos = Array.isArray(memberInternNos) ? memberInternNos.map(String) : [];
  const updated = await store.updateById('groups', req.params.groupId, patch);
  if (!updated) return res.status(404).json({ error: 'Group not found.' });
  res.json({ group: updated });
});

router.delete('/groups/:groupId', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const ok = await store.removeById('groups', req.params.groupId);
  if (!ok) return res.status(404).json({ error: 'Group not found.' });
  res.json({ ok: true });
});

/* ---------------------------------------------------------------------
 * LEADERBOARD — public within the org; ranks primarily by total marks
 * scored on graded assignments, with tasks completed and report count
 * as tiebreakers.
 * ------------------------------------------------------------------- */
router.get('/leaderboard', async (req, res) => {
  const interns = await db.getAll();
  const allTasks = await store.readAll('tasks');
  const allReports = await store.readAll('reports');
  const allAssignments = await store.readAll('assignments');
  const rows = interns.map(i => {
    const tasksDone = allTasks.filter(t => t.internNo === String(i.internNo) && t.status === 'done').length;
    const reportsSubmitted = allReports.filter(r => r.internNo === String(i.internNo)).length;
    const graded = allAssignments.filter(a => a.internNo === String(i.internNo) && a.status === 'graded');
    const totalMarks = graded.reduce((sum, a) => sum + (Number(a.marks) || 0), 0);
    return {
      internNo: i.internNo, fullName: i.fullName, department: i.department,
      totalMarks, assignmentsGraded: graded.length, tasksDone, reportsSubmitted
    };
  }).sort((a, b) => b.totalMarks - a.totalMarks || b.tasksDone - a.tasksDone || b.reportsSubmitted - a.reportsSubmitted);
  res.json({ leaderboard: rows });
});

/* ---------------------------------------------------------------------
 * ADMIN CERTIFICATE ACTIONS
 * ------------------------------------------------------------------- */
router.post('/:internNo/resend', auth.attachUser, auth.requireRole('admin'), async (req, res) => {
  const r = await db.getByInternNo(req.params.internNo);
  if (!r) return res.status(404).json({ error: 'Intern not found.' });

  // Some records (manually added, imported, or otherwise created outside
  // the normal /register flow) never got offerLetterFile/certificateFile
  // set at all. path.join() throws on undefined, so guard for that before
  // touching the filesystem — treat "field missing" the same as "file
  // missing" and regenerate below.
  let offerPath = r.offerLetterFile ? path.join(config.PATHS.offersOut, r.offerLetterFile) : null;
  let certPath = r.certificateFile ? path.join(config.PATHS.certsOut, r.certificateFile) : null;

  // On hosts with an ephemeral filesystem (e.g. Render's free tier), the
  // generated PDFs can disappear after a restart/redeploy even though the
  // intern record itself survives. Rebuild them on the fly instead of
  // letting nodemailer choke on a missing attachment path — that unhandled
  // failure is what was surfacing as a 502. Also regenerate (and push to
  // Drive) when Drive is enabled but this record predates it — otherwise
  // it'd keep pointing at local files that vanish on the next redeploy.
  const needsDriveBackfill = config.DRIVE_ENABLED && (!r.offerLetterUrl || !r.certificateUrl);
  try {
    if (!offerPath || !certPath || !fs.existsSync(offerPath) || !fs.existsSync(certPath) || needsDriveBackfill) {
      offerPath = await buildOfferLetter({
        internNo: r.internNo, offerLetterId: r.offerLetterId, fullName: r.fullName,
        position: r.position, department: r.department, startDate: r.startDate,
        durationLabel: `${r.durationMonths} month${r.durationMonths > 1 ? 's' : ''}`
      });
      certPath = await buildCertificate({
        fullName: r.fullName, position: r.position, department: r.department,
        startDate: r.startDate, endDate: r.endDate, certificateId: r.certificateId
      });
      const driveFields = await persistToDrive({
        offerPath, certPath, prevOfferDriveId: r.offerLetterDriveId, prevCertDriveId: r.certificateDriveId
      });
      await db.updateByInternNo(r.internNo, {
        offerLetterFile: path.basename(offerPath),
        certificateFile: path.basename(certPath),
        ...driveFields
      });
    }
  } catch (err) {
    console.error(`[interns] resend: failed to regenerate PDFs for #${r.internNo} —`, err.message);
    return res.status(500).json({ error: 'Could not prepare the certificate/offer letter files. Please try again.' });
  }

  try {
    await sendMail({
      to: r.email,
      subject: `Your ${config.COMPANY_NAME} Internship Offer Letter — ${r.offerLetterId}`,
      text: `Hi ${r.fullName},\n\nRe-sending your Offer Letter and Certificate of Internship as requested.\n\n` +
        `Best wishes,\n${config.FOUNDER_NAME}\n${config.FOUNDER_TITLE}, ${config.COMPANY_NAME}`,
      attachments: [
        { filename: path.basename(offerPath), path: offerPath },
        { filename: path.basename(certPath), path: certPath }
      ]
    });
  } catch (err) {
    // Caught explicitly so a bad SMTP config or a rejected send returns a
    // clean JSON error instead of an unhandled rejection that hangs the
    // request until the platform itself times it out with a 502.
    console.error(`[interns] resend: sendMail failed for #${r.internNo} (${r.email}) —`, err.message);
    return res.status(502).json({ error: `Could not send the email — ${err.message}. Check the SMTP_* settings in your server's environment.` });
  }

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

  try {
    const offerPath = await buildOfferLetter({
      internNo: r.internNo, offerLetterId: r.offerLetterId, fullName: r.fullName,
      position: r.position, department: r.department, startDate: r.startDate,
      durationLabel: `${r.durationMonths} month${r.durationMonths > 1 ? 's' : ''}`
    });
    const certPath = await buildCertificate({
      fullName: r.fullName, position: r.position, department: r.department,
      startDate: r.startDate, endDate: r.endDate, certificateId: r.certificateId
    });

    const driveFields = await persistToDrive({
      offerPath, certPath, prevOfferDriveId: r.offerLetterDriveId, prevCertDriveId: r.certificateDriveId
    });
    const updated = await db.updateByInternNo(req.params.internNo, {
      offerLetterFile: path.basename(offerPath),
      certificateFile: path.basename(certPath),
      ...driveFields
    });
    res.json({ intern: updated });
  } catch (err) {
    console.error(`[interns] regenerate: failed for #${r.internNo} —`, err.message);
    res.status(500).json({ error: 'Could not regenerate the PDFs. Check server logs for details.' });
  }
});

module.exports = router;
