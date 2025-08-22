// routes/contacts.ts
import { Router } from 'express'
import { randomUUID } from 'crypto'

type PostalAddress = {
  address?: string
  city?: string
  state?: string
  postalCode?: string
  fullAddress?: string
  full_address?: string
}

type Contact = {
  id: string
  name: string
  company?: string
  phones: string[]
  emails: string[]
  address?: string | PostalAddress
  tags: string[]
  notes?: string
  createdAt: string
  updatedAt: string
  // extra fields your UI expects:
  kind?: string
  lastAppointmentAt?: string
  appointments?: number
}

// naive per-client store (prototype)
const store = new Map<string, Contact[]>()
function getBucket(clientId = 'default') {
  if (!store.has(clientId)) store.set(clientId, [])
  return store.get(clientId)!
}

const router = Router()

// helpers
const asStrArray = (v: unknown) =>
  Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : []

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

function mergeAddress(
  prev: string | PostalAddress | undefined,
  next: string | PostalAddress | undefined
): string | PostalAddress | undefined {
  if (next == null) return prev
  if (typeof next === 'string') return next
  if (isObj(next)) {
    if (isObj(prev)) return { ...prev, ...next }
    return next
  }
  return prev
}

/* ------------------ ROUTES ------------------ */

// GET /api/contacts
router.get('/', (req, res) => {
  const clientId = (req.headers['x-client-id'] as string) || 'default'
  const list = getBucket(clientId)
  res.json({ ok: true, clientId, count: list.length, contacts: list })
})

// POST /api/contacts
router.post('/', (req, res) => {
  const clientId = (req.headers['x-client-id'] as string) || 'default'
  const bucket = getBucket(clientId)

  const b = req.body || {}
  if (!b.name || typeof b.name !== 'string') {
    return res.status(400).json({ ok: false, error: 'name is required' })
  }

  const now = new Date().toISOString()
  const contact: Contact = {
    id: (typeof b.id === 'string' && b.id.trim()) || randomUUID(),
    name: b.name.trim(),
    company: b.company || undefined,
    phones: asStrArray(b.phones),
    emails: asStrArray(b.emails),
    address: isObj(b.address) || typeof b.address === 'string' ? b.address : undefined,
    tags: asStrArray(b.tags),
    notes: b.notes || undefined,
    createdAt: now,
    updatedAt: now,
    // extras your UI reads:
    kind: typeof b.kind === 'string' ? b.kind : undefined,
    lastAppointmentAt: typeof b.lastAppointmentAt === 'string' ? b.lastAppointmentAt : undefined,
    appointments: typeof b.appointments === 'number' ? b.appointments : 0,
  }

  bucket.push(contact)
  res.status(201).json({ ok: true, contact })
})

// GET /api/contacts/:id
router.get('/:id', (req, res) => {
  const clientId = (req.headers['x-client-id'] as string) || 'default'
  const contact = getBucket(clientId).find(c => c.id === req.params.id)
  if (!contact) return res.status(404).json({ ok: false, error: 'not found' })
  res.json({ ok: true, contact })
})

// PATCH /api/contacts/:id
router.patch('/:id', (req, res) => {
  const clientId = (req.headers['x-client-id'] as string) || 'default'
  const bucket = getBucket(clientId)
  const idx = bucket.findIndex(c => c.id === req.params.id)
  if (idx === -1) return res.status(404).json({ ok: false, error: 'not found' })

  const current = bucket[idx]
  const b = req.body || {}

  const updated: Contact = {
    ...current,
    name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : current.name,
    company: b.company ?? current.company,
    phones: b.phones !== undefined ? asStrArray(b.phones) : current.phones,
    emails: b.emails !== undefined ? asStrArray(b.emails) : current.emails,
    address: mergeAddress(current.address, b.address),
    tags: b.tags !== undefined ? asStrArray(b.tags) : current.tags,
    notes: b.notes !== undefined ? String(b.notes) : current.notes,
    kind: b.kind !== undefined ? String(b.kind) : current.kind,
    lastAppointmentAt:
      typeof b.lastAppointmentAt === 'string' ? b.lastAppointmentAt : current.lastAppointmentAt,
    appointments:
      typeof b.appointments === 'number' ? b.appointments : current.appointments,
    updatedAt: new Date().toISOString(),
  }

  bucket[idx] = updated
  res.json({ ok: true, contact: updated })
})

// DELETE /api/contacts/:id
router.delete('/:id', (req, res) => {
  const clientId = (req.headers['x-client-id'] as string) || 'default'
  const bucket = getBucket(clientId)
  const idx = bucket.findIndex(c => c.id === req.params.id)
  if (idx === -1) return res.status(404).json({ ok: false, error: 'not found' })
  const [removed] = bucket.splice(idx, 1)
  res.json({ ok: true, removed: removed.id })
})

// Stub: GET /api/contacts/:id/appointments  (what ContactsPanel calls)
router.get('/:id/appointments', (_req, res) => {
  res.json({ appointments: [] })
})

export default router