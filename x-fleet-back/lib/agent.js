// lib/agent.js
import axios from 'axios';
import fetch from 'node-fetch';
import { coachReply } from './llm.js';

// ----- ENV / config -----
const USE_LLM = process.env.AGENT_USE_LLM === '1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AGENT_MODEL = process.env.AGENT_MODEL || 'gpt-4o-mini';
const BASE = process.env.AGENT_API_BASE || 'http://localhost:8080';
const AUTOPILOT_DEFAULT = process.env.AGENT_AUTOPILOT_DEFAULT === '1'; // NEW

// ----- utils -----
function normalizePhone(p) {
  if (!p) return p;
  let s = String(p).replace(/[^\d]/g, '');
  if (s.length === 10) s = '1' + s; // assume US
  if (!s.startsWith('+')) s = '+' + s;
  return s;
}
function toYYYYMMDD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseNaturalDate(phrase) {
  if (!phrase) return null;
  const msg = phrase.trim().toLowerCase();

  if (/^\d{4}-\d{2}-\d{2}$/.test(msg)) return msg; // ISO

  const today = new Date();
  if (msg === 'today') return toYYYYMMDD(today);
  if (msg === 'tomorrow') return toYYYYMMDD(new Date(today.getTime() + 24 * 3600 * 1000));

  const map = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };
  const wk = Object.keys(map).find(k => new RegExp(`\\b${k}`, 'i').test(msg));
  if (wk) {
    const target = map[wk];
    const diff = (target + 7 - today.getDay()) % 7 || 7;
    const next = new Date(today.getTime() + diff * 24 * 3600 * 1000);
    return toYYYYMMDD(next);
  }
  return null;
}

// ----- tiny LLM extractor -----
async function extractWithLLM(text, state) {
  if (!USE_LLM || !OPENAI_API_KEY) return null;
  const sys = [
    'You extract booking info for a home service dispatcher.',
    'Return STRICT JSON only with keys: intent, address, date, followup.',
    'intent ∈ {"book","reschedule","other"}',
    'address: full address string if present, else null.',
    'date: use "YYYY-MM-DD" if you can; otherwise "today"/"tomorrow"/weekday like "Tue".',
    'followup: a brief helpful next message for the customer (no branding).',
  ].join(' ');

  const user = [
    `Message: ${text}`,
    `Known state: ${JSON.stringify({ stage: state?.stage, address: state?.data?.address, date: state?.data?.date })}`,
  ].join('\n');

  const body = {
    model: AGENT_MODEL,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' }
  };

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const t = await r.text().catch(()=>'');
    throw new Error(`LLM error ${r.status}: ${t.slice(0,200)}`);
  }
  const j = await r.json();
  const raw = j?.choices?.[0]?.message?.content;
  try { return JSON.parse(raw); } catch { return null; }
}

// ----- simple session store -----
const sessions = new Map(); // phone -> { autopilot, stage, data, options }

export function setAutopilot(phone, enabled) {
  const k = normalizePhone(phone);
  const s = sessions.get(k) || { autopilot: AUTOPILOT_DEFAULT, stage: 'idle', data: {} }; // CHANGED
  s.autopilot = !!enabled;
  sessions.set(k, s);
  return s;
}
export function getState(phone) {
  const k = normalizePhone(phone);
  return sessions.get(k) || { autopilot: AUTOPILOT_DEFAULT, stage: 'idle', data: {} }; // CHANGED
}

