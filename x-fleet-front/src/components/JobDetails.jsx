// src/components/JobDetails.jsx
import { useEffect, useState } from 'react'
import { Phone, Mail, MapPin, Tag, Building2 } from 'lucide-react'
import { API_BASE } from '../config'

// ---------- helpers ----------
function addrToString(a) {
  if (!a) return ''
  if (typeof a === 'string') return a
  const parts = [
    a.fullAddress || a.full_address,
    [a.address, a.city, a.state, a.postalCode].filter(Boolean).join(', '),
  ].filter(Boolean)
  return parts[0] || ''
}

// Unify contact shape (accept many possible field names)
function normalizeContact(raw = {}) {
  const id = raw.id ?? raw.contactId ?? raw._id ?? null

  const phonesArr = Array.isArray(raw.phones) ? raw.phones : []
  const extraPhones = [raw.phone, raw.mobile, raw.primaryPhone].filter(Boolean)
  const phones = [...phonesArr, ...extraPhones].filter(Boolean)

  const emailsArr = Array.isArray(raw.emails) ? raw.emails : []
  const extraEmails = [raw.email, raw.primaryEmail].filter(Boolean)
  const emails = [...emailsArr, ...extraEmails].filter(Boolean)

  return {
    id,
    name: raw.name ?? raw.fullName ?? raw.firstName ?? '—',
    company: raw.company || null,
    phones,
    emails,
    address: raw.address ?? null, // string or object; UI handles both
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    custom: raw.custom || {},
    pipeline: raw.pipeline || null,
  }
}

// Unify job shape; also pull contact fields from job root if present
function normalizeJob(d = {}, seed = {}) {
  const startTime = d.startTime || seed.startTime || new Date().toISOString()
  const endTime =
    d.endTime || seed.endTime || new Date(Date.now() + 3600000).toISOString()

  const contactFromRoot = {
    id: d.contactId ?? seed.contactId,
    name: d.contactName ?? seed.contactName,
    phone: d.phone ?? d.contactPhone ?? seed.phone,
    email: d.email ?? d.contactEmail ?? seed.email,
  }

  const contact = normalizeContact({ ...(d.contact || {}), ...contactFromRoot })

  return {
    appointmentId: d.appointmentId || d.id || seed.appointmentId || seed.id || '—',
    address: d.address ?? seed.address ?? null,
    lat: d.lat ?? seed.lat ?? null,
    lng: d.lng ?? seed.lng ?? null,
    jobType: d.jobType ?? seed.jobType ?? 'Job',
    estValue: d.estValue ?? seed.estValue ?? 0,
    territory: d.territory ?? seed.territory ?? '—',
    travelMinutesFromPrev:
      typeof d.travelMinutesFromPrev === 'number'
        ? d.travelMinutesFromPrev
        : typeof seed.travelMinutesFromPrev === 'number'
        ? seed.travelMinutesFromPrev
        : null,
    startTime,
    endTime,
    contact,
  }
}

