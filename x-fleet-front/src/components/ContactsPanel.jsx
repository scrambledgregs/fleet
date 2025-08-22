// src/components/ContactsPanel.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  User, Phone, Mail, MapPin, CalendarDays, ChevronDown,
  MessageSquare, FileText, Plus
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import JobDetails from './JobDetails'
import { API_BASE } from '../config'

function Chip({ children, title, className = '' }) {
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

const normalizePhone = (p = '') => {
  let s = String(p).replace(/[^\d]/g, '')
  if (s.length === 10) s = '1' + s
  if (!s.startsWith('+')) s = '+' + s
  return s
}

export default function ContactsPanel({
  showToolbar = true,
  query: externalQuery,
  sortBy: externalSortBy,
  segment: externalSegment, // 'all' | 'customers' | 'leads'
}) {
  const navigate = useNavigate()

  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [expanded, setExpanded] = useState({})
  const [apptsByContact, setApptsByContact] = useState({})

  const [openId, setOpenId] = useState(null)
  const [openSeed, setOpenSeed] = useState(null)

  // internal (used only if not provided by parent)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('recent')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/contacts`)
        if (!r.ok) throw new Error('Failed to load contacts')
        const j = await r.json()
        if (!alive) return
        setContacts(j.contacts || [])
      } catch (e) {
        if (!alive) return
        setError(e.message || 'Load error')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  async function toggleContact(c) {
    setExpanded(s => ({ ...s, [c.id]: !s[c.id] }))
    if (!apptsByContact[c.id]) {
      try {
        const r = await fetch(`${API_BASE}/api/contacts/${encodeURIComponent(c.id)}/appointments`)
        const j = await r.json()
        setApptsByContact(m => ({ ...m, [c.id]: j.appointments || [] }))
      } catch {
        setApptsByContact(m => ({ ...m, [c.id]: [] }))
      }
    }
  }

  function openMessages(c) {
    const phone = (c.phones && c.phones[0]) || ''
    const threadId = c.id || (phone ? `manual:${normalizePhone(phone)}` : '')
    if (!threadId) return
    navigate(`/chatter/${encodeURIComponent(threadId)}`)
  }

  function openEstimator(c) {
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

  function openNewJob(c) {
    if (!c.id) return
    navigate(`/jobs/new?contactId=${encodeURIComponent(c.id)}`)
  }

  // derived list (uses external filters if provided)
  const list = useMemo(() => {
    const q = (externalQuery ?? query).trim().toLowerCase()
    const sb = externalSortBy ?? sortBy
    const seg = externalSegment ?? 'all'

    let arr = contacts

    // segment filter (support c.kind or c.type)
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
        ].filter(Boolean).join(' ').toLowerCase()
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
  }, [contacts, query, sortBy, externalQuery, externalSortBy, externalSegment])

  if (loading) return <div className="p-3 text-sm text-white/60">Loading contacts…</div>
  if (error)   return <div className="p-3 text-sm text-red-400">{error}</div>

  return (
    <div className="space-y-3">
      {/* Optional internal toolbar (hidden when page provides one) */}
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2 justify-between border border-white/10 rounded-xl bg-white/[0.035] p-2">
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, phone, email, address…"
              className="w-[min(52ch,70vw)] bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm"
              title="Sort contacts"
            >
              <option value="recent">Sort: Recent first</option>
              <option value="name">Sort: A → Z</option>
            </select>
          </div>
          <button
            className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10 inline-flex items-center gap-2"
            onClick={() => navigate('/contacts/new')}
            title="Create a new contact"
          >
            <Plus size={16} /> New Contact
          </button>
        </div>
      )}

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
            onClick={() => navigate('/contacts/new')}
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