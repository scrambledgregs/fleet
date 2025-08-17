// src/components/ContactsPanel.jsx
import { useEffect, useMemo, useState } from 'react'
import { User, Phone, Mail, MapPin, CalendarDays, ChevronDown } from 'lucide-react'
import JobDetails from './JobDetails'
import { API_BASE } from '../config'

// at top of ContactsPanel.jsx
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

export default function ContactsPanel() {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [expanded, setExpanded] = useState({}) // contactId -> bool
  const [apptsByContact, setApptsByContact] = useState({}) // contactId -> appointments[]

  const [openId, setOpenId] = useState(null)
  const [openSeed, setOpenSeed] = useState(null)

  // load contacts
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/contacts`)
        if (!r.ok) throw new Error('failed to load contacts')
        const j = await r.json()
        if (!alive) return
        setContacts(j.contacts || [])
      } catch (e) {
        if (!alive) return
        setError(e.message || 'load error')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  async function toggleContact(c) {
    setExpanded((s) => ({ ...s, [c.id]: !s[c.id] }))
    if (!apptsByContact[c.id]) {
      try {
        const r = await fetch(`${API_BASE}/api/contacts/${encodeURIComponent(c.id)}/appointments`)
        const j = await r.json()
        setApptsByContact((m) => ({ ...m, [c.id]: j.appointments || [] }))
      } catch {
        setApptsByContact((m) => ({ ...m, [c.id]: [] }))
      }
    }
  }

  const list = useMemo(() => contacts, [contacts])

  if (loading) return <div className="p-3 text-sm text-white/60">Loading contacts…</div>
  if (error) return <div className="p-3 text-sm text-red-400">{error}</div>

  return (
    <div className="space-y-3 overflow-auto" style={{ maxHeight: '70vh' }}>
      {openId && (
        <JobDetails
          jobId={openId}
          seed={openSeed}
          onClose={() => { setOpenId(null); setOpenSeed(null) }}
        />
      )}

      {list.length === 0 && (
        <div className="p-3 text-sm text-white/60">No contacts yet.</div>
      )}

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
              <div className="flex items-center gap-2">
                <User size={16} className="text-white/70" />
                <div className="font-semibold">{c.name || '—'}</div>
                {c.company && (
                  <Chip title="Company">{c.company}</Chip>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-white/70">
                {phones[0] && <Chip title="Primary phone"><Phone size={12} className="inline mr-1" />{phones[0]}</Chip>}
                {emails[0] && <Chip title="Primary email"><Mail size={12} className="inline mr-1" />{emails[0]}</Chip>}
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
                <ChevronDown
                  size={16}
                  className={'transition ' + (isOpen ? 'rotate-180 opacity-80' : 'opacity-50')}
                />
              </div>
            </button>

            {isOpen && (
              <div className="p-2 grid gap-2">
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
  )
}