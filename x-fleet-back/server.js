import 'dotenv/config'; // ✅ loads .env automatically in ESM

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import fetch from 'node-fetch';

import { scoreAllReps } from './lib/fit.js';

import {
  getContact,
  createContact, // ✅ add this
  updateAppointmentOwner,
  rescheduleAppointment,
  appendAppointmentNotes,
  updateContactCustomFields,
  createAppointment,
} from './lib/ghl.js';


const app = express()
const server = http.createServer(app)
const io = new SocketIOServer(server, {
  cors: { origin: process.env.ALLOW_ORIGIN || '*', methods: ['GET','POST'] }
})

function toOffsetISO(isoZ, offset = '-04:00') {
  // If you know you're in EDT right now, use -04:00.
  // In winter switch to -05:00 or compute dynamically with a tz lib.
  return isoZ.replace('Z', offset).replace(/\.\d{3}/, ''); // strip millis if present
}

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

// REPLACE the entire /api/suggest-times route with this:
app.post('/api/suggest-times', async (req, res) => {
  try {
    const { date, timezone = 'America/New_York', address, jobType = 'Repair', estValue = 0, territory = 'EAST' } = req.body;

    if (!date) {
      return res.status(400).json({ ok: false, error: 'date (YYYY-MM-DD) is required' });
    }

    const calendarId = process.env.GHL_CALENDAR_ID;
    if (!calendarId) {
      return res.status(500).json({ ok: false, error: 'GHL_CALENDAR_ID is not set in .env' });
    }

    const url = `https://rest.gohighlevel.com/v1/calendars/${calendarId}/availability?date=${encodeURIComponent(date)}`;
    const { data } = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        Accept: 'application/json'
      }
    });

    // Log raw response once to see structure
    console.log('[DEBUG availability raw]', JSON.stringify(data, null, 2));

    // Safely map whatever the API returns into {start, end}
    const slots = (data?.timeSlots || data?.availableSlots || data?.slots || [])
      .map(s => {
        // common shapes are either strings or objects with start/end
        if (typeof s === 'string') {
          // Some tenants return ISO-with-offset strings per slot length; treat each as 1 hour by default
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

    // Attach context your UI already expects
    const suggestions = slots.map(x => ({
      ...x,
      tech: undefined,         // (optional) fill later when scoring reps
      jobType,
      estValue: Number(estValue) || 0,
      territory,
      address
    }));

    return res.json({ ok: true, suggestions });
  } catch (err) {
    const payload = err?.response?.data || { message: err.message };
    console.error('[suggest-times availability error]', payload);
    // Bubble a clearer message to the UI
    const msg = payload?.msg || payload?.message || 'Availability lookup failed';
    return res.status(500).json({ ok: false, error: msg });
  }
});

import axios from 'axios'; // <-- Add to the top if not already imported

// Get live availability from GHL Calendar
app.get('/api/availability', async (req, res) => {
  try {
    const { calendarId, date } = req.query; // date format: YYYY-MM-DD

    if (!calendarId) {
      return res.status(400).json({ ok: false, error: 'calendarId is required' });
    }
    if (!date) {
      return res.status(400).json({ ok: false, error: 'date is required' });
    }

    const url = `https://rest.gohighlevel.com/v1/calendars/${calendarId}/availability?date=${date}`;

    const { data } = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        Accept: 'application/json'
      }
    });

    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[Availability Error]', err?.response?.data || err.message);
    res.status(500).json({ ok: false, error: err?.response?.data || err.message });
  }
});

// ---- Book appointment and push to GHL ----
async function handleBookAppointment(req, res) {
  
  try {
    console.log("[DEBUG] Incoming create-appointment payload:", req.body);
     console.log("[DEBUG] Starting appointment creation process...");
    const {
      contact,
      address,
      lat,
      lng,
      jobType = 'Repair',
      estValue = 0,
      territory = 'EAST',
      startTime,
      endTime,
      clientId
    } = req.body;

    console.log("[DEBUG] Destructured variables:", { contact, address, startTime, endTime });

if (!contact || !contact.name || !contact.phone || !address || !startTime || !endTime) {      
  return res.status(400).json({ 
    ok: false, 
       error: 'Missing required fields: contact (with name, phone), address, startTime, endTime' 
      });
    }

    console.log("[DEBUG] Validation passed, proceeding to contact lookup...");


    // ✅ Step 1 — Find or create the contact
  let contactId;
const existing = await getContact(null, { email: contact.email, phone: contact.phone });

if (existing?.id) {
  contactId = existing.id;
} else {
  const newContact = await createContact({
    firstName: contact.name,          // or split first/last if you want
    email: contact.email || '',
    phone: contact.phone
  });
  contactId = newContact.id || newContact.contact?.id; // <- robust
}

if (!contactId) {
  return res.status(500).json({ ok: false, error: 'No contactId returned from GHL' });
}

    const activeClientId = clientId || 'default';
    if (!jobsByClient.has(activeClientId)) jobsByClient.set(activeClientId, new Map());
    const jobs = jobsByClient.get(activeClientId);

// ✅ Step 2 — create the appointment (round-robin v1)
let ghlApptId;
try {
  const ghlAppt = await createAppointment({
  contactId,
  selectedSlot: req.body.selectedSlot,          // <-- pass through if present
  selectedTimezone: req.body.timezone,          // optional pass-through
  startTime,                                    // fallback path uses this
  timezone: 'America/New_York'
});
  ghlApptId = ghlAppt.id || ghlAppt.appointmentId;
} catch (err) {
  console.error('[Book Appointment] GHL create error:', err.response?.data || err.message || err);
  return res.status(500).json({ ok: false, error: 'Failed to create appointment in GHL' });
}

    const job = {
      appointmentId: ghlApptId,
      address,
      lat: Number(lat) || 0,
      lng: Number(lng) || 0,
      startTime,
      endTime,
      jobType,
      estValue: Number(estValue) || 0,
      territory,
      contact: { id: contactId, ...contact }
    };

    jobs.set(job.appointmentId, job);
    io.emit('job:created', job);

    return res.json({ ok: true, job });
  } catch (err) {
    console.error('[Book Appointment] Error:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
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