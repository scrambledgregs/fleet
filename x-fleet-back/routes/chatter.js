// routes/chatter.js
import express from 'express';
import { sendSMS } from '../lib/twilio.js';
import { setAutopilot, getState } from '../lib/agent.js';
import {
  recordSms,
  getThread,
  normalizePhone as phoneE164,
} from '../lib/chatter.js';

export default function createChatterRouter(io) {
  const r = express.Router();

  // Console UI
  r.get('/chatter', (_req, res) => {
    res.type('html').send(`
<!doctype html>
<meta charset="utf-8"/>
<title>Chatter Console</title>
<style>
  body{font:14px system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;margin:24px}
  .row{display:flex;gap:12px;align-items:center;margin:8px 0}
  #log{border:1px solid #ddd;padding:8px;height:320px;overflow:auto;white-space:pre-wrap;background:#fafafa}
  input,button{padding:8px}
</style>
<div class="row">
  <input id="phone" placeholder="Peer phone e.g. +15164560637" style="width:260px">
  <button id="load">Load thread</button>
  <label><input type="checkbox" id="auto"> Autopilot</label>
  <button id="saveAuto">Save</button>
</div>
<div id="log">—</div>
<div class="row">
  <input id="text" placeholder="Type a reply…" style="flex:1">
  <button id="send">Send SMS</button>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
const sock = io();
const $ = id=>document.getElementById(id);
const log = m => { const el=$('log'); el.textContent += "\\n" + m; el.scrollTop = el.scrollHeight; };

$('load').onclick = async () => {
  const phone = $('phone').value.trim();
  if (!phone) return;
  const r = await fetch('/api/sms/thread?phone=' + encodeURIComponent(phone));
  const j = await r.json();
  $('log').textContent = '';
  (j.messages || []).forEach(m => log(\`[\${m.at}] \${m.direction.toUpperCase()}: \${m.text}\`));
  const s = await fetch('/api/agent/state?phone=' + encodeURIComponent(phone));
  const sj = await s.json();
  $('auto').checked = !!sj?.state?.autopilot;
};

$('saveAuto').onclick = async () => {
  const phone = $('phone').value.trim();
  const enabled = $('auto').checked;
  if (!phone) return;
  const r = await fetch('/api/agent/autopilot', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ phone, enabled })
  });
  const j = await r.json();
  log('AUTOPILOT -> ' + (j?.state?.autopilot ? 'ON' : 'OFF'));
};

$('send').onclick = async () => {
  const phone = $('phone').value.trim();
  const text = $('text').value;
  if (!phone || !text) return;
  const r = await fetch('/api/sms/send', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ to: phone, text })
  });
  const j = await r.json();
  if (j.ok) { $('text').value=''; log('OUTBOUND: ' + text); }
  else { log('ERROR sending'); }
};

sock.on('sms:inbound', m => {
  const phone = $('phone').value.trim();
  if (!phone || m.from !== phone) return;
  log(\`[\${m.at}] INBOUND: \${m.text}\`);
});
sock.on('sms:outbound', m => {
  const phone = $('phone').value.trim();
  if (!phone || m.to !== phone) return;
  log(\`[\${m.at}] OUTBOUND: \${m.text}\`);
});
</script>
`);
  });

  // Agent state
  r.get('/api/agent/state', (req, res) => {
    const phone = (req.query.phone || '').trim();
    if (!phone) return res.status(400).json({ ok:false, error:'phone required' });
    res.json({ ok:true, phone, state: getState(phone) });
  });

  // Toggle autopilot
  r.post('/api/agent/autopilot', (req, res) => {
    const phone = (req.body?.phone || '').trim();
    const enabled = !!req.body?.enabled;
    if (!phone) return res.status(400).json({ ok:false, error:'phone required' });
    const state = setAutopilot(phone, enabled);
    res.json({ ok:true, phone, state });
  });

  // Thread fetch
  r.get('/api/sms/thread', (req, res) => {
    const phone = phoneE164((req.query.phone || '').trim());
    if (!phone) return res.status(400).json({ ok:false, error:'phone required' });
    res.json({ ok:true, phone, messages: getThread(phone) });
  });

  // Manual send
  r.post('/api/sms/send', async (req, res) => {
    try {
      const to = phoneE164(String(req.body?.to || ''));
      const text = String(req.body?.text || '').slice(0, 500);
      if (!to || !text) return res.status(400).json({ ok:false, error:'to and text required' });

      const resp = await sendSMS(to, text);
      recordSms({ to, from: process.env.TWILIO_FROM || 'operator', direction: 'outbound', text });
      io.emit('sms:outbound', { sid: resp.sid, to, text, at: new Date().toISOString() });

      res.json({ ok:true, sid: resp.sid });
    } catch (e) {
      console.error('[api/sms/send]', e?.message || e);
      res.status(500).json({ ok:false, error:'send failed' });
    }
  });

  return r;
}