// x-fleet-back/lib/twilio.js
import twilio from 'twilio';

let _client = null;

function getClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !token) throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
  if (!_client) _client = twilio(sid, token);
  return _client;
}

// pick a sender: Messaging Service SID wins, else FROM, else PHONE_NUMBER
function getFromConfig() {
  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const fromEnv = (process.env.TWILIO_FROM || process.env.TWILIO_PHONE_NUMBER || '').trim();

  if (!messagingServiceSid && !fromEnv) {
    throw new Error('Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM (or TWILIO_PHONE_NUMBER)');
  }
  return { messagingServiceSid, from: fromEnv };
}

// minimal E.164 helper (US default if user types 10 digits)
function ensureE164(n) {
  if (!n) return n;
  let s = String(n).replace(/[^\d+]/g, '');
  if (s.startsWith('+')) return s;
  if (/^\d{10}$/.test(s)) return '+1' + s;
  if (/^\d{11}$/.test(s)) return '+' + s;
  return s; // let Twilio validate other regions
}

/**
 * Send an SMS (or MMS if you pass mediaUrl/mediaUrls in extra)
 * @param {string} to E.164, e.g. +15551234567
 * @param {string} body message text
 * @param {object} extra Twilio params (statusCallback, mediaUrl(s), etc.)
 */
export async function sendSMS(to, body, extra = {}) {
  const client = getClient();
  const { from, messagingServiceSid } = getFromConfig();

  const params = {
    to: ensureE164(to),
    body,
    ...(messagingServiceSid ? { messagingServiceSid } : { from }),
    ...extra,
  };

  try {
    const msg = await client.messages.create(params);
    return msg; // { sid, status, errorCode:null, ... }
  } catch (e) {
    // surface Twilio diagnostics to the API caller
    const err = new Error(e?.message || 'Twilio send failed');
    err.code = e?.code ?? null;
    err.status = e?.status ?? null;
    err.moreInfo = e?.moreInfo ?? null; // URL to Twilio docs
    err.details = e;
    throw err;
  }
}

/**
 * Basic webhook handler for inbound SMS (Twilio hits this if you wire it)
 */
export function handleIncomingSMS(req, res) {
  const { From, Body, To } = req.body || {};
  console.log(`📩 Incoming SMS from ${From} to ${To}: ${Body}`);
  res.type('text/xml').send(`<Response><Message>Got your message: "${Body}"</Message></Response>`);
}