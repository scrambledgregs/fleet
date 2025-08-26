// src/components/JobCard.tsx
import React, { useMemo } from 'react'
import { Phone, MapPin, Wrench, Search, Package, User } from 'lucide-react'
import { useForecast } from '../hooks/useForecast'
import type { Job } from '../types/schedule'

type JobCardProps = {
  job: Job
  paydayThreshold?: number
  onOpen?: (job: Job) => void
  onMapClick?: (job: Job) => void
  isSelected?: boolean
}

type ForecastDay = { date: string; code?: number; tMax?: number; tMin?: number; popMax?: number }
type Forecast = { daily?: ForecastDay[] }

/* ------------------------------- helpers -------------------------------- */

function formatUSD(n: number | string | undefined) {
  const num = Number(n ?? 0)
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(num) ? num : 0)
}

function toNumberLoose(v: unknown) {
  if (v == null) return 0
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^0-9.-]/g, '')
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function pickNearestDaily(wx: Forecast | undefined, startISO?: string | null) {
  if (!wx?.daily?.length || !startISO) return null
  const t = new Date(startISO).getTime()
  let best: ForecastDay | null = null
  let bestDiff = Infinity
  for (const d of wx.daily) {
    const utcMidnight = Date.parse(d.date)
    const utcNoon = utcMidnight + 12 * 60 * 60 * 1000
    const diff = Math.abs(utcNoon - t)
    if (diff < bestDiff) { bestDiff = diff; best = d }
  }
  return best
}

const codeToEmoji = (c?: number) => {
  if (c == null) return '❔'
  if ([0].includes(c)) return '☀️'
  if ([1, 2].includes(c)) return '🌤️'
  if ([3].includes(c)) return '☁️'
  if ([45, 48].includes(c)) return '🌫️'
  if ([51, 53, 55].includes(c)) return '🌦️'
  if ([61, 63, 65, 80, 81, 82].includes(c)) return '🌧️'
  if ([71, 73, 75, 85, 86].includes(c)) return '❄️'
  if ([95, 96, 99].includes(c)) return '⛈️'
  return '❔'
}

function addrToString(a: unknown): string {
  if (!a) return ''
  if (typeof a === 'string') return a
  const anyA = a as any
  const parts = [
    anyA.fullAddress || anyA.full_address,
    [anyA.address, anyA.city, anyA.state, anyA.postalCode].filter(Boolean).join(', '),
  ].filter(Boolean)
  return parts[0] || ''
}

// normalize contact shape enough for rendering
function normalizeContact(raw: any = {}) {
  const phonesArr = Array.isArray(raw.phones) ? raw.phones : []
  const emailsArr = Array.isArray(raw.emails) ? raw.emails : []
  const phones = [...phonesArr, raw.phone, raw.mobile, raw.primaryPhone].filter(Boolean)
  const emails = [...emailsArr, raw.email, raw.primaryEmail].filter(Boolean)
  return {
    ...raw,
    name: raw.name ?? raw.fullName ?? raw.firstName ?? '—',
    phones,
    emails,
  }
}

/* -------------------------------- component ------------------------------ */

export default function JobCard({
  job,
  paydayThreshold = 2500,
  onOpen,
  onMapClick,
  isSelected,
}: JobCardProps) {
  const assignedUserId = job?.assignedUserId ?? null
  const assignedRepName = job?.assignedRepName ?? null
  const assignedLabel = assignedRepName ?? (assignedUserId ? `#${assignedUserId}` : 'Unassigned')

  const c = normalizeContact(job?.contact || {})

  const value = useMemo(() => {
    const raw =
      job?.estValue ??
      (job as any)?.est_value ??
      (job as any)?.estimate ??
      (job as any)?.custom?.estValue ??
      (job as any)?.custom?.estimate ??
      0
    return toNumberLoose(raw)
  }, [job])

  const isPayday = value >= (Number(paydayThreshold) || 0)

  // Forecast
  const lat = Number(job?.lat)
  const lng = Number(job?.lng)
  const { data: wx, error: wxErr } = useForecast(lat, lng, 10) as { data?: Forecast; error?: unknown }
  if (import.meta.env?.MODE !== 'production') {
    if (wxErr) console.warn('JobCard WX error:', wxErr)
  }

  // Use normalized field provided by Calendar mapper
  const startISO = job.startTimeISO
  const dayWx: ForecastDay | null =
    startISO ? pickNearestDaily(wx, startISO) : (wx?.daily?.[0] ?? null)

  const toF = (c?: number | null) => (c == null || isNaN(c) ? null : Math.round((c * 9) / 5 + 32))

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

  const displayAddress = addrToString(job?.address) || addrToString(c.address)

  return (
    <div
      className={[
        'glass rounded-xl p-3 cursor-pointer transition',
        isSelected ? 'ring-2 ring-sky-400/80 bg-white/[0.03]' : 'ring-1 ring-white/10',
        'hover:translate-y-[-1px] hover:ring-white/30',
      ].join(' ')}
      onClick={() => onOpen?.(job)}
      role="button"
      aria-label={`Open job ${job?.id}`}
    >
      {/* Top row: date/time + badges (with weather) */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-white/60">
          {job?.day} • {job?.dateText} • {job?.time}
        </div>
        <div className="flex items-center gap-1">
          {dayWx && (
            <span
              title={`High ${toF(dayWx.tMax)}°F / Low ${toF(dayWx.tMin)}°F • POP ${dayWx.popMax ?? 0}%`}
              className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/80"
            >
              {codeToEmoji(dayWx.code)} {toF(dayWx.tMax)}°/{toF(dayWx.tMin)}° • {(dayWx.popMax ?? 0)}%
            </span>
          )}
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

      {/* Title row */}
      <div className="mt-2 flex items-center gap-2">
        <TypeIcon size={16} className="text-white/80" />
        <div className="font-semibold text-white/90 truncate">
          {job?.jobType || 'Job'}
        </div>
        <div className="ml-auto text-sm">{formatUSD(value)}</div>
      </div>

      {/* Address */}
      <div className="mt-1 flex items-start gap-1.5 text-sm text-white/80">
        <MapPin size={14} className="mt-0.5 opacity-70" />
        <span className="line-clamp-2">{displayAddress || '—'}</span>
      </div>

      {/* Chips */}
      <div className="mt-2 flex items-center gap-2">
        <span className={`text-xs px-2 py-1 rounded ${travelColor}`}>
          {travelMin == null ? 'No prior travel' : `Travel +${travelMin}m`}
        </span>
        {typeof job?.fitScore === 'number' && (
          <span className="text-xs px-2 py-1 rounded bg-white/10 text-white/80">
            ⚡ Fit {job.fitScore.toFixed(1)}
          </span>
        )}
        <span className="text-xs px-2 py-1 rounded bg-white/10 text-white/80 inline-flex items-center gap-1">
          <User size={12} /> {assignedLabel}
        </span>
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2">
        <div className="text-xs text-white/70 truncate">
          {c.name || '—'}
        </div>
        <div className="flex items-center gap-2">
          {c.phones?.[0] && (
            <a
              href={`tel:${c.phones[0]}`}
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
              else if (displayAddress) {
                const q = encodeURIComponent(displayAddress)
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