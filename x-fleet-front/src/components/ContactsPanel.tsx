// x-fleet-front/src/components/ContactsPanel.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  User, Phone, Mail, MapPin, CalendarDays, ChevronDown,
  MessageSquare, FileText, Plus, Info
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import JobDetails from './JobDetails'
import DispositionButton from './DispositionButton'
import { API_BASE } from '../config'

type DispositionEntry = {
  key: string
  label: string
  note?: string
  at: string
}

type ContactRecord = {
  id: string
  name?: string
  company?: string
  phones?: string[]
  emails?: string[]
  address?: string
  kind?: string
  type?: string
  lastAppointmentAt?: string
  appointments?: number
  // server-reflected extras
  lastDisposition?: DispositionEntry | null
  dispositions?: DispositionEntry[]
}

type Appointment = {
  appointmentId: string
  address?: string
  startTime?: string
  endTime?: string
  jobType?: string
  estValue?: number
  territory?: string
}

type Counts = { all: number; customers: number; leads: number }

type ContactsPanelProps = {
  query?: string
  sortBy?: 'recent' | 'name'
  segment?: 'all' | 'customers' | 'leads'
  onCreateContact?: () => void
  /** optional: render a toolbar (unused here but accepted to avoid prop errors) */
  showToolbar?: boolean
  /** notify parent with counts derived from the full contacts list */
  onCounts?: (c: Counts) => void
}

function Chip({
  children,
  title,
  className = '',
}: {
  children: React.ReactNode
  title?: string
  className?: string
}) {
  return (
    <span
      title={title}
      className={[
        'inline-flex items-center gap-1 text-[11px] px-2 py-1',
        'rounded-lg bg-white/10 text-white/80',
        'whitespace-nowrap overflow-hidden text-ellipsis',
        className,
      ].join(' ')}
    >
      {children}
    </span>
  )
}

const normalizePhone = (p: string = ''): string => {
  let s = String(p).replace(/[^\d]/g, '')
  if (s.length === 10) s = '1' + s
  if (!s.startsWith('+')) s = '+' + s
  return s
}

// Coerce any payload into a valid DispositionEntry
function normalizeDispo(d: any): DispositionEntry {
  return {
    key: d?.key ?? d?.value ?? 'unknown',
    label: d?.label ?? d?.text ?? String(d?.key ?? 'Disposition'),
    note: d?.note ?? undefined,
    at: d?.at ?? new Date().toISOString(),
  }
}

function computeCounts(rows: ContactRecord[]): Counts {
  const out: Counts = { all: rows.length, customers: 0, leads: 0 }
  for (const r of rows) {
    const kind = (r.kind || r.type || '').toString().toLowerCase()
    if (kind.includes('customer')) out.customers++
    if (kind.includes('lead')) out.leads++
  }
  return out
}

