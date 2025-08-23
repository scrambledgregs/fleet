// src/components/JobDetails.jsx
import { useEffect, useMemo, useState } from 'react'
import { Phone, Mail, MapPin, Tag, Building2 } from 'lucide-react'
import { API_BASE } from '../config'
import { Link } from 'react-router-dom'
import JobMessages from './JobMessages'
import { getTenantId, withTenant } from '../lib/socket'

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

function normalizeContact(raw = {}) {
  const id = raw.id ?? raw.contactId ?? raw._id ?? null

  const phonesArr = Array.isArray(raw.phones) ? raw.phones : []
  const extraPhones = [raw.phone, raw.mobile, raw.primaryPhone].filter(Boolean)
  const phones = [...phonesArr, ...extraPhones]
    .filter(Boolean)
    .map(String)

  const emailsArr = Array.isArray(raw.emails) ? raw.emails : []
  const extraEmails = [
    raw.email,
    raw.primaryEmail,
    raw.contactEmail,
    raw.primary_email,
  ].filter(Boolean)
  const emails = [...emailsArr, ...extraEmails]
    .filter(Boolean)
    .map(e => String(e).trim())

  return {
    id,
    name: raw.name ?? raw.fullName ?? raw.firstName ?? '—',
    company: raw.company || null,
    phones: Array.from(new Set(phones)),
    emails: Array.from(new Set(emails)),
    address: raw.address ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    custom: raw.custom || {},
    pipeline: raw.pipeline || null,
  }
}

// Unify job shape; also pull contact fields from job root if present
function normalizeJob(raw = {}, seed = {}) {
  const d = raw?.items ?? raw

  const startTime = d.startTime || seed.startTime || new Date().toISOString()
  const endTime = d.endTime || seed.endTime || new Date(Date.now() + 3600000).toISOString()

  // Pull any stray contact fields off the root/seed/customer
  const contactFromRoot = {
    id: d.contactId ?? seed.contactId,
    name: d.contactName ?? seed.contactName,
    phone: d.phone ?? d.contactPhone ?? seed.phone,
    email:
      d.email ??
      d.contactEmail ??
      seed.email ??
      seed.contactEmail ??
      d?.customer?.email ??
      d?.customer?.primaryEmail,
  }

  const seedC = seed?.contact || {}
  const dc = d.contact || {}
  const cust = d.customer || {}

  const merged = {
    id: dc.id ?? seedC.id ?? contactFromRoot.id ?? cust.id ?? null,
    name: dc.name ?? seedC.name ?? contactFromRoot.name ?? cust.name ?? '—',
    company: dc.company ?? seedC.company ?? cust.company ?? null,
    address: dc.address ?? seedC.address ?? cust.address ?? null,
    phones: [
      ...(Array.isArray(seedC.phones) ? seedC.phones : []),
      ...(Array.isArray(dc.phones) ? dc.phones : []),
      cust.phone,
      cust.mobile,
      contactFromRoot.phone,
    ],
    emails: [
      ...(Array.isArray(seedC.emails) ? seedC.emails : []),
      ...(Array.isArray(dc.emails) ? dc.emails : []),
      cust.email,
      cust.primaryEmail,
      contactFromRoot.email,
    ],
    tags: [
      ...(Array.isArray(seedC.tags) ? seedC.tags : []),
      ...(Array.isArray(dc.tags) ? dc.tags : []),
    ],
    custom: { ...(seedC.custom || {}), ...(dc.custom || {}) },
    pipeline: dc.pipeline ?? seedC.pipeline ?? null,
  }

  const contact = normalizeContact(merged)

  return {
    appointmentId: d.appointmentId || d.id || seed.appointmentId || seed.id || '—',
    address: d.address ?? seed.address ?? null,
    lat: d.lat ?? seed.lat ?? null,
    lng: d.lng ?? seed.lng ?? null,
    jobType: d.jobType ?? seed.jobType ?? 'Job',
    estValue: d.estValue ?? seed.estValue ?? 0,
    territory: d.territory ?? seed.territory ?? '—',
    assignedUserId: d.assignedUserId ?? seed.assignedUserId ?? null,
    assignedRepName: d.assignedRepName ?? seed.assignedRepName ?? null,
    travelMinutesFromPrev:
      typeof d.travelMinutesFromPrev === 'number'
        ? d.travelMinutesFromPrev
        : typeof seed.travelMinutesFromPrev === 'number'
        ? seed.travelMinutesFromPrev
        : null,
    startTime,
    endTime,
    contact,
    // keep common root fields around for fallback rendering if needed
    email: contactFromRoot.email ?? null,
    contactEmail: d.contactEmail ?? null,
  }
}

