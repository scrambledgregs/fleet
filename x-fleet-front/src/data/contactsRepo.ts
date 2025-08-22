// src/data/contactsRepo.ts
export type DispositionEntry = {
  key: string
  label: string
  note?: string
  at: string
}

export type ContactSummary = {
  id: string
  name: string
  company?: string | null
  phones: string[]
  emails: string[]
  address?: string | null
  tags: string[]
  kind?: string
  lastAppointmentAt?: string | null
  appointments?: number
  lastDisposition?: DispositionEntry | null
  dispositions?: DispositionEntry[]
}

type Bag = Map<string, ContactSummary>    // contactId -> summary
const contactsByClient = new Map<string, Bag>() // clientId -> Bag

function bag(clientId = 'default'): Bag {
  if (!contactsByClient.has(clientId)) contactsByClient.set(clientId, new Map())
  return contactsByClient.get(clientId)!
}

export const contactsRepo = {
  list(clientId = 'default'): ContactSummary[] {
    return Array.from(bag(clientId).values())
  },

  get(clientId = 'default', id: string): ContactSummary | undefined {
    return bag(clientId).get(id)
  },

  // Accept partials but require id; merge then normalize to avoid duplicate-key warnings
  upsert(clientId = 'default', c: Partial<ContactSummary> & { id: string }): ContactSummary {
    const b = bag(clientId)
    const prev = b.get(c.id)

    const merged: ContactSummary = {
      ...(prev || ({} as ContactSummary)),
      ...(c as ContactSummary),
    }

    // Normalize defaults (only if missing/undefined)
    if (!Array.isArray(merged.tags)) merged.tags = []
    if (!Array.isArray(merged.phones)) merged.phones = []
    if (!Array.isArray(merged.emails)) merged.emails = []
    if (!Array.isArray(merged.dispositions)) merged.dispositions = []
    if (merged.lastDisposition === undefined) merged.lastDisposition = null
    if (merged.lastAppointmentAt === undefined) merged.lastAppointmentAt = null
    if (typeof merged.appointments !== 'number') merged.appointments = 0

    b.set(merged.id, merged)
    return merged
  },

  addDisposition(clientId = 'default', id: string, entry: Omit<DispositionEntry, 'at'>) {
    const b = bag(clientId)
    const row = b.get(id)
    if (!row) return undefined

    const d: DispositionEntry = { ...entry, at: new Date().toISOString() }
    if (!Array.isArray(row.dispositions)) row.dispositions = []
    row.dispositions.push(d)
    row.lastDisposition = d

    b.set(id, row)
    return d
  },
}