export default function ContactsPanel({
  query: externalQuery = '',
  sortBy: externalSortBy = 'recent',
  segment: externalSegment = 'all',
  onCreateContact,
  showToolbar, // accepted but not used yet
  onCounts,
}: ContactsPanelProps) {
  const navigate = useNavigate()

  const [contacts, setContacts] = useState<ContactRecord[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [apptsByContact, setApptsByContact] = useState<Record<string, Appointment[]>>({})

  const [openId, setOpenId] = useState<string | null>(null)
  const [openSeed, setOpenSeed] = useState<any>(null)

  // Keep latest onCounts without making it a dependency
  const onCountsRef = useRef<typeof onCounts>(onCounts)
  useEffect(() => { onCountsRef.current = onCounts }, [onCounts])

  // Fetch once on mount
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/contacts`)
        if (!r.ok) throw new Error('Failed to load contacts')
        const j = await r.json()
        if (!alive) return
        const rows = (j.contacts || []) as ContactRecord[]
        setContacts(rows)
        // push counts up to parent (via ref)
        onCountsRef.current?.(computeCounts(rows))
      } catch (e: any) {
        if (!alive) return
        setError(e?.message || 'Load error')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // If contacts change later, keep counts fresh
  useEffect(() => {
    if (!loading && !error) onCountsRef.current?.(computeCounts(contacts))
  }, [contacts, loading, error])

  async function toggleContact(c: ContactRecord) {
    setExpanded(s => ({ ...s, [c.id]: !s[c.id] }))
    if (!apptsByContact[c.id]) {
      try {
        const r = await fetch(`${API_BASE}/api/contacts/${encodeURIComponent(c.id)}/appointments`)
        const j = await r.json()
        setApptsByContact(m => ({ ...m, [c.id]: (j.appointments || []) as Appointment[] }))
      } catch {
        setApptsByContact(m => ({ ...m, [c.id]: [] }))
      }
    }
  }

  function openMessages(c: ContactRecord) {
    const phone = (c.phones && c.phones[0]) || ''
    const threadId = c.id || (phone ? `manual:${normalizePhone(phone)}` : '')
    if (!threadId) return
    navigate(`/chatter/${encodeURIComponent(threadId)}`)
  }

  function openEstimator(c: ContactRecord) {
    localStorage.setItem('estimatorPrefill', JSON.stringify({
      contact: {
        id: c.id,
        name: c.name || '',
        phone: (c.phones && c.phones[0]) || '',
        email: (c.emails && c.emails[0]) || '',
        address: c.address || '',
      },
    }))
    navigate('/estimator?pack=general')
  }

  function openNewJob(c: ContactRecord) {
    if (!c.id) return
    navigate(`/jobs/new?contactId=${encodeURIComponent(c.id)}`)
  }

  // derived list (uses parent-provided filters only)
  const list = useMemo(() => {
    const q = externalQuery.trim().toLowerCase()
    const sb = externalSortBy
    const seg = externalSegment

    let arr = contacts

    if (seg !== 'all') {
      arr = arr.filter(c => {
        const kind = (c.kind || c.type || '').toString().toLowerCase()
        if (seg === 'customers') return kind.includes('customer')
        if (seg === 'leads') return kind.includes('lead')
        return true
      })
    }

    if (q) {
      arr = arr.filter(c => {
        const hay = [
          c.name,
          c.company,
          ...(c.phones || []),
          ...(c.emails || []),
          c.address,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
    }

    if (sb === 'name') {
      arr = [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    } else {
      arr = [...arr].sort((a, b) => {
        const atA = a.lastAppointmentAt ? new Date(a.lastAppointmentAt).getTime() : 0
        const atB = b.lastAppointmentAt ? new Date(b.lastAppointmentAt).getTime() : 0
        if (atA !== atB) return atB - atA
        return (a.name || '').localeCompare(b.name || '')
      })
    }
    return arr
  }, [contacts, externalQuery, externalSortBy, externalSegment])

  if (loading) return <div className="p-3 text-sm text-white/60">Loading contacts…</div>
  if (error)   return <div className="p-3 text-sm text-red-400">{error}</div>

  return (
    <div className="space-y-3">
      {/* Job modal */}
      {openId && (
        <JobDetails
          jobId={openId}
          seed={openSeed}
          onClose={() => { setOpenId(null); setOpenSeed(null) }}
        />
      )}

      {/* Empty state */}
      {list.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-white/70">
          <div className="text-sm">No contacts.</div>
          <button
            className="mt-3 px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10 inline-flex items-center gap-2"
            onClick={onCreateContact || (() => navigate('/contacts/new'))}
          >
            <Plus size={16} /> Add your first contact
          </button>
        </div>
      )}

      {/* List */}
      <div className="space-y-3 overflow-auto" style={{ maxHeight: '70vh' }}>
        {list.map((c) => {
          const phones = c.phones || []
          const emails = c.emails || []
          const lastAt = c.lastAppointmentAt ? new Date(c.lastAppointmentAt) : null
          const appts = apptsByContact[c.id] || []
          const isOpen = !!expanded[c.id]

          const dispoTitle = c.lastDisposition
            ? `${c.lastDisposition.label}${c.lastDisposition.note ? ` — ${c.lastDisposition.note}` : ''}\n${new Date(c.lastDisposition.at).toLocaleString()}`
            : undefined

          return (
            <div key={c.id} className="rounded-xl border border-white/10 overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-white/10"
                onClick={() => toggleContact(c)}
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <User size={16} className="text-white/70 shrink-0" />
                  <div className="font-semibold truncate">{c.name || '—'}</div>
                  {c.company && <Chip title="Company">{c.company}</Chip>}

                  {/* Disposition badge */}
                  {c.lastDisposition && (
                    <Chip
                      title={dispoTitle}
                      className="bg-amber-500/15 text-amber-300 border border-amber-400/20"
                    >
                      <Info size={12} className="opacity-80" />
                      {c.lastDisposition.label}
                    </Chip>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-white/70">
                  {phones[0] && (
                    <Chip title="Primary phone">
                      <Phone size={12} className="inline mr-1" />
                      {phones[0]}
                    </Chip>
                  )}
                  {emails[0] && (
                    <Chip title="Primary email">
                      <Mail size={12} className="inline mr-1" />
                      {emails[0]}
                    </Chip>
                  )}
                  {c.address && (
                    <Chip title="Address" className="max-w-[260px]">
                      <MapPin size={12} className="inline mr-1" />
                      {c.address}
                    </Chip>
                  )}
                  {lastAt && (
                    <Chip title="Last appointment">
                      <CalendarDays size={12} className="inline mr-1" />
                      {lastAt.toLocaleDateString()}
                    </Chip>
                  )}
                  <Chip title="Appointment count">{c.appointments || 0} appt(s)</Chip>
                  <ChevronDown size={16} className={'transition ' + (isOpen ? 'rotate-180 opacity-80' : 'opacity-50')} />
                </div>
              </button>

              {isOpen && (
                <div className="p-2 grid gap-2">
                  {/* Quick actions */}
                  <div className="flex flex-wrap items-center gap-2 px-1">
                    <button
                      className="px-2 py-1 text-xs rounded-none border border-white/15 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
                      onClick={() => openMessages(c)}
                      title="Open messages"
                    >
                      <MessageSquare size={14} /> Message
                    </button>
                    <button
                      className="px-2 py-1 text-xs rounded-none border border-white/15 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
                      onClick={() => openEstimator(c)}
                      title="Create estimate"
                    >
                      <FileText size={14} /> Estimate
                    </button>
                    <button
                      className="px-2 py-1 text-xs rounded-none border border-white/15 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
                      onClick={() => openNewJob(c)}
                      title="Create job"
                    >
                      <Plus size={14} /> New Job
                    </button>

                    {/* Disposition */}
                    <DispositionButton
                      contactId={c.id}
                      onDispo={(payload) => {
                        const d = normalizeDispo(payload)
                        setContacts(prev =>
                          prev.map(row =>
                            row.id === c.id
                              ? {
                                  ...row,
                                  lastDisposition: d,
                                  dispositions: [...(row.dispositions || []), d],
                                }
                              : row
                          )
                        )
                      }}
                    />
                  </div>

                  {/* Appointments */}
                  {appts.length === 0 && (
                    <div className="px-2 py-1 text-xs text-white/60">No appointments for this contact.</div>
                  )}
                  {appts.map((a) => {
                    const t = a.startTime ? new Date(a.startTime) : null
                    const when = t
                      ? `${t.toLocaleDateString()} • ${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                      : '—'
                    return (
                      <div
                        key={a.appointmentId}
                        className="glass rounded-xl p-2 text-sm cursor-pointer hover:bg-white/[0.06]"
                        onClick={() => {
                          setOpenId(a.appointmentId)
                          setOpenSeed({
                            id: a.appointmentId,
                            appointmentId: a.appointmentId,
                            address: a.address,
                            startTime: a.startTime,
                            endTime: a.endTime,
                            jobType: a.jobType,
                            estValue: a.estValue,
                            territory: a.territory,
                            contact: c,
                          })
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium">{a.jobType || 'Appointment'}</div>
                          <div className="text-xs text-white/70">{when}</div>
                        </div>
                        <div className="text-xs text-white/80 mt-1 flex items-center gap-1">
                          <MapPin size={12} className="opacity-70" />
                          <span className="truncate">{a.address || '—'}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}