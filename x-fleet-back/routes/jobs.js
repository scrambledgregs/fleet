// routes/jobs.js
const express = require('express');
const router = express.Router();

// ---- in-memory store (replace with DB later) ----
const JOBS = []; // each is a plain job object

// helpers
function dayLabel(d) {
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
}
function isoDateOnly(d) {
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
}
function toWeekItem(job) {
  // Calendar.jsx expects: day, dateText, startTimeISO, assignedRepName, contact, jobType, address, id
  const start = new Date(job.startTime || job.startTimeISO || job.start);
  return {
    id: job.appointmentId || job.id,
    day: dayLabel(start),
    dateText: isoDateOnly(start),
    startTimeISO: start.toISOString(),
    assignedRepName: job.assignedRepName || null,
    contact: job.contact || null,
    jobType: job.jobType || 'Job',
    address: job.address || '',
    territory: job.territory || null,
    travelMinutesFromPrev: job.travelMinutesFromPrev ?? null,
  };
}

// ---- routes ----

// Create job
router.post('/jobs', (req, res) => {
  const body = req.body || {};
  const id = body.appointmentId || body.id || String(Date.now());
  const job = { ...body, id, appointmentId: body.appointmentId || id };

  // naive safety defaults
  if (!job.startTime && body.startTimeISO) job.startTime = body.startTimeISO;

  // upsert by id
  const idx = JOBS.findIndex(j => (j.appointmentId || j.id) === (job.appointmentId || job.id));
  if (idx >= 0) JOBS[idx] = job; else JOBS.push(job);

  // socket notify
  const io = req.app.get('io');
  io && io.emit('job:created', { id: job.appointmentId || job.id });

  res.json({ ok: true, job });
});

// List jobs (for planner lists)
router.get('/jobs', (req, res) => {
  res.json({ ok: true, items: JOBS });
});

// Get single job (JobDetails.jsx supports both plain and {items:{}} shapes)
router.get('/job/:id', (req, res) => {
  const id = req.params.id;
  const job = JOBS.find(j => String(j.appointmentId || j.id) === String(id));
  if (!job) return res.status(404).json({ ok: false, error: 'not found' });
  res.json(job); // or: res.json({ ok:true, items: job })
});

// Update job (time/assignee edits from JobDetails.jsx)
router.patch('/jobs/:id', (req, res) => {
  const id = req.params.id;
  const idx = JOBS.findIndex(j => String(j.appointmentId || j.id) === String(id));
  if (idx < 0) return res.status(404).json({ ok: false, error: 'not found' });

  JOBS[idx] = { ...JOBS[idx], ...req.body };

  const io = req.app.get('io');
  io && io.emit('job:updated', { id });

  res.json({ ok: true, job: JOBS[idx] });
});

// Calendar week feed (Calendar.jsx calls GET /api/week-appointments)
router.get('/week-appointments', (req, res) => {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0,0,0,0);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7); // next Sunday

  const withinWeek = JOBS.filter(j => {
    const t = new Date(j.startTime || j.startTimeISO || j.start);
    return !isNaN(t) && t >= startOfWeek && t < endOfWeek;
  });

  res.json(withinWeek.map(toWeekItem));
});

module.exports = router;