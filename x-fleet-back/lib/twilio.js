// x-fleet-back/lib/twilio.js
import twilio from 'twilio';

let _client = null;

function getClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !token) {
    throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
  }
  if (!_client) _client = twilio(sid, token);
  return _client;
}

function getFromConfig() {
  const from = (process.env.TWILIO_PHONE_NUMBER || '').trim();
  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  if (!from && !messagingServiceSid) {
    throw new Error('Set TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID');
  }
  return { from, messagingServiceSid };
}

/**
 * Send an SMS
 * @param {string} to - E.164, e.g. +15551234567
 * @param {string} body - Message content
 * @param {object} extra - Optional extra Twilio params (statusCallback, mediaUrl, etc.)
 */
export async function sendSMS(to, body, extra = {}) {
  const client = getClient();
  const { from, messagingServiceSid } = getFromConfig();

  const params = {
    to,
    body,
    ...(messagingServiceSid ? { messagingServiceSid } : { from }),
    ...extra,
  };

  return client.messages.create(params);
}

/**
 * Basic webhook handler for inbound SMS (responds with a simple echo)
 */
export function handleIncomingSMS(req, res) {
  const { From, Body, To } = req.body || {};
  console.log(`📩 Incoming SMS from ${From} to ${To}: ${Body}`);

  res.type('text/xml').send(
    `<Response><Message>Got your message: "${Body}"</Message></Response>`
  );
}