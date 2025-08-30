import 'dotenv/config';

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import fetch from 'node-fetch';
import axios from 'axios';

import twilio from 'twilio';
import { verifyTwilio } from './lib/twilio.js';
import { scoreAllReps } from './lib/fit.js';
import { sendSMS, placeCall } from './lib/twilio.js';
import { handleInbound as agentHandle } from './lib/agent.js';
import { recordSms, normalizePhone as phoneE164, getThread } from './lib/chatter.js';


import {
  getContact,
  createContact,
  updateAppointmentOwner,
  rescheduleAppointment,
  appendAppointmentNotes,
  createAppointmentV2,
} from './lib/ghl.js';

import createChatterRouter from './routes/chatter.js';
import mailgunRoute from './routes/mailgun.ts';
import { sendEmail } from './lib/mailgun.ts';
import { draftEmail } from './lib/emailDraft.ts';
import emailSendRoute from './routes/emailSend.ts';
import { SuggestTimesRequestSchema, CreateAppointmentReqSchema, UpsertTechsRequestSchema } from './lib/schemas.js';
import { generateEstimateItems, draftEstimateCopy } from './lib/estimate-llm.ts';
import { aiEstimate } from './lib/estimate.ts';
import contactsRouter from './routes/contacts.ts';
import { createEvent, recordAndEmit, listEvents } from './lib/events.ts';
import { registerAutomationRoutes, dispatchEvent } from './lib/automations.ts';
import { makeChatRouter } from './routes/chat';
import { makeTeamRouter } from './routes/team';


// 🔁 Central repo: one place for all in-memory stores & caches
import {
  geocodeCache,
  driveCache,
  jobsByClient,
  techsByClient,
  vehiclesByClient,
  contactsByClient,
  newId,
  setAutoPref,
  getAutoPref,
} from './lib/repos/memory.ts';

// 🧭 New centralized phone→tenant mapping
import {
  loadTenantPhoneSeeds,
  getTenantForPhone,
  setTenantPhone,
  removeTenantPhone,
  listTenantPhoneMap,
} from './lib/repos/tenants.ts';
import { WebSocketServer } from 'ws'

// WebSocket server for Twilio Media Streams
const mediaWSS = new WebSocketServer({ noServer: true })

// Path Twilio will connect to for Media Streams
const VOICE_WS_PATH = '/twilio/media';

// Prefer PUBLIC_WS_URL (wss://...), else derive from PUBLIC_URL
function publicWsUrl() {
  const explicit = (process.env.PUBLIC_WS_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const base = (process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (!base) return '';
  return base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}



// Basic handler: logs stream lifecycle and forwards key events to the UI
mediaWSS.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost'); // base is ignored
  const tenantId = (url.searchParams.get('tenantId') || 'default').toLowerCase();

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    // Twilio sends 'start' | 'media' | 'stop' events
    if (msg.event === 'start') {
      emitTenant(tenantId, 'voice:media', {
        type: 'start',
        streamSid: msg.start?.streamSid || null,
        callSid: msg.start?.callSid || null,
        at: new Date().toISOString(),
      });
    } else if (msg.event === 'media') {
      // msg.media.payload is base64 PCM-16 mono @8kHz
      // hook your voice AI here (decode, transcribe, respond, etc.)
    } else if (msg.event === 'stop') {
      emitTenant(tenantId, 'voice:media', { type: 'stop', at: new Date().toISOString() });
      ws.close();
    }
  });

  ws.on('close', () => {
    emitTenant(tenantId, 'voice:media', { type: 'ws_closed', at: new Date().toISOString() });
  });
});

const app = express();
const server = http.createServer(app);
const CHATTER_AI = process.env.CHATTER_AI === 'true';

// Upgrade HTTP to WebSocket for Twilio Media Streams
server.on('upgrade', (req, socket, head) => {
  if (!req.url || !req.url.startsWith(VOICE_WS_PATH)) return;
  mediaWSS.handleUpgrade(req, socket, head, (ws) => {
    mediaWSS.emit('connection', ws, req);
  });
});

const io = new SocketIOServer(server, {
  cors: { origin: process.env.ALLOW_ORIGIN || '*', methods: ['GET', 'POST'] },
});



// ---- Socket.IO tenant scoping ----
io.use((socket, next) => {
  const t =
    (socket.handshake.auth && socket.handshake.auth.tenantId) ||
    (socket.handshake.query && socket.handshake.query.tenantId) ||
    'default';
  socket.data = socket.data || {};
  socket.data.tenantId = String(t || 'default').toLowerCase();
  next();
});

io.on('connection', (socket) => {
  socket.join(socket.data.tenantId || 'default');
});

// Emit to a single tenant "room"
function emitTenant(tenantId, event, payload) {
  io.to(String(tenantId || 'default').toLowerCase()).emit(event, payload);
}

// Get a tenant-scoped io-like emitter for helpers
function ioForTenant(tenantId) {
  const room = String(tenantId || 'default').toLowerCase();
  return { emit: (event, payload) => io.to(room).emit(event, payload) };
}

