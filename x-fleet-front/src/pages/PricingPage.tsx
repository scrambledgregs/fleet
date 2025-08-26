import React, { useMemo, useState } from 'react'
import { Check, Sparkles, ArrowRight } from 'lucide-react'
import PricingSlider, { Plan as SliderPlan, Rates, Module, Estimate } from '../components/PricingSlider'

/* ---------- Local plan card type extends slider plan ---------- */
type CardPlan = SliderPlan & {
  blurb: string
  features: string[]
  highlight?: boolean
}

/* ---------- Data ---------- */
const PLANS: CardPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    blurb: 'Solo or first admin',
    monthly: 59,
    annual: 49,
    seatsIncluded: 1,
    features: ['Inbox & Contacts', 'SMS & Email automations', 'Basic reporting', 'Community support'],
  },
  {
    id: 'growth',
    name: 'Growth',
    blurb: 'Most popular for small teams',
    monthly: 129,
    annual: 99,
    seatsIncluded: 3,
    features: ['Everything in Starter', 'Inbound Voice AI', 'Advanced templates', 'Priority support'],
    highlight: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    blurb: 'Serious automation',
    monthly: 249,
    annual: 199,
    seatsIncluded: 8,
    features: ['Everything in Growth', 'Outbound Voice AI', 'Custom guardrails', 'Dedicated onboarding'],
  },
]

const MODULES: Module[] = [
  { key: 'inbound', label: 'Inbound Voice AI', monthly: 49 },
  { key: 'outbound', label: 'Outbound Voice AI', monthly: 69 },
  { key: 'nurture', label: 'Nurture Journeys', monthly: 29 },
]

const RATES: Rates = {
  smsPerMessage: 0.01,
  voicePerMinute: 0.04,
  emailPerMessage: 0,
  extraSeat: 15,
}

/* ---------- Helpers ---------- */
const usd = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const usd2 = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
const pct = (n: number) => `${(n * 100).toFixed(0)}%`

