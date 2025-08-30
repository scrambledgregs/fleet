// ./lib/agent.js
import axios from 'axios';
import * as chrono from 'chrono-node';

// ---------- Config ----------
const SELF_BASE = process.env.SELF_BASE || 'http://localhost:8080';
const DEFAULT_TZ = process.env.DEFAULT_TZ || 'America/New_York';
const DEFAULT_DURATION_MIN = Number(process.env.DEFAULT_JOB_DURATION_MIN || 60);
const DEFAULT_BUFFER_MIN   = Number(process.env.DEFAULT_BUFFER_MIN || 15);
const DEFAULT_MAX_DETOUR   = Number(process.env.DEFAULT_MAX_DETOUR_MIN || 60);
const DEFAULT_JOB_TYPE     = process.env.DEFAULT_JOB_TYPE || 'Repair';
const DEFAULT_TERRITORY    = process.env.DEFAULT_TERRITORY || 'EAST';
const DEFAULT_EST_VALUE    = Number(process.env.DEFAULT_EST_VALUE || 0);
const MODE                 = (process.env.SDC_MODE || 'Approve').toLowerCase(); // 'auto' | 'approve'

// ---- Conversation memory (per phone) ----
const history = new Map(); // phone -> [{role, content}]

function pushTurn(phone, role, content) {
  const arr = history.get(phone) || [];
  arr.push({ role, content: String(content).slice(0, 2000) });
  // keep last ~20 turns
  while (arr.length > 20) arr.shift();
  history.set(phone, arr);
}

// ---- Human-grade NLG using OpenAI (optional but recommended) ----
async function composeLikeHuman(phone, rawAssistantText, opts = {}) {
  // If LLM disabled or no key, return the raw text
  if (!OPENAI_API_KEY || !USE_LLM) return rawAssistantText;

  const convo = history.get(phone) || [];
  const sys = [
    "You are a friendly human dispatcher texting with a customer.",
    "Sound INDISTINGUISHABLE from a person: natural, concise, empathetic, no corporate tone.",
    "Use contractions; vary phrasing; ask exactly one question at a time.",
    "Keep to SMS length; avoid lists unless the user needs choices.",
    "Stay truthful. If scheduling is uncertain, say so.",
    "If presenting options (1–3), make them easy to reply to.",
    "Never expose system/tool details."
  ].join(" ");

  const userGoal = `You were about to send this assistant message:\n"""${rawAssistantText}"""`;

  const body = {
    model: AGENT_MODEL,
    temperature: 0.5,
    messages: [
      { role: "system", content: sys },
      ...convo,
      { role: "user", content: userGoal }
    ]
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    // Fail soft to the raw text
    return rawAssistantText;
  }
  const j = await r.json();
  const out = j?.choices?.[0]?.message?.content?.trim();
  return out || rawAssistantText;
}

// Wrap sending to always pass through the “humanizer”
async function humanSend({ phone, text, send }) {
  const polished = await composeLikeHuman(phone, text);
  pushTurn(phone, "assistant", polished);
  return send(phone, polished);
}

// Optional LLM “polish” (paraphrase final text)
const USE_LLM = process.env.AGENT_USE_LLM === '1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AGENT_MODEL = process.env.AGENT_MODEL || 'gpt-4o-mini';

// ---------- Session store ----------
const sessions = new Map(); // phone -> state
function getSession(phone) {
  const key = String(phone || '');
  if (!sessions.has(key)) sessions.set(key, {});
  return sessions.get(key);
}
function clearSession(phone) { sessions.delete(String(phone || '')); }