// ---- Geocode + Drive helpers (backed by shared caches) ----
async function geocodeAddress(address) {
  if (!address) return null;
  const hit = geocodeCache.get(address);
  if (hit) return hit;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${apiKey}`;

  const resp = await fetch(url);
  const data = await resp.json();
  console.log('[Geocode API Response]', JSON.stringify(data, null, 2));

  if (data.status === 'OK' && data.results.length > 0) {
    const loc = data.results[0].geometry.location;
    const out = { lat: loc.lat, lng: loc.lng };
    geocodeCache.set(address, out);
    return out;
  }
  return null;
}

async function getDriveMinutes(from, to) {
  if (!from || !to) return null;
  const f = `${from.lat},${from.lng}`;
  const t = `${to.lat},${to.lng}`;
  if (
    !/^-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/.test(f) ||
    !/^-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/.test(t)
  )
    return null;

  const key = `${from.lat},${from.lng}|${to.lat},${to.lng}`;
  const hit = driveCache.get(key);
  if (hit != null) return hit;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
    f
  )}&destinations=${encodeURIComponent(
    t
  )}&mode=driving&departure_time=now&key=${apiKey}`;

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

// ---- Mock conversations / globals ----
const mockConvos = new Map(); // conversationId -> { id, contactId, messages: [...] }
const mockByContact = new Map(); // contactId -> conversationId
const uuid = () => 'c_' + Math.random().toString(36).slice(2);
let VOICE_AI_ENABLED = false;

// ---- Tenant resolution (JS) ----
function resolveTenant(req) {
  const hdr = req.get('X-Tenant-Id');
  const q = req.query && req.query.clientId;
  const bodyClient = req.body && req.body.clientId;
  const sub = (req.hostname || '').split('.')[0];

  const t =
    (hdr && String(hdr)) ||
    (q && String(q)) ||
    (bodyClient && String(bodyClient)) ||
    (sub && sub !== 'www' ? sub : '') ||
    'default';

  req.tenantId = String(t).toLowerCase();
  return req.tenantId;
}

function withTenant(req, _res, next) {
  resolveTenant(req);
  next();
}

// ---- Startup seeds (if provided) ----
loadTenantPhoneSeeds(process.env.TWILIO_TENANT_MAP);

app.use(withTenant);
app.use(cors({ origin: process.env.ALLOW_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/chat', makeChatRouter(io));
app.use('/api/team', makeTeamRouter(io));


app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} ct=${req.headers['content-type'] || ''}`);
  if (req.method !== 'GET') {
    try {
      console.log('[BODY]', JSON.stringify(req.body).slice(0, 500));
    } catch {}
  }
  next();
});

// Routers
app.use(createChatterRouter(io));
app.use('/api', mailgunRoute);
app.use('/api', emailSendRoute);
app.use('/api/contacts-db', contactsRouter);
app.use('/api', registerAutomationRoutes());

/* --- Internal Chat (tenant-scoped Slack-lite) --- */
const channelsByClient = new Map();
const channelMessagesByClient = new Map();
const channelReadsByClient = new Map();

function bag(map, clientId) {
  const id = (clientId || 'default').trim();
  if (!map.has(id)) map.set(id, new Map());
  return map.get(id);
}
function listChannels(clientId) {
  const id = (clientId || 'default').trim();
  if (!channelsByClient.has(id)) channelsByClient.set(id, []);
  return channelsByClient.get(id);
}
function listMessages(clientId, channelId) {
  const msgsByChan = bag(channelMessagesByClient, clientId);
  if (!msgsByChan.has(channelId)) msgsByChan.set(channelId, []);
  return msgsByChan.get(channelId);
}
function readMap(clientId, channelId) {
  const readsByChan = bag(channelReadsByClient, clientId);
  if (!readsByChan.has(channelId)) readsByChan.set(channelId, new Map());
  return readsByChan.get(channelId);
}

function ensureChannel(clientId, { name, topic = '', members = [] }) {
  const list = listChannels(clientId);
  const existing = list.find(c => c.name.toLowerCase() === String(name).toLowerCase());
  if (existing) return existing;
  const ch = {
    id: newId('chn_'),
    name: String(name).trim().slice(0, 80),
    topic: String(topic || '').slice(0, 200),
    members: Array.isArray(members) ? members.filter(Boolean) : [],
    createdAt: new Date().toISOString(),
    lastMessageAt: null,
  };
  list.push(ch);
  return ch;
}

if (process.env.SEED_DEMO_CHANNELS === 'true') {
  ensureChannel('default', { name: 'sales', topic: 'Sales team huddle' });
  ensureChannel('default', { name: 'ops', topic: 'Dispatch & operations' });
}

app.get('/api/chat/channels', (req, res) => {
  const clientId = (req.query.clientId || req.tenantId || 'default').trim();
  const items = listChannels(clientId).slice().sort((a, b) => {
    const ta = new Date(a.lastMessageAt || a.createdAt).getTime();
    const tb = new Date(b.lastMessageAt || b.createdAt).getTime();
    return tb - ta;
  });
  res.json({ ok: true, clientId, channels: items });
});

app.post('/api/chat/channels', (req, res) => {
  const clientId = (req.body.clientId || req.tenantId || 'default').trim();
  const { name, topic = '', members = [] } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: 'name required' });
  const ch = ensureChannel(clientId, { name, topic, members });
  emitTenant(clientId, 'chat:channel:created', { channel: ch });
  res.status(201).json({ ok: true, channel: ch });
});

app.get('/api/chat/channels/:id/messages', (req, res) => {
  const clientId = (req.query.clientId || req.tenantId || 'default').trim();
  const channelId = req.params.id;
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const afterRaw = req.query.after ? new Date(String(req.query.after)) : null;
  const afterISO = afterRaw && !isNaN(afterRaw.getTime()) ? afterRaw.toISOString() : null;
  const all = listMessages(clientId, channelId);
  let out = all;
  if (afterISO) {
    const t = new Date(afterISO).getTime();
    out = all.filter(m => new Date(m.at).getTime() > t);
  }
  out = out.slice(-limit);
  res.json({ ok: true, clientId, channelId, count: out.length, messages: out });
});

app.post('/api/chat/channels/:id/messages', async (req, res) => {
  try {
    const clientId = (req.body.clientId || req.tenantId || 'default').trim();
    const channelId = req.params.id;
    const { userId, userName, text, attachments = [] } = req.body || {};
    if (!userId || !text) return res.status(400).json({ ok: false, error: 'userId and text required' });

    const ch = listChannels(clientId).find(c => c.id === channelId);
    if (!ch) return res.status(404).json({ ok: false, error: 'channel not found' });

    const msg = {
      id: newId('msg_'),
      channelId,
      userId: String(userId),
      userName: String(userName || '').slice(0, 80) || 'User',
      text: String(text).slice(0, 10000),
      attachments: Array.isArray(attachments) ? attachments.slice(0, 5) : [],
      at: new Date().toISOString(),
    };

    const msgs = listMessages(clientId, channelId);
    msgs.push(msg);
    ch.lastMessageAt = msg.at;

    emitTenant(clientId, 'chat:message', { channelId, message: msg });

    try {
      const ev = createEvent(
        'chat.message.created',
        clientId,
        { channelId, message: msg },
        { source: 'chat', idempotencyKey: `${clientId}:${channelId}:${msg.id}` }
      );
      recordAndEmit(ioForTenant(clientId), ev);
      await dispatchEvent(ev);
    } catch (e) {
      console.warn('[chat.message.created] dispatch warn:', e?.message || e);
    }

    res.status(201).json({ ok: true, message: msg });
  } catch (e) {
    console.error('[POST /api/chat/.../messages]', e);
    res.status(500).json({ ok: false, error: 'send_failed' });
  }
});

app.post('/api/chat/channels/:id/typing', (req, res) => {
  const clientId = (req.body.clientId || req.tenantId || 'default').trim();
  const channelId = req.params.id;
  const { userId, userName, isTyping = true } = req.body || {};
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

  emitTenant(clientId, 'chat:typing', {
    channelId,
    userId: String(userId),
    userName: String(userName || ''),
    isTyping: !!isTyping,
    at: new Date().toISOString(),
  });
  res.json({ ok: true });
});

app.post('/api/chat/channels/:id/read', (req, res) => {
  const clientId = (req.body.clientId || req.tenantId || 'default').trim();
  const channelId = req.params.id;
  const { userId, lastReadMessageId } = req.body || {};
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

  const reads = readMap(clientId, channelId);
  const at = new Date().toISOString();
  reads.set(String(userId), { lastReadMessageId: lastReadMessageId || null, at });

  emitTenant(clientId, 'chat:read', {
    channelId,
    userId: String(userId),
    lastReadMessageId: lastReadMessageId || null,
    at,
  });

  res.json({ ok: true });
});
/* --- end Internal Chat --- */

// --- Tenants admin: phone → tenant mapping ---
// GET list
app.get('/api/tenants/phone-map', (_req, res) => {
  res.json({ ok: true, items: listTenantPhoneMap() });
});
// POST upsert { phone, tenantId }
app.post('/api/tenants/phone-map', (req, res) => {
  const phone = phoneE164(req.body?.phone || '');
  const tenantId = String(req.body?.tenantId || '').trim();
  if (!phone || !tenantId) return res.status(400).json({ ok: false, error: 'phone and tenantId required' });
  setTenantPhone(phone, tenantId);
  res.json({ ok: true, saved: { phone, tenantId } });
});
// DELETE { phone }
app.delete('/api/tenants/phone-map', (req, res) => {
  const phone = phoneE164(req.body?.phone || req.query?.phone || '');
  if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });
  removeTenantPhone(phone);
  res.json({ ok: true, removed: phone });
});

// --- Voice numbers & assignments (in-memory) ---
// Purpose:
// 1) Registry of tenant-owned numbers
// 2) Per-user direct number assignment
// 3) Optional per-tenant rollover order (array of numbers)
// All in-memory for now; swap to DB later.

const voiceNumbersByTenant = new Map();   // tenantId -> Set<phone>
const userNumberByTenant = new Map();     // tenantId -> Map<userId, phone>
const rolloverByTenant = new Map();       // tenantId -> Array<phone>

// helpers
function bagSet(map, key) {
  const k = String(key || 'default').toLowerCase();
  if (!map.has(k)) map.set(k, new Set());
  return map.get(k);
}
function bagMap(map, key) {
  const k = String(key || 'default').toLowerCase();
  if (!map.has(k)) map.set(k, new Map());
  return map.get(k);
}
function listTenantNumbers(tenantId) {
  return Array.from(voiceNumbersByTenant.get(String(tenantId).toLowerCase()) || []);
}

// GET numbers for a tenant
app.get('/api/voice/numbers', (req, res) => {
  const tenantId = (req.query.tenantId || req.tenantId || 'default').toLowerCase();
  res.json({
    ok: true,
    tenantId,
    numbers: listTenantNumbers(tenantId),
    assignments: Array.from(bagMap(userNumberByTenant, tenantId).entries())
      .map(([userId, phone]) => ({ userId, phone })),
    rollover: Array.from(rolloverByTenant.get(tenantId) || []),
  });
});

// POST add/buy (register) a number for a tenant
// Body: { phone: string(E.164), tenantId?: string }
app.post('/api/voice/numbers', (req, res) => {
  const tenantId = (req.body?.tenantId || req.tenantId || 'default').toLowerCase();
  const phone = phoneE164(req.body?.phone || '');
  if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });

  const set = bagSet(voiceNumbersByTenant, tenantId);
  set.add(phone);

  // keep your global phone→tenant resolver in sync
  setTenantPhone(phone, tenantId);

  emitTenant(tenantId, 'voice:numbers:update', { numbers: Array.from(set) });
  res.status(201).json({ ok: true, tenantId, phone });
});

// DELETE remove a number from a tenant
// Body or query: { phone }
app.delete('/api/voice/numbers', (req, res) => {
  const tenantId = (req.body?.tenantId || req.query?.tenantId || req.tenantId || 'default').toLowerCase();
  const phone = phoneE164(req.body?.phone || req.query?.phone || '');
  if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });

  const set = bagSet(voiceNumbersByTenant, tenantId);
  set.delete(phone);
  removeTenantPhone(phone); // also remove from resolver

  // also unassign from any user
  const map = bagMap(userNumberByTenant, tenantId);
  for (const [uid, p] of map.entries()) if (p === phone) map.delete(uid);

  // prune from rollover
  const roll = (rolloverByTenant.get(tenantId) || []).filter(n => n !== phone);
  rolloverByTenant.set(tenantId, roll);

  emitTenant(tenantId, 'voice:numbers:update', { numbers: Array.from(set) });
  res.json({ ok: true, tenantId, removed: phone });
});

// POST assign a number to a user
// Body: { userId: string, phone: string(E.164), tenantId?: string }
app.post('/api/voice/assign', (req, res) => {
  const tenantId = (req.body?.tenantId || req.tenantId || 'default').toLowerCase();
  const userId = String(req.body?.userId || '').trim();
  const phone = phoneE164(req.body?.phone || '');
  if (!userId || !phone) return res.status(400).json({ ok: false, error: 'userId and phone required' });

  const set = bagSet(voiceNumbersByTenant, tenantId);
  if (!set.has(phone)) return res.status(400).json({ ok: false, error: 'phone not registered for tenant' });

  const map = bagMap(userNumberByTenant, tenantId);
  map.set(userId, phone);

  emitTenant(tenantId, 'voice:assign:update', { userId, phone });
  res.json({ ok: true, tenantId, userId, phone });
});

// GET assignments for a tenant
app.get('/api/voice/assign', (req, res) => {
  const tenantId = (req.query?.tenantId || req.tenantId || 'default').toLowerCase();
  const map = bagMap(userNumberByTenant, tenantId);
  res.json({
    ok: true,
    tenantId,
    assignments: Array.from(map.entries()).map(([userId, phone]) => ({ userId, phone })),
  });
});

// POST set rollover order for a tenant
// Body: { tenantId?: string, numbers: string[] }  (must be registered)
app.post('/api/voice/rollover', (req, res) => {
  const tenantId = (req.body?.tenantId || req.tenantId || 'default').toLowerCase();
  const numbers = Array.isArray(req.body?.numbers) ? req.body.numbers.map(phoneE164).filter(Boolean) : [];
  const registered = new Set(listTenantNumbers(tenantId));
  const bad = numbers.filter(n => !registered.has(n));
  if (bad.length) return res.status(400).json({ ok: false, error: 'unregistered numbers in list', bad });

  rolloverByTenant.set(tenantId, numbers);
  res.json({ ok: true, tenantId, rollover: numbers });
});

// GET rollover list
app.get('/api/voice/rollover', (req, res) => {
  const tenantId = (req.query?.tenantId || req.tenantId || 'default').toLowerCase();
  res.json({ ok: true, tenantId, rollover: Array.from(rolloverByTenant.get(tenantId) || []) });
});

// --- EMAIL ---
app.post('/api/test-email', async (req, res) => {
  try {
    const { to, subject = 'Mailgun prototype test', text, html, replyTo, domain, from } =
      req.body || {};
    if (!to) return res.status(400).json({ ok: false, error: 'to required' });
    const r = await sendEmail({
      to,
      subject,
      text: text || 'Hello from Fleet via Mailgun.',
      html: html || '<p>Hello from <b>Fleet</b> via Mailgun.</p>',
      replyTo: replyTo || 'greg@nonstopautomation.com',
      domain,
      from,
    });
    res.json({ ok: true, result: r });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.post('/api/email/draft', async (req, res) => {
  try {
    const { context, tone = 'friendly' } = req.body || {};
    if (!context) return res.status(400).json({ ok: false, error: 'context required' });
    const draft = await draftEmail(context, tone);
    res.json({ ok: true, draft });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'draft failed' });
  }
});

app.post('/api/email/draft-and-send', async (req, res) => {
  try {
    const { to, context, tone = 'friendly', replyTo } = req.body || {};
    if (!to || !context) return res.status(400).json({ ok: false, error: 'to and context required' });

    const draft = await draftEmail(context, tone);
    const result = await sendEmail({
      to,
      subject: draft.subject,
      html: draft.html,
      replyTo,
    });

    res.json({ ok: true, draft, send: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'draft-and-send failed' });
  }
});

// --- Voice: outbound call ---
app.post('/api/voice/call', async (req, res) => {
  try {
    const { to, opts = {} } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, error: 'to required' });

    const r = await placeCall(to, {
      statusCallback: `${process.env.PUBLIC_URL}/twilio/voice-status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      ...opts,
    });

    emitTenant(req.tenantId || 'default', 'voice:status', {
      sid: r.sid,
      status: r.status || 'queued',
      to,
    });
    return res.json({ ok: true, sid: r.sid, status: r.status || 'queued' });
  } catch (e) {
    console.error('[api/voice/call]', e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || 'call failed' });
  }
});

