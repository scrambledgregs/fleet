import React, { useEffect, useMemo, useState } from 'react'

/* ---------- Public types (exported so pages can reuse) ---------- */

export type Plan = {
  id: string
  name: string
  monthly: number
  annual: number
  seatsIncluded?: number
}

export type Rates = {
  smsPerMessage: number
  voicePerMinute: number
  emailPerMessage?: number
  extraSeat?: number
}

export type Module = {
  key: string
  label: string
  monthly: number
}

export type Estimate = {
  planId: string
  planLabel: string
  seats: number
  monthlyCost: number
  breakdown: {
    platform: number
    extraSeats: number
    addOns: number
    usage: {
      sms: number
      voiceMinutes: number
      emails: number
    }
  }
}

/* ---------- Component props ---------- */

type Props = {
  /** current billing cadence controlled by parent */
  billing: 'monthly' | 'annual'
  plans: Plan[]
  rates: Rates
  modules?: Module[]
  /** optional starting values */
  initial?: {
    planId?: string
    seats?: number
    sms?: number
    voiceMinutes?: number
    emails?: number
    selectedModules?: string[]
  }
  onEstimate?: (e: Estimate) => void
  onPickPlan?: (p: Plan) => void
  className?: string
  style?: React.CSSProperties
}

/* ---------- Helpers ---------- */

const usd = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(
    Number.isFinite(n) ? n : 0
  )

function clamp(n: number, min = 0, max = Number.POSITIVE_INFINITY) {
  return Math.max(min, Math.min(max, n))
}

/* ---------- UI bits ---------- */

function Stepper({
  value,
  onChange,
  min = 0,
  step = 1,
  label,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  step?: number
  label: string
  suffix?: string
}) {
  return (
    <label className="grid grid-cols-[1fr,9rem] items-center gap-2 text-xs">
      <span className="text-white/70">{label}</span>
      <div className="inline-flex items-center border border-white/10 rounded-none">
        <button
          type="button"
          className="px-2 py-1 hover:bg-white/5"
          onClick={() => onChange(clamp(value - step, min))}
        >
          −
        </button>
        <input
          type="number"
          className="w-[5.5rem] px-2 py-1 bg-black/30 outline-none"
          value={value}
          min={min}
          step={step}
          onChange={(e) => onChange(clamp(parseFloat(e.target.value || '0'), min))}
        />
        <span className="px-2 py-1 text-white/60">{suffix}</span>
        <button
          type="button"
          className="px-2 py-1 hover:bg-white/5"
          onClick={() => onChange(value + step)}
        >
          +
        </button>
      </div>
    </label>
  )
}

/* ---------- Main component ---------- */