// ---------- Micro-NLG (friendly phrasings, no LLM needed) ----------
const T = {
  menuIntro: [
    `I can help with:\n1) Book a visit\n2) Reschedule\n3) Cancel\n4) Talk to a human\n\nReply 1–4 to choose.`,
    `Here’s what I can do:\n1) Book a visit\n2) Reschedule\n3) Cancel\n4) Talk to a human\n\nReply 1–4.`
  ],
  askAddress: [
    `Got it—what’s the service address? (street + city works)`,
    `Happy to help. What address should we use for the visit?`
  ],
  askDate: [
    `Great—what day works for you? (e.g., “tomorrow 10am”, “next Tue morning”)`,
    `Okay—what date/time is best? You can say things like “Fri 2pm” or “next Wed morning”.`
  ],
  couldNotPullTimes: [
    `I couldn’t pull availability just now. Mind sharing another day/time?`,
    `My schedule lookup hiccupped—can you try a different day or rough window?`
  ],
  noWindowsThatDay: [
    `I didn’t find a good window that day. Want to try another day or give me a time window (like “Wed 1–3pm”)?`,
    `Looks tight that day. Want to try a different day or a morning/afternoon preference?`
  ],
  chooseSlot: [
    `Here are a few openings near your route:\n{{lines}}\n\nReply with 1, 2, or 3 to lock one in — or send another time.`,
    `These could work:\n{{lines}}\n\nReply 1–3 to pick, or suggest another time.`
  ],
  badPick: [
    `Please reply 1, 2, or 3.`,
    `Oops—just reply 1, 2, or 3 to choose.`
  ],
  bookedAuto: [
    `All set — you’re scheduled for {{when}}. See you then!`,
    `Booked! You’re on the calendar for {{when}}.`
  ],
  bookedApprove: [
    `Got it — I’ve penciled in {{when}}. We’ll confirm shortly.`,
    `Saved that time ({{when}}). A teammate will confirm soon.`
  ],
  cancelAck: [
    `Okay — I’ve noted you need to cancel. A team member will confirm shortly.`,
    `No problem—cancel request received. We’ll follow up to confirm.`
  ],
  handoffAck: [
    `No problem — I’ll have a human follow up shortly.`,
    `Got it—connecting you with a human.`
  ],
  helpLine: [
    `Reply STOP to opt out. For help call (516) 373-0214.`,
    `If you ever want to stop messages, reply STOP. Need help now? Call (516) 373-0214.`
  ],
  fallback: [
    `I can help book, reschedule, or cancel an appointment. Tell me a day/time and address to get started.`,
    `I handle booking, rescheduling, and cancellations. Share an address and a day/time to begin.`
  ],
  friendlyHi: [
    `Hi! 👋 I can get you scheduled.`,
    `Hey there! I can help with booking, rescheduling, or cancelling.`
  ],
  friendlyThanks: [
    `You’re welcome! Anything else I can do?`,
    `Happy to help—need anything else?`
  ],
  optout: [
    `You’re opted out. Reply START to opt back in.`,
    `Okay, you won’t get more messages. Text START if you change your mind.`
  ],
  optin: [
    `You’re opted back in. How can I help?`,
    `Opt-in confirmed—what can I do for you?`
  ],
  askMenuPick: [
    `Please reply 1, 2, 3, or 4.`,
    `Just send 1–4 to choose.`
  ]
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fill = (tpl, vars = {}) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

// Optional: paraphrase with OpenAI for extra polish
async function polish(text) {
  if (!USE_LLM || !OPENAI_API_KEY) return text;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: AGENT_MODEL,
        temperature: 0.4,
        messages: [
          { role: 'system', 
            content: 'Rewrite the assistant message to be concise, natural, and SMS-appropriate. Do NOT apologize or mention being a bot/robot. Never say things like "I didn’t mean to sound robotic" or reference your tone. Just deliver the message as a friendly human would.' 
        },
          { role: 'user', content: text }
        ]
      })
    });
    const j = await r.json();
    const out = j?.choices?.[0]?.message?.content?.trim();
    return out || text;
  } catch { return text; }
}

async function say(send, toPhone, key, vars = {}) {
  const base = fill(pick(T[key] || T.fallback), vars);
  // First do a light polish fallback (works even if LLM is off)
  const polished = await polish(base);
  // Then run the real “sound-like-a-human” pass with conversation history
  const final = await composeLikeHuman(toPhone, polished);
  pushTurn(toPhone, "assistant", final);
  return send(toPhone, final);
}

// ---------- Intent & parsing ----------
function classifyIntent(text) {
  const t = (text || '').toLowerCase().trim();

  if (/^\s*(hi|hey|hello|yo|good (morning|afternoon|evening))\b/.test(t)) return 'greet';
  if (/\b(thanks|thank you|ty|appreciate it)\b/.test(t)) return 'thanks';

  if (/\b(stop|unsubscribe|quit|cancel all)\b/.test(t)) return 'optout';
  if (/\b(start)\b/.test(t)) return 'optin';
  if (/\b(help)\b/.test(t)) return 'help';

  if (/\b(human|agent|representative|someone|real person|live support)\b/.test(t)) return 'handoff';
  if (/\b(cancel|cancelling|can't make|cannot make|won'?t make)\b/.test(t)) return 'cancel';
  if (/\b(reschedul|another time|different time|move (it|appt|appointment)|change (time|date))\b/.test(t)) return 'reschedule';
  if (/\b(book|schedule|set up|appointment|come out|estimate|quote|pricing|price)\b/.test(t)) return 'book';

  const parsed = chrono.parse(t);
  if (parsed && parsed.length) return 'book';

  if (/what can you do|how can you help|menu|options/.test(t)) return 'menu';

  return 'chitchat';
}

