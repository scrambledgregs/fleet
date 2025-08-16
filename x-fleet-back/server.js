import 'dotenv/config'; // ✅ loads .env automatically in ESM

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import fetch from 'node-fetch';
import axios from 'axios'; 
import { scoreAllReps } from './lib/fit.js';

import {
  getContact,
  createContact, // ✅ add this
  updateAppointmentOwner,
  rescheduleAppointment,
  appendAppointmentNotes,
  updateContactCustomFields,
  createAppointmentV2,
} from './lib/ghl.js';


const app = express()
const server = http.createServer(app)
const io = new SocketIOServer(server, {
  cors: { origin: process.env.ALLOW_ORIGIN || '*', methods: ['GET','POST'] }
})

async function geocodeAddress(address) {
  if (!address) return null;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  const resp = await fetch(url);
  const data = await resp.json();
  console.log('[Geocode API Response]', JSON.stringify(data, null, 2));
  if (data.status === 'OK' && data.results.length > 0) {
    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  }
  console.warn('[Geocode] Failed for address:', address, data.status);
  return null;
}

// In-memory store per client
const techsByClient = new Map(); // clientId -> tech array
const jobsByClient  = new Map(); // clientId -> Map(appointmentId -> job)

app.use(cors({ origin: process.env.ALLOW_ORIGIN || '*' }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} ct=${req.headers['content-type'] || ''}`)
  if (req.method !== 'GET') {
    try { console.log('[BODY]', JSON.stringify(req.body).slice(0, 500)) } catch {}
  }
  next()
})

// helper: very simple offset fallback (see NOTE)
const TZ_DEFAULT = 'America/New_York';
const TZ_OFFSET_FALLBACK = process.env.DEFAULT_TZ_OFFSET || '-04:00'; // EDT default

function extractSlotsFromGHL(data) {
  // Accept several shapes:
  // 1) { timeSlots: [...] } or { availableSlots: [...] } or { slots: [...] }
  // 2) { "YYYY-MM-DD": { slots: [...] }, ... }
  let raw = data?.timeSlots || data?.availableSlots || data?.slots;

  if (!raw) {
    // try date-keyed format: pick the first date that has slots[]
    const dateKey = Object.keys(data || {}).find(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && data[k]?.slots);
    if (dateKey) raw = data[dateKey].slots;
  }

  if (!raw) return [];

  // Normalize to [{start,end}] (strings may be 30-min; we’ll assume 60m default end if missing)
  const slots = raw
    .map(s => {
      if (typeof s === 'string') {
        const start = new Date(s);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        return { start: start.toISOString(), end: end.toISOString() };
      }
      if (s?.start && s?.end) {
        return { start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() };
      }
      return null;
    })
    .filter(Boolean);

  return slots;
}

function dayBoundsEpochMs(yyyyMmDd, tzOffset = TZ_OFFSET_FALLBACK) {
  // Build "YYYY-MM-DDT00:00:00-04:00" and "...23:59:59-04:00" and take .getTime()
  const startISO = `${yyyyMmDd}T00:00:00${tzOffset}`;
  const endISO   = `${yyyyMmDd}T23:59:59${tzOffset}`;
  return {
    startMs: new Date(startISO).getTime(),
    endMs:   new Date(endISO).getTime(),
  };
}
function ensureOffsetISO(iso, fallbackOffset = TZ_OFFSET_FALLBACK) {
  if (!iso) return iso;
  // If the client sent UTC (ends with 'Z'), replace with our fallback offset and strip millis
  if (iso.endsWith('Z')) return iso.replace('Z', fallbackOffset).replace(/\.\d{3}/, '');
  return iso;
}

app.get('/api/test-geocode', async (req, res) => {
  try {
    const testAddress = req.query.address || '1600 Amphitheatre Parkway, Mountain View, CA';
    const coords = await geocodeAddress(testAddress);
    res.json({ ok: true, address: testAddress, coords });
  } catch (err) {
    console.error('[Test Geocode] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
})

app.get('/health', (req,res)=> res.json({ ok:true }))

app.post('/api/clear-jobs', (req, res) => {
  const clientId = req.body.clientId || 'default';
  jobsByClient.set(clientId, new Map());
  res.json({ ok: true, message: `Jobs cleared for ${clientId}` })
})

app.get('/api/week-appointments', (req,res) => {
  const clientId = req.query.clientId || 'default';
  const jobs = jobsByClient.get(clientId) || new Map();
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
// add in server.js
app.get('/api/debug/calendar', async (req, res) => {
  try {
    const calId = process.env.GHL_CALENDAR_ID;
    const base = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
    const url = `${base}/calendars/${encodeURIComponent(calId)}`;
    const r = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.GHL_ACCESS_TOKEN}`,
        Accept: 'application/json',
        Version: '2021-07-28',
        // include both variants just in case
        LocationId: process.env.GHL_LOCATION_ID,
        'Location-Id': process.env.GHL_LOCATION_ID,
      },
      timeout: 15000,
    });
    res.json({ ok: true, calendarId: calId, meta: r.data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.response?.data || e?.message });
  }
});