export default function PricingSlider({
  billing,
  plans,
  rates,
  modules = [],
  initial,
  onEstimate,
  onPickPlan,
  className,
  style,
}: Props) {
  const [planId, setPlanId] = useState<string>(initial?.planId || plans[0]?.id)
  const activePlan = useMemo(() => plans.find((p) => p.id === planId) || plans[0], [plans, planId])

  const [seats, setSeats] = useState<number>(initial?.seats ?? (activePlan?.seatsIncluded || 1))
  const [sms, setSms] = useState<number>(initial?.sms ?? 1000)
  const [voice, setVoice] = useState<number>(initial?.voiceMinutes ?? 200)
  const [emails, setEmails] = useState<number>(initial?.emails ?? 2000)
  const [selected, setSelected] = useState<string[]>(initial?.selectedModules ?? [])

  // keep seats sensible when switching plans
  useEffect(() => {
    const inc = activePlan?.seatsIncluded || 1
    setSeats((s) => Math.max(s, inc))
  }, [activePlan])

  const pricePlan = useMemo(
    () => (billing === 'annual' ? activePlan.annual : activePlan.monthly),
    [billing, activePlan]
  )

  const calc = useMemo(() => {
    const extraSeats = Math.max(0, seats - (activePlan.seatsIncluded || 0))
    const extraSeatCost = (rates.extraSeat || 0) * extraSeats

    const addOns = modules
      .filter((m) => selected.includes(m.key))
      .reduce((sum, m) => sum + m.monthly, 0)

    const usage =
      sms * rates.smsPerMessage +
      voice * rates.voicePerMinute +
      (rates.emailPerMessage ? emails * rates.emailPerMessage : 0)

    const platform = pricePlan + extraSeatCost
    const monthlyCost = platform + addOns + usage

    return {
      platform,
      extraSeatCost,
      addOns,
      usage,
      monthlyCost,
    }
  }, [
    seats,
    sms,
    voice,
    emails,
    selected,
    rates.smsPerMessage,
    rates.voicePerMinute,
    rates.emailPerMessage,
    rates.extraSeat,
    modules,
    pricePlan,
    activePlan,
  ])

  // push estimate up
  useEffect(() => {
    if (!onEstimate || !activePlan) return
    onEstimate({
      planId: activePlan.id,
      planLabel: activePlan.name,
      seats,
      monthlyCost: Number(calc.monthlyCost.toFixed(2)),
      breakdown: {
        platform: Number(calc.platform.toFixed(2)),
        extraSeats: Number(calc.extraSeatCost.toFixed(2)),
        addOns: Number(calc.addOns.toFixed(2)),
        usage: {
          sms,
          voiceMinutes: voice,
          emails,
        },
      },
    })
  }, [onEstimate, calc, activePlan, seats, sms, voice, emails])

  return (
    <div className={className} style={style}>
      {/* Plan & billing row */}
      <div className="grid lg:grid-cols-[1fr,1fr] gap-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-2">
          <div className="text-sm font-medium">Plan</div>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-xs">
              Select plan
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="mt-1 w-full px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {usd(billing === 'annual' ? p.annual : p.monthly)}/mo
                    {p.seatsIncluded ? ` · ${p.seatsIncluded} seat${p.seatsIncluded > 1 ? 's' : ''} included` : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs">
              Seats
              <Stepper
                value={seats}
                onChange={setSeats}
                min={activePlan?.seatsIncluded || 1}
                label=""
                suffix="seats"
              />
            </label>
          </div>

          <div className="text-xs text-white/60">
            {activePlan?.seatsIncluded || 0} included. Extra seats {usd(rates.extraSeat || 0)}/mo each.
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-2">
          <div className="text-sm font-medium">Usage (estimate)</div>
          <div className="grid sm:grid-cols-2 gap-2">
            <Stepper value={sms} onChange={setSms} min={0} step={100} label="SMS" suffix="msgs" />
            <Stepper value={voice} onChange={setVoice} min={0} step={50} label="Voice minutes" suffix="min" />
            <Stepper value={emails} onChange={setEmails} min={0} step={500} label="Emails" suffix="msgs" />
          </div>
          <div className="text-xs text-white/60">
            Rates: SMS {usd(rates.smsPerMessage)}/msg · Voice {usd(rates.voicePerMinute)}/min
            {rates.emailPerMessage ? ` · Email ${usd(rates.emailPerMessage)}/msg` : ''}
          </div>
        </div>
      </div>

      {/* Add-ons + Estimate */}
      <div className="grid lg:grid-cols-[1fr,0.9fr] gap-3 mt-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <div className="text-sm font-medium mb-2">Add-ons</div>
          {modules.length === 0 ? (
            <div className="text-xs text-white/60">No add-ons available.</div>
          ) : (
            <ul className="grid sm:grid-cols-2 gap-2">
              {modules.map((m) => {
                const checked = selected.includes(m.key)
                return (
                  <li key={m.key} className="flex items-center justify-between border border-white/10 rounded-md px-2 py-1.5">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-white/90"
                        checked={checked}
                        onChange={(e) =>
                          setSelected((prev) =>
                            e.target.checked ? [...prev, m.key] : prev.filter((k) => k !== m.key)
                          )
                        }
                      />
                      {m.label}
                    </label>
                    <span className="text-xs text-white/70">{usd(m.monthly)}/mo</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
          <div className="text-sm font-medium mb-2">Estimate</div>
          <div className="space-y-1 text-sm">
            <Row label="Platform" value={usd(calc.platform)} />
            <Row label="Add-ons" value={usd(calc.addOns)} />
            <Row label="Usage" value={usd(calc.usage)} />
            <hr className="border-white/10 my-1" />
            <Row label="Estimated monthly total" value={usd(calc.monthlyCost)} strong />
          </div>

          {onPickPlan && (
            <button
              onClick={() => onPickPlan(activePlan)}
              className="w-full mt-2 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-none border border-white/15 bg-white/10 hover:bg-white/20"
            >
              Choose {activePlan.name}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className={`text-xs ${strong ? 'text-white/80' : 'text-white/60'}`}>{label}</div>
      <div className={`text-sm ${strong ? 'font-semibold' : ''}`}>{value}</div>
    </div>
  )
}