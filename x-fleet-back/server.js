import 'dotenv/config';

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import fetch from 'node-fetch';
import axios from 'axios';
import { scoreAllReps } from './lib/fit.js';
import { sendSMS } from './lib/twilio.js';
import { handleInbound as agentHandle } from './lib/agent.js';
import { recordSms, normalizePhone as phoneE164 } from './lib/chatter.js';
import {
  getContact,
  createContact,
  updateAppointmentOwner,
  rescheduleAppointment,
  appendAppointmentNotes,
  createAppointmentV2,
} from './lib/ghl.js';
import createChatterRouter from './routes/chatter.js';
import mailgunRoute from './routes/mailgun.ts';  // ← NEW (TS file, tsconfig has allowJs so mixed is fine)
import { sendEmail } from './lib/mailgun.ts';
import { draftEmail } from './lib/emailDraft.ts';
import emailSendRoute from './routes/emailSend.ts';
import { SuggestTimesRequestSchema, CreateAppointmentReqSchema, UpsertTechsRequestSchema } from './lib/schemas.js';
import { generateEstimateItems, draftEstimateCopy } from './lib/estimate-llm.ts'
import { aiEstimate } from "./lib/estimate.ts";
import contactsRouter from './routes/contacts.ts';
import rateLimit from 'express-rate-limit';

function ttlMap(ttlMs, opts = {}) {
  const max = Number.isFinite(opts.max) ? opts.max : null;
  const normalizeKey = typeof opts.normalizeKey === 'function' ? opts.normalizeKey : (k) => k;

  // Use a Map to keep insertion order (LRU via re-insert on get/set)
  const store = new Map(); // key -> { v, t }

  const api = {
    get(key) {
      const k = normalizeKey(key);
      const row = store.get(k);
      if (!row) return null;
      if (Date.now() - row.t > ttlMs) { store.delete(k); return null; }
      // refresh LRU position
      store.delete(k);
      store.set(k, { v: row.v, t: row.t });
      return row.v;
    },
    set(key, value) {
      const k = normalizeKey(key);
      store.set(k, { v: value, t: Date.now() });
      // enforce max size (delete oldest)
      if (max && store.size > max) {
        const oldestKey = store.keys().next().value;
        store.delete(oldestKey);
      }
    },
    has(key) {
      return api.get(key) != null;
    },
    delete(key) {
      const k = normalizeKey(key);
      return store.delete(k);
    },
    clear() { store.clear(); },
    size() { return store.size; },
  };

  return api;
}

const geocodeCache = ttlMap(24 * 60 * 60 * 1000, {
  max: 10000,
  normalizeKey: (addr) => String(addr || '').trim().toLowerCase(),
});
const app = express()
const server = http.createServer(app)
const CHATTER_AI = process.env.CHATTER_AI === 'true';
const io = new SocketIOServer(server, {
  cors: { origin: process.env.ALLOW_ORIGIN || '*', methods: ['GET','POST'] }
})

async function geocodeAddress(address) {
  if (!address) return null;
  const hit = geocodeCache.get(address);
  if (hit) return hit;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
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

// Replace your current driveCache line with:
const q = (n) => Number(n).toFixed(4); // ~11m at the equator
const driveCache = ttlMap(6 * 60 * 60 * 1000, {
  max: 20000,
  normalizeKey: (k) => {
    if (typeof k === 'string') return k;
    const { from, to } = k || {};
    if (!from || !to) return '∅';
    return `${q(from.lat)},${q(from.lng)}|${q(to.lat)},${q(to.lng)}`;
  },
});

async function getDriveMinutes(from, to) {
  if (!from || !to) return null;
  const f = `${from.lat},${from.lng}`;
  const t = `${to.lat},${to.lng}`;
  if (!/^-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/.test(f) || !/^-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/.test(t)) return null;

  // Ask cache first (pass structured key so the normalizer can quantize)
  const hit = driveCache.get({ from, to });
  if (hit != null) return hit;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(f)}&destinations=${encodeURIComponent(t)}&mode=driving&departure_time=now&key=${apiKey}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    const elem = data?.rows?.[0]?.elements?.[0];
    const seconds = elem?.duration_in_traffic?.value ?? elem?.duration?.value;
    if (typeof seconds === 'number') {
      const minutes = Math.round(seconds / 60);
      driveCache.set({ from, to }, minutes);
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
const vehiclesByClient = new Map(); // clientId -> [{id,name,plate,capacity}]
const newId = (p='id_') => p + Math.random().toString(36).slice(2);
const contactsByClient = new Map(); // clientId -> Map(contactId -> contactSummary)

// helper to get/create the per-client contacts bag
function contactBag(clientId = 'default') {
  if (!contactsByClient.has(clientId)) contactsByClient.set(clientId, new Map());
  return contactsByClient.get(clientId);
}

// --- Per-contact Chat AI state (autopilot) ---
const autopilotPref = new Map(); // key = id or phone (E.164), value = boolean

function setAutoPref({ id, phone, enabled }) {
  if (typeof enabled !== 'boolean') return;
  if (id) autopilotPref.set(String(id), enabled);
  if (phone) autopilotPref.set(String(phone), enabled);
}

function getAutoPref({ id, phone }) {
  // precedence: explicit id, then phone
  if (id != null && autopilotPref.has(String(id))) return autopilotPref.get(String(id));
  if (phone != null && autopilotPref.has(String(phone))) return autopilotPref.get(String(phone));
  return null; // means "no override"
}

// Demo tech seeding
const SHOULD_SEED_DEMO = process.env.SEED_DEMO_TECHS === 'true';
function ensureDemoTechs(clientId = 'default') {
  const cur = techsByClient.get(clientId) || [];
  if (cur.length) return;
  techsByClient.set(clientId, [
    { id: 't1', name: 'Alice (demo)', skills: ['Repair'], territory: 'EAST', route: [] },
    { id: 't2', name: 'Bob (demo)',   skills: ['Repair'], territory: 'EAST', route: [] },
  ]);
}

// --- MOCK CONVERSATIONS (dev/testing) ---
const mockConvos = new Map();      // conversationId -> { id, contactId, messages: [...] }
const mockByContact = new Map();   // contactId -> conversationId
const uuid = () => 'c_' + Math.random().toString(36).slice(2);

// --- Voice AI global toggle (additive) ---
let VOICE_AI_ENABLED = false;

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

//EMAIL -- mailgun

app.use(createChatterRouter(io));
app.use('/api', mailgunRoute); 
app.use('/api', emailSendRoute);

// 👉 Mount the DB-backed contacts router here
app.use('/api/contacts-db', contactsRouter);

app.post('/api/test-email', async (req, res) => {
  try {
    const { to, subject = 'Mailgun prototype test', text, html, replyTo, domain, from } = req.body || {};
    if (!to) return res.status(400).json({ ok:false, error:'to required' });
    const r = await sendEmail({
      to, subject,
      text: text || 'Hello from Fleet via Mailgun.',
      html: html || '<p>Hello from <b>Fleet</b> via Mailgun.</p>',
      replyTo: replyTo || 'greg@nonstopautomation.com',
      domain, // ← optional override
      from,   // ← optional override
    });
    res.json({ ok:true, result: r });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message || String(e) });
  }
});