// REPLACE the entire /api/suggest-times route with this:
app.post('/api/suggest-times', async (req, res) => {
  try {
    const {
      date,                                    // YYYY-MM-DD
      timezone = TZ_DEFAULT,
      address,
      jobType = 'Repair',
      estValue = 0,
      territory = 'EAST',
    } = req.body;

    if (!date) {
      return res.status(400).json({ ok: false, error: 'date (YYYY-MM-DD) is required' });
    }

    const calendarId = process.env.GHL_CALENDAR_ID;
    if (!calendarId) {
      return res.status(500).json({ ok: false, error: 'GHL_CALENDAR_ID is not set in .env' });
    }
    if (!process.env.GHL_ACCESS_TOKEN) {
      return res.status(500).json({ ok: false, error: 'GHL_ACCESS_TOKEN is not set in .env' });
    }

    // Build v2 free-slots URL
    const base = 'https://services.leadconnectorhq.com';
    const free = new URL(`/calendars/${calendarId}/free-slots`, base);

    // NOTE: for perfect accuracy across DST, compute real offset for `timezone`.
    // This fallback uses a fixed offset (-04:00 by default).
    const { startMs, endMs } = dayBoundsEpochMs(date, TZ_OFFSET_FALLBACK);

    free.searchParams.set('startDate', String(startMs)); // epoch ms (string)
    free.searchParams.set('endDate',   String(endMs));   // epoch ms (string)
    free.searchParams.set('timezone',  timezone);

    const { data } = await axios.get(free.toString(), {
      headers: {
        Authorization: `Bearer ${process.env.GHL_ACCESS_TOKEN}`,
        Version: '2021-04-15',
        Accept: 'application/json',
      },
      timeout: 15000,
    });

    console.log('[DEBUG free-slots raw]', JSON.stringify(data, null, 2));

    // map into {start, end} ISO strings the UI expects
    const slots = extractSlotsFromGHL(data);

const suggestions = slots.map(x => ({
  ...x,
  tech: undefined,
  jobType,
  estValue: Number(estValue) || 0,
  territory,
  address,
}));

    return res.json({ ok: true, suggestions });
  } catch (err) {
    const payload = err?.response?.data || { message: err.message };
    console.error('[suggest-times error]', payload);
    const msg = payload?.msg || payload?.message || 'Availability lookup failed';
    return res.status(500).json({ ok: false, error: msg });
  }
});

// v2 availability (free-slots)
app.get('/api/availability', async (req, res) => {
  try {
    const calendarId = req.query.calendarId || process.env.GHL_CALENDAR_ID;
    const date = req.query.date;
    const timezone = req.query.timezone || TZ_DEFAULT;

    if (!calendarId) return res.status(400).json({ ok: false, error: 'calendarId is required' });
    if (!date) return res.status(400).json({ ok: false, error: 'date (YYYY-MM-DD) is required' });

    const { startMs, endMs } = dayBoundsEpochMs(String(date), TZ_OFFSET_FALLBACK);

    const base = 'https://services.leadconnectorhq.com';
    const free = new URL(`/calendars/${calendarId}/free-slots`, base);
    free.searchParams.set('startDate', String(startMs));
    free.searchParams.set('endDate',   String(endMs));
    free.searchParams.set('timezone',  String(timezone));

    const { data } = await axios.get(free.toString(), {
      headers: {
        Authorization: `Bearer ${process.env.GHL_ACCESS_TOKEN}`,
        Version: '2021-04-15',
        Accept: 'application/json',
      },
      timeout: 15000,
    });

    const slots = extractSlotsFromGHL(data);
    return res.json({ ok: true, slots });
  } catch (err) {
    console.error('[Availability v2 Error]', err?.response?.data || err.message);
    return res.status(500).json({ ok: false, error: err?.response?.data || err.message });
  }
});