// --- Twilio recording status webhook ---
app.post('/twilio/recording-status', express.urlencoded({ extended: false }),  verifyTwilio(), async (req, res) => {
  try {
    const { CallSid, CallStatus, RecordingSid, RecordingUrl, RecordingStatus, RecordingDuration, Timestamp, To, From } =
      req.body || {};

    // 🔁 resolve tenant from the inbound "To" number
    req.tenantId = getTenantForPhone(To) || 'default';

    const mp3Url = RecordingUrl ? `${RecordingUrl}.mp3` : null;

    emitTenant(req.tenantId, 'voice:recording', {
      callSid: CallSid || null,
      status: RecordingStatus || 'unknown',
      url: mp3Url,
      recordingSid: RecordingSid || null,
      durationSec: RecordingDuration ? Number(RecordingDuration) : null,
      to: To || null,
      from: From || null,
      callStatus: CallStatus || null,
      at: new Date().toISOString(),
    });

    try {
      const clientId = (req.query.clientId || 'default').trim();
      const ev = createEvent(
        'call.recording.completed',
        clientId,
        {
          callSid: CallSid || null,
          recordingSid: RecordingSid || null,
          url: mp3Url,
          durationSec: RecordingDuration ? Number(RecordingDuration) : null,
          to: To || null,
          from: From || null,
          timestamp: Timestamp || null,
        },
        { source: 'twilio' }
      );
      recordAndEmit(ioForTenant(clientId), ev);
      await dispatchEvent(ev);
    } catch (persistErr) {
      console.warn('[recording-status] persist warning:', persistErr?.message || persistErr);
    }

    res.type('text/xml').send('<Response/>');
  } catch (e) {
    console.error('[twilio/recording-status]', e?.message || e);
    res.type('text/xml').send('<Response/>');
  }
});

// --- Estimate AI ---
app.post('/api/estimate/ai/items', async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ ok: false, error: 'prompt (string) is required' });
    }
    const payload = await generateEstimateItems(prompt);
    return res.json({ ok: true, ...payload });
  } catch (e) {
    console.warn('[estimate.ai.items]', e?.message || e);
    return res.status(500).json({ ok: false, error: 'llm_failed' });
  }
});

app.post('/api/estimate/ai/summary', async (req, res) => {
  try {
    const { items = [], notes = '', contact = {} } = req.body || {};
    const text = await draftEstimateCopy({ items, notes }, contact);
    return res.json({ ok: true, text });
  } catch (e) {
    console.warn('[estimate.ai.summary]', e?.message || e);
    return res.status(500).json({ ok: false, error: 'llm_failed' });
  }
});

app.post('/api/agent/estimate', express.json(), async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ ok: false, error: 'prompt required' });

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
});

// --- Proposal cover letter (JS alias) ---
app.post('/api/agent/proposal', async (req, res) => {
  try {
    const { items = [], notes = '', contact = {} } = req.body || {};

    // Try LLM helper first (same one your /api/estimate/ai/summary uses)
    let text = '';
    try {
      text = await draftEstimateCopy({ items, notes }, contact);
    } catch (err) {
      console.warn('[agent.proposal] draftEstimateCopy failed:', err?.message || err);
    }

    // Fallback: safe, no-LLM template
    if (!text || !String(text).trim()) {
      const lines = (Array.isArray(items) ? items : [])
        .slice(0, 6)
        .map((it) => {
          const name = (it?.name || 'Item').toString();
          const qty = Number(it?.qty) || 0;
          const unit = (it?.unit || '').toString().trim();
          const unitPrice = Number(it?.unitPrice) || 0;
          const line = qty * unitPrice;
          return `• ${name} — ${qty}${unit ? ' ' + unit : ''} @ $${unitPrice.toFixed(2)} (${line ? '$' + line.toFixed(2) : '—'})`;
        })
        .join('\n');

      text =
`Hi ${contact?.name || 'there'},

Thanks for inviting us to look at your project. Below is a clear scope and transparent pricing.

Scope summary:
${lines || '• See line items below.'}

${notes ? `Notes: ${String(notes).trim()}\n\n` : ''}If everything looks good, reply here or call us and we’ll get your work scheduled.

Best regards,
NONSTOP JOBS`;
    }

    return res.json({ ok: true, text });
  } catch (e) {
    console.error('[/api/agent/proposal]', e?.message || e);
    return res.status(500).json({ ok: false, error: 'proposal_failed' });
  }
});