// ----- main handler -----
export async function handleInbound({ from, to, text, send }) {
  const phone = normalizePhone(from);
  const s = sessions.get(phone) || { autopilot: AUTOPILOT_DEFAULT, stage: 'idle', data: {} }; // CHANGED
  sessions.set(phone, s);

  const msg = (text || '').trim(); // get the message first

  // ✅ Handle compliance FIRST (works even if autopilot is off)
  if (/^stop\b/i.test(msg)) {
    s.autopilot = false;
    await send(phone, 'You’re opted out. Reply START to opt back in.');
    return { handled: true };
  }
  if (/^start\b/i.test(msg)) {
    s.autopilot = true;
    await send(phone, 'You’re opted back in. How can I help?');
    return { handled: true };
  }
  if (/^help\b/i.test(msg)) {
    await send(phone, 'Reply STOP to opt out. For help call (516) 373-0214.');
    return { handled: true };
  }

  // ⛔ Only now short-circuit if autopilot is off
  if (!s.autopilot) return { handled: false };

  // Try to extract fields with LLM (optional)
  let nlp = null;
  try { nlp = await extractWithLLM(msg, s); } catch {}

  if (!s.data.address && nlp?.address) s.data.address = nlp.address;
  const llmDate =
    nlp?.date &&
    (parseNaturalDate(nlp.date) ||
      (/^\d{4}-\d{2}-\d{2}$/.test(nlp.date) ? nlp.date : null));
  if (!s.data.date && llmDate) s.data.date = llmDate;

  const lower = msg.toLowerCase();

  switch (s.stage) {
    case 'idle': {
      s.stage = /\b(book|schedule|appointment|estimate|reschedule)\b/.test(lower)
        ? 'need_address'
        : 'need_intent_or_address';

      // Optional: use LLM to craft the ask (safe; only after we decide the stage)
      let llm = null;
      if (USE_LLM && OPENAI_API_KEY) {
        try { llm = await coachReply(s, msg); } catch {}
      }

      await send(
        phone,
        llm || (s.stage === 'need_address'
          ? 'Happy to help! What’s the service address?'
          : 'Hi! I can get you scheduled. What’s the service address?')
      );
      return { handled: true };
    }

    case 'need_intent_or_address':
    case 'need_address': {
      // Accept as address only if it looks like one and isn't just a date
      const maybeDate = parseNaturalDate(msg);
      const looksLikeAddress =
        /[\d].+/.test(msg) || /,/.test(msg) ||
        /\b(st|ave|blvd|rd|dr|ln|ct|hwy|highway|road|lane)\b/i.test(msg);

      if (!s.data.address && looksLikeAddress && !maybeDate) {
        s.data.address = msg;
      }

      if (!s.data.address) {
        await send(phone, 'What’s the service address?');
        return { handled: true };
      }

      s.stage = 'need_day';
      await send(phone, 'Got it. What day works best? (e.g., “Tue” or YYYY-MM-DD)');
      return { handled: true };
    }

    case 'need_day': {
      const picked = llmDate || parseNaturalDate(msg);
      if (!picked) {
        await send(phone, 'Let’s use a date like YYYY-MM-DD or “tomorrow”.');
        return { handled: true };
      }
      s.data.date = picked;

      try {
        const r = await axios.post(`${BASE}/api/suggest-times`, {
          date: picked,
          address: s.data.address,
          durationMin: 60,
          bufferMin: 15,
          maxDetourMin: 60,
        }, { timeout: 15000 });

        const opts = (r.data?.suggestions || []).slice(0, 3);
        if (!opts.length) {
          await send(phone, 'We’re tight that day. Want a different day or morning/afternoon preference?');
          return { handled: true };
        }

        s.stage = 'offer_slots';
        s.options = opts;

        const lines = opts.map((o, i) => {
          const t = new Date(o.start);
          const when = t.toLocaleString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
          });
          return `${i + 1}) ${when}`;
        }).join('\n');

        await send(phone, `Here are a few times:\n${lines}\nReply 1, 2, or 3 to choose.`);
      } catch {
        await send(phone, 'I couldn’t pull times just now. Can you share a different day preference?');
      }
      return { handled: true };
    }

    case 'offer_slots': {
      const pick = Number(msg.trim());
      if (![1, 2, 3].includes(pick) || !s.options?.[pick - 1]) {
        await send(phone, 'Please reply 1, 2, or 3 to choose a time.');
        return { handled: true };
      }

      const choice = s.options[pick - 1];
      try {
        await axios.post(`${BASE}/api/create-appointment`, {
          address: s.data.address,
          startTime: choice.start,
          endTime: choice.end,
          title: 'Service appointment',
          notes: 'Booked by Dispatch AI',
          timezone: 'America/New_York',
          contact: { name: 'Customer', phone }
        }, { timeout: 20000 });

        s.stage = 'done';
        await send(phone, `You’re all set for ${new Date(choice.start).toLocaleString()}. We’ll see you then!`);
      } catch {
        s.stage = 'need_day';
        await send(phone, 'Booking failed just now—mind trying a different time/day?');
      }
      return { handled: true };
    }

    case 'done': {
      await send(phone, 'If you need to reschedule or have questions, just text me.');
      return { handled: true };
    }

    default:
      s.stage = 'idle';
      return { handled: false };
  }
}