// ---- Book appointment and push to GHL ----
// ---- Book appointment and push to GHL ----
async function handleBookAppointment(req, res) {
  try {
    console.log("[DEBUG] Incoming create-appointment payload:", req.body);

    // 1) destructure request
    const {
      contact,                // { name, phone, email }  (optional if contactId provided)
      contactId: contactIdFromClient,   // 👈 allow direct contactId pass-through
      address,
      lat,
      lng,
      jobType = 'Repair',
      estValue = 0,
      territory = 'EAST',
      startTime,
      endTime,
      timezone = 'America/New_York',
      title = 'Service appointment',
      notes = 'Booked by Dispatch Board',
      rrule,                  // optional recurring rule
      assignedUserId,         // optional override; else we’ll use env
      clientId
    } = req.body;

    // 2) quick validation for the bare minimum
    if (!address || !startTime) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: address, startTime (and either contactId OR contact{name,phone})'
      });
    }

    // 3) resolve a contactId:
    //    - if caller provided contactId, use it (skips contact creation)
    //    - else, find or create using contact info
    let contactId = contactIdFromClient || null;

    if (!contactId) {
      if (!contact || !contact.name || !contact.phone) {
        return res.status(400).json({
          ok: false,
          error: 'Missing contact info: contact{name,phone} is required when contactId is not provided'
        });
      }

      // try to find
      const existing = await getContact(null, { email: contact.email, phone: contact.phone });
      if (existing?.id) {
        contactId = existing.id;
      } else {
        // create
        const created = await createContact({
          firstName: contact.name,
          email: contact.email || '',
          phone: contact.phone
        });
        contactId = created?.id || created?.contact?.id || null;
      }
    }

    if (!contactId) {
      return res.status(500).json({ ok: false, error: 'No contactId returned/resolved in GHL' });
    }

    // 4) normalize times (keep your existing ensureOffsetISO if desired)
    const startISO = ensureOffsetISO(startTime);
    const endISO   = endTime ? ensureOffsetISO(endTime)
                             : new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString();

    // 5) create the appointment (this matches your working curl)
    const created = await createAppointmentV2({
      calendarId: process.env.GHL_CALENDAR_ID,
      contactId,
      startTime: startISO,
      endTime: endISO,
      timezone,
      title,
      notes,
      address,
      rrule,                               // optional, only sent if provided
      assignedUserId: assignedUserId || process.env.GHL_USER_ID,
    });

    // 6) save to in-memory board
    const activeClientId = clientId || 'default';
    if (!jobsByClient.has(activeClientId)) jobsByClient.set(activeClientId, new Map());
    const jobs = jobsByClient.get(activeClientId);

    const job = {
      appointmentId: created?.id || created?.appointmentId || 'ghl-unknown',
      address,
      lat: Number(lat) || 0,
      lng: Number(lng) || 0,
      startTime: startISO,
      endTime: endISO,
      jobType,
      estValue: Number(estValue) || 0,
      territory,
      contact: { id: contactId, ...(contact || {}) },
    };

    jobs.set(job.appointmentId, job);
    io.emit('job:created', job);

    return res.json({ ok: true, job });
  } catch (err) {
    console.error('[Book Appointment] Error:', err?.response?.data || err.message || err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

// ✅ Register the route AFTER defining the function
app.post('/api/create-appointment', handleBookAppointment);
app.post('/ghl/appointment-created', async (req, res) => {
  try {
    const clientId = req.query.clientId || req.body.clientId || 'default';
    const techs = techsByClient.get(clientId) || [];
    if (!jobsByClient.has(clientId)) jobsByClient.set(clientId, new Map());
    const jobs = jobsByClient.get(clientId);

    const body = { ...(req.query || {}), ...(req.body || {}) };
    const appt = body.appointment ?? body.payload?.appointment ?? body.payload ?? body;

console.log("[DEBUG GHL incoming appt]", JSON.stringify(appt, null, 2));


    const job = normalizeJob(appt);
    if (!job.address && body.address) job.address = body.address;

    if ((job.lat == null || job.lng == null) && job.address) {
      try {
        const geo = await geocodeAddress(job.address);
        if (geo) {
          job.lat = geo.lat;
          job.lng = geo.lng;
        }
      } catch {}
    }

    try {
      const contactId = appt.contactId || body.contactId;
      const contactFirst = appt.contactFirstName || body.contactFirstName;
      const contactLast = appt.contactLastName || body.contactLastName;
      const contactName = appt.contactName || [contactFirst, contactLast].filter(Boolean).join(' ').trim();
      const contactEmail = appt.contactEmail || body.contactEmail;
      const contactPhone = appt.contactPhone || body.contactPhone;

      job.contact = { id: contactId, name: contactName, emails: [contactEmail].filter(Boolean), phones: [contactPhone].filter(Boolean) };

      if (job.contact.id || job.contact.emails.length || job.contact.phones.length) {
        const enriched = await getContact(job.contact.id, { email: job.contact.emails[0], phone: job.contact.phones[0] });
        job.contact = { ...job.contact, ...enriched };
      }
    } catch {}

    jobs.set(job.appointmentId, job);

    try {
      const reps = techs.map(t => ({ id: t.id, name: t.name, skills: t.skills, territory: t.territory, route: t.route }));
      const candidates = await scoreAllReps(job, reps);
      const mode = process.env.SDC_MODE || 'Approve';
      if (!candidates?.length) {
        io.emit('ai:suggestion', { clientId, job, candidates: [] });
        return res.json({ ok: true, action: 'awaiting_approval' });
      }
      const best = candidates[0];
      if (mode === 'Auto') {
        await updateAppointmentOwner(job.appointmentId, best.repId);
        await rescheduleAppointment(job.appointmentId, job.startTime, job.endTime);
        await appendAppointmentNotes(job.appointmentId, `Booked by SDC AI • ${best.reason} • FIT=${best.total.toFixed(2)}`);
        io.emit('ai:booking', { clientId, job, decision: best });
        return res.json({ ok: true, action: 'booked', decision: best });
      }
      io.emit('ai:suggestion', { clientId, job, candidates });
      return res.json({ ok: true, action: 'awaiting_approval', candidates });
    } catch {
      io.emit('ai:suggestion', { clientId, job, candidates: [] });
      return res.json({ ok: true, action: 'awaiting_approval' });
    }
  } catch (e) {
    console.error('webhook error', e);
    return res.status(200).json({ ok: true, action: 'stored_with_errors' });
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
  if (typeof v === 'number') {
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return isNaN(d) ? null : d.toISOString();
  }
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

function normalizeJob(appt){
  const appointmentId = appt.appointmentId || appt.id || ('ghl-' + Math.random().toString(36).slice(2));
  const startCand = appt.startTime ?? appt.start_time ?? appt.start;
  const endCand = appt.endTime ?? appt.end_time ?? appt.end;
  const startTime = toISOorNull(startCand) || new Date().toISOString();
  const endTime   = toISOorNull(endCand)   || new Date(Date.now()+3600000).toISOString();
  const rawAddr = appt.address ?? appt.location ?? '';
  const address = toAddressString(rawAddr);
  const toNumOrUndef = (v) => (v === '' || v == null || isNaN(Number(v)) ? undefined : Number(v));
  const safeLat = toNumOrUndef(appt.lat ?? appt.latitude ?? (rawAddr && (rawAddr.lat ?? rawAddr.latitude)));
  const safeLng = toNumOrUndef(appt.lng ?? appt.longitude ?? (rawAddr && (rawAddr.lng ?? rawAddr.longitude)));
  const customer = appt.customer || appt.contact || appt.client || {};
  const custom = appt.custom || { jobType: appt.jobType || 'Repair', estValue: appt.estValue ?? 0, territory: appt.territory || 'EAST' };
  const day = appt.day || null;
  const time = appt.time || null;
  return { appointmentId, customer, address, lat: safeLat, lng: safeLng, startTime, endTime, jobType: custom.jobType || 'Repair', estValue: Number(custom.estValue || 0), territory: custom.territory || 'EAST', day, time }
}



const PORT = process.env.PORT || 8080

server.listen(PORT, () => console.log(`SDC backend (multi-client) on http://localhost:${PORT}`))