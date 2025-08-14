import express from 'express'
import http from 'http'
import { Server as SocketIOServer } from 'socket.io'
import cors from 'cors'
import dotenv from 'dotenv'

import { scoreAllReps } from './lib/fit.js'
import { getContact, updateAppointmentOwner, rescheduleAppointment, appendAppointmentNotes } from './lib/ghl.js'

dotenv.config()

const app = express()
const server = http.createServer(app)
const io = new SocketIOServer(server, { cors: { origin: process.env.ALLOW_ORIGIN || '*', methods: ['GET','POST'] } })
app.use(cors({ origin: process.env.ALLOW_ORIGIN || '*' }))
app.use(express.json())

// ---- In-memory stores ----
const techs = [
  { id: 1, name: 'Tech 1', status: 'En Route', pos: [33.4484,-112.0740], skills: ['Reroof','Repair'], territory: 'EAST', route: [] },
  { id: 2, name: 'Tech 2', status: 'On Site', pos: [33.457,-112.07], skills: ['Repair'], territory: 'WEST', route: [] },
  { id: 3, name: 'Tech 3', status: 'En Route', pos: [33.44,-112.09], skills: ['Inspection','Reroof'], territory: 'EAST', route: [] },
]
const jobs = new Map() // appointmentId -> enriched job (incl. contact snapshot)

// Quick test helper: clear in-memory jobs
app.post('/api/clear-jobs', (req, res) => {
  jobs.clear()
  res.json({ ok: true, message: 'Jobs cleared' })
})

// ---- WS snapshot for map ----
io.on('connection', (socket) => {
  socket.emit('tech:snapshot', techs.map(t => ({ id: t.id, name: t.name, status: t.status, pos: t.pos })))
})

// ---- Health ----
app.get('/health', (req,res)=> res.json({ ok:true }))

// ---- Week appointments (from store) ----
app.get('/api/week-appointments', (req,res) => {
  const list = Array.from(jobs.values()).map(j => {
    let day = j.day, time = j.time
    if (!day || !time) {
      const d = new Date(j.startTime)
      day = d.toLocaleDateString(undefined, { weekday: 'short' })
      time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    }
    return {
      id: j.appointmentId,
      day, time,
      address: toAddressString(j.address),
      lat: j.lat, lng: j.lng,
      jobType: j.jobType, estValue: j.estValue, territory: j.territory,
      contact: j.contact
    }
  })
  res.json(list)
})