app.post('/api/email/draft', async (req, res) => {
  try {
    const { context, tone = 'friendly' } = req.body || {};
    if (!context) return res.status(400).json({ ok:false, error:'context required' });
    const draft = await draftEmail(context, tone);
    res.json({ ok:true, draft });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message || 'draft failed' });
  }
});


// POST /api/email/draft-and-send
// body: { to, context, tone?, replyTo? }
app.post('/api/email/draft-and-send', async (req, res) => {
  try {
    const { to, context, tone = 'friendly', replyTo } = req.body || {};
    if (!to || !context) return res.status(400).json({ ok:false, error:'to and context required' });

    const draft = await draftEmail(context, tone);
    const result = await sendEmail({
      to,
      subject: draft.subject,
      html: draft.html,
      replyTo
    });

    // result.id is Mailgun’s message id; you can store it to correlate webhooks
    res.json({ ok:true, draft, send: result });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message || 'draft-and-send failed' });
  }
});

// --- Estimate AI: generate structured line items from a free-text prompt ---
app.post('/api/estimate/ai/items', async (req, res) => {
  try {
    const { prompt } = req.body || {}
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ ok: false, error: 'prompt (string) is required' })
    }
    const payload = await generateEstimateItems(prompt)
    return res.json({ ok: true, ...payload }) // => { ok, items, notes }
  } catch (e) {
    console.warn('[estimate.ai.items]', e?.message || e)
    return res.status(500).json({ ok: false, error: 'llm_failed' })
  }
})

// --- Estimate AI: draft short SMS/email text for the estimate ---
app.post('/api/estimate/ai/summary', async (req, res) => {
  try {
    const { items = [], notes = '', contact = {} } = req.body || {}
    const text = await draftEstimateCopy({ items, notes }, contact)
    return res.json({ ok: true, text })
  } catch (e) {
    console.warn('[estimate.ai.summary]', e?.message || e)
    return res.status(500).json({ ok: false, error: 'llm_failed' })
  }
})

app.post(
  '/api/agent/estimate',
  express.json(),
  async (req, res) => {
    try {
      const prompt = String(req.body?.prompt || '').trim();
      if (!prompt) return res.status(400).json({ ok: false, error: 'prompt required' });

      // NEW: accept up to 5 image URLs (job photos / satellite tiles)
      const images = Array.isArray(req.body?.images)
        ? req.body.images.filter((u) => typeof u === 'string' && u.trim()).slice(0, 5)
        : [];

      const out = await aiEstimate(prompt, images);

      if (out.items?.length) {
        return res.json({ ok: true, items: out.items, notes: out.notes ?? null });
      }
      return res.json({ ok: true, items: [], text: out.raw || '' });
    } catch (e) {
      console.error('[/api/agent/estimate]', e?.message || e);
      res.status(500).json({ ok: false, error: 'estimate failed' });
    }
  }
);

// ---- VEHICLES CRUD ----
app.get('/api/vehicles', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  const list = vehiclesByClient.get(clientId) || [];
  res.json({ ok:true, clientId, vehicles: list });
});

// --- Industry Packs: install ---
app.post('/api/packs/install', (req, res) => {
  try {
    const pack = req.body || {};
    if (!pack || typeof pack !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid pack payload' });
    }

    // quick shape checks
    const missing = [];
    if (!pack.id) missing.push('id');
    if (!pack.name) missing.push('name');
    if (typeof pack.version !== 'number') missing.push('version');
    if (!pack.trade) missing.push('trade');
    if (missing.length) {
      return res.status(400).json({ ok: false, error: `Missing: ${missing.join(', ')}` });
    }

    // TODO: persist pack settings, seed pipelines/pricebook/etc.
    return res.json({
      ok: true,
      installed: { id: pack.id, name: pack.name, version: pack.version, trade: pack.trade },
      message: 'Pack received and queued for install',
    });
  } catch (e) {
    console.error('[packs/install]', e);
    res.status(500).json({ ok: false, error: 'Install failed' });
  }
});

app.post('/api/vehicles', (req, res) => {
  const clientId = (req.body.clientId || 'default').trim();
  const v = req.body || {};
  const list = vehiclesByClient.get(clientId) || [];
  const item = {
    id: newId('veh_'),
    name: (v.name || 'Van').trim(),
    plate: (v.plate || '').trim(),
    capacity: Number(v.capacity) || 0,
    notes: (v.notes || '').trim(),
  };
  list.push(item);
  vehiclesByClient.set(clientId, list);
  res.json({ ok:true, vehicle: item });
});

