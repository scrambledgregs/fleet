import { useEffect, useState } from 'react'
import { Phone, Mail, MapPin, Tag, Building2 } from 'lucide-react'
import { API_BASE } from '../config'

// ---- helper ----
function addrToString(a) {
  if (!a) return ''
  if (typeof a === 'string') return a
  const parts = [
    a.fullAddress,
    [a.address, a.city, a.state, a.postalCode].filter(Boolean).join(', ')
  ].filter(Boolean)
  return parts[0] || ''
}

function Row({ label, children }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <div className="min-w-24 text-white/60">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false)
  
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text || ''); setCopied(true); setTimeout(() => setCopied(false), 1000) }}
      className="px-1.5 py-1 text-[11px] rounded-none glass hover:bg-panel/70 transition ml-2"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export default function JobDetails({ jobId, seed, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
  (async () => {
    try {
      const r = await fetch(`${API_BASE}/api/job/${encodeURIComponent(jobId)}`);
      if (!r.ok) throw new Error('no job');

      const d = await r.json();

      // ✅ Merge: prefer API values, but fall back to seed, then to “now”
      setData({
        ...seed,
        ...d,
        startTime: d.startTime || seed?.startTime || new Date().toISOString(),
        endTime:
          d.endTime ||
          seed?.endTime ||
          new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
    } catch (e) {
      // ✅ Fallback: use seed times instead of “now”
      setData({
        appointmentId: jobId,
        address: seed?.address,
        lat: seed?.lat,
        lng: seed?.lng,
        startTime: seed?.startTime || new Date().toISOString(),
        endTime: seed?.endTime || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        jobType: seed?.jobType,
        estValue: seed?.estValue,
        territory: seed?.territory,
        contact: seed?.contact || {
          name: '—',
          emails: [],
          phones: [],
          address: null,
          tags: [],
          custom: {},
          pipeline: null,
        },
      });
    } finally {
      setLoading(false);
    }
  })();
}, [jobId, seed]);

  if (loading) return <div className="p-4 text-sm text-white/60">Loading…</div>
  if (!data) return <div className="p-4 text-sm text-white/60">Not found.</div>

  const c = data.contact || {}
  const jobAddr = addrToString(data.address)
  const contactAddr = addrToString(c.address)
  const showBoth = jobAddr && contactAddr && jobAddr !== contactAddr
 const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dStart = data?.startTime ? new Date(data.startTime) : new Date();
const dEnd   = data?.endTime   ? new Date(data.endTime)   : new Date(dStart.getTime() + 60*60*1000);

  const dateStr  = dStart.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: tz,
  });
  const startStr = dStart.toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', timeZone: tz,
  });
  const endStr   = dEnd.toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', timeZone: tz,
  });
  return (
    <div className="fixed inset-0 z-[500] flex">
      <div className="absolute inset-0 bg-black/60" onClick={onClose}></div>

      <aside className="ml-auto h-full w-full sm:w-[520px] glass rounded-none p-4 overflow-auto relative">
        <button onClick={onClose} className="absolute top-3 right-3 px-2 py-1 rounded-none glass hover:bg-panel/70 text-xs">Close</button>

        <div className="mb-3">
          <div className="text-xs text-white/60">Job</div>
          <div className="text-lg font-semibold">#{data.appointmentId}</div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div className="glass rounded-none p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-white/60">Contact</div>
                <div className="text-base font-semibold">{c.name || '—'}</div>
              </div>
              {c.company && (
                <div className="text-xs text-white/70 flex items-center gap-2"><Building2 size={14}/>{c.company}</div>
              )}
            </div>

            <div className="mt-3 space-y-2">
              <Row label="Phone">
                <div className="flex items-center gap-2 flex-wrap">
                  {(c.phones || []).length ? c.phones.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <a href={`tel:${p}`} className="text-white/90 hover:underline flex items-center gap-1"><Phone size={14}/>{p}</a>
                    </div>
                  )) : <span className="text-white/50">—</span>}
                </div>
              </Row>

              <Row label="Email">
                <div className="flex items-center gap-2 flex-wrap">
                  {(c.emails || []).length ? c.emails.map((e, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <a href={`mailto:${e}`} className="text-white/90 hover:underline flex items-center gap-1"><Mail size={14}/>{e}</a>
                    </div>
                  )) : <span className="text-white/50">—</span>}
                </div>
              </Row>

              <Row label="Address">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <MapPin size={14}/>
                    <span>{jobAddr || '—'}</span>
                  </div>

                  {showBoth && (
                    <div className="pl-6 text-xs text-white/70">
                      Contact Address: {contactAddr}
                    </div>
                  )}
                </div>
              </Row>

              {(c.tags || []).length > 0 && (
                <Row label="Tags">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {c.tags.map((t, i) => (<span key={i} className="px-1.5 py-0.5 rounded-none text-[11px] bg-white/10 flex items-center gap-1"><Tag size={12}/>{t}</span>))}
                  </div>
                </Row>
              )}

              {c.custom && Object.keys(c.custom).length > 0 && (
                <Row label="Custom">
                  <div className="space-y-1 text-xs">
                    {Object.entries(c.custom).map(([k, v]) => (<div key={k}><span className="text-white/60">{k}:</span> <span className="text-white/90">{String(v)}</span></div>))}
                  </div>
                </Row>
              )}

              {c.pipeline && (
                <Row label="Pipeline">
                  <div className="text-xs">{c.pipeline.name} → <span className="text-white/90">{c.pipeline.stage}</span></div>
                </Row>
              )}
            </div>
          </div>

          <div className="glass rounded-none p-3">
            <div className="text-xs text-white/60">Job</div>
            <div className="mt-1 text-sm">Type: <span className="text-white/90">{data.jobType}</span></div>
            <div className="mt-1 text-sm">Est. Value: <span className="text-white/90">${(data.estValue || 0).toLocaleString()}</span></div>
            <div className="mt-1 text-sm">Territory: <span className="text-white/90">{data.territory}</span></div>
<div className="mt-1 text-sm">
  Window: <span className="text-white/90">{dateStr}, {startStr} – {endStr}</span>
</div>          </div>
        </div>
      </aside>
    </div>
  )
}