/* ---------- Page ---------- */
export default function PricingPage() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual')

  // estimate coming back from slider
  const [estimate, setEstimate] = useState<Partial<Estimate>>({})

  // ROI calculator inputs
  const [inputs, setInputs] = useState({
    leadsPerMonth: 120,
    avgTicket: 850,
    baseClose: 0.28,
    upliftFromSpeed: 0.07,
    callsPerMonth: 80,
    aiCapturesMissed: 0.4,
    closeFromCall: 0.3,
    minutesSavedPerLead: 6,
    hourlyRate: 35,
  })

  const value = useMemo(() => {
    const addlJobsFromSpeed = inputs.leadsPerMonth * inputs.upliftFromSpeed
    const addlRevFromSpeed = addlJobsFromSpeed * inputs.avgTicket

    const jobsFromMissedCalls = inputs.callsPerMonth * inputs.aiCapturesMissed * inputs.closeFromCall
    const addlRevFromCalls = jobsFromMissedCalls * inputs.avgTicket

    const timeValue = (inputs.leadsPerMonth * inputs.minutesSavedPerLead / 60) * inputs.hourlyRate

    const totalValue = addlRevFromSpeed + addlRevFromCalls + timeValue
    return { addlJobsFromSpeed, addlRevFromSpeed, jobsFromMissedCalls, addlRevFromCalls, timeValue, totalValue }
  }, [inputs])

  const monthlyCost =
    estimate?.monthlyCost ??
    (billing === 'annual'
      ? PLANS.find((p) => p.id === 'growth')!.annual
      : PLANS.find((p) => p.id === 'growth')!.monthly)

  const roi = monthlyCost > 0 ? value.totalValue / monthlyCost : 0
  const net = value.totalValue - monthlyCost

  function handlePickPlan(p: SliderPlan | string) {
    const id = typeof p === 'string' ? p : p.id
    window.location.href = `/signup?plan=${id}&billing=${billing}`
  }

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 text-sm text-white/70">
          <Sparkles size={14} className="opacity-80" />
          <span>Proven ROI from day one</span>
        </div>
        <h1 className="text-2xl font-semibold">Pricing that scales with your wins</h1>
        <p className="text-white/70 max-w-2xl mx-auto text-sm">
          Pick a plan, estimate usage, and see your expected value. Switch anytime.
        </p>

        {/* Billing toggle */}
        <div className="mt-2 inline-flex rounded-md border border-white/10 overflow-hidden">
          {(['monthly', 'annual'] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBilling(b)}
              className={`px-3 py-1.5 text-xs ${billing === b ? 'bg-white/10' : 'hover:bg-white/5'} ${
                b !== 'monthly' ? 'border-l border-white/10' : ''
              }`}
              aria-current={billing === b}
            >
              {b === 'annual' ? 'Annual (save ~20%)' : 'Monthly'}
            </button>
          ))}
        </div>
      </section>

      {/* Plan cards */}
      <section className="grid gap-3 md:grid-cols-3">
        {PLANS.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            price={billing === 'annual' ? p.annual : p.monthly}
            billing={billing}
            onSelect={() => handlePickPlan(p)}
          />
        ))}
      </section>

      {/* Quick estimate + slider */}
      <section className="glass rounded-xl p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Quick estimate</div>
            <div className="text-xs text-white/70">Adjust seats, usage, and add-ons to preview your bill.</div>
          </div>
          <a href="#value" className="text-xs underline inline-flex items-center gap-1">
            Jump to ROI <ArrowRight size={12} />
          </a>
        </div>

        <PricingSlider
          billing={billing}
          plans={PLANS.map(({ blurb, features, highlight, ...p }) => p)} // pass only slider fields
          rates={RATES}
          modules={MODULES}
          onEstimate={(est) => {
            setEstimate(est)
            try {
              fetch('/api/analytics/pricing-estimate', { method: 'POST', body: JSON.stringify(est) })
            } catch {}
          }}
          onPickPlan={(p) => handlePickPlan(p)}
        />

        <div className="mt-2 text-xs text-white/70">
          Estimate shows subscription + add-ons + expected usage. Actuals depend on real SMS/voice volumes.
        </div>
      </section>

      {/* ROI / Value calculator */}
      <section id="value" className="grid gap-3 lg:grid-cols-[1.1fr,0.9fr]">
        {/* Inputs */}
        <div className="glass rounded-xl p-3 space-y-3">
          <div className="text-sm font-medium">Show me the value</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Leads per month">
              <NumberInput value={inputs.leadsPerMonth} onChange={(v) => setInputs((s) => ({ ...s, leadsPerMonth: v }))} min={0} />
            </Field>
            <Field label="Average job value">
              <MoneyInput value={inputs.avgTicket} onChange={(v) => setInputs((s) => ({ ...s, avgTicket: v }))} min={0} />
            </Field>
            <Field label="Current close rate">
              <PercentInput value={inputs.baseClose} onChange={(v) => setInputs((s) => ({ ...s, baseClose: v }))} />
            </Field>
            <Field label="Uplift from faster follow-up">
              <PercentInput value={inputs.upliftFromSpeed} onChange={(v) => setInputs((s) => ({ ...s, upliftFromSpeed: v }))} />
            </Field>
            <Field label="Inbound calls per month">
              <NumberInput value={inputs.callsPerMonth} onChange={(v) => setInputs((s) => ({ ...s, callsPerMonth: v }))} min={0} />
            </Field>
            <Field label="AI captures missed calls">
              <PercentInput value={inputs.aiCapturesMissed} onChange={(v) => setInputs((s) => ({ ...s, aiCapturesMissed: v }))} />
            </Field>
            <Field label="Close rate on captured calls">
              <PercentInput value={inputs.closeFromCall} onChange={(v) => setInputs((s) => ({ ...s, closeFromCall: v }))} />
            </Field>
            <Field label="Minutes saved per lead">
              <NumberInput value={inputs.minutesSavedPerLead} onChange={(v) => setInputs((s) => ({ ...s, minutesSavedPerLead: v }))} min={0} />
            </Field>
            <Field label="Loaded hourly rate">
              <MoneyInput value={inputs.hourlyRate} onChange={(v) => setInputs((s) => ({ ...s, hourlyRate: v }))} min={0} />
            </Field>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="grid sm:grid-cols-3 gap-3 text-sm">
              <Metric label="Extra jobs from faster follow-up" value={`${Math.round(value.addlJobsFromSpeed)}`} hint={`${pct(inputs.upliftFromSpeed)} of ${inputs.leadsPerMonth} leads`} />
              <Metric label="Added revenue (speed)" value={usd2(value.addlRevFromSpeed)} />
              <Metric label="Jobs from answered missed calls" value={`${Math.round(value.jobsFromMissedCalls)}`} hint={`${pct(inputs.aiCapturesMissed)} capture × ${pct(inputs.closeFromCall)} close`} />
              <Metric label="Added revenue (calls)" value={usd2(value.addlRevFromCalls)} />
              <Metric label="Time value saved" value={usd2(value.timeValue)} hint={`${inputs.minutesSavedPerLead} min × ${inputs.leadsPerMonth} leads`} />
              <Metric label="Estimated monthly value" value={usd2(value.totalValue)} emphasis />
            </div>
          </div>
        </div>

        {/* Comparison / ROI */}
        <div className="glass rounded-xl p-3 space-y-3">
          <div className="text-sm font-medium">Cost vs. value</div>

          <div className="grid gap-2 text-sm">
            <Row label="Your estimated monthly cost" value={usd2(monthlyCost)} />
            <Row label="Estimated monthly value" value={usd2(value.totalValue)} />
            <hr className="border-white/10 my-1" />
            <Row label="Net benefit" value={`${net >= 0 ? '+' : '−'}${usd2(Math.abs(net))}`} strong />
            <Row label="ROI" value={roi > 0 ? `${roi.toFixed(1)}×` : '—'} strong />
          </div>

          <div className="text-xs text-white/70">
            Based on your inputs. Actual results vary; this helps you benchmark the upside before starting a trial.
          </div>

          <button
            onClick={() => handlePickPlan((estimate as Estimate)?.planId ?? 'growth')}
            className="w-full mt-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-none border border-white/15 bg-white/10 hover:bg-white/20"
          >
            Start free trial <ArrowRight size={14} />
          </button>
        </div>
      </section>

      {/* Sticky summary */}
      <StickySummary cost={monthlyCost} value={value.totalValue} onStart={() => handlePickPlan((estimate as Estimate)?.planId ?? 'growth')} />

      {/* FAQ */}
      <section className="grid md:grid-cols-2 gap-3">
        <FAQ q="How do you bill for SMS and calls?" a="We meter SMS by message and voice by the minute at wholesale-style rates. The slider shows your blended estimate; your dashboard shows real usage in real time." />
        <FAQ q="Can I change plans or cancel anytime?" a="Yep. Upgrade/downgrade instantly. Cancel any time in-app without calling sales." />
        <FAQ q="What about compliance & quiet hours?" a="Built-in guardrails: opt-outs, quiet hours, capped sends, and local-time scheduling are on by default." />
        <FAQ q="Do you charge per user?" a="Each plan includes seats. Extra seats are billed at a simple flat add-on." />
      </section>
    </div>
  )
}