app.put('/api/vehicles/:id', (req, res) => {
  const clientId = (req.body.clientId || 'default').trim();
  const id = req.params.id;
  const list = vehiclesByClient.get(clientId) || [];
  const idx = list.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ ok:false, error:'not found' });
  list[idx] = { ...list[idx], ...req.body, id };
  vehiclesByClient.set(clientId, list);
  res.json({ ok:true, vehicle: list[idx] });
});

app.delete('/api/vehicles/:id', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  const id = req.params.id;
  const list = vehiclesByClient.get(clientId) || [];
  const next = list.filter(x => x.id !== id);
  vehiclesByClient.set(clientId, next);
  res.json({ ok:true, removed:id });
});

// put near the top of server.js
function normalizeContact(raw = {}) {
  const arr = v => (Array.isArray(v) ? v.filter(Boolean) : []);
  const phones = [
    ...arr(raw.phones),
    raw.phone,
    raw.mobile,
    raw.primaryPhone,
  ].filter(Boolean);

  const emails = [
    ...arr(raw.emails),
    raw.email,
    raw.primaryEmail,
  ].filter(Boolean);

  return {
    id: raw.id || raw.contactId || null,
    name: raw.name || raw.fullName || raw.firstName || '—',
    company: raw.company || null,
    phones,
    emails,
    address: raw.address || null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    custom: raw.custom || {},
    pipeline: raw.pipeline || null,
  };
}

// helper: very simple offset fallback (see NOTE)
const TZ_DEFAULT = 'America/New_York';
const TZ_OFFSET_FALLBACK = process.env.DEFAULT_TZ_OFFSET || '-04:00'; // EDT default
// Suggest-times source: 'ghl' (default) or 'local' to avoid any GHL calls
const SUGGEST_SLOTS_SOURCE = process.env.SUGGEST_SLOTS_SOURCE || 'ghl';

// Local/mock free-slots generator (9–5 every 30m)
function buildLocalSlots(date, stepMin = 30, open = '09:00', close = '17:00') {
  const startISO = `${date}T${open}:00${TZ_OFFSET_FALLBACK}`;
  const endISO   = `${date}T${close}:00${TZ_OFFSET_FALLBACK}`;
  const out = [];
  for (let t = new Date(startISO); t < new Date(endISO); t = new Date(t.getTime() + stepMin * 60000)) {
    const end = new Date(t.getTime() + stepMin * 60000);
    out.push({ start: t.toISOString(), end: end.toISOString() });
  }
  return out;
}
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

// --- OSM / Nominatim geocode proxy with cache ---
const nominatimCache = new Map();
const NOM_TTL_MS = 12 * 60 * 60 * 1000; // 12h cache

app.get('/api/geo/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 200);
    if (!q) return res.json([]);

    const key = q.toLowerCase();
    const hit = nominatimCache.get(key);
    if (hit && Date.now() - hit.ts < NOM_TTL_MS) {
      return res.json(hit.data);
    }

    const email = process.env.GEOCODE_EMAIL || 'admin@example.com';
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=' +
      encodeURIComponent(q) +
      '&email=' + encodeURIComponent(email);

    const r = await fetch(url, {
      headers: {
        'User-Agent': `x-fleet/1.0 (${email})`,
        'Accept': 'application/json',
      },
    });

    if (!r.ok) {
      // Surface rate limit/info but don’t crash the UI
      const msg = await r.text().catch(() => '');
      return res.status(502).json({ ok: false, error: `nominatim_${r.status}`, details: msg.slice(0, 200) });
    }

    const data = await r.json().catch(() => []);
    const list = Array.isArray(data) ? data : [];
    nominatimCache.set(key, { ts: Date.now(), data: list });
    return res.json(list);
  } catch (e) {
    console.warn('[geo/search]', e?.message || e);
    return res.json([]); // fail-soft for the UI
  }
});

app.get('/health', (req,res)=> res.json({ ok:true }))

// --- helper to pick a primary phone from a contact
function pickPrimaryPhone(c = {}) {
  const arr = Array.isArray(c.phones) ? c.phones.filter(Boolean) : [];
  return arr[0] || c.phone || c.mobile || c.primaryPhone || null;
}

// Create or fetch a mock conversation for a contact (reuses your mockConvos store)
function ensureMockConversationForContact(contactId) {
  let convoId = mockByContact.get(contactId);
  if (!convoId) {
    convoId = uuid();
    mockByContact.set(contactId, convoId);
    mockConvos.set(convoId, { id: convoId, contactId, messages: [] });
  }
  return convoId;
}

// --- Jobs: create/upsert ---
app.post('/api/jobs', async (req, res) => {
  try {
    const b = req.body || {};
    const clientId = (b.clientId || 'default').trim();

    // ensure client map exists
    if (!jobsByClient.has(clientId)) jobsByClient.set(clientId, new Map());
    const jobs = jobsByClient.get(clientId);

    // id / times
    const id = b.appointmentId || b.id || newId('job_');
    const startISO = ensureOffsetISO(b.startTime) || new Date().toISOString();
    const endISO   = ensureOffsetISO(b.endTime)   ||
      new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString();

    // address + lat/lng
    const address = toAddressString(b.address);
    let lat = Number(b.lat), lng = Number(b.lng);
    const missingOrZero =
      !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0);

    if (missingOrZero && address) {
      try {
        const geo = await geocodeAddress(address);
        if (geo) { lat = geo.lat; lng = geo.lng; }
      } catch {}
    }

    // contact
    const contact = normalizeContact(b.contact || {});

    // store
    const job = {
      appointmentId: id,
      startTime: startISO,
      endTime: endISO,
      jobType: b.jobType || 'Job',
      estValue: Number(b.estValue) || 0,
      territory: b.territory || null,
      assignedUserId: b.assignedUserId || null,
      assignedRepName: b.assignedRepName || null,
      address,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      contact,
    };

    jobs.set(job.appointmentId, job);

    // live-refresh UIs
    io.emit('job:created', { clientId, job });

    res.json({ ok: true, job });
  } catch (e) {
    console.error('[POST /api/jobs]', e);
    res.status(500).json({ ok:false, error: 'failed to create job' });
  }
});

