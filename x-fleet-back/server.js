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

const geocodeCache = new Map();
const app = express()
const server = http.createServer(app)
const io = new SocketIOServer(server, {
  cors: { origin: process.env.ALLOW_ORIGIN || '*', methods: ['GET','POST'] }
})

async function geocodeAddress(address) {
  if (!address) return null;
  const hit = geocodeCache.get(address);
  if (hit) return hit;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  const resp = await fetch(url);
  const data = await resp.json();
  console.log('[Geocode API Response]', JSON.stringify(data, null, 2));
  if (data.status === 'OK' && data.results.length > 0) {
  const loc = data.results[0].geometry.location;
  const out = { lat: loc.lat, lng: loc.lng };
  geocodeCache.set(address, out);
  return out;
}

  return null;  // ✅ fallback if nothing comes back
}
// --- Distance Matrix (drive time) helper ---
const driveCache = new Map(); // key: "lat1,lng1|lat2,lng2" -> minutes

async function getDriveMinutes(from, to) {
  if (!from || !to) return null;
  const f = `${from.lat},${from.lng}`;
  const t = `${to.lat},${to.lng}`;
  if (!/^-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/.test(f) || !/^-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/.test(t)) return null;

  const key = `${f}|${t}`;
  const hit = driveCache.get(key);
  if (hit) return hit;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(f)}&destinations=${encodeURIComponent(t)}&mode=driving&departure_time=now&key=${apiKey}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    const elem = data?.rows?.[0]?.elements?.[0];
    const seconds = elem?.duration_in_traffic?.value ?? elem?.duration?.value;
    if (typeof seconds === 'number') {
      const minutes = Math.round(seconds / 60);
      driveCache.set(key, minutes);
      return minutes;
    }
  } catch (e) {
    console.warn('[DriveTime] fetch failed', e.message);
  }
  return null;
}

// In-memory store per client
const techsByClient = new Map(); // clientId -> tech array
const jobsByClient  = new Map(); // clientId -> Map(appointmentId -> job)

// --- MOCK CONVERSATIONS (dev/testing) ---
const mockConvos = new Map();      // conversationId -> { id, contactId, messages: [...] }
const mockByContact = new Map();   // contactId -> conversationId
const uuid = () => 'c_' + Math.random().toString(36).slice(2);

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

  // If timestamp already has a timezone (Z or ±HH:MM), leave it alone.
  if (/[+-]\d\d:\d\d$|Z$/.test(iso)) {
    return iso.replace(/\.\d{3}/, ''); // optional: strip millis for cleanliness
  }

  // Otherwise, append a fallback offset (rare—mostly for naive strings).
  return `${iso.replace(/\.\d{3}/, '')}${fallbackOffset}`;
}
function normalizePhone(p) {
  if (!p) return p;
  let s = String(p).replace(/[^\d]/g, '');
  if (s.length === 10) s = '1' + s;     // assume US if 10 digits
  if (!s.startsWith('+')) s = '+' + s;
  return s;
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

app.get('/api/week-appointments', async (req, res) => {
  try {
    const clientId = req.query.clientId || 'default';
    const jobsMap = jobsByClient.get(clientId) || new Map();

    // normalize
    const items = Array.from(jobsMap.values()).map(j => {
      const d = j.startTime ? new Date(j.startTime) : new Date();
      let day = j.day, time = j.time;

      if (!day || !time) {
        day  = d.toLocaleDateString(undefined, { weekday: 'short' });
        time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      }

      const dateText = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      return {
        id: j.appointmentId,
        startTimeISO: d.toISOString(),
        day, time, dateText,
        address: toAddressString(j.address),
        lat: j.lat, lng: j.lng,
        jobType: j.jobType,
        estValue: j.estValue,
        territory: j.territory,
        contact: j.contact,
        travelMinutesFromPrev: null,
      };
    });

    // sort by time
    items.sort((a, b) => new Date(a.startTimeISO) - new Date(b.startTimeISO));

    // compute drive times per day
    const byDay = new Map();
    for (const it of items) {
      if (!byDay.has(it.day)) byDay.set(it.day, []);
      byDay.get(it.day).push(it);
    }

    for (const list of byDay.values()) {
      list.sort((a, b) => new Date(a.startTimeISO) - new Date(b.startTimeISO));
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const curr = list[i];
        if (prev.lat != null && prev.lng != null && curr.lat != null && curr.lng != null) {
          curr.travelMinutesFromPrev = await getDriveMinutes(
            { lat: prev.lat, lng: prev.lng },
            { lat: curr.lat, lng: curr.lng }
          );
        }
      }
    }

    const out = items.map(it => ({
      id: it.id,
      startTime: it.startTimeISO,
      day: it.day,
      time: it.time,
      dateText: it.dateText,
      address: it.address,
      lat: it.lat, lng: it.lng,
      jobType: it.jobType,
      estValue: Number(it.estValue) || 0, 
      territory: it.territory,
      contact: it.contact,
      travelMinutesFromPrev: it.travelMinutesFromPrev,
    }));

    res.json(out);
  } catch (e) {
    console.error('[week-appointments]', e);
    res.status(500).json({ ok: false, error: 'failed to build week' });
  }
});