function firstDateTimeISO(text, baseDate = new Date()) {
  const results = chrono.parse(text, baseDate, { forwardDate: true });
  if (!results.length) return null;
  const r = results[0];
  let d = r.start?.date();
  if (!d) return null;
  if (!r.start.isCertain('hour')) d.setHours(9, 0, 0, 0); // default time if only a date

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const dateOnly = `${yyyy}-${mm}-${dd}`;

  return { dateOnly, iso: d.toISOString(), certain: r.start };
}

function extractPossibleAddress(text) {
  const m = (text || '').match(
    /\d{2,6}\s+[A-Za-z0-9.\-'\s]+\b(ave|avenue|st|street|rd|road|blvd|lane|ln|dr|drive|court|ct|way|pkwy|parkway)\b\.?,?\s*[A-Za-z\s]*\d{0,10}/i
  );
  return m ? m[0] : null;
}

// ---------- Backend helpers ----------
async function _setAutopilotAPI({ id, phone, enabled }) {
  try {
    await axios.post(`${SELF_BASE}/api/agent/autopilot`, { id, phone, enabled });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.response?.data || e?.message || 'failed' };
  }
}

// Export names used by routes/chatter.js
export async function setAutopilot(phoneOrObj, enabled) {
  if (typeof phoneOrObj === 'object' && phoneOrObj !== null) {
    const { id, phone, enabled: en } = phoneOrObj;
    return _setAutopilotAPI({ id, phone, enabled: !!en });
  }
  return _setAutopilotAPI({ id: null, phone: phoneOrObj, enabled: !!enabled });
}

export async function getState(phone) {
  try {
    const { data } = await axios.get(`${SELF_BASE}/api/agent/state`, { params: { phone } });
    return data?.state || { autopilot: true };
  } catch {
    return { autopilot: true };
  }
}

async function suggestTimes({
  clientId = 'default',
  date,
  timezone,
  address,
  jobType,
  estValue,
  territory,
  durationMin,
  bufferMin,
  maxDetourMin
}) {
  const payload = {
    clientId, date, timezone,
    address, jobType, estValue, territory,
    durationMin, bufferMin, maxDetourMin
  };
  const { data } = await axios.post(`${SELF_BASE}/api/suggest-times`, payload, { timeout: 20000 });
  if (!data?.ok) throw new Error(data?.error || 'suggest-times failed');
  return data.suggestions || [];
}

async function createAppointment({
  contact, contactId,
  address, lat, lng,
  jobType, estValue, territory,
  startTime, endTime,
  timezone = DEFAULT_TZ,
  title = 'Service Visit',
  notes = '',
  clientId = 'default',
  assignedUserId = process.env.GHL_USER_ID
}) {
  const payload = {
    contactId, contact,
    address, lat, lng,
    jobType, estValue, territory,
    startTime, endTime,
    timezone, title, notes,
    clientId, assignedUserId
  };
  const { data } = await axios.post(`${SELF_BASE}/api/create-appointment`, payload, { timeout: 25000 });
  if (!data?.ok) throw new Error(data?.error || 'create-appointment failed');
  return data;
}