// --- Jobs: list (debug/convenience) ---
app.get('/api/jobs', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  const jobsMap = jobsByClient.get(clientId) || new Map();
  res.json({ ok: true, items: Array.from(jobsMap.values()) });
});

/**
 * POST /api/job/:id/ensure-thread
 * Body: { clientId?: string }
 * Returns: { ok, conversationId, contact, phone, autopilot }
 */
app.post('/api/job/:id/ensure-thread', async (req, res) => {
  try {
    const clientId = (req.body.clientId || 'default').trim();
    const jobs = jobsByClient.get(clientId) || new Map();
    const job = jobs.get(req.params.id);

    if (!job) return res.status(404).json({ ok:false, error:'Job not found' });

    // Normalize contact & enrich if needed
    let contact = normalizeContact(job.contact || {});
    if ((!contact.phones?.length || !contact.name) && (contact.id || contact.emails?.[0])) {
      try {
        const enriched = await getContact(contact.id, { email: contact.emails?.[0] });
        contact = normalizeContact({ ...contact, ...enriched });
      } catch {}
    }

    if (!contact.id) {
      return res.status(400).json({ ok:false, error:'Job has no contact id' });
    }

    // Make sure we have a usable phone for SMS UI
    const phone = pickPrimaryPhone(contact);

    // Ensure a conversation exists (mock layer for now)
    const conversationId = ensureMockConversationForContact(contact.id);

    // Read autopilot state for this contact (your per-contact override)
    const pref = getAutoPref({ id: contact.id, phone: phoneE164(phone) });
    const autopilot = (pref == null) ? (CHATTER_AI === true) : !!pref;

    return res.json({ ok:true, conversationId, contact, phone, autopilot });
  } catch (e) {
    console.error('[ensure-thread]', e);
    res.status(500).json({ ok:false, error:'failed to ensure thread' });
  }
});

app.post('/api/clear-jobs', (req, res) => {
  const clientId = req.body.clientId || 'default';
  jobsByClient.set(clientId, new Map());
  res.json({ ok: true, message: `Jobs cleared for ${clientId}` })
})

// PATCH /api/jobs/:id  → { startTime?, endTime?, assignedUserId? , clientId? }
app.patch('/api/jobs/:id', async (req, res) => {
  try {
    const clientId = (req.body.clientId || 'default').trim();
    const jobs = jobsByClient.get(clientId) || new Map();
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ ok:false, error:'job not found' });

    const { startTime, endTime, assignedUserId } = req.body || {};

    // 1) Apply local changes
    if (startTime) job.startTime = ensureOffsetISO(startTime);
    if (endTime)   job.endTime   = ensureOffsetISO(endTime);
    if (assignedUserId) job.assignedUserId = String(assignedUserId);

    jobs.set(job.appointmentId, job);

    // 2) Reflect in GHL (best-effort)
    try {
      if (assignedUserId) {
        await updateAppointmentOwner(job.appointmentId, assignedUserId);
        await appendAppointmentNotes(job.appointmentId, `Reassigned to ${assignedUserId} via Calendar/Board`);
      }
      if (startTime || endTime) {
        await rescheduleAppointment(job.appointmentId, job.startTime, job.endTime);
        await appendAppointmentNotes(job.appointmentId, `Rescheduled to ${job.startTime} – ${job.endTime}`);
      }
    } catch (e) {
      console.warn('[PATCH /api/jobs/:id] GHL sync warning:', e?.response?.data || e.message);
    }

    // 3) Notify all UIs
    io.emit('job:updated', { clientId, job });

    res.json({ ok:true, job });
  } catch (e) {
    console.error('[PATCH /api/jobs/:id]', e);
    res.status(500).json({ ok:false, error:'update failed' });
  }
});


// --- Chat AI per-contact state (used by Chatter.jsx) ---
// GET /api/agent/state?phone=+1555...&id=contact_123
app.get('/api/agent/state', (req, res) => {
  const id = req.query.id?.trim();
  const phone = phoneE164(req.query.phone?.trim());
  const pref = getAutoPref({ id, phone });
  const effective = (pref == null) ? (CHATTER_AI === true) : !!pref;
  const source = (pref == null) ? 'global_default' : 'per_contact';
  res.json({ ok: true, state: { autopilot: effective }, source });
});

// POST /api/agent/autopilot { id?, phone?, enabled: boolean }
app.post('/api/agent/autopilot', (req, res) => {
  try {
    const { id, phone, enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'enabled must be boolean' });
    }
    setAutoPref({ id, phone: phoneE164(phone), enabled });
    res.json({ ok: true, saved: { id: id || null, phone: phoneE164(phone) || null, enabled } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'failed to save' });
  }
});

// --- Voice AI (incoming calls) global state ---
app.get('/api/voice/state', (_req, res) => {
  res.json({ ok: true, enabled: !!VOICE_AI_ENABLED });
});

app.post('/api/voice/state', (req, res) => {
  VOICE_AI_ENABLED = !!req.body?.enabled;
  res.json({ ok: true, enabled: VOICE_AI_ENABLED });
});

