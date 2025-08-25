// routes/voice.ts
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { ensureE164 } from '../lib/twilio.js';
import {
  upsertNumber,
  listNumbers,
  assignNumberToUser,
  createOrUpdateSession,
} from '../lib/repos/voice';
import { setTenantPhone } from '../lib/repos/tenants';

function room(io: SocketIOServer, tenantId?: string) {
  const r = String(tenantId || 'default').toLowerCase();
  return { emit: (evt: string, payload: any) => io.to(r).emit(evt, payload) };
}

export function makeVoiceRouter(io: SocketIOServer) {
  const router = express.Router();

  // Health / connect check — confirms env creds are present.
  router.post('/twilio/connect', async (_req, res) => {
    const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
    const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    if (!sid || !token) {
      return res.status(400).json({ ok: false, error: 'Twilio creds missing in env' });
    }
    // simple success; real validation can call Twilio if you want
    return res.json({ ok: true, accountSid: sid.slice(0, 6) + '…' });
  });

  // Upsert (attach) a number to a tenant (and optional user).
  // Body: { phone, tenantId, userId?, label? }
  router.post('/numbers', (req, res) => {
    const phone = ensureE164(req.body?.phone || '');
    const tenantId = String(req.body?.tenantId || 'default').toLowerCase();
    const userId = req.body?.userId ? String(req.body.userId) : null;
    const label = req.body?.label ? String(req.body.label) : null;

    if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });

    const saved = upsertNumber({ phone, tenantId, userId, label, sid: null, friendlyName: null });
    // keep global phone->tenant mapping in sync for inbound resolution
    setTenantPhone(phone, tenantId);

    return res.status(201).json({ ok: true, number: saved });
  });

  // Assign/unassign a number to a user (agent)
  // Body: { phone, userId }  (userId = null to unassign)
  router.post('/numbers/assign', (req, res) => {
    const phone = ensureE164(req.body?.phone || '');
    const userId = req.body?.userId == null ? null : String(req.body.userId);
    if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });
    const updated = assignNumberToUser(phone, userId);
    if (!updated) return res.status(404).json({ ok: false, error: 'number not found' });
    return res.json({ ok: true, number: updated });
  });

  // List numbers (optionally by tenant)
  router.get('/numbers', (req, res) => {
    const tenantId = req.query?.tenantId ? String(req.query.tenantId) : undefined;
    res.json({ ok: true, items: listNumbers({ tenantId }) });
  });

  // Minimal inbound voice webhook (TwiML) — logs a session and says hello.
  // Point your Twilio number Voice URL to:  POST {PUBLIC_URL}/api/voice/inbound
  router.post('/inbound', express.urlencoded({ extended: false }), (req, res) => {
    const { From, To, CallSid } = req.body || {};
    const tenantId = req.get('X-Tenant-Id')?.toLowerCase() || 'default';

    const s = createOrUpdateSession({
      sid: String(CallSid || ''),
      tenantId,
      direction: 'inbound',
      from: From || null,
      to: To || null,
      status: 'ringing',
      startedAt: new Date().toISOString(),
    });

    room(io, tenantId).emit('voice:status', {
      sid: s.sid, status: s.status, from: s.from, to: s.to, dir: s.direction, at: s.startedAt,
    });

    // simple TwiML (you can swap to <Dial> later)
    res.type('text/xml').send(
      `<Response>
         <Say voice="Polly.Matthew">Thanks for calling Nonstop. Please hold while we connect you.</Say>
       </Response>`
    );
  });

  // Status webhook — keep UI in sync with Twilio call lifecycle.
  // Point Twilio status callback to: POST {PUBLIC_URL}/api/voice/status
  router.post('/status', express.urlencoded({ extended: false }), (req, res) => {
    const { CallSid, CallStatus, From, To, Direction } = req.body || {};
    const tenantId = req.get('X-Tenant-Id')?.toLowerCase() || 'default';

    const s = createOrUpdateSession({
      sid: String(CallSid || ''),
      tenantId,
      status: String(CallStatus || 'unknown'),
      from: From || null,
      to: To || null,
      direction: (Direction as any) || 'inbound',
      endedAt: /completed|failed|busy|no-answer/.test(String(CallStatus)) ? new Date().toISOString() : null,
    });

    room(io, tenantId).emit('voice:status', {
      sid: s.sid, status: s.status, from: s.from, to: s.to, dir: s.direction, at: new Date().toISOString(),
    });

    res.type('text/xml').send('<Response/>');
  });

  // Recording webhook (optional here; you already have /twilio/recording-status)
  // If you want this path instead, point Twilio Recording Status to: POST {PUBLIC_URL}/api/voice/recording
  router.post('/recording', express.urlencoded({ extended: false }), (req, res) => {
    const { CallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body || {};
    const tenantId = req.get('X-Tenant-Id')?.toLowerCase() || 'default';

    const s = createOrUpdateSession({
      sid: String(CallSid || ''),
      tenantId,
      status: 'recorded',
      recordingUrl: RecordingUrl ? `${RecordingUrl}.mp3` : null,
      recordingSid: RecordingSid || null,
      durationSec: RecordingDuration ? Number(RecordingDuration) : null,
    });

    room(io, tenantId).emit('voice:recording', {
      callSid: s.sid,
      url: s.recordingUrl,
      recordingSid: s.recordingSid,
      durationSec: s.durationSec ?? null,
      at: new Date().toISOString(),
    });

    res.type('text/xml').send('<Response/>');
  });

  return router;
}
export default makeVoiceRouter;