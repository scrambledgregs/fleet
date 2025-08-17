import { Phone, MapPin, Wrench, Search, Package } from 'lucide-react'
import { useMemo } from 'react'

function formatUSD(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0)
}

// Parse anything: 35000, "35000", "35,000", "$35,000", etc.
function toNumberLoose(v) {
  if (v == null) return 0
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^0-9.-]/g, '')
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

export default function JobCard({
  job,
  paydayThreshold = 2500,
  onClick,
  onMapClick,
}) {
  const value = useMemo(() => {
    // Try common locations, then fallback to job.estValue
    const raw =
      job?.estValue ??
      job?.est_value ??
      job?.estimate ??
      job?.custom?.estValue ??
      job?.custom?.estimate ??
      0
    return toNumberLoose(raw)
  }, [job])

  const isPayday = value >= (Number(paydayThreshold) || 0)

  const travelMin =
    typeof job?.travelMinutesFromPrev === 'number'
      ? job.travelMinutesFromPrev
      : null

  const travelColor =
    travelMin == null
      ? 'bg-white/10 text-white/70'
      : travelMin < 10
      ? 'bg-green-500/20 text-green-300'
      : travelMin < 30
      ? 'bg-yellow-500/20 text-yellow-300'
      : 'bg-red-500/20 text-red-300'

  const TypeIcon =
    job?.jobType === 'Inspection' ? Search : job?.jobType === 'Install' ? Package : Wrench

  // Uncomment for a quick sanity check in the browser console:
  // console.debug('JobCard value check:', { id: job?.id, estValue: job?.estValue, parsed: value, threshold: paydayThreshold })

  return (
    <div
      className={[
        'glass rounded-xl p-3 cursor-pointer transition',
        isPayday ? 'ring-2 ring-yellow-400/70' : 'ring-1 ring-white/10',
        'hover:translate-y-[-1px] hover:ring-white/30',
      ].join(' ')}
      onClick={onClick}
      role="button"
      aria-label={`Open job ${job?.id}`}
    >
      {/* top row: date/time + badges */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-white/60">
          {job?.day} • {job?.dateText} • {job?.time}
        </div>
        <div className="flex items-center gap-1">
          {job?.territory && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/70">
              {job.territory}
            </span>
          )}
          {isPayday && (
            <span
              title={`At or above ${formatUSD(paydayThreshold)}`}
              className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-400/20 text-yellow-200"
            >
              💰 Potential Payday
            </span>
          )}
        </div>
      </div>

      {/* title row */}
      <div className="mt-2 flex items-center gap-2">
        <TypeIcon size={16} className="text-white/80" />
        <div className="font-semibold text-white/90 truncate">
          {job?.jobType || 'Job'}
        </div>
        <div className="ml-auto text-sm">{formatUSD(value)}</div>
      </div>

      {/* address */}
      <div className="mt-1 flex items-start gap-1.5 text-sm text-white/80">
        <MapPin size={14} className="mt-0.5 opacity-70" />
        <span className="line-clamp-2">{job?.address || '—'}</span>
      </div>

      {/* chips */}
      <div className="mt-2 flex items-center gap-2">
        <span className={`text-xs px-2 py-1 rounded ${travelColor}`}>
          {travelMin == null ? 'No prior travel' : `Travel +${travelMin}m`}
        </span>

        {typeof job?.fitScore === 'number' && (
          <span className="text-xs px-2 py-1 rounded bg-white/10 text-white/80">
            ⚡ Fit {job.fitScore.toFixed(1)}
          </span>
        )}
      </div>

      {/* footer */}
      <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2">
        <div className="text-xs text-white/70 truncate">
          {job?.contact?.name || '—'}
        </div>
        <div className="flex items-center gap-2">
          {job?.contact?.phones?.[0] && (
            <a
              href={`tel:${job.contact.phones[0]}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/20"
            >
              <Phone size={12} /> Call
            </a>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (onMapClick) onMapClick(job)
              else if (job?.address) {
                const q = encodeURIComponent(job.address)
                window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
              }
            }}
            className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/20"
          >
            <MapPin size={12} /> Map
          </button>
        </div>
      </div>
    </div>
  )
}