// Twilio inbound SMS webhook
app.post('/twilio/sms', express.urlencoded({ extended: false }), async (req, res) => {
  const { From, Body, To } = req.body || {};

  recordSms({ to: To, from: From, direction: 'inbound', text: Body });
  io.emit('sms:inbound', { from: From, to: To, text: Body, at: new Date().toISOString() });

  try {
    // decide if Chat AI should reply for this sender
    const phoneNorm = phoneE164(From);
    const pref = getAutoPref({ phone: phoneNorm });
    const useAI = (pref == null) ? (CHATTER_AI === true) : !!pref;

    if (useAI) {
      await agentHandle({
        from: From,
        to: To,
        text: Body,
        send: async (toPhone, replyText) => {
          const resp = await sendSMS(toPhone, replyText);
          recordSms({ to: toPhone, from: To, direction: 'outbound', text: replyText });
          io.emit('sms:outbound', { sid: resp.sid, to: toPhone, text: replyText, at: new Date().toISOString() });
          return resp;
        },
      });
    }

    res.type('text/xml').send('<Response/>');
  } catch (err) {
    console.error('[twilio/sms agent error]', err?.message || err);
    res.type('text/xml').send('<Response/>');
  }
});

// NEW: aggregate contacts from (A) manual seeds + (B) current jobs in memory
app.get('/api/contacts', (req, res) => {
  try {
    const clientId = (req.query.clientId || 'default').trim();

    // A) start with any manually-seeded contacts
    const manual = contactsByClient.get(clientId) || new Map();
    const map = new Map(manual); // contactId -> summary

    // B) merge in contacts derived from jobs
    const jobs = jobsByClient.get(clientId) || new Map();
    for (const j of jobs.values()) {
      const c = normalizeContact(j.contact || {});
      if (!c.id) continue;

      const cur = map.get(c.id) || {
        id: c.id,
        name: c.name || '—',
        company: c.company || null,
        phones: [],
        emails: [],
        address: c.address || null,
        tags: c.tags || [],
        lastAppointmentAt: null,
        appointments: 0,
      };

      // unique merge for phones/emails
      const uniq = a => Array.from(new Set(a.filter(Boolean)));
      cur.phones = uniq([...(cur.phones || []), ...(c.phones || [])]);
      cur.emails = uniq([...(cur.emails || []), ...(c.emails || [])]);

      // last appt + count
      cur.appointments = (cur.appointments || 0) + 1;
      const t = new Date(j.startTime || 0).getTime();
      const prev = new Date(cur.lastAppointmentAt || 0).getTime();
      if (t > prev) cur.lastAppointmentAt = j.startTime || cur.lastAppointmentAt;

      map.set(c.id, cur);
    }

    const list = Array.from(map.values())
      .sort((a, b) => new Date(b.lastAppointmentAt || 0) - new Date(a.lastAppointmentAt || 0));

    res.json({ ok: true, clientId, count: list.length, contacts: list });
  } catch (e) {
    console.error('[contacts index]', e);
    res.status(500).json({ ok: false, error: 'failed to build contacts list' });
  }
});

// GET all dispositions for a contact (returns [] if none / jobs-only contact)
app.get('/api/contacts/:id/dispositions', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  const id = req.params.id;

  // ensure bag
  if (!contactsByClient.has(clientId)) contactsByClient.set(clientId, new Map());
  const bag = contactsByClient.get(clientId);

  let row = bag.get(id);

  // If missing, try to derive from jobs (mirror POST behavior)
  if (!row) {
    const jobsMap = jobsByClient.get(clientId) || new Map();
    const jobs = Array.from(jobsMap.values())
      .filter(j => (j?.contact?.id || j?.contactId) === id)
      .sort((a,b) => new Date(b.startTime) - new Date(a.startTime));

    if (jobs.length) {
      const j0 = jobs[0];
      const c  = normalizeContact(j0.contact || {});
      row = {
        id,
        name: c.name || '—',
        company: c.company || null,
        phones: Array.isArray(c.phones) ? c.phones.filter(Boolean) : [],
        emails: Array.isArray(c.emails) ? c.emails.filter(Boolean) : [],
        address: c.address || null,
        tags: [],
        kind: c.pipeline || undefined,
        lastAppointmentAt: j0.startTime || null,
        appointments: jobs.length,
        lastDisposition: null,
        dispositions: [],
      };
      bag.set(id, row);
    }
  }

  // If still nothing, return empty history (not an error)
  if (!row) return res.json({ ok:true, contactId:id, dispositions: [] });

  const list = Array.isArray(row.dispositions) ? row.dispositions : [];
  res.json({ ok:true, contactId:id, dispositions: list });
});

// POST /api/contacts/:id/dispositions  → { key, label, note?, clientId? }
app.post('/api/contacts/:id/dispositions', (req, res) => {
  try {
    const clientId = (req.body.clientId || req.query.clientId || 'default').trim();
    const id = req.params.id;
    const { key, label, note } = req.body || {};
    if (!key || !label) {
      return res.status(400).json({ ok:false, error:'key and label are required' });
    }

    // ensure a per-client bag
    if (!contactsByClient.has(clientId)) contactsByClient.set(clientId, new Map());
    const bag = contactsByClient.get(clientId);

    // try to load existing
    let row = bag.get(id);

    // If missing, auto-seed a minimal summary from jobs for this contact
    if (!row) {
      const jobsMap = jobsByClient.get(clientId) || new Map();
      // find the newest job for this contact to grab some context
      const jobs = Array.from(jobsMap.values())
        .filter(j => (j?.contact?.id || j?.contactId) === id)
        .sort((a,b) => new Date(b.startTime) - new Date(a.startTime));

      if (jobs.length) {
        const j0 = jobs[0];
        const c  = normalizeContact(j0.contact || {});
        row = {
          id,
          name: c.name || '—',
          company: c.company || null,
          phones: Array.isArray(c.phones) ? c.phones.filter(Boolean) : [],
          emails: Array.isArray(c.emails) ? c.emails.filter(Boolean) : [],
          address: c.address || null,
          tags: [],
          kind: c.pipeline || undefined,
          lastAppointmentAt: j0.startTime || null,
          appointments: jobs.length,
          lastDisposition: null,
          dispositions: [],
        };
        bag.set(id, row);
      }
    }

    if (!row) {
      // Still nothing to seed from—fail clearly
      return res.status(404).json({ ok:false, error:'contact not found (seed first via /api/contacts or create a job with this contact)' });
    }

    // make sure the arrays exist
    row.dispositions = Array.isArray(row.dispositions) ? row.dispositions : [];

    const entry = {
      key: String(key),
      label: String(label),
      note: note ? String(note) : undefined,
      at: new Date().toISOString(),
    };

    row.dispositions.push(entry);
    row.lastDisposition = entry;

    bag.set(id, row);
    return res.status(201).json({ ok:true, entry });
  } catch (e) {
    console.error('[contacts disposition]', e);
    return res.status(500).json({ ok:false, error:'failed to save disposition' });
  }
});