function Row({ label, children }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <div className="min-w-24 text-white/60">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

// ---------- component ----------
export default function JobDetails({ jobId, seed, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [convo, setConvo] = useState({ loading: false, messages: null, error: null })

  // Load job; use the normalizer
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/job/${encodeURIComponent(jobId)}`)
        if (!r.ok) throw new Error('no job')
        const d = await r.json()
        if (!alive) return
        setData(normalizeJob(d, seed))
      } catch {
        if (!alive) return
        setData(normalizeJob({}, seed)) // fallback to seed
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [jobId, seed])

  async function openConversation() {
    const contactId = data?.contact?.id
    if (!contactId) {
      setConvo({ loading: false, messages: null, error: 'No contactId on this job.' })
      return
    }
    try {
      setConvo((s) => ({ ...s, loading: true, error: null }))

      // Try to find an existing conversation for contact
      const r1 = await fetch(
        `${API_BASE}/api/mock/ghl/contact/${encodeURIComponent(contactId)}/conversations`
      )
      const j1 = await r1.json()
      let convoId = j1?.conversations?.[0]?.id

      // If none, create one by sending a seed message
      if (!convoId) {
        const r2 = await fetch(`${API_BASE}/api/mock/ghl/send-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId,
            text: '(test) First message',
            direction: 'outbound',
          }),
        })
        const j2 = await r2.json()
        convoId = j2.conversationId
      }

      // Load its messages
      const r3 = await fetch(
        `${API_BASE}/api/mock/ghl/conversation/${encodeURIComponent(convoId)}/messages`
      )
      const j3 = await r3.json()
      setConvo({ loading: false, messages: j3.messages || [], error: null })
    } catch (e) {
      setConvo({
        loading: false,
        messages: null,
        error: e?.message || 'Failed to load conversation',
      })
    }
  }

  if (loading) return <div className="p-4 text-sm text-white/60">Loading…</div>
  if (!data) return <div className="p-4 text-sm text-white/60">Not found.</div>

  // ⬇️ Normalize the contact here so phones/emails are arrays
  const c = normalizeContact(data?.contact || {})

  const jobAddr = addrToString(data.address)
  const contactAddr = addrToString(c.address)
  const showBoth = jobAddr && contactAddr && jobAddr !== contactAddr

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const dStart = data.startTime ? new Date(data.startTime) : new Date()
  const dEnd = data.endTime ? new Date(data.endTime) : new Date(dStart.getTime() + 60 * 60 * 1000)

  const dateStr = dStart.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  })
  const startStr = dStart.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  })
  const endStr = dEnd.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  })

  const travelMinutes =
    typeof data.travelMinutesFromPrev === 'number' ? data.travelMinutesFromPrev : null

  return (
    <div className="fixed inset-0 z-[500] flex">
      <div className="absolute inset-0 bg-black/60" onClick={onClose}></div>

      <aside className="ml-auto h-full w-full sm:w-[520px] glass rounded-none p-4 overflow-auto relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 px-2 py-1 rounded-none glass hover:bg-panel/70 text-xs"
        >
          Close
        </button>

        <div className="mb-3">
          <div className="text-xs text-white/60">Job</div>
          <div className="text-lg font-semibold">#{data.appointmentId}</div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {/* Contact */}
          <div className="glass rounded-none p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-white/60">Contact</div>
                <div className="text-base font-semibold">{c.name || '—'}</div>
              </div>
              <div className="flex items-center gap-2">
                {c.company && (
                  <div className="text-xs text-white/70 flex items-center gap-2">
                    <Building2 size={14} />
                    {c.company}
                  </div>
                )}
                <button
                  onClick={openConversation}
                  disabled={!c.id}
                  className={`px-2 py-1 rounded-none glass text-xs ${
                    c.id ? 'hover:bg-panel/70' : 'opacity-50 cursor-not-allowed'
                  }`}
                  title={c.id ? 'Open conversation' : 'No contact ID'}
                >
                  View Conversation
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <Row label="Phone">
                <div className="flex items-center gap-2 flex-wrap">
                  {c.phones?.length ? (
                    c.phones.map((p, i) => (
                      <a
                        key={i}
                        href={`tel:${p}`}
                        className="text-white/90 hover:underline flex items-center gap-1"
                      >
                        <Phone size={14} />
                        {p}
                      </a>
                    ))
                  ) : (
                    <span className="text-white/50">—</span>
                  )}
                </div>
              </Row>

              <Row label="Email">
                <div className="flex items-center gap-2 flex-wrap">
                  {c.emails?.length ? (
                    c.emails.map((e, i) => (
                      <a
                        key={i}
                        href={`mailto:${e}`}
                        className="text-white/90 hover:underline flex items-center gap-1"
                      >
                        <Mail size={14} />
                        {e}
                      </a>
                    ))
                  ) : (
                    <span className="text-white/50">—</span>
                  )}
                </div>
              </Row>

              <Row label="Address">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <MapPin size={14} />
                    <span>{jobAddr || contactAddr || '—'}</span>
                  </div>
                  {showBoth && (
                    <div className="pl-6 text-xs text-white/70">Contact Address: {contactAddr}</div>
                  )}
                </div>
              </Row>

              {!!c.tags?.length && (
                <Row label="Tags">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {c.tags.map((t, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 rounded-none text-[11px] bg-white/10 flex items-center gap-1"
                      >
                        <Tag size={12} />
                        {t}
                      </span>
                    ))}
                  </div>
                </Row>
              )}

              {!!c.custom && Object.keys(c.custom).length > 0 && (
                <Row label="Custom">
                  <div className="space-y-1 text-xs">
                    {Object.entries(c.custom).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-white/60">{k}:</span>{' '}
                        <span className="text-white/90">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </Row>
              )}

              {c.pipeline && (
                <Row label="Pipeline">
                  <div className="text-xs">
                    {c.pipeline.name} → <span className="text-white/90">{c.pipeline.stage}</span>
                  </div>
                </Row>
              )}

              {convo.loading && (
                <div className="mt-3 text-xs text-white/60">Loading conversation…</div>
              )}
              {convo.error && <div className="mt-3 text-xs text-red-400">{convo.error}</div>}
              {Array.isArray(convo.messages) && (
                <div className="mt-3 border-t border-white/10 pt-2">
                  <div className="text-xs text-white/60 mb-1">Conversation</div>
                  <div className="space-y-1 max-h-40 overflow-auto pr-1">
                    {convo.messages.length === 0 && (
                      <div className="text-xs text-white/50">No messages yet.</div>
                    )}
                    {convo.messages.map((m) => (
                      <div key={m.id} className="text-xs">
                        <span className="text-white/50">
                          {new Date(m.createdAt).toLocaleString()} • {m.direction}
                        </span>
                        <div className="text-white/90">
                          {m.text || <span className="text-white/50">(no text)</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Job */}
          <div className="glass rounded-none p-3">
            <div className="text-xs text-white/60">Job</div>
            <div className="mt-1 text-sm">
              Type: <span className="text-white/90">{data.jobType}</span>
            </div>
            <div className="mt-1 text-sm">
              Est. Value:{' '}
              <span className="text-white/90">
                {new Intl.NumberFormat(undefined, {
                  style: 'currency',
                  currency: 'USD',
                  maximumFractionDigits: 0,
                }).format(Number(data.estValue || 0))}
              </span>
            </div>
            <div className="mt-1 text-sm">
              Territory: <span className="text-white/90">{data.territory}</span>
            </div>
            <div className="mt-1 text-sm">
              Window:{' '}
              <span className="text-white/90">
                {dateStr}, {startStr} – {endStr}
              </span>
            </div>
            {travelMinutes != null && (
              <div className="mt-1 text-sm">
                Travel from previous: <span className="text-white/90">{travelMinutes} min</span>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}