// x-fleet-back/lib/twilio.js
import twilio from 'twilio'

let _client = null

function getClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim()
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim()
  if (!sid || !token) throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN')
  if (!_client) _client = twilio(sid, token)
  return _client
}

// pick a sender: Messaging Service SID wins, else FROM, else PHONE_NUMBER
function getFromConfig() {
  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim()
  const fromEnv = (process.env.TWILIO_FROM || process.env.TWILIO_PHONE_NUMBER || '').trim()

  if (!messagingServiceSid && !fromEnv) {
    throw new Error('Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM (or TWILIO_PHONE_NUMBER)')
  }
  return { messagingServiceSid, from: fromEnv }
}

// minimal E.164 helper (US default for 10-digit input)
function ensureE164(n) {
  if (!n) return n
  let s = String(n).replace(/[^\d+]/g, '')
  if (s.startsWith('+')) return s
  if (/^\d{10}$/.test(s)) return '+1' + s
  if (/^\d{11}$/.test(s)) return '+' + s
  return s // let Twilio validate other regions
}

/**
 * Send an SMS (or MMS if you pass mediaUrl/mediaUrls in extra)
 * @param {string} to   E.164, e.g. +15551234567
 * @param {string} body message text
 * @param {object} extra Twilio params (statusCallback, mediaUrl(s), etc.)
 */
async function sendSMS(to, body, extra = {}) {
  const client = getClient()
  const { from, messagingServiceSid } = getFromConfig()

  const params = {
    to: ensureE164(to),
    body,
    ...(messagingServiceSid ? { messagingServiceSid } : { from }),
    ...extra,
  }

  try {
    const msg = await client.messages.create(params)
    return msg // { sid, status, errorCode:null, ... }
  } catch (e) {
    const err = new Error(e?.message || 'Twilio send failed')
    err.code = e?.code ?? null
    err.status = e?.status ?? null
    err.moreInfo = e?.moreInfo ?? null // URL to Twilio docs
    err.details = e
    throw err
  }
}

/**
 * (Optional) place an outbound voice call via REST API.
 * For Power Dialer: POST /api/voice/call { to }
 * You can also point this at a TwiML app if you prefer.
 */
async function placeCall(to, opts = {}) {
  const client = getClient()
  const { from } = getFromConfig()

  // record from answer dual

const twiml = new twilio.twiml.VoiceResponse()

// Always-on recording (dual channel) + webhook to receive recording status
const recordingCb =
  process.env.TWILIO_RECORDING_CALLBACK_URL ||
  `${process.env.PUBLIC_URL}/twilio/recording-status`

const dial = twiml.dial({
  callerId: from,
  // Start recording once the call is answered; use dual-channel for rep/customer separation
  record: 'record-from-answer-dual',
  // Tell Twilio where to POST when a recording is ready (we'll add the route next)
  recordingStatusCallback: recordingCb,
  // Keep it simple: notify only when the recording is completed
  recordingStatusCallbackEvent: 'completed',
})

dial.number(ensureE164(to))

  return client.calls.create({
    twiml: twiml.toString(),
    to: ensureE164(to),
    from,
    ...opts, // e.g. statusCallback, machineDetection, etc.
  })
}

/**
 * Basic webhook handler for inbound SMS (Twilio hits this if you wire it).
 * Tip: add signature validation middleware (see verifyTwilio below).
 */
function handleIncomingSMS(req, res) {
  const { From, Body, To } = req.body || {}
  console.log(`📩 Incoming SMS from ${From} to ${To}: ${Body}`)

  // Build TwiML safely
  const twiml = new twilio.twiml.MessagingResponse()
  twiml.message(`Got your message: "${Body}"`)
  res.type('text/xml').send(twiml.toString())
}

/**
 * Express middleware to verify Twilio webhook signatures (recommended).
 * Usage: app.post('/twilio/sms', express.urlencoded({extended:false}), verifyTwilio(), handleIncomingSMS)
 */
function verifyTwilio(expectedUrlGetter) {
  return (req, res, next) => {
    try {
      const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim()
      const signature = req.header('x-twilio-signature') || ''
      // Twilio needs the full public URL that Twilio called:
      const url = typeof expectedUrlGetter === 'function'
        ? expectedUrlGetter(req)
        : `${process.env.PUBLIC_URL}${req.originalUrl}`

      const ok = twilio.validateRequest(authToken, signature, url, req.body)
      if (!ok) return res.status(403).send('Invalid Twilio signature')
      next()
    } catch (e) {
      return res.status(400).send('Signature validation error')
    }
  }
}

export {
  getClient,
  getFromConfig,
  ensureE164,
  sendSMS,
  placeCall,
  handleIncomingSMS,
  verifyTwilio,
}
export default {
  getClient,
  getFromConfig,
  ensureE164,
  sendSMS,
  placeCall,
  handleIncomingSMS,
  verifyTwilio,
}