// Create/seed a contact for the prototype
app.post('/api/contacts', (req, res) => {
  try {
    const clientId = (req.body.clientId || 'default').trim();
    const b = req.body || {};

    if (!b.id || !b.name) {
      return res.status(400).json({ ok:false, error:'id and name are required' });
    }

    if (!contactsByClient.has(clientId)) contactsByClient.set(clientId, new Map());
    const bag = contactsByClient.get(clientId);

    const phones = Array.isArray(b.phones) ? b.phones.filter(Boolean) : [];
    const emails = Array.isArray(b.emails) ? b.emails.filter(Boolean) : [];

    const summary = {
      id: String(b.id),
      name: String(b.name),
      company: b.company || null,
      phones,
      emails,
      address: b.address || null,
      tags: Array.isArray(b.tags) ? b.tags : [],
      kind: b.kind || undefined,
      lastAppointmentAt: b.lastAppointmentAt || null,
      appointments: Number.isFinite(b.appointments) ? Number(b.appointments) : 0,
    };

    bag.set(summary.id, summary);
    return res.status(201).json({ ok:true, contact: summary });
  } catch (e) {
    console.error('[POST /api/contacts]', e);
    return res.status(500).json({ ok:false, error:'failed to save contact' });
  }
});



// List all appointments for a given contact (uses in-memory jobs store)
app.get('/api/contacts/:contactId/appointments', (req, res) => {
  try {
    const clientId  = (req.query.clientId || 'default').trim();
    const contactId = req.params.contactId?.trim();
    if (!contactId) return res.status(400).json({ ok:false, error:'contactId required' });

    const jobsMap = jobsByClient.get(clientId) || new Map();

    const list = Array.from(jobsMap.values())
      .filter(j => {
        const id = j?.contact?.id || j?.contactId;
        return id && id === contactId;
      })
      .map(j => ({
        appointmentId: j.appointmentId,
        startTime: j.startTime,
        endTime: j.endTime,
        address: j.address,
        jobType: j.jobType,
        estValue: Number(j.estValue) || 0,
        territory: j.territory || null,
      }))
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime)); // newest first

    res.json({ ok:true, contactId, count: list.length, appointments: list });
  } catch (e) {
    console.error('[contacts:appointments]', e);
    res.status(500).json({ ok:false, error:'failed to load contact appointments' });
  }
});

app.get('/api/week-appointments', async (req, res) => {
  try {
    const clientId = req.query.clientId || 'default';
    const jobsMap = jobsByClient.get(clientId) || new Map();

     // 👇 Add this lookup
    const techs = techsByClient.get(clientId) || [];
    const nameById = new Map(techs.map(t => [t.id, t.name]));

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
  assignedUserId: j.assignedUserId || null,   // ← add this
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
    // keep both field names so UI components don’t break
    startTime: it.startTimeISO,
    startTimeISO: it.startTimeISO,
    day: it.day,
    time: it.time,
    dateText: it.dateText,
    address: it.address,
    lat: it.lat,
    lng: it.lng,
    jobType: it.jobType,
    estValue: Number(it.estValue) || 0,
    territory: it.territory,
    contact: it.contact,
    travelMinutesFromPrev: it.travelMinutesFromPrev,
    assignedUserId: it.assignedUserId || null,
    assignedRepName: nameById.get(it.assignedUserId) || null,
  }));

  res.json(out);
  } catch (e) {
    console.error('[week-appointments]', e);
    res.status(500).json({ ok: false, error: 'failed to build week' });
  }
});

// --- Weather (Open-Meteo) ---
const weatherCache = new Map(); // key: "lat,lng|days" -> { ts, data }
const WEATHER_TTL_MS = 30 * 60 * 1000; // 30 min