/* ---------- Small components ---------- */

function PlanCard({ plan, price, billing, onSelect }: { plan: CardPlan; price: number; billing: 'monthly'|'annual'; onSelect: () => void }) {
  return (
    <div className={`rounded-2xl border ${plan.highlight ? 'border-white/20 bg-white/[0.06]' : 'border-white/10 bg-white/[0.04]'} p-4 relative`}>
      {plan.highlight && (
        <span className="absolute -top-2 left-4 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-400/20">Most popular</span>
      )}
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-lg font-semibold">{plan.name}</div>
          <div className="text-sm text-white/70">{plan.blurb}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold">{usd(price)}</div>
          <div className="text-xs text-white/60">/mo {billing === 'annual' && <span className="ml-1 opacity-80">(billed annually)</span>}</div>
        </div>
      </div>

      <ul className="mt-3 space-y-1 text-sm">
        {plan.features.map((f) => (
          <li key={f} className="flex items-center gap-2">
            <Check size={14} className="text-emerald-300" />
            <span>{f}</span>
          </li>
        ))}
        <li className="text-xs text-white/60 mt-1">Includes {plan.seatsIncluded} seat{plan.seatsIncluded! > 1 ? 's' : ''}</li>
      </ul>

      <button onClick={onSelect} className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-none border border-white/15 bg-white/10 hover:bg-white/20">
        Choose {plan.name}
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}

function NumberInput({ value, onChange, min = 0, step = 1 }: { value: number; onChange: (v:number)=>void; min?: number; step?: number }) {
  return (
    <input type="number" value={value} min={min} step={step} onChange={(e)=>onChange(parseFloat(e.target.value || '0'))} className="w-full px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm" />
  )
}

function MoneyInput({ value, onChange, min = 0 }: { value: number; onChange: (v:number)=>void; min?: number }) {
  return (
    <div className="flex">
      <span className="px-2 py-1 bg-black/30 border border-r-0 border-white/10 rounded-none text-sm text-white/70">$</span>
      <input type="number" value={value} min={min} onChange={(e)=>onChange(parseFloat(e.target.value || '0'))} className="w-full px-2 py-1 bg-black/30 border border-l-0 border-white/10 rounded-none text-sm" />
    </div>
  )
}

function PercentInput({ value, onChange }: { value: number; onChange: (v:number)=>void }) {
  return (
    <div className="flex">
      <input type="number" value={(value * 100).toFixed(0)} onChange={(e)=>onChange(Math.max(0, Math.min(1, parseFloat(e.target.value || '0')/100)))} className="w-full px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm" />
      <span className="px-2 py-1 bg-black/30 border border-l-0 border-white/10 rounded-none text-sm text-white/70">%</span>
    </div>
  )
}

function Metric({ label, value, hint, emphasis }: { label: string; value: string; hint?: string; emphasis?: boolean }) {
  return (
    <div>
      <div className="text-xs text-white/60">{label}</div>
      <div className={`font-semibold ${emphasis ? 'text-lg' : ''}`}>{value}</div>
      {hint && <div className="text-[11px] text-white/50">{hint}</div>}
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

function StickySummary({ cost, value, onStart }: { cost: number; value: number; onStart: () => void }) {
  const net = value - cost
  const roi = cost > 0 ? value / cost : 0
  return (
    <div className="sticky bottom-3 z-30">
      <div className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="text-white/70 mr-2">Your estimate:</span>
          <span className="font-semibold mr-3">Cost {usd2(cost)}/mo</span>
          <span className="font-semibold mr-3">Value {usd2(value)}/mo</span>
          <span className={`font-semibold ${net >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {net >= 0 ? `Net +${usd2(net)}` : `Net −${usd2(Math.abs(net))}`} ({roi > 0 ? `${roi.toFixed(1)}× ROI` : '—'})
          </span>
        </div>
        <button onClick={onStart} className="inline-flex items-center gap-2 px-4 py-2 rounded-none border border-white/15 bg-white/10 hover:bg-white/20">
          Start free trial <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="font-medium text-sm mb-1">{q}</div>
      <div className="text-sm text-white/70">{a}</div>
    </div>
  )
}