// --- GHL: get messages for a specific conversationId ---
app.get('/api/ghl/conversation/:conversationId/messages', async (req, res) => {
  try {
    const conversationId = req.params.conversationId;
    const base = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';

    if (!process.env.GHL_ACCESS_TOKEN) {
      return res.status(500).json({ ok:false, error:'GHL_ACCESS_TOKEN missing' });
    }

    const headers = {
      Authorization: `Bearer ${process.env.GHL_ACCESS_TOKEN}`,
      Accept: 'application/json',
      Version: '2021-04-15',
      ...(process.env.GHL_LOCATION_ID ? { 'Location-Id': process.env.GHL_LOCATION_ID } : {})
    };

    const url = new URL(`/conversations/${encodeURIComponent(conversationId)}/messages`, base);
    url.searchParams.set('page', '1');
    url.searchParams.set('limit', '50');

    const resp = await axios.get(url.toString(), { headers, timeout: 15000 });
    const raw = Array.isArray(resp.data?.messages) ? resp.data.messages : (resp.data?.data || []);

    const messages = raw.map(m => ({
      id: m.id,
      direction: m.direction || (m.fromMe ? 'outbound' : 'inbound'),
      channel: m.channel || m.type,
      text: m.message || m.text || '',
      attachments: m.attachments || [],
      createdAt: m.createdAt || m.dateAdded || m.timestamp,
    }));

    res.json({ ok:true, conversationId, messages });
  } catch (e) {
    console.error('[conversation messages]', e?.response?.data || e.message);
    res.status(500).json({ ok:false, error: e?.response?.data || e.message });
  }
});

app.get('/api/job/:id', (req, res) => {
  const clientId = req.query.clientId || 'default';
  const jobs = jobsByClient.get(clientId) || new Map();
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json(job);
});

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