// --- Events ---
app.get('/api/events', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  const limit = Number(req.query.limit) || 100;
  const events = listEvents({ clientId, limit });
  res.json({ ok: true, events });
});

// --- Mark an invoice as paid (demo/dev) ---
app.post('/api/invoices/:id/pay', async (req, res) => {
  try {
    const tenantId =
      (req.body?.clientId || req.query?.clientId || req.tenantId || 'default').trim();

    const inv = {
      id: String(req.params.id),
      total: Number(req.body?.total) || null,
      contactId: req.body?.contactId || null,
      appointmentId: req.body?.appointmentId || null,
      at: new Date().toISOString(),
    };

    // Emit a domain event for this tenant so the UI (and automations) react.
    try {
      const ev = createEvent(
        'invoice.paid',
        tenantId,
        {
          invoiceId: inv.id,
          total: inv.total,
          contactId: inv.contactId,
          appointmentId: inv.appointmentId,
          at: inv.at,
        },
        { source: 'api', idempotencyKey: `invoice:${tenantId}:${inv.id}:paid` }
      );

      recordAndEmit(ioForTenant(tenantId), ev); // socket.io -> front-end listeners
      await dispatchEvent(ev);                   // run any matching automations
    } catch (e) {
      // soft-fail: don’t break the API if broadcasting fails
      console.warn('[invoice.paid] event dispatch warning:', e?.message || e);
    }

    res.json({ ok: true, invoice: inv });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'pay_failed' });
  }
});

// ---- VEHICLES CRUD ----
app.get('/api/vehicles', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  const list = vehiclesByClient.get(clientId) || [];
  res.json({ ok: true, clientId, vehicles: list });
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
  res.json({ ok: true, vehicle: item });
});

app.put('/api/vehicles/:id', (req, res) => {
  const clientId = (req.body.clientId || 'default').trim();
  const id = req.params.id;
  const list = vehiclesByClient.get(clientId) || [];
  const idx = list.findIndex((x) => x.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'not found' });
  list[idx] = { ...list[idx], ...req.body, id };
  vehiclesByClient.set(clientId, list);
  res.json({ ok: true, vehicle: list[idx] });
});

app.delete('/api/vehicles/:id', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  const id = req.params.id;
  const list = vehiclesByClient.get(clientId) || [];
  const next = list.filter((x) => x.id !== id);
  vehiclesByClient.set(clientId, next);
  res.json({ ok: true, removed: id });
});

// ---- Helpers ----
function normalizeContact(raw = {}) {
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const phones = [...arr(raw.phones), raw.phone, raw.mobile, raw.primaryPhone].filter(Boolean);
  const emails = [...arr(raw.emails), raw.email, raw.primaryEmail].filter(Boolean);

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

const TZ_OFFSET_FALLBACK = process.env.DEFAULT_TZ_OFFSET || '-04:00';
const SUGGEST_SLOTS_SOURCE = process.env.SUGGEST_SLOTS_SOURCE || 'ghl';

function buildLocalSlots(date, stepMin = 30, open = '09:00', close = '17:00') {
  const startISO = `${date}T${open}:00${TZ_OFFSET_FALLBACK}`;
  const endISO = `${date}T${close}:00${TZ_OFFSET_FALLBACK}`;
  const out = [];
  for (let t = new Date(startISO); t < new Date(endISO); t = new Date(t.getTime() + stepMin * 60000)) {
    const end = new Date(t.getTime() + stepMin * 60000);
    out.push({ start: t.toISOString(), end: end.toISOString() });
  }
  return out;
}

function parseDateish(v) {
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n)) return new Date(n > 1e12 ? n : n * 1000);
    return new Date(v);
  }
  return new Date(v);
}

function extractSlotsFromGHL(data) {
  let raw = data?.timeSlots || data?.availableSlots || data?.slots;
  if (!raw) {
    const dateKey = Object.keys(data || {}).find(
      (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && data[k]?.slots
    );
    if (dateKey) raw = data[dateKey].slots;
  }
  if (!raw) return [];
  return raw
    .map((s) => {
      const startD = parseDateish(s?.start ?? s);
      if (!startD || isNaN(startD)) return null;
      const endD = parseDateish(s?.end) || new Date(startD.getTime() + 60 * 60 * 1000);
      return { start: startD.toISOString(), end: endD.toISOString() };
    })
    .filter(Boolean);
}

function dayBoundsEpochMs(yyyyMmDd, tzOffset = TZ_OFFSET_FALLBACK) {
  const startISO = `${yyyyMmDd}T00:00:00${tzOffset}`;
  const endISO = `${yyyyMmDd}T23:59:59${tzOffset}`;
  return { startMs: new Date(startISO).getTime(), endMs: new Date(endISO).getTime() };
}

function ensureOffsetISO(iso, fallbackOffset = TZ_OFFSET_FALLBACK) {
  if (!iso) return iso;
  if (/[+-]\d\d:\d\d$|Z$/.test(iso)) {
    return iso.replace(/\.\d{3}/, '');
  }
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
});

// --- OSM / Nominatim geocode proxy with cache ---
const nominatimCache = new Map();
const NOM_TTL_MS = 12 * 60 * 60 * 1000;

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
        Accept: 'application/json',
      },
    });

    if (!r.ok) {
      const msg = await r.text().catch(() => '');
      return res
        .status(502)
        .json({ ok: false, error: `nominatim_${r.status}`, details: msg.slice(0, 200) });
    }

    const data = await r.json().catch(() => []);
    const list = Array.isArray(data) ? data : [];
    nominatimCache.set(key, { ts: Date.now(), data: list });
    return res.json(list);
  } catch (e) {
    console.warn('[geo/search]', e?.message || e);
    return res.json([]);
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

function pickPrimaryPhone(c = {}) {
  const arr = Array.isArray(c.phones) ? c.phones.filter(Boolean) : [];
  return arr[0] || c.phone || c.mobile || c.primaryPhone || null;
}

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

    if (!jobsByClient.has(clientId)) jobsByClient.set(clientId, new Map());
    const jobs = jobsByClient.get(clientId);

    const id = b.appointmentId || b.id || newId('job_');
    const startISO = ensureOffsetISO(b.startTime) || new Date().toISOString();
    const endISO =
      ensureOffsetISO(b.endTime) ||
      new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString();

    const address = toAddressString(b.address);
    let lat = Number(b.lat),
      lng = Number(b.lng);
    const missingOrZero =
      !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0);

    if (missingOrZero && address) {
      try {
        const geo = await geocodeAddress(address);
        if (geo) {
          lat = geo.lat;
          lng = geo.lng;
        }
      } catch {}
    }

    const contact = normalizeContact(b.contact || {});

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

    recordAndEmit(
      ioForTenant(clientId),
      createEvent(
        'appointment.created',
        clientId,
        {
          appointmentId: job.appointmentId,
          contactId: (contact && contact.id) || (job.contact && job.contact.id) || null,
          contactName: (contact && contact.name) || (job.contact && job.contact.name) || null,
          address,
          startTime: job.startTime,
          endTime: job.endTime,
          estValue: job.estValue,
          territory: job.territory,
          createdBy: 'web',
        },
        { source: 'web', idempotencyKey: `${job.appointmentId}:created` }
      )
    );

    emitTenant(clientId, 'job:created', { clientId, job });

    res.json({ ok: true, job });
  } catch (e) {
    console.error('[POST /api/jobs]', e);
    res.status(500).json({ ok: false, error: 'failed to create job' });
  }
});

app.get('/api/jobs', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  const jobsMap = jobsByClient.get(clientId) || new Map();
  res.json({ ok: true, items: Array.from(jobsMap.values()) });
});

/**
 * POST /api/job/:id/ensure-thread
 * Body: { clientId?: string }
 */
app.post('/api/job/:id/ensure-thread', async (req, res) => {
  try {
    const clientId = (req.body.clientId || 'default').trim();
    const jobs = jobsByClient.get(clientId) || new Map();
    const job = jobs.get(req.params.id);

    if (!job) return res.status(404).json({ ok: false, error: 'Job not found' });

    let contact = normalizeContact(job.contact || {});
    if ((!contact.phones?.length || !contact.name) && (contact.id || contact.emails?.[0])) {
      try {
        const enriched = await getContact(contact.id, { email: contact.emails?.[0] });
        contact = normalizeContact({ ...contact, ...enriched });
      } catch {}
    }
    if (!contact.id) {
      return res.status(400).json({ ok: false, error: 'Job has no contact id' });
    }

    const phone = pickPrimaryPhone(contact);
    const conversationId = ensureMockConversationForContact(contact.id);

    const pref = getAutoPref({ id: contact.id, phone: phoneE164(phone) });
    const autopilot = pref == null ? CHATTER_AI === true : !!pref;

    return res.json({ ok: true, conversationId, contact, phone, autopilot });
  } catch (e) {
    console.error('[ensure-thread]', e);
    res.status(500).json({ ok: false, error: 'failed to ensure thread' });
  }
});