function Row({ label, children }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <div className="w-24 shrink-0 text-white/60">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

// ---------- component ----------
export default function JobDetails({ jobId, seed, onClose }) {
  const tenantId = useMemo(() => getTenantId(), [])
  const API_HTTP_BASE = `${API_BASE}`.endsWith('/api') ? API_BASE : `${API_BASE}/api`

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  // --- editing + save ---
  const [saving, setSaving] = useState(false)
  const [editStart, setEditStart] = useState(null)
  const [editEnd, setEditEnd] = useState(null)
  const [editAssignee, setEditAssignee] = useState('')

  // load the job (or seed fallback)
  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        setLoading(true)

        if (!jobId) {
          if (alive) setData(normalizeJob({}, seed))
          return
        }

        const url = new URL(`${API_HTTP_BASE}/job/${encodeURIComponent(jobId)}`)
        url.searchParams.set('clientId', tenantId)

        const r = await fetch(url.toString(), withTenant())
        if (!r.ok) throw new Error('no job')
        const d = await r.json()
        if (!alive) return

        const payload = d?.items ?? d
        if (alive) setData(normalizeJob(payload, seed))
      } catch {
        if (!alive) return
        setData(normalizeJob({}, seed))
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [jobId, seed, tenantId, API_HTTP_BASE])

  // seed edit controls once data is available
  useEffect(() => {
    if (!data) return
    if (editStart === null) setEditStart(data.startTime || null)
    if (editEnd === null) setEditEnd(data.endTime || null)
    if (editAssignee === '') {
      setEditAssignee(data.assignedUserId != null ? String(data.assignedUserId) : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  async function saveChanges() {
    const id = jobId || seed?.appointmentId || seed?.id || data?.appointmentId
    if (!id) return

    const payload = { clientId: tenantId }
    if (editStart) payload.startTime = editStart
    if (editEnd) payload.endTime = editEnd
    if (editAssignee) payload.assignedUserId = String(editAssignee)

    try {
      setSaving(true)
      await fetch(`${API_HTTP_BASE}/jobs/${encodeURIComponent(id)}`, withTenant({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }))
      setData(prev =>
        prev
          ? {
              ...prev,
              startTime: payload.startTime ?? prev.startTime,
              endTime: payload.endTime ?? prev.endTime,
              assignedUserId: payload.assignedUserId ?? prev.assignedUserId,
            }
          : prev
      )
      onClose?.()
    } catch (e) {
      console.error('Save failed', e)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-4 text-sm text-white/60">Loading…</div>
  if (!data) return <div className="p-4 text-sm text-white/60">Not found.</div>

  const assignedUserId = data?.assignedUserId ?? null
  const assignedRepName = data?.assignedRepName ?? null

  const c = normalizeContact(data?.contact || {})
  const jobAddr = addrToString(data.address)
  const contactAddr = addrToString(c.address)
  const showBoth = jobAddr && contactAddr && jobAddr !== contactAddr

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const dStart = data.startTime ? new Date(data.startTime) : new Date()
  const dEnd = data.endTime ? new Date(data.endTime) : new Date(dStart.getTime() + 60 * 60 * 1000)

  const startStr = dStart.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz })
  const endStr = dEnd.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz })

  const travelMinutes = typeof data.travelMinutesFromPrev === 'number' ? data.travelMinutesFromPrev : null

  // --- Email fallback if array is empty but a single email exists somewhere else
  const arrayEmails = Array.isArray(c.emails) ? c.emails.filter(Boolean) : []
  const singleFallbackEmail =
    data?.contactEmail ||
    data?.email ||
    (data?.contact && (data.contact.email || data.contact.primaryEmail || data.contact.contactEmail)) ||
    null
  const effectiveEmails = arrayEmails.length ? arrayEmails : (singleFallbackEmail ? [singleFallbackEmail] : [])

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
          <Link
            to={`/calendar?clientId=${encodeURIComponent(tenantId)}&date=${encodeURIComponent(data.startTime)}&assigned=${encodeURIComponent(assignedUserId ?? '')}&id=${encodeURIComponent(data.appointmentId)}`}
            onClick={onClose}
            className="ml-2 text-xs underline text-blue-400 hover:text-blue-300"
          >
            View on Calendar
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {/* Messages for this job’s contact */}
          <JobMessages jobId={jobId} />

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

                <Link
                  to={c.id ? `/chatter/${encodeURIComponent(c.id)}?clientId=${encodeURIComponent(tenantId)}` : '#'}
                  onClick={(e) => {
                    if (!c.id) { e.preventDefault(); return }
                    onClose?.()
                  }}
                  className={`px-2 py-1 rounded-none glass text-xs ${
                    c.id ? 'hover:bg-panel/70' : 'opacity-50 pointer-events-none'
                  }`}
                  title={c.id ? 'Open conversation' : 'No contact ID'}
                >
                  View Conversation
                </Link>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <Row label="Phone">
                <div className="flex items-center gap-2 flex-wrap">
                  {c.phones?.length ? (
                    c.phones.map((p, i) => (
                      <a key={i} href={`tel:${p}`} className="text-white/90 hover:underline flex items-center gap-1">
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
                  {effectiveEmails.length ? (
                    effectiveEmails.map((em, i) => (
                      <a
                        key={i}
                        href={`mailto:${em}`}
                        className="text-white/90 hover:underline flex items-center gap-1"
                      >
                        <Mail size={14} />
                        {em}
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
                      <span key={i} className="px-1.5 py-0.5 rounded-none text-[11px] bg-white/10 flex items-center gap-1">
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

            {/* Editable fields */}
            <div className="mt-3 grid sm:grid-cols-2 gap-2">
              <label className="text-xs text-white/70">
                Start
                <input
                  type="datetime-local"
                  className="mt-1 w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none"
                  value={editStart ? new Date(editStart).toISOString().slice(0, 16) : ''}
                  onChange={(e) => {
                    const iso = new Date(e.target.value).toISOString()
                    setEditStart(iso)
                  }}
                />
              </label>

              <label className="text-xs text-white/70">
                End
                <input
                  type="datetime-local"
                  className="mt-1 w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none"
                  value={editEnd ? new Date(editEnd).toISOString().slice(0, 16) : ''}
                  onChange={(e) => {
                    const iso = new Date(e.target.value).toISOString()
                    setEditEnd(iso)
                  }}
                />
              </label>
            </div>

            <label className="mt-2 block text-xs text-white/70">
              Assigned User ID
              <input
                type="text"
                className="mt-1 w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none"
                placeholder="e.g. 123"
                value={editAssignee}
                onChange={(e) => setEditAssignee(e.target.value)}
              />
            </label>

            {/* Read-only helpers */}
            <div className="mt-2 text-sm">
              Assigned to:{' '}
              <span className="text-white/90">
                {assignedRepName ?? (assignedUserId ? `#${assignedUserId}` : 'Unassigned')}
              </span>
            </div>

            {travelMinutes != null && (
              <div className="mt-1 text-sm">
                Travel from previous: <span className="text-white/90">{travelMinutes} min</span>
              </div>
            )}

            {/* Actions */}
            <div className="mt-3 flex gap-2">
              <button
                onClick={saveChanges}
                disabled={saving}
                className="px-3 py-2 rounded-none glass hover:bg-panel/70 text-sm"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={onClose}
                className="px-3 py-2 rounded-none glass hover:bg-panel/70 text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}