// REPLACE your existing /api/suggest-times with this version
app.post('/api/suggest-times', async (req, res) => {
  try {
    const {
      clientId = 'default',
      date,                       // YYYY-MM-DD (required)
      timezone = TZ_DEFAULT,
      address,                    // new job address (helps routing)
      jobType = 'Repair',
      estValue = 0,
      territory = 'EAST',
      durationMin = 60,           // desired job length
      bufferMin = 15,             // min setup/tear-down buffer
      maxDetourMin = 60           // max total extra drive time you’ll accept
    } = req.body;

    if (!date) return res.status(400).json({ ok:false, error:'date (YYYY-MM-DD) is required' });

    // --- 1) Get free slots from GHL ---
    const calendarId = process.env.GHL_CALENDAR_ID;
    if (!calendarId || !process.env.GHL_ACCESS_TOKEN) {
      return res.status(500).json({ ok:false, error:'GHL env vars missing' });
    }
    const base = 'https://services.leadconnectorhq.com';
    const free = new URL(`/calendars/${calendarId}/free-slots`, base);

    const { startMs, endMs } = dayBoundsEpochMs(date, TZ_OFFSET_FALLBACK);
    free.searchParams.set('startDate', String(startMs));
    free.searchParams.set('endDate',   String(endMs));
    free.searchParams.set('timezone',  timezone);

    const { data } = await axios.get(free.toString(), {
      headers: {
        Authorization: `Bearer ${process.env.GHL_ACCESS_TOKEN}`,
        Version: '2021-04-15',
        Accept: 'application/json',
      },
      timeout: 15000,
    });

    const freeSlots = extractSlotsFromGHL(data); // [{start,end}]

    // --- 2) Prepare the "new job" location (for travel calc) ---
    let newLoc = null;
    if (address) {
      try { newLoc = await geocodeAddress(address); } catch {}
    }

    // --- 3) Pull existing jobs for this client+day from the dispatch board ---
    const jobsMap = jobsByClient.get(clientId) || new Map();
    const dayJobs = Array.from(jobsMap.values())
      .filter(j => {
        const t = new Date(j.startTime).getTime();
        return t >= startMs && t <= endMs;
      })
      .map(j => ({
        id: j.appointmentId,
        start: new Date(j.startTime).getTime(),
        end:   new Date(j.endTime || new Date(new Date(j.startTime).getTime() + 60*60*1000)).getTime(),
        lat: j.lat, lng: j.lng,
        address: j.address,
        territory: j.territory,
        estValue: j.estValue
      }))
      .sort((a,b)=>a.start-b.start);

    // helper to find prev/next jobs around a start time
    function neighbors(startMs) {
      let prev = null, next = null;
      for (const j of dayJobs) {
        if (j.end <= startMs) prev = j;
        if (j.start >= startMs) { next = j; break; }
      }
      return { prev, next };
    }

    // --- 4) Filter GHL slots by overlap + travel fit ---
    const accepted = [];
    for (const s of freeSlots) {
      const start = new Date(s.start).getTime();
      const end   = start + durationMin*60*1000;

      // basic overlap check against existing jobs
      const overlaps = dayJobs.some(j => !(end <= j.start || start >= j.end));
      if (overlaps) continue;

      const { prev, next } = neighbors(start);

      // travel/time feasibility
      let travelPrev = 0, travelNext = 0;

      if (prev && newLoc && prev.lat != null && prev.lng != null) {
        const mins = await getDriveMinutes({lat:prev.lat,lng:prev.lng}, newLoc);
        if (mins != null) travelPrev = mins;
        // enough time between prev job end + buffer and new start?
        const gap = (start - prev.end) / 60000; // min
        if (gap < (bufferMin + travelPrev)) continue;
      }

      if (next && newLoc && next.lat != null && next.lng != null) {
        const mins = await getDriveMinutes(newLoc, {lat:next.lat,lng:next.lng});
        if (mins != null) travelNext = mins;
        // enough time from new end + buffer to next start?
        const gap = (next.start - end) / 60000; // min
        if (gap < (bufferMin + travelNext)) continue;
      }

      // territory sanity (optional hard filter)
      if (territory && dayJobs.length) {
        const badNeighbor =
          (prev && prev.territory && prev.territory !== territory) ||
          (next && next.territory && next.territory !== territory);
        // If you want soft scoring instead, remove this "continue"
        if (badNeighbor) continue;
      }

      const totalDetour = travelPrev + travelNext;

      if (totalDetour > maxDetourMin) continue;

      // simple score: value bias minus travel penalty (tune as you like)
      const score = (Number(estValue)||0)/1000 - (totalDetour/10);

      accepted.push({
        start: new Date(start).toISOString(),
        end:   new Date(end).toISOString(),
        jobType,
        estValue: Number(estValue)||0,
        territory,
        address,
        travel: { fromPrev: travelPrev || null, toNext: travelNext || null, total: totalDetour || 0 },
        neighbors: { prev: prev?.id || null, next: next?.id || null },
        reason: `fits route (+${totalDetour}m travel, ${bufferMin}m buffer)`,
        score
      });
    }

    // sort best-first
    accepted.sort((a,b)=>b.score-a.score);

    return res.json({ ok:true, suggestions: accepted });
  } catch (err) {
    console.error('[suggest-times error]', err?.response?.data || err.message);
    const msg = err?.response?.data?.message || err?.message || 'Availability lookup failed';
    return res.status(500).json({ ok:false, error: msg });
  }
});
// Create (or reuse) a mock conversation and add a message
app.post('/api/mock/ghl/send-message', (req, res) => {
  const { contactId, text = '', direction = 'outbound', channel = 'sms' } = req.body || {};
  if (!contactId) return res.status(400).json({ ok:false, error:'contactId required' });

  let convoId = mockByContact.get(contactId);
  if (!convoId) {
    convoId = uuid();
    mockByContact.set(contactId, convoId);
    mockConvos.set(convoId, { id: convoId, contactId, messages: [] });
  }
  const convo = mockConvos.get(convoId);
  const msg = {
    id: uuid(),
    direction,              // 'inbound' | 'outbound'
    channel,                // 'sms' | 'email' | etc
    text,
    createdAt: new Date().toISOString(),
  };
  convo.messages.push(msg);
  return res.json({ ok:true, conversationId: convoId, message: msg });
});

// List mock conversations for a contact (if any)
app.get('/api/mock/ghl/contact/:contactId/conversations', (req, res) => {
  const contactId = req.params.contactId;
  const convoId = mockByContact.get(contactId);
  if (!convoId) return res.json({ ok:true, contactId, conversations: [] });
  return res.json({ ok:true, contactId, conversations: [{ id: convoId, unreadCount: 0, starred: false, type: 0 }] });
});

// List mock messages for a conversation
app.get('/api/mock/ghl/conversation/:conversationId/messages', (req, res) => {
  const convo = mockConvos.get(req.params.conversationId);
  if (!convo) return res.status(404).json({ ok:false, error:'not found' });
  return res.json({ ok:true, conversationId: convo.id, messages: convo.messages });
});

