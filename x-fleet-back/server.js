import express from 'express'
import http from 'http'
import { Server as SocketIOServer } from 'socket.io'
import cors from 'cors'
import dotenv from 'dotenv'

import { scoreAllReps } from './lib/fit.js'
import { getContact, updateAppointmentOwner, rescheduleAppointment, appendAppointmentNotes } from './lib/ghl.js'

dotenv.config()

const app = express()
const server = http.createServer(app)
const io = new SocketIOServer(server, {
  cors: { origin: process.env.ALLOW_ORIGIN || '*', methods: ['GET','POST'] }
})

// 1) CORS first
app.use(cors({ origin: process.env.ALLOW_ORIGIN || '*' }))

// 2) Body parsers (JSON + form-encoded)
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

// 3) Simple request logger (after parsers so req.body is available)
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} ct=${req.headers['content-type'] || ''}`)
  if (req.method !== 'GET') {
    try { console.log('[BODY]', JSON.stringify(req.body).slice(0, 500)) } catch {}
  }
  next()
})

// quick GET probe for the webhook path
app.get('/ghl/appointment-created', (req, res) => {
  res.json({ ok: true, method: 'GET', tip: 'POST to this path for webhooks' });
});

// ---- In-memory stores ----
const techs = [
  { id: 1, name: 'Tech 1', status: 'En Route', pos: [33.4484,-112.0740], skills: ['Reroof','Repair'], territory: 'EAST', route: [] },
  { id: 2, name: 'Tech 2', status: 'On Site', pos: [33.457,-112.07], skills: ['Repair'], territory: 'WEST', route: [] },
  { id: 3, name: 'Tech 3', status: 'En Route', pos: [33.44,-112.09], skills: ['Inspection','Reroof'], territory: 'EAST', route: [] },
]
const jobs = new Map() // appointmentId -> enriched job (incl. contact snapshot)

// Quick test helper: clear in-memory jobs
app.post('/api/clear-jobs', (req, res) => {
  jobs.clear()
  res.json({ ok: true, message: 'Jobs cleared' })
})

// ---- WS snapshot for map ----
io.on('connection', (socket) => {
  socket.emit('tech:snapshot', techs.map(t => ({ id: t.id, name: t.name, status: t.status, pos: t.pos })))
})

// ---- Health ----
app.get('/health', (req,res)=> res.json({ ok:true }))

// ---- Week appointments (from store) ----
app.get('/api/week-appointments', (req,res) => {
  const list = Array.from(jobs.values()).map(j => {
    let day = j.day, time = j.time
    if (!day || !time) {
      const d = new Date(j.startTime)
      day = d.toLocaleDateString(undefined, { weekday: 'short' })
      time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    }
    return {
      id: j.appointmentId,
      day, time,
      address: toAddressString(j.address),
      lat: j.lat, lng: j.lng,
      jobType: j.jobType, estValue: j.estValue, territory: j.territory,
      contact: j.contact
    }
  })
  res.json(list)
})

/* ==== AI: suggest best times for the bot ===================================
   The GHL bot posts address/lat/lng + job meta + a preferred window.
   We try candidate start times and return the top 2–3 options with rep + reason.
=========================================================================== */
app.post('/ai/suggest-times', async (req, res) => {
  try {
    const { address, lat, lng, jobType, estValue = 0, territory, preferredStart, preferredEnd } = req.body || {}

    const baseJob = {
      appointmentId: 'ad-hoc-' + Math.random().toString(36).slice(2),
      address: address || '',
      lat: Number(lat ?? 33.455),
      lng: Number(lng ?? -112.05),
      startTime: preferredStart || new Date().toISOString(),
      endTime: preferredEnd || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      jobType: jobType || 'Repair',
      estValue: Number(estValue) || 0,
      territory: territory || 'EAST'
    }

    const reps = techs.map(t => ({ id: t.id, name: t.name, skills: t.skills, territory: t.territory, route: t.route }))
    const starts = buildCandidateStarts(baseJob.startTime) // every 30m over next few hrs

    const options = []
    for (const s of starts) {
      const trial = { ...baseJob, startTime: s, endTime: new Date(new Date(s).getTime() + 60*60*1000).toISOString() }
      const scored = await scoreAllReps(trial, reps)
      if (scored.length) options.push({ startTime: trial.startTime, endTime: trial.endTime, decision: scored[0] })
    }

    options.sort((a,b) => a.decision.total - b.decision.total)
    return res.json({
      ok: true,
      suggestions: options.slice(0,3).map(o => ({
        startTime: o.startTime,
        endTime: o.endTime,
        repId: o.decision.repId,
        repName: o.decision.repName,
        reason: o.decision.reason,
        fit: Number(o.decision.total.toFixed(2))
      }))
    })
  } catch (e) {
    console.error('suggest-times error', e)
    res.status(500).json({ ok:false, error:'internal_error' })
  }
})

function buildCandidateStarts(baseISO){
  const base = new Date(baseISO || Date.now())
  const out = []
  for (let k = 0; k < 6; k++){
    const t = new Date(base.getTime() + k * 30 * 60 * 1000)
    t.setSeconds(0,0)
    out.push(t.toISOString())
  }
  return out
}

// ---- Job detail with full GHL contact snapshot ----
app.get('/api/job/:id', (req,res) => {
  const j = jobs.get(req.params.id)
  if(!j) return res.status(404).json({ error: 'not_found' })
  res.json(j)
})

// ---- GHL webhook: enrich job with contact card ----

app.post('/ghl/appointment-created', async (req, res) => {
  try {
    console.log('[REQ] POST /ghl/appointment-created');
    console.log('[QUERY]', req.query);
    console.log('[BODY]', req.body);

    // ✅ single declaration: merge query params and body
    const body = { ...(req.query || {}), ...(req.body || {}) };
    console.log('[MERGED BODY]', body);

    // Try to synthesize top-level contact fields if they were nested
    const nestedContact =
      body.contact ||
      body.appointment?.contact ||
      body.payload?.contact ||
      body.appointment?.customer ||
      body.payload?.appointment?.customer ||
      body.customer || {};

    body.contactFirstName ||= nestedContact.first_name || nestedContact.firstName;
    body.contactLastName  ||= nestedContact.last_name  || nestedContact.lastName;
    body.contactEmail     ||= nestedContact.email;
    body.contactPhone     ||= nestedContact.phone;
    body.contactId        ||= nestedContact.id;
    body.address          ||= nestedContact.full_address || nestedContact.fullAddress ||
                              [nestedContact.address, nestedContact.city, nestedContact.state, nestedContact.postal_code || nestedContact.postalCode]
                                .filter(Boolean).join(', ');

    const must = ['contactId','contactFirstName','contactLastName','contactEmail','contactPhone','startTime','endTime','address'];
    console.log('[VERIFY] webhook snapshot:', Object.fromEntries(must.map(k => [k, body[k]])));
    console.log('[VERIFY] missing-or-empty:', must.filter(k => body[k] == null || body[k] === ''));

    // Support native GHL event or our custom flat payload
    const appt =
      body.appointment ??
      body.payload?.appointment ??
      body.payload ??
      (body.type === 'AppointmentCreate' ? (body.appointment || {}) : body);

    console.log('[WEBHOOK] resolved appt keys:', Object.keys(appt || {}));
    console.log('[DEBUG] time fields', {
      startTime: appt.startTime, start_time: appt.start_time,
      endTime: appt.endTime, end_time: appt.end_time
    });
    console.log('[DEBUG] contact fields', {
      contactId: appt.contactId || appt.contact_id || appt.contact?.id || appt.client?.id || appt.customer?.id,
      contactName: appt.contactName || appt.contact_name || appt.contact?.name || appt.client?.name || appt.customer?.name,
      contactEmail: appt.contactEmail || appt.contact_email || appt.contact?.email || appt.client?.email || appt.customer?.email,
      contactPhone: appt.contactPhone || appt.contact_phone || appt.contact?.phone || appt.client?.phone || appt.customer?.phone
    });

    // Build job first
    const job = normalizeJob(appt);
    if (!job.address && body.address) job.address = body.address; // fallback
    console.log('[DEBUG] normalized job:', job);

    // ---- Enrich contact (never leave blanks) ----
    try {
      const contactId =
        appt.contactId || appt.contact_id ||
        appt.contact?.id || appt.client?.id || appt.customer?.id ||
        body.contact?.id || body.contactId;

      const contactFirst =
        appt.contactFirstName || appt.contact_first_name ||
        appt.contact?.first_name || appt.client?.first_name || appt.customer?.first_name ||
        body.contactFirstName || body.contact?.first_name || body.contact?.firstName;

      const contactLast =
        appt.contactLastName || appt.contact_last_name ||
        appt.contact?.last_name || appt.client?.last_name || appt.customer?.last_name ||
        body.contactLastName || body.contact?.last_name || body.contact?.lastName;

      const contactName =
        appt.contactName || appt.contact_name ||
        [contactFirst, contactLast].filter(Boolean).join(' ').trim() ||
        appt.contact?.name || appt.client?.name || appt.customer?.name ||
        body.contact?.name;

      const contactEmail =
        appt.contactEmail || appt.contact_email ||
        appt.contact?.email || appt.client?.email || appt.customer?.email ||
        body.contactEmail || body.contact?.email;

      const contactPhone =
        appt.contactPhone || appt.contact_phone ||
        appt.contact?.phone || appt.client?.phone || appt.customer?.phone ||
        body.contactPhone || body.contact?.phone;

      console.log('[WEBHOOK] contact keys found:', {
        hasId: !!contactId, hasEmail: !!contactEmail, hasPhone: !!contactPhone, name: contactName || ''
      });

      const seedFromCustomer = job.customer || {};
      job.contact = {
        id: contactId ?? seedFromCustomer.id ?? null,
        name: (contactName || seedFromCustomer.name || '—'),
        emails: [contactEmail || seedFromCustomer.email].filter(Boolean),
        phones: [contactPhone || seedFromCustomer.phone].filter(Boolean),
        tags: [],
        custom: {},
        pipeline: null,
        address: ''
      };

      if (job.contact.id || job.contact.emails.length || job.contact.phones.length) {
        const enriched = await getContact(job.contact.id, {
          email: job.contact.emails[0],
          phone: job.contact.phones[0]
        });
        job.contact = {
          ...job.contact,
          ...enriched,
          id: enriched?.id || job.contact.id,
          name: enriched?.name || job.contact.name,
          emails: (enriched?.emails?.length ? enriched.emails : job.contact.emails),
          phones: (enriched?.phones?.length ? enriched.phones : job.contact.phones),
        };
      }
    } catch (enrichErr) {
      console.warn('[WEBHOOK] contact enrich failed:', enrichErr?.message || enrichErr);
    }

    // Save and continue with scoring
    jobs.set(job.appointmentId, job);

    try {
      const reps = techs.map(t => ({ id: t.id, name: t.name, skills: t.skills, territory: t.territory, route: t.route }));
      const candidates = await scoreAllReps(job, reps);
      const mode = process.env.SDC_MODE || 'Approve';

      if (!candidates?.length) {
        io.emit('ai:suggestion', { job, candidates: [] });
        return res.json({ ok: true, action: 'awaiting_approval' });
      }

      const best = candidates[0];
      if (mode === 'Auto') {
        await updateAppointmentOwner(job.appointmentId, best.repId);
        await rescheduleAppointment(job.appointmentId, job.startTime, job.endTime);
        await appendAppointmentNotes(job.appointmentId, `Booked by SDC AI • ${best.reason} • FIT=${best.total.toFixed(2)}`);
        io.emit('ai:booking', { job, decision: best });
        return res.json({ ok: true, action: 'booked', decision: best });
      }

      io.emit('ai:suggestion', { job, candidates });
      return res.json({ ok: true, action: 'awaiting_approval', candidates });
    } catch (scoreErr) {
      console.warn('[WEBHOOK] scoring failed:', scoreErr?.message || scoreErr);
      io.emit('ai:suggestion', { job, candidates: [] });
      return res.json({ ok: true, action: 'awaiting_approval' });
    }
  } catch (e) {
    console.error('webhook error', e);
    return res.status(200).json({ ok: true, action: 'stored_with_errors' });
  }
});


/**
 * Normalize webhook payloads from:
 *  - Planner posts (nested: customer{}, custom{})
 *  - GHL Webhook “Custom Data” (flat key/value pairs)
 */

function toAddressString(a){
  if (!a) return ''
  if (typeof a === 'string') return a
  const parts = [
    a.fullAddress || a.full_address,
    [a.address, a.city, a.state, a.postalCode].filter(Boolean).join(', ')
  ].filter(Boolean)
  return parts[0] || ''
}
function toISOorNull(v) {
  if (v == null) return null;
  // numeric epoch? (ms or s)
  if (typeof v === 'number') {
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return isNaN(d) ? null : d.toISOString();
  }
  // string parse
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

function normalizeJob(appt){
  const appointmentId = appt.appointmentId || appt.id || ('ghl-' + Math.random().toString(36).slice(2));

  // Accept multiple possible keys; only default to now if *all* are missing/unparseable
  const startCand =
    appt.startTime ?? appt.start_time ?? appt.start ??
    appt.scheduledStart ?? appt.scheduled_start ?? appt.timeStart ?? appt.time_start;

  const endCand =
    appt.endTime ?? appt.end_time ?? appt.end ??
    appt.scheduledEnd ?? appt.scheduled_end ?? appt.timeEnd ?? appt.time_end;

  const startTime = toISOorNull(startCand) || new Date().toISOString();
  const endTime   = toISOorNull(endCand)   || new Date(Date.now()+3600000).toISOString();

  // Address / geo
  const rawAddr = appt.address ?? appt.location ?? '';
  const address = toAddressString(rawAddr);

const lat = Number(
  appt.lat ?? appt.latitude ??
  (rawAddr && (rawAddr.lat ?? rawAddr.latitude))
);
const lng = Number(
  appt.lng ?? appt.longitude ??
  (rawAddr && (rawAddr.lng ?? rawAddr.longitude))
);
// If NaN, leave undefined
const safeLat = Number.isFinite(lat) ? lat : undefined;
const safeLng = Number.isFinite(lng) ? lng : undefined;

  const customer =
    appt.customer ||
    appt.contact ||
    appt.client || {
      id:    appt.contactId || appt.contact_id,
      name:  appt.contactName  || appt.contact_name,
      email: appt.contactEmail || appt.contact_email,
      phone: appt.contactPhone || appt.contact_phone
    };

  const custom = appt.custom || {
    jobType:   appt.jobType   || appt.job_type   || 'Repair',
    estValue:  appt.estValue ?? appt.est_value ?? 0,
    territory: appt.territory || 'EAST'
  };

  const day = appt.day || null;
  const time = appt.time || null;

  return {
    appointmentId,
    customer,
    address,
    lat: safeLat, lng: safeLng,
    startTime, endTime,
    jobType: custom.jobType || 'Repair',
    estValue: Number(custom.estValue || 0),
    territory: custom.territory || 'EAST',
    day, time
  };
}

const PORT = process.env.PORT || 8080
server.listen(PORT, () => console.log(`SDC backend (GHL+) on http://localhost:${PORT}`))