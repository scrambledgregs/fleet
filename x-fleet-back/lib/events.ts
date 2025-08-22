// lib/events.ts
import crypto from 'crypto'

export type EventName =
  | 'lead.created'
  | 'lead.updated'
  | 'contact.disposition.created'
  | 'appointment.created'
  | 'appointment.assigned'
  | 'sms.inbound'
  | 'sms.outbound'

// NEW: who triggered the event (optional)
export type EventActor =
  | { kind: 'system'; name?: string }
  | { kind: 'automation'; id?: string; name?: string }
  | { kind: 'user'; id?: string; name?: string; email?: string }

// NEW: what entity the event is about (optional)
export type EventSubject = {
  contactId?: string
  contactName?: string
  appointmentId?: string
  repId?: string
  repName?: string
}

export type BaseEvent<T = unknown> = {
  id: string
  name: EventName
  ts: string            // ISO timestamp
  clientId: string
  source: 'api' | 'web' | 'webhook' | 'system'
  // NEW (all optional/backward-compatible):
  mode?: 'manual' | 'automatic'
  actor?: EventActor
  subject?: EventSubject
  meta?: Record<string, any>
  idempotencyKey?: string
  payload: T
}

// ---- simple in-memory store (swap to DB later) ----
type PersistedEvent = BaseEvent
const EVENTS_MAX = Number(process.env.EVENTS_MAX || 5000)

const events: PersistedEvent[] = []
const idemp = new Map<string, string>() // key -> eventId

export function createEvent<T>(
  name: EventName,
  clientId: string,
  payload: T,
  opts?: {
    source?: BaseEvent['source']
    idempotencyKey?: string
    // NEW (optional)
    mode?: BaseEvent['mode']
    actor?: EventActor
    subject?: EventSubject
    meta?: Record<string, any>
    ts?: string
  }
): BaseEvent<T> {
  return {
    id: crypto.randomUUID(),
    name,
    ts: opts?.ts || new Date().toISOString(),
    clientId: (clientId || 'default').trim(),
    source: opts?.source ?? 'api',
    idempotencyKey: opts?.idempotencyKey,
    // NEW (optional)
    mode: opts?.mode,
    actor: opts?.actor,
    subject: opts?.subject,
    meta: opts?.meta,
    payload,
  }
}

export function persistEvent<T>(ev: BaseEvent<T>): BaseEvent<T> | null {
  // idempotency per client
  if (ev.idempotencyKey) {
    const key = `${ev.clientId}::${ev.idempotencyKey}`
    if (idemp.has(key)) return null
    idemp.set(key, ev.id)
  }

  events.push(ev as PersistedEvent)
  if (events.length > EVENTS_MAX) {
    events.splice(0, events.length - EVENTS_MAX)
  }
  return ev
}

export function listEvents(filters: {
  clientId?: string
  name?: EventName
  limit?: number
} = {}): PersistedEvent[] {
  const { clientId, name, limit = 100 } = filters
  let out = events
  if (clientId) out = out.filter(e => e.clientId === clientId)
  if (name) out = out.filter(e => e.name === name)
  return out.slice(-limit).reverse()
}

export function broadcastEvent(
  io: { emit: (ch: string, payload: any) => void },
  ev: BaseEvent
) {
  try { io.emit('event', ev) } catch {}
}

export function recordAndEmit<T>(
  io: { emit: (ch: string, payload: any) => void },
  ev: BaseEvent<T>
): BaseEvent<T> | null {
  const saved = persistEvent(ev)
  if (saved) broadcastEvent(io, saved)
  return saved
}