// --- Client settings (in-memory for now) ---
const DEFAULT_PAYDAY_THRESHOLD = Number(process.env.DEFAULT_PAYDAY_THRESHOLD || 2500);

// Optional per-client overrides. You can persist later (DB).
// Key = clientId, Value = { paydayThreshold: number }
const clientSettings = new Map();
// Example seed:
// clientSettings.set('acme', { paydayThreshold: 5000 });

app.get('/api/client-settings', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  const saved = clientSettings.get(clientId) || {};
  const paydayThreshold =
    Number.isFinite(saved.paydayThreshold) ? saved.paydayThreshold : DEFAULT_PAYDAY_THRESHOLD;

  res.json({ ok: true, clientId, settings: { paydayThreshold } });
});

// (Optional) simple setter you can call from an admin tool or curl
app.post('/api/client-settings', (req, res) => {
  const clientId = (req.body.clientId || 'default').trim();
  const paydayThreshold = Number(req.body.paydayThreshold);
  if (!Number.isFinite(paydayThreshold) || paydayThreshold < 0) {
    return res.status(400).json({ ok: false, error: 'paydayThreshold must be a non-negative number' });
  }
  clientSettings.set(clientId, { paydayThreshold });
  res.json({ ok: true, clientId, settings: { paydayThreshold } });
});

// ---- Book appointment and push to GHL ----
// ---- Book appointment and push to GHL ----
// ---- Book appointment and push to GHL ----
async function handleBookAppointment(req, res) {
  try {
    console.log("[DEBUG] Incoming create-appointment payload:", req.body);

    const {
      contact,                       // { name, phone, email } (optional if contactId provided)
      contactId: contactIdFromClient,
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
      rrule,
      assignedUserId,
      clientId,
    } = req.body;

    if (!address || !startTime) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: address, startTime (and either contactId OR contact{name,phone})',
      });
    }

    // Resolve contactId
    let contactId = contactIdFromClient || null;

    if (!contactId) {
      if (!contact || !contact.name || !contact.phone) {
        return res.status(400).json({
          ok: false,
          error: 'Missing contact info: contact{name,phone} is required when contactId is not provided',
        });
      }

      const emailNorm = (contact?.email || '').trim().toLowerCase();
      const phoneNorm = normalizePhone(contact?.phone);

      const existing = await getContact(null, { email: emailNorm, phone: phoneNorm });
      if (existing?.id) {
        contactId = existing.id;
      } else {
        try {
          const created = await createContact({
            firstName: contact.name,
            email: emailNorm,
            phone: phoneNorm,
          });
          contactId = created?.id || created?.contact?.id || null;
        } catch (e) {
          const dupId = e?.response?.data?.meta?.contactId;
          const msg = e?.response?.data?.message || '';
          if (dupId && /duplicated contacts/i.test(msg)) {
            console.warn('[Contact] Duplicate detected; using existing contactId:', dupId);
            contactId = dupId;
          } else {
            throw e;
          }
        }
      }
    }

    if (!contactId) {
      return res.status(500).json({ ok: false, error: 'No contactId returned/resolved in GHL' });
    }

    // Times
    const startISO = ensureOffsetISO(startTime);
    const endISO = endTime
      ? ensureOffsetISO(endTime)
      : new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString();

    // Create appointment
    const created = await createAppointmentV2({
      calendarId: process.env.GHL_CALENDAR_ID,
      contactId,
      startTime: startISO,
      endTime: endISO,
      timezone,
      title,
      notes,
      address,
      rrule,
      assignedUserId: assignedUserId || process.env.GHL_USER_ID,
    });

    // --- ensure we have real coordinates for this address ---
let latNum = Number(lat);
let lngNum = Number(lng);
const missingOrZero =
  !Number.isFinite(latNum) || !Number.isFinite(lngNum) || (latNum === 0 && lngNum === 0);

if (missingOrZero && address) {
  try {
    const geo = await geocodeAddress(address);
    if (geo) { latNum = geo.lat; lngNum = geo.lng; }
  } catch (e) {
    console.warn('[Geocode] create-appointment lookup failed:', e.message);
  }
}

    // Store job locally
    const activeClientId = clientId || 'default';
    if (!jobsByClient.has(activeClientId)) jobsByClient.set(activeClientId, new Map());
    const jobs = jobsByClient.get(activeClientId);

   const job = {
  appointmentId: created?.id || created?.appointmentId || 'ghl-unknown',
  address,
  lat: Number.isFinite(latNum) ? latNum : 0,   // <-- use latNum
  lng: Number.isFinite(lngNum) ? lngNum : 0,   // <-- use lngNum
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