app.post('/api/clear-jobs', (req, res) => {
  const clientId = req.body.clientId || 'default';
  jobsByClient.set(clientId, new Map());
  res.json({ ok: true, message: `Jobs cleared for ${clientId}` });
});

// PATCH /api/jobs/:id
app.patch('/api/jobs/:id', async (req, res) => {
  try {
    const clientId = (req.body.clientId || 'default').trim();
    const jobs = jobsByClient.get(clientId) || new Map();
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'job not found' });

    const { startTime, endTime, assignedUserId } = req.body || {};

    if (startTime) job.startTime = ensureOffsetISO(startTime);
    if (endTime) job.endTime = ensureOffsetISO(endTime);
    if (assignedUserId) job.assignedUserId = String(assignedUserId);

    jobs.set(job.appointmentId, job);

    try {
      if (assignedUserId) {
        await updateAppointmentOwner(job.appointmentId, assignedUserId);
        await appendAppointmentNotes(
          job.appointmentId,
          `Reassigned to ${assignedUserId} via Calendar/Board`
        );
      }
      if (startTime || endTime) {
        await rescheduleAppointment(job.appointmentId, job.startTime, job.endTime);
        await appendAppointmentNotes(
          job.appointmentId,
          `Rescheduled to ${job.startTime} – ${job.endTime}`
        );
      }
    } catch (e) {
      console.warn('[PATCH /api/jobs/:id] GHL sync warning:', e?.response?.data || e.message);
    }

    emitTenant(clientId, 'job:updated', { clientId, job });

    res.json({ ok: true, job });
  } catch (e) {
    console.error('[PATCH /api/jobs/:id]', e);
    res.status(500).json({ ok: false, error: 'update failed' });
  }
});

// --- Chat AI per-contact state ---
app.get('/api/agent/state', (req, res) => {
  const id = req.query.id?.trim();
  const phone = phoneE164(req.query.phone?.trim());
  const pref = getAutoPref({ id, phone });
  const effective = pref == null ? CHATTER_AI === true : !!pref;
  const source = pref == null ? 'global_default' : 'per_contact';
  res.json({ ok: true, state: { autopilot: effective }, source });
});

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

// --- Voice AI state ---
app.get('/api/voice/state', (_req, res) => {
  res.json({ ok: true, enabled: !!VOICE_AI_ENABLED });
});

app.post('/api/voice/state', (req, res) => {
  VOICE_AI_ENABLED = !!req.body?.enabled;
  res.json({ ok: true, enabled: VOICE_AI_ENABLED });
});