/* ==== AI: suggest best times for the bot ===================================
   The GHL bot posts address/lat/lng + job meta + a preferred window.
   We try candidate start times and return the top 2–3 options with rep + reason.
=========================================================================== */
app.post('/ai/suggest-times', async (req, res) => {
  try {
    const { address, lat, lng, jobType, estValue = 0, territory, preferredStart, preferredEnd } = req.body || {}

    const baseJob = {
      appointmentId: 'ad-hoc-' + Math.random().toString(36).slice(2),
      address: address || '',
      lat: Number(lat ?? 33.455),
      lng: Number(lng ?? -112.05),
      startTime: preferredStart || new Date().toISOString(),
      endTime: preferredEnd || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      jobType: jobType || 'Repair',
      estValue: Number(estValue) || 0,
      territory: territory || 'EAST'
    }

    const reps = techs.map(t => ({ id: t.id, name: t.name, skills: t.skills, territory: t.territory, route: t.route }))
    const starts = buildCandidateStarts(baseJob.startTime) // every 30m over next few hrs

    const options = []
    for (const s of starts) {
      const trial = { ...baseJob, startTime: s, endTime: new Date(new Date(s).getTime() + 60*60*1000).toISOString() }
      const scored = await scoreAllReps(trial, reps)
      if (scored.length) options.push({ startTime: trial.startTime, endTime: trial.endTime, decision: scored[0] })
    }

    options.sort((a,b) => a.decision.total - b.decision.total)
    return res.json({
      ok: true,
      suggestions: options.slice(0,3).map(o => ({
        startTime: o.startTime,
        endTime: o.endTime,
        repId: o.decision.repId,
        repName: o.decision.repName,
        reason: o.decision.reason,
        fit: Number(o.decision.total.toFixed(2))
      }))
    })
  } catch (e) {
    console.error('suggest-times error', e)
    res.status(500).json({ ok:false, error:'internal_error' })
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

// ---- Job detail with full GHL contact snapshot ----
app.get('/api/job/:id', (req,res) => {
  const j = jobs.get(req.params.id)
  if(!j) return res.status(404).json({ error: 'not_found' })
  res.json(j)
})

// ---- GHL webhook: enrich job with contact card ----
app.post('/ghl/appointment-created', async (req, res) => {
  try {
    console.log('[WEBHOOK] appointment-created payload keys:', Object.keys(req.body || {}))
    const appt = req.body || {}
    const job = normalizeJob(appt)

    // Enrich with GHL contact data (accept nested OR flat)
    const contactId = appt.contactId || appt.contact_id || appt.customer?.id
    const contactEmail = appt.contactEmail || appt.contact_email || appt.customer?.email
    const contactPhone = appt.contactPhone || appt.contact_phone || appt.customer?.phone
    const contact = await getContact(contactId, { email: contactEmail, phone: contactPhone })
    job.contact = contact

    jobs.set(job.appointmentId, job)

    const reps = techs.map(t => ({ id: t.id, name: t.name, skills: t.skills, territory: t.territory, route: t.route }))
    const candidates = await scoreAllReps(job, reps)
    if(!candidates.length){
      io.emit('ai:suggestion', { job, candidates: [] })
      return res.json({ ok: true, action: 'awaiting_approval' })
    }
    const best = candidates[0]

    const mode = process.env.SDC_MODE || 'Approve'
    if (mode === 'Auto'){
      await updateAppointmentOwner(job.appointmentId, best.repId)
      await rescheduleAppointment(job.appointmentId, job.startTime, job.endTime)
      await appendAppointmentNotes(job.appointmentId, `Booked by SDC AI • ${best.reason} • FIT=${best.total.toFixed(2)}`)
      io.emit('ai:booking', { job, decision: best })
      return res.json({ ok: true, action: 'booked', decision: best })
    } else {
      io.emit('ai:suggestion', { job, candidates })
      return res.json({ ok: true, action: 'awaiting_approval', candidates })
    }
  } catch (e){
    console.error('webhook error', e)
    return res.status(500).json({ ok:false, error: 'internal_error' })
  }
})
function toAddressString(a){
  if (!a) return ''
  if (typeof a === 'string') return a
  const parts = [
    a.fullAddress,
    [a.address, a.city, a.state, a.postalCode].filter(Boolean).join(', ')
  ].filter(Boolean)
  return parts[0] || ''
}
/**
 * Normalize webhook payloads from:
 *  - Planner posts (nested: customer{}, custom{})
 *  - GHL Webhook “Custom Data” (flat key/value pairs)
 */
function normalizeJob(appt){
  const appointmentId = appt.appointmentId || appt.id || ('ghl-' + Math.random().toString(36).slice(2))
  const startTime = appt.startTime || appt.start_time || new Date().toISOString()
  const endTime   = appt.endTime   || appt.end_time   || new Date(Date.now()+3600000).toISOString()

  // Address / geo: support string or object
  const rawAddr = appt.address ?? appt.location ?? ''
  const address = toAddressString(rawAddr)

  const lat = Number(
    appt.lat ?? appt.latitude ??
    (rawAddr && (rawAddr.lat ?? rawAddr.latitude)) ??
    33.455
  )
  const lng = Number(
    appt.lng ?? appt.longitude ??
    (rawAddr && (rawAddr.lng ?? rawAddr.longitude)) ??
    -112.05
  )

  const customer = appt.customer || {
    id:    appt.contactId || appt.contact_id,
    name:  appt.contactName  || appt.contact_name,
    email: appt.contactEmail || appt.contact_email,
    phone: appt.contactPhone || appt.contact_phone
  }

  const custom = appt.custom || {
    jobType:   appt.jobType   || appt.job_type   || 'Repair',
    estValue:  appt.estValue ?? appt.est_value ?? 0,
    territory: appt.territory || 'EAST'
  }

  const day = appt.day || null
  const time = appt.time || null

  return {
    appointmentId,
    customer,
    address, // <- now always a string
    lat, lng,
    startTime, endTime,
    jobType: custom.jobType || 'Repair',
    estValue: Number(custom.estValue || 0),
    territory: custom.territory || 'EAST',
    day, time
  }
}

const PORT = process.env.PORT || 8080
server.listen(PORT, () => console.log(`SDC backend (GHL+) on http://localhost:${PORT}`))