// ---------- Main entry ----------
export async function handleInbound({ from, to, text, send, context }) {
    pushTurn(from, "user", text);
  const s = getSession(from);
    const inJobThread = !!(context && context.job && context.job.appointmentId);

  // defaults
  s.clientId     ||= 'default';
  s.timezone     ||= DEFAULT_TZ;
  s.jobType      ||= DEFAULT_JOB_TYPE;
  s.durationMin  ||= DEFAULT_DURATION_MIN;
  s.bufferMin    ||= DEFAULT_BUFFER_MIN;
  s.maxDetourMin ||= DEFAULT_MAX_DETOUR;
  s.territory    ||= DEFAULT_TERRITORY;
  if (typeof s.estValue !== 'number') s.estValue = DEFAULT_EST_VALUE;

  const intent = classifyIntent(text);

  // --- Compliance & basic commands (always honored) ---
  if (intent === 'optout') {
    await setAutopilot({ phone: from, enabled: false });
    await say(send, from, 'optout');
    return;
  }
  if (intent === 'optin') {
    await setAutopilot({ phone: from, enabled: true });
    await say(send, from, 'optin');
    return;
  }
  if (intent === 'help') {
    await say(send, from, 'helpLine');
    return;
  }

// --- Small talk niceties ---
if (intent === 'greet' && !s.stage) {
  s.stage = 'menu';
  await say(send, from, 'friendlyHi', { extra: "What do you need today — booking, rescheduling, or canceling?" });
  return;
}

  if (intent === 'thanks') {
    await say(send, from, 'friendlyThanks');
    return;
  }

  // --- Human handoff / cancel ---
  if (intent === 'handoff') {
    await setAutopilot({ phone: from, enabled: false });
    await say(send, from, 'handoffAck');
    return;
  }
  if (intent === 'cancel') {
    await say(send, from, 'cancelAck');
    clearSession(from);
    return;
  }

  // --- Quick menu entry points ---
  if ((intent === 'menu' || intent === 'chitchat') && !s.stage) {
    s.stage = 'menu';
    await say(send, from, 'menuIntro');
    return;
  }

  if (s.stage === 'menu') {
    const n = Number(String(text).trim());
    if (n === 1) { s.stage = undefined; return await handleInbound({ from, to, text: 'book', send }); }
    if (n === 2) { s.stage = undefined; return await handleInbound({ from, to, text: 'reschedule', send }); }
    if (n === 3) { s.stage = undefined; return await handleInbound({ from, to, text: 'cancel', send }); }
    if (n === 4) { s.stage = undefined; return await handleInbound({ from, to, text: 'human', send }); }
    await say(send, from, 'askMenuPick');
    return;
  }

  // --- Booking / Reschedule flow (collect address + date) ---
  if (intent === 'book' || intent === 'reschedule') {
    const dt = firstDateTimeISO(text, new Date());
    if (dt?.dateOnly) s.date = dt.dateOnly;

    const maybeAddr = extractPossibleAddress(text);
    if (maybeAddr && (!s.address || s.address.length < maybeAddr.length)) s.address = maybeAddr;

    if (!s.address) {
      await say(send, from, 'askAddress');
      return;
    }
    if (!s.date) {
      await say(send, from, 'askDate');
      return;
    }

    // Have address + date → pull suggestions
    try {
      const suggestions = await suggestTimes({
        clientId: s.clientId,
        date: s.date,
        timezone: s.timezone,
        address: s.address,
        jobType: s.jobType,
        estValue: s.estValue,
        territory: s.territory,
        durationMin: s.durationMin,
        bufferMin: s.bufferMin,
        maxDetourMin: s.maxDetourMin
      });

      if (!suggestions.length) {
        await say(send, from, 'noWindowsThatDay');
        return;
      }

      s.options = suggestions.slice(0, 3);
      const lines = s.options.map((o, i) => {
        const start = new Date(o.start);
        const local = start.toLocaleString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit'
        });
        const travel = o.travel?.total ? ` • +${o.travel.total}m travel` : '';
        return `${i + 1}) ${local}${travel}`;
      }).join('\n');

      await say(send, from, 'chooseSlot', { lines });
      return;
    } catch {
      await say(send, from, 'couldNotPullTimes');
      return;
    }
  }

  // --- Selecting one of the offered options ---
  if (s.options && /^\s*[123]\s*$/.test(text)) {
    const idx = Number(text.trim()) - 1;
    const choice = s.options[idx];
    if (!choice) {
      await say(send, from, 'badPick');
      return;
    }

    try {
      const create = await createAppointment({
        contact: { name: '', phone: from },
        address: s.address,
        jobType: s.jobType,
        estValue: s.estValue,
        territory: s.territory,
        startTime: choice.start,
        timezone: s.timezone,
        title: `${s.jobType} visit`,
        notes: `Booked via SMS AI (${MODE})`,
        clientId: s.clientId
      });

      const when = new Date(choice.start).toLocaleString();
      if ((MODE === 'auto') && create?.job?.appointmentId) {
        await say(send, from, 'bookedAuto', { when });
      } else {
        await say(send, from, 'bookedApprove', { when });
      }
      clearSession(from);
      return;
    } catch {
      await say(send, from, 'couldNotPullTimes');
      return;
    }
  }

  // --- fallback ---
  await say(send, from, 'fallback');
}