async function fetchExtendedForecast(lat, lng, days = 16) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}|${days}`;
  const hit = weatherCache.get(key);
  if (hit && (Date.now() - hit.ts) < WEATHER_TTL_MS) return hit.data;

  const base = 'https://api.open-meteo.com/v1/forecast';
  const url = `${base}?latitude=${lat}&longitude=${lng}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=${Math.min(Math.max(1, days), 16)}`;

  const r = await fetch(url);
  const j = await r.json();

  const out = (j?.daily?.time || []).map((d, i) => ({
    date: d,
    code: j.daily.weathercode?.[i] ?? null,
    tMax: j.daily.temperature_2m_max?.[i] ?? null,
    tMin: j.daily.temperature_2m_min?.[i] ?? null,
    popMax: j.daily.precipitation_probability_max?.[i] ?? null,
  }));

  const payload = { lat, lng, days: out.length, daily: out };
  weatherCache.set(key, { ts: Date.now(), data: payload });
  return payload;
}

// API: /api/forecast?lat=..&lng=..&days=10
app.get('/api/forecast', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const days = Number(req.query.days) || 10;
    const data = await fetchExtendedForecast(lat, lng, days);
    if (!data) return res.status(400).json({ ok:false, error:'bad lat/lng' });
    res.json({ ok:true, ...data });
  } catch (e) {
    console.error('[forecast]', e);
    res.status(500).json({ ok:false, error:'forecast failed' });
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

  // Normalize on read so the drawer always has phones/emails/etc.
  const out = {
    ...job,
    estValue: Number(job.estValue) || 0,
    territory: job.territory || '—',
    contact: normalizeContact(job.contact || {}),
  };

  res.json({ ok: true, items: out });
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
 const args = SuggestTimesRequestSchema.parse(req.body);
const {
  clientId,
  date,
  timezone,
  address,
  jobType,
  estValue,
  territory,
  durationMin,
  bufferMin,
  maxDetourMin
} = args;
  const { startMs, endMs } = dayBoundsEpochMs(date, TZ_OFFSET_FALLBACK);

    // --- 1) Get free slots ---
let freeSlots = [];
if (SUGGEST_SLOTS_SOURCE === 'local') {
  freeSlots = buildLocalSlots(date);
} else {
  const calendarId = process.env.GHL_CALENDAR_ID;
  if (!calendarId || !process.env.GHL_ACCESS_TOKEN) {
    return res.status(500).json({ ok:false, error:'GHL env vars missing' });
  }
  const base = 'https://services.leadconnectorhq.com';
  const free = new URL(`/calendars/${calendarId}/free-slots`, base);

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

  freeSlots = extractSlotsFromGHL(data);
}
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

  // real SMS
  
app.post('/api/sms/send', async (req, res) => {
  try {
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ ok:false, error:'to and text required' });

    const resp = await sendSMS(to, text);
    recordSms({ to, from: process.env.TWILIO_FROM || process.env.TWILIO_PHONE_NUMBER, direction:'outbound', text });
    io.emit('sms:outbound', { sid: resp.sid, to, text, at: new Date().toISOString() });

    res.json({ ok:true, sid: resp.sid, status: resp.status });
  } catch (e) {
    res.status(500).json({
      ok:false,
      error: e.message || 'send failed',
      code: e.code || null,
      status: e.status || null,
      moreInfo: e.moreInfo || null
    });
  }
});

// REPLACE the existing /api/mock/ghl/send-message block with this
app.post('/api/mock/ghl/send-message', async (req, res) => {
  const {
    contactId,
    text = '',
    direction = 'outbound',
    channel = 'sms',
    autopilot,
    to,               // optional explicit phone for manual threads
    clientId = 'default',
  } = req.body || {};

  if (!contactId) return res.status(400).json({ ok:false, error:'contactId required' });


  // Persist per-contact AI pref if provided
  if (typeof autopilot === 'boolean') {
    setAutoPref({ id: contactId, phone: phoneE164(to), enabled: autopilot });
  }

  // Ensure a mock conversation (keeps UI history consistent)
  let convoId = mockByContact.get(contactId);
  if (!convoId) {
    convoId = uuid();
    mockByContact.set(contactId, convoId);
    mockConvos.set(convoId, { id: convoId, contactId, messages: [] });
  }
  const convo = mockConvos.get(convoId);

  // Append the outbound message to the local store
  const msg = {
    id: uuid(),
    direction,
    channel,
    text,
    createdAt: new Date().toISOString(),
  };
  convo.messages.push(msg);

  // ---- NEW: actually send via Twilio when this is an SMS ----
  let emittedSid = msg.id;
  try {
    if (channel === 'sms' && direction === 'outbound') {
      // Find a destination: explicit "to" or the contact’s primary phone from in-memory jobs
      let dest = phoneE164(to);
      if (!dest) {
        // search all clients' jobs for this contact’s phone
        for (const jobs of jobsByClient.values()) {
          for (const j of jobs.values()) {
            const c = normalizeContact(j.contact || {});
            if (String(c.id) === String(contactId)) {
              const p = pickPrimaryPhone(c);
              if (p) { dest = phoneE164(p); break; }
            }
          }
          if (dest) break;
        }
      }

      if (dest) {
        const resp = await sendSMS(dest, text);         // <-- real Twilio send
        emittedSid = resp?.sid || emittedSid;
      } else {
        console.warn('[sms send] No destination phone found for contact', contactId);
      }
    }
  } catch (e) {
    console.error('[sms send] Twilio error:', e?.message || e);
    // fall through; we still keep mock history & UI event
  }

  // Notify UIs of the outbound message (use Twilio SID when available)
  io.emit('sms:outbound', { sid: emittedSid, contactId, text: msg.text, at: msg.createdAt });



  return res.json({ ok: true, conversationId: convoId, message: msg });
});

app.get('/api/mock/ghl/contact/:contactId/conversations', (req, res) => {
  const contactId = req.params.contactId;
  const convoId = mockByContact.get(contactId);
  if (!convoId) return res.json({ ok:true, contactId, conversations: [] });
  return res.json({
    ok: true,
    contactId,
    conversations: [{ id: convoId, unreadCount: 0, starred: false, type: 0 }],
  });
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
async function handleBookAppointment(req, res) {
  try {
    console.log("[DEBUG] Incoming create-appointment payload:", req.body);

    let args;
    try {
      args = CreateAppointmentReqSchema.parse(req.body);
    } catch (e) {
      return res.status(400).json({ ok:false, error:'Invalid request', details: e.errors ?? String(e) });
    }

    const {
      contact,
      contactId: contactIdFromClient,
      address,
      lat,
      lng,
      jobType,
      estValue,
      territory,
      startTime,
      endTime,
      timezone,
      title,
      notes,
      rrule,
      assignedUserId,
      clientId,
    } = args;

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
      const phoneNorm = phoneE164(contact?.phone);

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

    // Create appointment in GHL
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

    // Ensure we have coordinates
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

// Build a **fully-enriched contact** for the job
let contactNorm = normalizeContact({ id: contactId, ...(contact || {}) });
try {
  const enriched = await getContact(contactId, {
    email: (contact && contact.email) || undefined,
    phone: (contact && contact.phone) || undefined,
  });
  contactNorm = normalizeContact({ ...contactNorm, ...(enriched || {}) });
} catch (e) {
  // soft-fail: keep whatever we already have
}

// Store job locally
const activeClientId = clientId || 'default';
if (!jobsByClient.has(activeClientId)) jobsByClient.set(activeClientId, new Map());
const jobs = jobsByClient.get(activeClientId);

const job = {
  appointmentId: created?.id || created?.appointmentId || 'ghl-unknown',
  address,
  lat: Number.isFinite(latNum) ? latNum : 0,
  lng: Number.isFinite(lngNum) ? lngNum : 0,
  startTime: ensureOffsetISO(startTime),
  endTime: ensureOffsetISO(endTime),
  jobType,
  estValue: Number(estValue) || 0,
  territory,
  contact: contactNorm, // <-- now includes phones/emails/name when available
};

jobs.set(job.appointmentId, job);
io.emit('job:created', job);

    // ---------------- AI ranking lives HERE ----------------
    if (SHOULD_SEED_DEMO) ensureDemoTechs(activeClientId);
    const techs = techsByClient.get(activeClientId) || [];
    const reps = techs.map(t => ({
      id: t.id, name: t.name, skills: t.skills, territory: t.territory, route: t.route
    }));

    let candidates = [];
    try {
      candidates = await scoreAllReps(job, reps);
    } catch (e) {
      console.warn('[AI score manual] failed:', e.message);
    }

    const mode = process.env.SDC_MODE || 'Approve';

    if (mode === 'Auto' && candidates[0]) {
      const best = candidates[0];
      try {
        await updateAppointmentOwner(job.appointmentId, best.repId);
        await appendAppointmentNotes(
          job.appointmentId,
          `Booked by SDC AI • ${best.reason} • FIT=${best.total.toFixed(2)}`
        );
        io.emit('ai:booking', { clientId: activeClientId, job, decision: best });
      } catch (e) {
        console.warn('[Auto-assign/manual] failed:', e.message);
      }
    } else {
      io.emit('ai:suggestion', { clientId: activeClientId, job, candidates });
    }
    // -------------------------------------------------------

    // (nice for UI) return candidates too
    return res.json({ ok: true, job, candidates });
  } catch (err) {
    console.error('[Book Appointment] Error:', err?.response?.data || err.message || err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

// ---- Techs (simple admin endpoints) ----
app.get('/api/techs', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  if (SHOULD_SEED_DEMO) ensureDemoTechs(clientId);
  const techs = techsByClient.get(clientId) || [];
  res.json({ ok: true, clientId, count: techs.length, techs });
});

app.post('/api/techs', (req, res) => {
  try {
    const { clientId, techs } = UpsertTechsRequestSchema.parse(req.body);
    techsByClient.set(clientId, techs);
    res.json({ ok: true, clientId, count: techs.length });
  } catch (e) {
    res.status(400).json({ ok:false, error:'Invalid payload', details: e.errors ?? String(e) });
  }
});


// Approve & assign a candidate to an appointment
app.post('/api/approve-assignment', async (req, res) => {
  try {
    const clientId = (req.body.clientId || 'default').trim();
    const { appointmentId, repId } = req.body || {};
    if (!appointmentId || !repId) {
      return res.status(400).json({ ok:false, error:'appointmentId and repId are required' });
    }

    const techs = techsByClient.get(clientId) || [];
    const rep = techs.find(t => t.id === repId);
    if (!rep) return res.status(404).json({ ok:false, error:'rep not found for client' });

    // Update in GHL
    await updateAppointmentOwner(appointmentId, repId);

    // Keep local state in sync
    const jobs = jobsByClient.get(clientId) || new Map();
    const job = jobs.get(appointmentId);
    if (job) {
      await rescheduleAppointment(appointmentId, job.startTime, job.endTime);
      await appendAppointmentNotes(appointmentId, `Approved for ${rep.name} (${rep.id}) via Dispatch Board`);
      job.assignedUserId = repId;
      jobs.set(appointmentId, job);
      io.emit('ai:booking', { clientId, job, decision: { repId: rep.id, repName: rep.name } });
    }
    

    res.json({ ok:true, appointmentId, assignedTo: { id: rep.id, name: rep.name } });
  } catch (e) {
    console.error('[approve-assignment]', e?.response?.data || e.message);
    res.status(500).json({ ok:false, error: e?.response?.data || e.message });
  }
});

// ✅ Register the route AFTER defining the function
app.post('/api/create-appointment', handleBookAppointment);
app.post('/ghl/appointment-created', async (req, res) => {
  try {
    const clientId = req.query.clientId || req.body.clientId || 'default';
    if (SHOULD_SEED_DEMO) ensureDemoTechs(clientId);
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
  job.contact = normalizeContact({ ...job.contact, ...enriched });
} else {
  job.contact = normalizeContact(job.contact);
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

app.get('/__routes', (_req, res) => {
  const routes = app._router.stack
    .filter(l => l.route)
    .map(l => ({ method: Object.keys(l.route.methods)[0]?.toUpperCase(), path: l.route.path }));
  res.json(routes);
});


const PORT = process.env.PORT || 8080

server.listen(PORT, () => {
  console.log(`SDC backend (multi-client) on http://localhost:${PORT}`)
})