// Twilio inbound SMS webhook
app.post('/twilio/sms', express.urlencoded({ extended: false }), verifyTwilio(), async (req, res) => {

  const { From, Body, To } = req.body || {};

  // 🔁 resolve tenant from inbound "To"
  req.tenantId = getTenantForPhone(To) || 'default';

  recordSms({ to: To, from: From, direction: 'inbound', text: Body });
  emitTenant(req.tenantId, 'sms:inbound', {
    from: From,
    to: To,
    text: Body,
    at: new Date().toISOString(),
  });

  try {
    const phoneNorm = phoneE164(From);
    const pref = getAutoPref({ phone: phoneNorm });
    const useAI = pref == null ? CHATTER_AI === true : !!pref;

    if (useAI) {
      await agentHandle({
        from: From,
        to: To,
        text: Body,
        send: async (toPhone, replyText) => {
          const resp = await sendSMS(toPhone, replyText);
          recordSms({
            to: toPhone,
            from: To,
            direction: 'outbound',
            text: replyText,
          });
          emitTenant(req.tenantId, 'sms:outbound', {
            sid: resp.sid,
            to: toPhone,
            text: replyText,
            at: new Date().toISOString(),
          });
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



app.post('/twilio/voice-status', express.urlencoded({ extended: false }), verifyTwilio(), async (req, res) => {   
  const { CallSid, CallStatus, From, To, Direction } = req.body || {};

   res.type('text/xml').send('<Response/>');
 });
 
// Inbound Voice webhook → connect the call to our Media Stream WS
app.post('/twilio/voice', express.urlencoded({ extended: false }), verifyTwilio(), (req, res) => {
  const { To } = req.body || {};
  const tenantId = getTenantForPhone(To) || req.tenantId || 'default';

  const baseWs = publicWsUrl();
  const twiml = new twilio.twiml.VoiceResponse();

  if (!VOICE_AI_ENABLED) {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, voice is currently unavailable.');
    return res.type('text/xml').send(twiml.toString());
  }

  if (!baseWs) {
    twiml.say('Media stream is not configured on the server.');
    return res.type('text/xml').send(twiml.toString());
  }

  const connect = twiml.connect();
  const streamUrl = `${baseWs}${VOICE_WS_PATH}?tenantId=${encodeURIComponent(tenantId)}`;
  connect.stream({ url: streamUrl, track: 'both_tracks' });

  res.type('text/xml').send(twiml.toString());
});

// --- Aggregate contacts (manual + jobs memory) ---
app.get('/api/contacts', (req, res) => {
  try {
    const clientId = (req.query.clientId || 'default').trim();

    const manual = contactsByClient.get(clientId) || new Map();
    const map = new Map(manual);

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

      const uniq = (a) => Array.from(new Set(a.filter(Boolean)));
      cur.phones = uniq([...(cur.phones || []), ...(c.phones || [])]);
      cur.emails = uniq([...(cur.emails || []), ...(c.emails || [])]);

      cur.appointments = (cur.appointments || 0) + 1;
      const t = new Date(j.startTime || 0).getTime();
      const prev = new Date(cur.lastAppointmentAt || 0).getTime();
      if (t > prev) cur.lastAppointmentAt = j.startTime || cur.lastAppointmentAt;

      map.set(c.id, cur);
    }

    const list = Array.from(map.values()).sort(
      (a, b) => new Date(b.lastAppointmentAt || 0) - new Date(a.lastAppointmentAt || 0)
    );

    res.json({ ok: true, clientId, count: list.length, contacts: list });
  } catch (e) {
    console.error('[contacts index]', e);
    res.status(500).json({ ok: false, error: 'failed to build contacts list' });
  }
});

// GET dispositions for a contact
app.get('/api/contacts/:id/dispositions', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  const id = req.params.id;

  if (!contactsByClient.has(clientId)) contactsByClient.set(clientId, new Map());
  const bag = contactsByClient.get(clientId);

  let row = bag.get(id);

  if (!row) {
    const jobsMap = jobsByClient.get(clientId) || new Map();
    const jobs = Array.from(jobsMap.values())
      .filter((j) => (j?.contact?.id || j?.contactId) === id)
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    if (jobs.length) {
      const j0 = jobs[0];
      const c = normalizeContact(j0.contact || {});
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

  if (!row) return res.json({ ok: true, contactId: id, dispositions: [] });

  const list = Array.isArray(row.dispositions) ? row.dispositions : [];
  res.json({ ok: true, contactId: id, dispositions: list });
});

app.post('/api/contacts/:id/dispositions', async (req, res) => {
  try {
    const clientId = (req.body.clientId || req.query.clientId || 'default').trim();
    const id = req.params.id;
    const { key, label, note } = req.body || {};
    if (!key || !label) {
      return res.status(400).json({ ok: false, error: 'key and label are required' });
    }

    if (!contactsByClient.has(clientId)) contactsByClient.set(clientId, new Map());
    const bag = contactsByClient.get(clientId);

    let row = bag.get(id);

    if (!row) {
      const jobsMap = jobsByClient.get(clientId) || new Map();
      const jobs = Array.from(jobsMap.values())
        .filter((j) => (j?.contact?.id || j?.contactId) === id)
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

      if (jobs.length) {
        const j0 = jobs[0];
        const c = normalizeContact(j0.contact || {});
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
      return res.status(404).json({
        ok: false,
        error:
          'contact not found (seed first via /api/contacts or create a job with this contact)',
      });
    }

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

    const ev = createEvent(
      'contact.disposition.created',
      clientId,
      {
        contactId: id,
        key: entry.key,
        label: entry.label,
        note: entry.note ?? null,
        at: entry.at,
      },
      {
        source: 'api',
        idempotencyKey: `${id}:${entry.at}:${entry.key}`,
      }
    );
    recordAndEmit(ioForTenant(clientId), ev);
    await dispatchEvent(ev);

    return res.status(201).json({ ok: true, entry });
  } catch (e) {
    console.error('[contacts disposition]', e);
    return res.status(500).json({ ok: false, error: 'failed to save disposition' });
  }
});

app.post('/api/contacts', (req, res) => {
  try {
    const clientId = (req.body.clientId || 'default').trim();
    const b = req.body || {};

    if (!b.id || !b.name) {
      return res.status(400).json({ ok: false, error: 'id and name are required' });
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
    return res.status(201).json({ ok: true, contact: summary });
  } catch (e) {
    console.error('[POST /api/contacts]', e);
    return res.status(500).json({ ok: false, error: 'failed to save contact' });
  }
});

// List appointments for a contact (from memory)
app.get('/api/contacts/:contactId/appointments', (req, res) => {
  try {
    const clientId = (req.query.clientId || 'default').trim();
    const contactId = req.params.contactId?.trim();
    if (!contactId) return res.status(400).json({ ok: false, error: 'contactId required' });

    const jobsMap = jobsByClient.get(clientId) || new Map();

    const list = Array.from(jobsMap.values())
      .filter((j) => {
        const id = j?.contact?.id || j?.contactId;
        return id && id === contactId;
      })
      .map((j) => ({
        appointmentId: j.appointmentId,
        startTime: j.startTime,
        endTime: j.endTime,
        address: j.address,
        jobType: j.jobType,
        estValue: Number(j.estValue) || 0,
        territory: j.territory || null,
      }))
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    res.json({ ok: true, contactId, count: list.length, appointments: list });
  } catch (e) {
    console.error('[contacts:appointments]', e);
    res.status(500).json({ ok: false, error: 'failed to load contact appointments' });
  }
});

app.get('/api/week-appointments', async (req, res) => {
  try {
    const clientId = req.query.clientId || 'default';
    const jobsMap = jobsByClient.get(clientId) || new Map();

    const techs = techsByClient.get(clientId) || [];
    const nameById = new Map(techs.map((t) => [t.id, t.name]));

    const items = Array.from(jobsMap.values()).map((j) => {
      const d = j.startTime ? new Date(j.startTime) : new Date();
      let day = j.day,
        time = j.time;

      if (!day || !time) {
        day = d.toLocaleDateString(undefined, { weekday: 'short' });
        time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      }

      const dateText = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      return {
        id: j.appointmentId,
        startTimeISO: d.toISOString(),
        day,
        time,
        dateText,
        address: toAddressString(j.address),
        lat: j.lat,
        lng: j.lng,
        jobType: j.jobType,
        estValue: j.estValue,
        territory: j.territory,
        contact: j.contact,
        travelMinutesFromPrev: null,
        assignedUserId: j.assignedUserId || null,
      };
    });

    items.sort((a, b) => new Date(a.startTimeISO) - new Date(b.startTimeISO));

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
        if (
          prev.lat != null &&
          prev.lng != null &&
          curr.lat != null &&
          curr.lng != null
        ) {
          curr.travelMinutesFromPrev = await getDriveMinutes(
            { lat: prev.lat, lng: prev.lng },
            { lat: curr.lat, lng: curr.lng }
          );
        }
      }
    }

    const out = items.map((it) => ({
      id: it.id,
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
const weatherCache = new Map();
const WEATHER_TTL_MS = 30 * 60 * 1000;

async function fetchExtendedForecast(lat, lng, days = 16) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}|${days}`;
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.ts < WEATHER_TTL_MS) return hit.data;

  const base = 'https://api.open-meteo.com/v1/forecast';
  const url = `${base}?latitude=${lat}&longitude=${lng}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=${Math.min(
    Math.max(1, days),
    16
  )}`;

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

app.get('/api/forecast', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const days = Number(req.query.days) || 10;
    const data = await fetchExtendedForecast(lat, lng, days);
    if (!data) return res.status(400).json({ ok: false, error: 'bad lat/lng' });
    res.json({ ok: true, ...data });
  } catch (e) {
    console.error('[forecast]', e);
    res.status(500).json({ ok: false, error: 'forecast failed' });
  }
});

// --- GHL conversation messaging (read) ---
app.get('/api/ghl/conversation/:conversationId/messages', async (req, res) => {
  try {
    const conversationId = req.params.conversationId;
    const base = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';

    if (!process.env.GHL_ACCESS_TOKEN) {
      return res.status(500).json({ ok: false, error: 'GHL_ACCESS_TOKEN missing' });
    }

    const headers = {
      Authorization: `Bearer ${process.env.GHL_ACCESS_TOKEN}`,
      Accept: 'application/json',
      Version: '2021-04-15',
      ...(process.env.GHL_LOCATION_ID ? { 'Location-Id': process.env.GHL_LOCATION_ID } : {}),
    };

    const url = new URL(`/conversations/${encodeURIComponent(conversationId)}/messages`, base);
    url.searchParams.set('page', '1');
    url.searchParams.set('limit', '50');

    const resp = await axios.get(url.toString(), { headers, timeout: 15000 });
    const raw = Array.isArray(resp.data?.messages)
      ? resp.data.messages
      : resp.data?.data || [];

    const messages = raw.map((m) => ({
      id: m.id,
      direction: m.direction || (m.fromMe ? 'outbound' : 'inbound'),
      channel: m.channel || m.type,
      text: m.message || m.text || '',
      attachments: m.attachments || [],
      createdAt: m.createdAt || m.dateAdded || m.timestamp,
    }));

    res.json({ ok: true, conversationId, messages });
  } catch (e) {
    console.error('[conversation messages]', e?.response?.data || e.message);
    res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

app.get('/api/job/:id', (req, res) => {
  const clientId = req.query.clientId || 'default';
  const jobs = jobsByClient.get(clientId) || new Map();
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Not found' });

  const out = {
    ...job,
    estValue: Number(job.estValue) || 0,
    territory: job.territory || '—',
    contact: normalizeContact(job.contact || {}),
  };

  res.json({ ok: true, job: out });
});

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

// --- Suggest times (route-aware) ---
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
      maxDetourMin,
    } = args;

    const { startMs, endMs } = dayBoundsEpochMs(date, TZ_OFFSET_FALLBACK);

    let freeSlots = [];
    if (SUGGEST_SLOTS_SOURCE === 'local') {
      freeSlots = buildLocalSlots(date);
    } else {
      const calendarId = process.env.GHL_CALENDAR_ID;
      if (!calendarId || !process.env.GHL_ACCESS_TOKEN) {
        return res.status(500).json({ ok: false, error: 'GHL env vars missing' });
      }
      const base = 'https://services.leadconnectorhq.com';
      const free = new URL(`/calendars/${calendarId}/free-slots`, base);

      free.searchParams.set('startDate', String(startMs));
      free.searchParams.set('endDate', String(endMs));
      free.searchParams.set('timezone', timezone);

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

    let newLoc = null;
    if (address) {
      try {
        newLoc = await geocodeAddress(address);
      } catch {}
    }

    const jobsMap = jobsByClient.get(clientId) || new Map();
    const dayJobs = Array.from(jobsMap.values())
      .filter((j) => {
        const t = new Date(j.startTime).getTime();
        return t >= startMs && t <= endMs;
      })
      .map((j) => ({
        id: j.appointmentId,
        start: new Date(j.startTime).getTime(),
        end: new Date(j.endTime || new Date(new Date(j.startTime).getTime() + 60 * 60 * 1000)).getTime(),
        lat: j.lat,
        lng: j.lng,
        address: j.address,
        territory: j.territory,
        estValue: j.estValue,
      }))
      .sort((a, b) => a.start - b.start);

    function neighbors(startMs) {
      let prev = null,
        next = null;
      for (const j of dayJobs) {
        if (j.end <= startMs) prev = j;
        if (j.start >= startMs) {
          next = j;
          break;
        }
      }
      return { prev, next };
    }

    const accepted = [];
    for (const s of freeSlots) {
      const start = new Date(s.start).getTime();
      const end = start + durationMin * 60 * 1000;

      const overlaps = dayJobs.some((j) => !(end <= j.start || start >= j.end));
      if (overlaps) continue;

      const { prev, next } = neighbors(start);

      let travelPrev = 0,
        travelNext = 0;

      if (prev && newLoc && prev.lat != null && prev.lng != null) {
        const mins = await getDriveMinutes({ lat: prev.lat, lng: prev.lng }, newLoc);
        if (mins != null) travelPrev = mins;
        const gap = (start - prev.end) / 60000;
        if (gap < bufferMin + travelPrev) continue;
      }

      if (next && newLoc && next.lat != null && next.lng != null) {
        const mins = await getDriveMinutes(newLoc, { lat: next.lat, lng: next.lng });
        if (mins != null) travelNext = mins;
        const gap = (next.start - end) / 60000;
        if (gap < bufferMin + travelNext) continue;
      }

      if (territory && dayJobs.length) {
        const badNeighbor =
          (prev && prev.territory && prev.territory !== territory) ||
          (next && next.territory && next.territory !== territory);
        if (badNeighbor) continue;
      }

      const totalDetour = travelPrev + travelNext;
      if (totalDetour > maxDetourMin) continue;

      const score = (Number(estValue) || 0) / 1000 - totalDetour / 10;

      accepted.push({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        jobType,
        estValue: Number(estValue) || 0,
        territory,
        address,
        travel: { fromPrev: travelPrev || null, toNext: travelNext || null, total: totalDetour || 0 },
        neighbors: { prev: prev?.id || null, next: next?.id || null },
        reason: `fits route (+${totalDetour}m travel, ${bufferMin}m buffer)`,
        score,
      });
    }

    accepted.sort((a, b) => b.score - a.score);

    return res.json({ ok: true, suggestions: accepted });
  } catch (err) {
    console.error('[suggest-times error]', err?.response?.data || err.message);
    const msg = err?.response?.data?.message || err?.message || 'Availability lookup failed';
    return res.status(500).json({ ok: false, error: msg });
  }
});

// --- Real SMS (manual) ---
app.post('/api/sms/send', async (req, res) => {
  try {
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ ok: false, error: 'to and text required' });

    const resp = await sendSMS(to, text);
    recordSms({
      to,
      from: process.env.TWILIO_FROM || process.env.TWILIO_PHONE_NUMBER,
      direction: 'outbound',
      text,
    });
    emitTenant(req.tenantId || 'default', 'sms:outbound', {
      sid: resp.sid,
      to,
      text,
      at: new Date().toISOString(),
    });
    res.json({ ok: true, sid: resp.sid, status: resp.status });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message || 'send failed',
      code: e.code || null,
      status: e.status || null,
      moreInfo: e.moreInfo || null,
    });
  }
});

// --- Read SMS thread for a phone (simple, in-memory) ---
app.get('/api/sms/thread', (req, res) => {
  try {
    const raw = req.query.phone || '';
    const phone = phoneE164(raw);
    if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });

    // pull from the shared in-memory log
    const arr = getThread(phone) || [];

    // normalize a lightweight payload for UIs
    const items = arr.map((m, i) => ({
      id: `${phone}:${i}:${m.at}`,
      dir: m.direction === 'outbound' ? 'out' : 'in',
      text: m.text || '',
      at: m.at,
      to: m.to || null,
      from: m.from || null,
    }));

    res.json({ ok: true, phone, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'thread_failed' });
  }
});

// --- Mock: send GHL message (optionally Twilio SMS) ---
app.post('/api/mock/ghl/send-message', async (req, res) => {
  const {
    contactId,
    text = '',
    direction = 'outbound',
    channel = 'sms',
    autopilot,
    to,
    clientId = 'default',
  } = req.body || {};

  if (!contactId) return res.status(400).json({ ok: false, error: 'contactId required' });

  if (typeof autopilot === 'boolean') {
    setAutoPref({ id: contactId, phone: phoneE164(to), enabled: autopilot });
  }

  let convoId = mockByContact.get(contactId);
  if (!convoId) {
    convoId = uuid();
    mockByContact.set(contactId, convoId);
    mockConvos.set(convoId, { id: convoId, contactId, messages: [] });
  }
  const convo = mockConvos.get(convoId);

  const msg = {
    id: uuid(),
    direction,
    channel,
    text,
    createdAt: new Date().toISOString(),
  };
  convo.messages.push(msg);

  let emittedSid = msg.id;
  try {
    if (channel === 'sms' && direction === 'outbound') {
      let dest = phoneE164(to);
      if (!dest) {
        for (const jobs of jobsByClient.values()) {
          for (const j of jobs.values()) {
            const c = normalizeContact(j.contact || {});
            if (String(c.id) === String(contactId)) {
              const p = pickPrimaryPhone(c);
              if (p) {
                dest = phoneE164(p);
                break;
              }
            }
          }
          if (dest) break;
        }
      }

      if (dest) {
        const resp = await sendSMS(dest, text);
        emittedSid = resp?.sid || emittedSid;
      } else {
        console.warn('[sms send] No destination phone found for contact', contactId);
      }
    }
  } catch (e) {
    console.error('[sms send] Twilio error:', e?.message || e);
  }

  emitTenant(clientId, 'sms:outbound', {
    sid: emittedSid,
    contactId,
    text: msg.text,
    at: msg.createdAt,
  });

  return res.json({ ok: true, conversationId: convoId, message: msg });
});

app.get('/api/mock/ghl/contact/:contactId/conversations', (req, res) => {
  const contactId = req.params.contactId;
  const convoId = mockByContact.get(contactId);
  if (!convoId) return res.json({ ok: true, contactId, conversations: [] });
  return res.json({
    ok: true,
    contactId,
    conversations: [{ id: convoId, unreadCount: 0, starred: false, type: 0 }],
  });
});

app.get('/api/mock/ghl/conversation/:conversationId/messages', (req, res) => {
  const convo = mockConvos.get(req.params.conversationId);
  if (!convo) return res.status(404).json({ ok: false, error: 'not found' });
  return res.json({ ok: true, conversationId: convo.id, messages: convo.messages });
});

// --- Client settings (in-memory) ---
const DEFAULT_PAYDAY_THRESHOLD = Number(process.env.DEFAULT_PAYDAY_THRESHOLD || 2500);
const clientSettings = new Map();

app.get('/api/client-settings', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  const saved = clientSettings.get(clientId) || {};
  const paydayThreshold = Number.isFinite(saved.paydayThreshold)
    ? saved.paydayThreshold
    : DEFAULT_PAYDAY_THRESHOLD;

  res.json({ ok: true, clientId, settings: { paydayThreshold } });
});

app.post('/api/client-settings', (req, res) => {
  const clientId = (req.body.clientId || 'default').trim();
  const paydayThreshold = Number(req.body.paydayThreshold);
  if (!Number.isFinite(paydayThreshold) || paydayThreshold < 0) {
    return res
      .status(400)
      .json({ ok: false, error: 'paydayThreshold must be a non-negative number' });
  }
  clientSettings.set(clientId, { paydayThreshold });
  res.json({ ok: true, clientId, settings: { paydayThreshold } });
});

// ---- Book appointment and push to GHL ----
async function handleBookAppointment(req, res) {
  try {
    console.log('[DEBUG] Incoming create-appointment payload:', req.body);

    let args;
    try {
      args = CreateAppointmentReqSchema.parse(req.body);
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'Invalid request', details: e.errors ?? String(e) });
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

    const startISO = ensureOffsetISO(startTime);
    const endISO = endTime
      ? ensureOffsetISO(endTime)
      : new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString();

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

    let latNum = Number(lat);
    let lngNum = Number(lng);
    const missingOrZero =
      !Number.isFinite(latNum) || !Number.isFinite(lngNum) || (latNum === 0 && lngNum === 0);

    if (missingOrZero && address) {
      try {
        const geo = await geocodeAddress(address);
        if (geo) {
          latNum = geo.lat;
          lngNum = geo.lng;
        }
      } catch (e) {
        console.warn('[Geocode] create-appointment lookup failed:', e.message);
      }
    }

    let contactNorm = normalizeContact({ id: contactId, ...(contact || {}) });
    try {
      const enriched = await getContact(contactId, {
        email: (contact && contact.email) || undefined,
        phone: (contact && contact.phone) || undefined,
      });
      contactNorm = normalizeContact({ ...contactNorm, ...(enriched || {}) });
    } catch (e) {}

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
      contact: contactNorm,
    };

    jobs.set(job.appointmentId, job);
    emitTenant(activeClientId, 'job:created', { clientId: activeClientId, job });

    const SHOULD_SEED_DEMO = process.env.SEED_DEMO_TECHS === 'true';
    if (SHOULD_SEED_DEMO) {
      const cur = techsByClient.get(activeClientId) || [];
      if (!cur.length) {
        techsByClient.set(activeClientId, [
          { id: 't1', name: 'Alice (demo)', skills: ['Repair'], territory: 'EAST', route: [] },
          { id: 't2', name: 'Bob (demo)', skills: ['Repair'], territory: 'EAST', route: [] },
        ]);
      }
    }

    const techs = techsByClient.get(activeClientId) || [];
    const reps = techs.map((t) => ({
      id: t.id,
      name: t.name,
      skills: t.skills,
      territory: t.territory,
      route: t.route,
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
        emitTenant(activeClientId, 'ai:booking', {
          clientId: activeClientId,
          job,
          decision: best,
        });
      } catch (e) {
        console.warn('[Auto-assign/manual] failed:', e.message);
      }
    } else {
      emitTenant(activeClientId, 'ai:suggestion', { clientId: activeClientId, job, candidates });
    }

    return res.json({ ok: true, job, candidates });
  } catch (err) {
    console.error('[Book Appointment] Error:', err?.response?.data || err.message || err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

app.get('/api/techs', (req, res) => {
  const clientId = (req.query.clientId || 'default').trim();
  const SHOULD_SEED_DEMO = process.env.SEED_DEMO_TECHS === 'true';
  if (SHOULD_SEED_DEMO) {
    const cur = techsByClient.get(clientId) || [];
    if (!cur.length) {
      techsByClient.set(clientId, [
        { id: 't1', name: 'Alice (demo)', skills: ['Repair'], territory: 'EAST', route: [] },
        { id: 't2', name: 'Bob (demo)', skills: ['Repair'], territory: 'EAST', route: [] },
      ]);
    }
  }
  const techs = techsByClient.get(clientId) || [];
  res.json({ ok: true, clientId, count: techs.length, techs });
});

app.post('/api/techs', (req, res) => {
  try {
    const { clientId, techs } = UpsertTechsRequestSchema.parse(req.body);
    techsByClient.set(clientId, techs);
    res.json({ ok: true, clientId, count: techs.length });
  } catch (e) {
    res.status(400).json({ ok: false, error: 'Invalid payload', details: e.errors ?? String(e) });
  }
});

app.post('/api/approve-assignment', async (req, res) => {
  try {
    const clientId = (req.body.clientId || 'default').trim();
    const { appointmentId, repId } = req.body || {};
    if (!appointmentId || !repId) {
      return res.status(400).json({ ok: false, error: 'appointmentId and repId are required' });
    }

    const techs = techsByClient.get(clientId) || [];
    const rep = techs.find((t) => t.id === repId);
    if (!rep) return res.status(404).json({ ok: false, error: 'rep not found for client' });

    await updateAppointmentOwner(appointmentId, repId);

    const jobs = jobsByClient.get(clientId) || new Map();
    const job = jobs.get(appointmentId);
    if (job) {
      await rescheduleAppointment(appointmentId, job.startTime, job.endTime);
      await appendAppointmentNotes(
        appointmentId,
        `Approved for ${rep.name} (${rep.id}) via Dispatch Board`
      );
      job.assignedUserId = repId;
      jobs.set(appointmentId, job);
      emitTenant(clientId, 'ai:booking', {
        clientId,
        job,
        decision: { repId: rep.id, repName: rep.name },
      });
    }

    res.json({ ok: true, appointmentId, assignedTo: { id: rep.id, name: rep.name } });
  } catch (e) {
    console.error('[approve-assignment]', e?.response?.data || e.message);
    res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

app.post('/api/create-appointment', handleBookAppointment);

app.post('/ghl/appointment-created', async (req, res) => {
  try {
    const clientId = req.query.clientId || req.body.clientId || 'default';
    const SHOULD_SEED_DEMO = process.env.SEED_DEMO_TECHS === 'true';
    if (SHOULD_SEED_DEMO) {
      const cur = techsByClient.get(clientId) || [];
      if (!cur.length) {
        techsByClient.set(clientId, [
          { id: 't1', name: 'Alice (demo)', skills: ['Repair'], territory: 'EAST', route: [] },
          { id: 't2', name: 'Bob (demo)', skills: ['Repair'], territory: 'EAST', route: [] },
        ]);
      }
    }
    if (!jobsByClient.has(clientId)) jobsByClient.set(clientId, new Map());
    const jobs = jobsByClient.get(clientId);

    const body = { ...(req.query || {}), ...(req.body || {}) };
    const appt = body.appointment ?? body.payload?.appointment ?? body.payload ?? body;

    console.log('[DEBUG GHL incoming appt]', JSON.stringify(appt, null, 2));

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
      const contactName =
        appt.contactName || [contactFirst, contactLast].filter(Boolean).join(' ').trim();
      const contactEmail = appt.contactEmail || body.contactEmail;
      const contactPhone = appt.contactPhone || body.contactPhone;

      job.contact = {
        id: contactId,
        name: contactName,
        emails: [contactEmail].filter(Boolean),
        phones: [contactPhone].filter(Boolean),
      };

      if (job.contact.id || job.contact.emails.length || job.contact.phones.length) {
        const enriched = await getContact(job.contact.id, {
          email: job.contact.emails[0],
          phone: job.contact.phones[0],
        });
        job.contact = normalizeContact({ ...job.contact, ...enriched });
      } else {
        job.contact = normalizeContact(job.contact);
      }
    } catch {}

    jobs.set(job.appointmentId, job);

    try {
      const techs = techsByClient.get(clientId) || [];
      const reps = techs.map((t) => ({
        id: t.id,
        name: t.name,
        skills: t.skills,
        territory: t.territory,
        route: t.route,
      }));
      const candidates = await scoreAllReps(job, reps);
      const mode = process.env.SDC_MODE || 'Approve';
      if (!candidates?.length) {
        emitTenant(clientId, 'ai:suggestion', { clientId, job, candidates: [] });
        return res.json({ ok: true, action: 'awaiting_approval' });
      }
      const best = candidates[0];
      if (mode === 'Auto') {
        await updateAppointmentOwner(job.appointmentId, best.repId);
        await rescheduleAppointment(job.appointmentId, job.startTime, job.endTime);
        await appendAppointmentNotes(
          job.appointmentId,
          `Booked by SDC AI • ${best.reason} • FIT=${best.total.toFixed(2)}`
        );
        emitTenant(clientId, 'ai:booking', { clientId, job, decision: best });
        return res.json({ ok: true, action: 'booked', decision: best });
      }
      emitTenant(clientId, 'ai:suggestion', { clientId, job, candidates });
      return res.json({ ok: true, action: 'awaiting_approval', candidates });
    } catch {
      emitTenant(clientId, 'ai:suggestion', { clientId, job, candidates: [] });
      return res.json({ ok: true, action: 'awaiting_approval' });
    }
  } catch (e) {
    console.error('webhook error', e);
    return res.status(200).json({ ok: true, action: 'stored_with_errors' });
  }
});

function buildCandidateStarts(baseISO) {
  const base = new Date(baseISO || Date.now());
  const out = [];
  for (let k = 0; k < 6; k++) {
    const t = new Date(base.getTime() + k * 30 * 60 * 1000);
    t.setSeconds(0, 0);
    out.push(t.toISOString());
  }
  return out;
}

function toAddressString(a) {
  if (!a) return '';
  if (typeof a === 'string') return a;
  const parts = [
    a.fullAddress || a.full_address,
    [a.address, a.city, a.state, a.postalCode].filter(Boolean).join(', '),
  ].filter(Boolean);
  return parts[0] || '';
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

function normalizeJob(appt) {
  const appointmentId =
    appt.appointmentId || appt.id || 'ghl-' + Math.random().toString(36).slice(2);
  const startCand = appt.startTime ?? appt.start_time ?? appt.start;
  const endCand = appt.endTime ?? appt.end_time ?? appt.end;
  const startTime = toISOorNull(startCand) || new Date().toISOString();
  const endTime = toISOorNull(endCand) || new Date(Date.now() + 3600000).toISOString();
  const rawAddr = appt.address ?? appt.location ?? '';
  const address = toAddressString(rawAddr);
  const toNumOrUndef = (v) =>
    v === '' || v == null || isNaN(Number(v)) ? undefined : Number(v);
  const safeLat =
    toNumOrUndef(appt.lat ?? appt.latitude ?? (rawAddr && (rawAddr.lat ?? rawAddr.latitude)));
  const safeLng =
    toNumOrUndef(appt.lng ?? appt.longitude ?? (rawAddr && (rawAddr.lng ?? rawAddr.longitude)));
  const custom = appt.custom || {
    jobType: appt.jobType || 'Repair',
    estValue: appt.estValue ?? 0,
    territory: appt.territory || 'EAST',
  };
  const day = appt.day || null;
  const time = appt.time || null;
  return {
    appointmentId,
    customer: appt.customer || appt.contact || appt.client || {},
    address,
    lat: safeLat,
    lng: safeLng,
    startTime,
    endTime,
    jobType: custom.jobType || 'Repair',
    estValue: Number(custom.estValue || 0),
    territory: custom.territory || 'EAST',
    day,
    time,
  };
}

app.get('/__routes', (_req, res) => {
  const routes = app._router.stack
    .filter((l) => l.route)
    .map((l) => ({ method: Object.keys(l.route.methods)[0]?.toUpperCase(), path: l.route.path }));
  res.json(routes);
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`SDC backend (multi-client) on http://localhost:${PORT}`);
});