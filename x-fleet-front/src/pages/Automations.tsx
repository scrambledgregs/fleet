// src/pages/Automations.tsx
import React, { useEffect, useMemo, useState, useRef } from 'react'
import {
  MessageSquare, CalendarCheck, Star, Clock, Send, Sparkles,
  Phone, Mail, Trash2, Filter, PlusCircle, Wand2
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import NurtureDesigner from '../components/NurtureDesigner'
import RuleBuilder from '../components/RuleBuilder'

type Automation = {
  id: string
  title: string
  enabled: boolean
  trigger:
    | { kind: 'event'; event: string; delayMinutes?: number; match?: Record<string, any> }
    | { kind: 'schedule'; rrule?: string; every?: 'day'|'week'|'month'|'year'; at?: string }
  action:
    | { kind: 'sms'; text: string; to?: 'contact'|'assignee'|'custom'; customPhone?: string }
    | { kind: 'email'; subject: string; body: string; to?: 'contact'|'assignee'|'custom'; customEmail?: string }
  meta?: Record<string, any>
  lastRunAt?: string | null
  runs?: number
}

type ApiListResp = { ok: true; items: Automation[] } | { ok: false; error: string }
type ApiOneResp  = { ok: true; item: Automation }   | { ok: false; error: string }

const TEMPLATES = [
  // 1) New lead
  {
    key: 'lead-instant-reply',
    Icon: MessageSquare,
    title: 'New lead reply',
    blurb: 'Text new inquiries within 60s.',
    make: (): Omit<Automation, 'id'> => ({
      title: 'Instant SMS reply to new leads',
      enabled: true,
      trigger: { kind: 'event', event: 'lead.created' },
      action: {
        kind: 'sms',
        to: 'contact',
        text:
          "Hi {contact.firstName}, thanks for reaching out to NONSTOP.\n" +
          "We got your request and will text you shortly with times.\n" +
          "— {user.name}",
      },
      meta: { category: 'new-lead', step: 10 },
    }),
  },

  // 2) Follow-up if no response
  {
    key: 'lead-followup-no-response',
    Icon: Send,
    title: 'Lead follow-up (no reply)',
    blurb: 'Nudge if a new lead hasn’t replied.',
    make: (): Omit<Automation, 'id'> => ({
      title: 'Follow-up if lead hasn’t responded',
      enabled: true,
      trigger: { kind: 'event', event: 'lead.no_response', delayMinutes: 60 },
      action: {
        kind: 'sms',
        to: 'contact',
        text:
          "Hi {contact.firstName}—just circling back. Want to grab a time?\n" +
          "Reply 1 for today, 2 for tomorrow. — {user.name}",
      },
      meta: { category: 'new-lead', step: 20 },
    }),
  },

  // 3) Booking intro (introduce rep)
  {
    key: 'booking-intro',
    Icon: MessageSquare,
    title: 'Booking intro',
    blurb: 'Introduce the assigned rep after booking.',
    make: (): Omit<Automation, 'id'> => ({
      title: 'Intro assigned rep after booking',
      enabled: true,
      trigger: { kind: 'event', event: 'appointment.created' },
      action: {
        kind: 'sms',
        to: 'contact',
        text:
          "You’re booked for {appointment.date} at {appointment.time}.\n" +
          "Meet {assignee.name} ({assignee.role}). {assignee.bio}\n" +
          "{assignee.photoUrl}",
      },
      meta: { category: 'appointment', step: 30 },
    }),
  },

  // 4) Appointment reminder
  {
    key: 'appt-reminder',
    Icon: CalendarCheck,
    title: 'Appointment reminder',
    blurb: 'Day-before reminder SMS.',
    make: (): Omit<Automation, 'id'> => ({
      title: 'Appointment reminder (day before)',
      enabled: true,
      trigger: { kind: 'event', event: 'appointment.created', delayMinutes: 60 * 24 - 60 },
      action: {
        kind: 'sms',
        to: 'contact',
        text:
          "Reminder: we’re scheduled {appointment.date} at {appointment.time}.\n" +
          "Reply 1 to confirm or 2 to reschedule.",
      },
      meta: { category: 'appointment', step: 40 },
    }),
  },

  // 5) Dispatch on-the-way
  {
    key: 'dispatch-otw',
    Icon: Send,
    title: 'Dispatching Notifications',
    blurb: 'Text when rep is en-route.',
    make: (): Omit<Automation, 'id'> => ({
      title: 'Tech en-route / On-the-way',
      enabled: true,
      trigger: { kind: 'event', event: 'dispatch.enroute' },
      action: {
        kind: 'sms',
        to: 'contact',
        text:
          "{assignee.name} is on the way. ETA {dispatch.eta}.\n" +
          "{assignee.photoUrl}",
      },
      meta: { category: 'appointment', step: 50 },
    }),
  },

  // 6) Estimate follow-up
  {
    key: 'estimate-followup',
    Icon: Send,
    title: 'Estimate follow-up',
    blurb: 'Follow up after sending estimate.',
    make: (): Omit<Automation, 'id'> => ({
      title: 'Estimate follow-up (24h)',
      enabled: true,
      trigger: { kind: 'event', event: 'estimate.sent', delayMinutes: 60 * 24 },
      action: {
        kind: 'sms',
        to: 'contact',
        text:
          "Hi {contact.firstName}, any questions on the estimate?\n" +
          "Want us to hold a time? — {user.name}",
      },
      meta: { category: 'estimate', step: 60 },
    }),
  },

  // 7) Disposition follow-up
  {
    key: 'dispo-followup',
    Icon: Send,
    title: 'Disposition follow-up',
    blurb: 'Automatically reply to the disposition if they decline the estimate.',
    make: (): Omit<Automation, 'id'> => ({
      title: 'Follow-up after disposition “Estimate Sent”',
      enabled: true,
      trigger: {
        kind: 'event',
        event: 'disposition.recorded',
        match: { disposition: 'estimate_sent' },
        delayMinutes: 60 * 24,
      },
      action: {
        kind: 'sms',
        to: 'contact',
        text:
          "Hi {contact.firstName}, checking in on the estimate we sent.\n" +
          "Any questions, or would you like us to schedule? — {user.name}",
      },
      meta: { category: 'disposition', step: 70 },
    }),
  },

  // 8) Invoice reminder
  {
    key: 'invoice-reminder',
    Icon: Clock,
    title: 'Invoice reminder',
    blurb: 'Remind after invoice sent (unpaid).',
    make: (): Omit<Automation, 'id'> => ({
      title: 'Invoice reminder (3 days)',
      enabled: true,
      trigger: { kind: 'event', event: 'invoice.sent', delayMinutes: 60 * 24 * 3 },
      action: {
        kind: 'sms',
        to: 'contact',
        text:
          "Friendly reminder: your invoice {invoice.number} is open.\n" +
          "{invoice.payUrl}",
      },
      meta: { category: 'billing', step: 80 },
    }),
  },

  // 9) NPS request
  {
    key: 'nps-request',
    Icon: Star,
    title: 'NPS request',
    blurb: 'Ask 0–10, branch later.',
    make: (): Omit<Automation, 'id'> => ({
      title: 'NPS survey after job',
      enabled: true,
      trigger: { kind: 'event', event: 'job.completed', delayMinutes: 60 * 6 },
      action: {
        kind: 'sms',
        to: 'contact',
        text:
          "Quick Q: How likely are you to recommend us? 0–10\n" +
          "Reply with a number.",
      },
      meta: { category: 'nps', step: 90 },
    }),
  },

  // 10) Review & referral
  {
    key: 'review-referral',
    Icon: Star,
    title: 'Review & referral',
    blurb: 'Ask for review after job.',
    make: (): Omit<Automation, 'id'> => ({
      title: 'Ask for review + referral after job completion',
      enabled: true,
      trigger: { kind: 'event', event: 'job.completed', delayMinutes: 60 * 3 },
      action: {
        kind: 'sms',
        to: 'contact',
        text:
          "Thanks again for choosing NONSTOP!\n" +
          "If we earned it, would you mind leaving a quick review? {links.review}\n" +
          "Know someone who needs us? Share this link: {links.referral}",
      },
      meta: { category: 'reviews', step: 100 },
    }),
  },

  // 11) Annual nurture (long-tail)
  {
    key: 'annual-nurture',
    Icon: Clock,
    title: 'Annual nurture',
    blurb: 'Yearly check-in email.',
    make: (): Omit<Automation, 'id'> => ({
      title: 'Annual nurture check-in',
      enabled: true,
      trigger: { kind: 'schedule', every: 'year', at: '09:00' },
      action: {
        kind: 'email',
        to: 'contact',
        subject: 'Quick annual check-in from NONSTOP',
        body:
          "Hi {contact.firstName},\n\n" +
          "Just checking in—anything we can help with this year? " +
          "We also have seasonal tune-up specials.\n\n" +
          "Best,\n{user.name}",
      },
      meta: { category: 'nurture', step: 110 },
    }),
  },
] as const

const BLUEPRINTS: {
  id: string
  title: string
  blurb: string
  includes: Array<typeof TEMPLATES[number]['key']>
}[] = [
  {
    id: 'speed-to-lead',
    title: 'Speed-to-Lead Starter',
    blurb: 'Instant reply + no-response nudge + appt. reminder.',
    includes: ['lead-instant-reply', 'lead-followup-no-response', 'appt-reminder'],
  },
  {
    id: 'booking-and-dispatch',
    title: 'Booking & On-My-Way',
    blurb: 'Rep intro after booking + on-the-way text.',
    includes: ['booking-intro', 'dispatch-otw'],
  },
  {
    id: 'close-and-grow',
    title: 'Close & Grow',
    blurb: 'Estimate follow-up, disposition, invoice, NPS → reviews, annual nurture.',
    includes: ['estimate-followup', 'dispo-followup', 'invoice-reminder', 'nps-request', 'review-referral', 'annual-nurture'],
  },
]
type Tab = 'overview' | 'gallery' | 'rules' | 'nurture' | 'ai' | 'logs'

export default function AutomationsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab) || 'overview'
  const [tab, setTab] = useState<Tab>(initialTab)

  // Slide-over states
  const [showBuilder, setShowBuilder] = useState(false)
  const [testItem, setTestItem] = useState<Automation | null>(null)

  // keep URL in sync
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Deep link: ?tab=rules&new=1
  useEffect(() => {
    const wantsNew = searchParams.get('new') === '1'
    if (wantsNew) {
      setTab('rules')
      setShowBuilder(true)
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [items, setItems] = useState<Automation[]>([])
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [preview, setPreview] = useState<Automation | null>(null)
  const [previewStartEditing, setPreviewStartEditing] = useState(false)

  // light filters
  const [cat, setCat] = useState<'all' | string>('all')
  const [status, setStatus] = useState<'all'|'active'|'paused'>('all')

  async function load() {
    try {
      setLoading(true)
      const r = await fetch('/api/automations', { headers: { Accept: 'application/json' } })
      const j: ApiListResp = await r.json()
      if (!('ok' in j) || !j.ok) throw new Error((j as any).error || 'Failed to load automations')
      setItems(j.items || [])
    } catch (e) {
      console.error(e)
      setItems([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId) return
    const item = items.find(i => i.id === openId)
    if (item) {
      setPreview(item)
      // Clean up the URL so refreshes don’t keep reopening
      const next = new URLSearchParams(searchParams)
      next.delete('open')
      setSearchParams(next, { replace: true })
    }
  }, [items, searchParams, setSearchParams])

  async function createFromTemplate(key: string) {
    const t = TEMPLATES.find(x => x.key === key)
    if (!t) return
    try {
      setSavingKey(key)
      const r = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t.make()),
      })
      const j: ApiOneResp = await r.json()
      if (!('ok' in j) || !j.ok) throw new Error((j as any).error || 'Create failed')
      setItems(prev => [j.item, ...prev])

      // Navigate to Rules and request the drawer to open (resilient to remounts)
      const next = new URLSearchParams(searchParams)
      next.set('tab', 'rules')
      next.set('open', j.item.id)
      setSearchParams(next, { replace: true })

      // Also set local state so it opens immediately if the component doesn't remount
      setPreview(j.item)
      setTab('rules')
    } catch (e) {
      console.error('POST /api/automations failed; using local fallback', e)
      // Fallback for dev: create a local temp item so the preview drawer can open
      const t = TEMPLATES.find(x => x.key === key)
      if (t) {
        const tmp: Automation = {
          id: `tmp_${Date.now()}`,
          ...t.make(),
          lastRunAt: null,
          runs: 0,
        }
        setItems(prev => [tmp, ...prev])
        setPreview(tmp)       // open the drawer for the item we "added"
        setTab('rules')
      } else {
        alert('Failed to create automation.')
      }
    } finally {
      setSavingKey(null)
    }
  }

  async function createBlueprint(keys: string[]) {
    // create sequentially to keep UX/order predictable
    for (const k of keys) {
      await createFromTemplate(k)
    }
    setTab('rules')
  }

  async function patchAutomation(id: string, patch: Partial<Automation>) {
    const r = await fetch(`/api/automations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const j: ApiOneResp = await r.json()
    if (!('ok' in j) || !j.ok) throw new Error((j as any).error || 'Update failed')
    setItems(prev => prev.map(x => (x.id === id ? j.item : x)))
    setPreview(j.item) // keep drawer in sync with the saved version
  }

  // Create from RuleBuilder
  async function createFromBuilder(payload: {
    title: string
    enabled: boolean
    trigger: any
    action: any
    meta?: Record<string, any>
  }) {
    try {
      const r = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j: ApiOneResp = await r.json()
      if (!('ok' in j) || !j.ok) throw new Error((j as any).error || 'Create failed')
      setItems(prev => [j.item, ...prev])
      setShowBuilder(false)
      setPreview(j.item)
      setTab('rules')
    } catch (e) {
      console.error(e)
      alert('Failed to create rule.')
    }
  }

  async function toggleEnabledOptimistic(a: Automation, next: boolean) {
    setItems(prev => prev.map(x => (x.id === a.id ? { ...x, enabled: next } : x)))
    try {
      const r = await fetch(`/api/automations/${encodeURIComponent(a.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const j: ApiOneResp = await r.json()
      if (!('ok' in j) || !j.ok) throw new Error('Toggle failed')
      setItems(prev => prev.map(x => (x.id === a.id ? j.item : x)))
    } catch {
      setItems(prev => prev.map(x => (x.id === a.id ? { ...x, enabled: a.enabled } : x)))
      alert('Could not update. Please try again.')
    }
  }

  async function removeAutomation(a: Automation) {
    if (!confirm(`Delete “${a.title}”?`)) return
    const keep = items
    setItems(prev => prev.filter(x => x.id !== a.id))
    try {
      const r = await fetch(`/api/automations/${encodeURIComponent(a.id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
    } catch {
      setItems(keep)
      alert('Delete failed.')
    }
  }

  async function dryRun(a: Automation) {
    try {
      const r = await fetch(`/api/automations/${encodeURIComponent(a.id)}/dry-run`, { method: 'POST' })
      if (r.ok) alert('Sent a test to your user contact (if configured).')
      else alert('Test sent (simulated). Wire /dry-run for full behavior.')
    } catch {
      alert('Could not send test.')
    }
  }

  // Optional simulate (safe to no-op if backend not present)
  async function simulate(a: Automation, payload: any) {
    try {
      const r = await fetch(`/api/automations/${encodeURIComponent(a.id)}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!r.ok) throw new Error('Simulate failed')
      return await r.json()
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Simulate failed' }
    }
  }

  const categories = useMemo(() => {
    const known = new Set<string>(['new-lead', 'disposition', 'appointment', 'reviews', 'nurture'])
    items.forEach(i => i.meta?.category && known.add(i.meta.category))
    return Array.from(known)
  }, [items])

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    const arr = items
      .filter(a => (status==='all') ? true : status==='active' ? a.enabled : !a.enabled)
      .filter(a => (cat==='all') ? true : (a.meta?.category || 'custom') === cat)
      .filter(a =>
        !qq ? true :
        (a.title || '').toLowerCase().includes(qq) ||
        JSON.stringify(a.trigger).toLowerCase().includes(qq) ||
        JSON.stringify(a.action).toLowerCase().includes(qq)
      )

    // sort by our journey order, then by title as a stable tiebreaker
    return arr.sort((a, b) => {
      const wa = journeyWeight(a), wb = journeyWeight(b)
      return wa === wb ? (a.title || '').localeCompare(b.title || '') : wa - wb
    })
  }, [items, q, cat, status])

  function journeyWeight(a: Automation): number {
    if (typeof a.meta?.step === 'number') return a.meta.step

    const e = (a.trigger as any)?.event || ''
    const t = (a.title || '').toLowerCase()

    if (e === 'lead.created') return 10
    if (e === 'lead.no_response') return 20
    if (e === 'appointment.created') return t.includes('intro') ? 30 : 40
    if (e === 'dispatch.enroute') return 50
    if (e === 'estimate.sent') return 60
    if (e === 'disposition.recorded') return 70
    if (e === 'invoice.sent') return 80
    if (e === 'job.completed') return t.includes('nps') ? 90 : 100
    if ((a.meta?.category || '') === 'nurture') return 110

    return 999 // unknowns go to the end
  }

  return (
    <div className="relative space-y-4">
      {/* Page header + tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="opacity-80" />
            <div className="text-lg font-semibold">Automation Hub</div>
          </div>
          <p className="text-xs text-white/60">
            Triggers → messages → guardrails. Test anything before you publish.
          </p>
        </div>

        <div className="inline-flex overflow-hidden rounded-md border border-white/10">
          {(['overview','gallery','rules','nurture','ai','logs'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={'px-3 py-1.5 text-xs ' + (tab === t ? 'bg-white/10' : 'hover:bg-white/5') + (t!=='overview'?' border-l border-white/10':'')}
              aria-current={tab===t}
            >
              {t[0].toUpperCase()+t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <div className="grid md:grid-cols-3 gap-3">
          <div className="glass rounded-xl p-3">
            <div className="text-sm font-medium mb-1">Get started</div>
            <div className="text-xs text-white/70 mb-2">Pick a template or build a rule.</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setTab('gallery')} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">
                <Wand2 size={14} className="mr-1 inline" /> Browse templates
              </button>
              <button onClick={() => { setTab('rules'); setShowBuilder(true) }} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/10 hover:bg-white/20">
                <PlusCircle size={14} className="mr-1 inline" /> Create rule
              </button>
            </div>
          </div>
          <div className="glass rounded-xl p-3">
            <div className="text-sm font-medium mb-1">AI</div>
            <div className="text-xs text-white/70 mb-2">Inbound & outbound assistants.</div>
            <button onClick={() => setTab('ai')} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">Open AI setup</button>
          </div>
          <div className="glass rounded-xl p-3">
            <div className="text-sm font-medium mb-1">Journeys</div>
            <div className="text-xs text-white/70 mb-2">Annual nurture & seasonal touchpoints.</div>
            <button onClick={() => setTab('nurture')} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">Open Nurture</button>
          </div>
        </div>
      )}

      {/* GALLERY */}
      {tab === 'gallery' && (
        <>
          {/* Blueprints */}
          <div className="text-xs text-white/60 mb-2">Blueprints</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {BLUEPRINTS.map(bp => (
              <div
                key={bp.id}
                className="p-4 rounded-2xl border border-white/10 bg-white/[0.04]"
              >
                <div className="font-semibold">{bp.title}</div>
                <div className="text-sm text-white/70 mt-0.5">{bp.blurb}</div>

                {/* tiny chips of what's included */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {bp.includes.map(k => {
                    const t = TEMPLATES.find(x => x.key === k)!
                    return (
                      <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                        {t.title}
                      </span>
                    )
                  })}
                </div>

                <div className="mt-3">
                  <button
                    onClick={() => createBlueprint(bp.includes)}
                    className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-full border border-white/10 hover:border-white/20"
                  >
                    Add bundle <span aria-hidden>→</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Recommended */}
          <div className="text-xs text-white/60 mb-2">Recommended</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {TEMPLATES.map(t => (
              <button
                key={t.key}
                onClick={() => createFromTemplate(t.key)}
                disabled={savingKey === t.key}
                className="group text-left p-4 rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.06] hover:border-white/20 transition"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center">
                    <t.Icon size={18} className="opacity-90" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{t.title}</div>
                    <div className="text-sm text-white/70 truncate">{t.blurb}</div>
                  </div>
                </div>
                <div className="mt-3">
                  <span className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-full border border-white/10 group-hover:border-white/20">
                    {savingKey === t.key ? 'Adding…' : 'Add'} <span aria-hidden>→</span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* RULES */}
      {tab === 'rules' && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search title, schedule, phrase…"
                className="px-3 py-2 text-sm bg-neutral-900 border border-white/10 outline-none focus:border-white/30 rounded-none"
              />
              <button onClick={load} className="px-3 py-2 text-sm border border-white/15 bg-white/5 hover:bg-white/10 rounded-none">
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {/* Filters */}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-white/50 inline-flex items-center gap-1"><Filter size={12}/> Filters:</span>
              <select
                value={status}
                onChange={e=>setStatus(e.target.value as any)}
                className="px-2 py-1 text-xs bg-neutral-900 border border-white/10"
                aria-label="Status filter"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
              <select
                value={cat}
                onChange={e=>setCat(e.target.value as any)}
                className="px-2 py-1 text-xs bg-neutral-900 border border-white/10"
                aria-label="Category filter"
              >
                <option value="all">All categories</option>
                {categories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              {/* + New rule */}
              <button
                onClick={() => setShowBuilder(true)}
                className="px-3 py-2 text-sm border border-white/15 bg-white/10 hover:bg-white/20 rounded-none"
              >
                <PlusCircle size={14} className="inline mr-1" /> New rule
              </button>
            </div>
          </div>

          <div className="border border-white/10 rounded-none">
            <div className="grid grid-cols-[1fr,16rem,16rem,9rem,12rem] text-xs bg-neutral-900/70 border-b border-white/10">
              <div className="px-3 py-2">Title</div>
              <div className="px-3 py-2">When</div>
              <div className="px-3 py-2">Action</div>
              <div className="px-3 py-2">Last run</div>
              <div className="px-3 py-2">Controls</div>
            </div>

            {filtered.length === 0 && !loading && (
              <div className="px-3 py-8 text-sm text-white/70">
                <div className="max-w-md">
                  <div className="text-base font-semibold mb-1">No automations yet</div>
                  <div className="text-white/60 mb-3">
                    Start with a proven template or create your own. You can test safely before going live.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => createFromTemplate('lead-instant-reply')} className="px-3 py-1.5 text-sm border border-white/15 bg-white/5 hover:bg-white/10 rounded-none">Add New Lead reply</button>
                    <button onClick={() => createFromTemplate('annual-nurture')} className="px-3 py-1.5 text-sm border border-white/15 bg-white/5 hover:bg-white/10 rounded-none">Add Annual nurture</button>
                    <button onClick={() => setShowBuilder(true)} className="px-3 py-1.5 text-sm border border-white/15 bg-white/10 hover:bg-white/20 rounded-none">Create custom rule</button>
                  </div>
                </div>
              </div>
            )}

            <ul className="divide-y divide-white/10">
              {filtered.map(a => (
                <li
                  key={a.id}
                  className="grid grid-cols-[1fr,16rem,16rem,9rem,12rem] items-center text-sm hover:bg-white/5"
                >
                  {/* title */}
                  <button className="px-3 py-2 text-left" onClick={() => setPreview(a)} title="Open preview">
                    <div className="font-medium truncate">{a.title}</div>
                    <div className="text-xs text-white/60 flex items-center gap-2">
                      <span>{a.meta?.category || 'custom'}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                        to: {(a.action as any).to || 'contact'}
                      </span>
                    </div>
                  </button>

                  {/* when */}
                  <div className="px-3 py-2 text-white/70 text-xs">
                    <ScheduleBadge trigger={a.trigger} />
                  </div>

                  {/* action */}
                  <div className="px-3 py-2 text-white/70 text-xs truncate">
                    {a.action.kind === 'sms' ? (
                      <span className="inline-flex items-center gap-1">
                        <Phone size={12} /> SMS → {a.action.to || 'contact'}:
                        <span className="font-mono truncate max-w-[12rem]">{truncate((a.action as any).text, 60)}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Mail size={12} /> Email → {a.action.to || 'contact'}:
                        <span className="font-mono truncate max-w-[12rem]">{truncate((a.action as any).subject, 40)}</span>
                      </span>
                    )}
                  </div>

                  {/* last run */}
                  <div className="px-3 py-2 text-xs text-white/60">
                    {a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : '—'}
                  </div>

                  {/* controls */}
                  <div className="px-3 py-2 flex items-center gap-2">
                    <ActiveToggle value={a.enabled} onChange={(v) => toggleEnabledOptimistic(a, v)} />
                    <button
                      onClick={() => { setPreview(a); setPreviewStartEditing(true) }}
                      className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none"
                      title="Quick edit"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setTestItem(a)}   // ← open Test drawer
                      className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none"
                      title="Test / simulate"
                    >
                      <Send size={12} /> Test
                    </button>
                    <button onClick={() => removeAutomation(a)} className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none inline-flex items-center gap-1" title="Delete">
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-3 text-xs text-white/50">
            Tip: personalize with <code className="font-mono">{"{contact.firstName}"}</code>, <code className="font-mono">{"{appointment.date}"}</code>, <code className="font-mono">{"{user.name}"}</code>.
          </div>
        </>
      )}

      {/* NURTURE */}
      {tab === 'nurture' && <NurtureDesigner />}

      {/* AI */}
      {tab === 'ai' && (
        <AIHubView
          items={items}
          goToTab={(t) => setTab(t)}
          onQuickAdd={(k) => createFromTemplate(k)}
          onOpenBuilder={() => { setTab('rules'); setShowBuilder(true) }}
        />
      )}

      {/* LOGS */}
      {tab === 'logs' && (
        <div className="glass rounded-xl p-3 text-sm">
          See detailed run history and errors in <a className="underline" href="/events">Activity</a>.
        </div>
      )}

      {preview && (
        <PreviewDrawer
          a={preview}
          onClose={() => { setPreview(null); setPreviewStartEditing(false) }}
          onSave={patchAutomation}
          onOpenTest={() => preview && setTestItem(preview)}
          startEditing={previewStartEditing}
        />
      )}

      {/* Slide-over: RuleBuilder */}
      {showBuilder && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowBuilder(false)} />
          <div
            className="fixed top-0 right-0 z-50 h-full w-[min(560px,95vw)] bg-neutral-950/95 backdrop-blur border-l border-white/10 shadow-2xl"
            role="dialog"
            aria-label="Create rule"
          >
            <div className="p-3 border-b border-white/10 flex items-center justify-between">
              <div className="font-medium">Create rule</div>
              <button
                onClick={() => setShowBuilder(false)}
                className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none"
              >
                Close
              </button>
            </div>
            <RuleBuilder
              onCreate={createFromBuilder}
              onCancel={() => setShowBuilder(false)}
            />
          </div>
        </>
      )}

      {/* Slide-over: Test */}
      {testItem && (
        <TestDrawer
          a={testItem}
          onClose={() => setTestItem(null)}
          onSendTest={async () => { await dryRun(testItem) }}
          onSimulate={async (payload) => await simulate(testItem, payload)}
        />
      )}
    </div>
  )
}

/* ---------- helpers & small views ---------- */

function truncate(s: string, n: number) { return !s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s }

// Rough SMS length/segment calculator.
// NOTE: This is an approximation: if any char code > 127 we treat as UCS-2.

function smsParts(text: string): {
  encoding: 'GSM-7' | 'UCS-2';
  length: number;
  segments: number;
  perSegment: number;
} {
  const length = [...text].length; // count codepoints
  const isUCS2 = [...text].some(ch => (ch.codePointAt(0) ?? 0) > 127);
  if (length === 0) return { encoding: 'GSM-7', length: 0, segments: 0, perSegment: 160 };

  if (isUCS2) {
    const per1 = 70, perN = 67;
    const segments = length <= per1 ? 1 : Math.ceil(length / perN);
    return { encoding: 'UCS-2', length, segments, perSegment: segments === 1 ? per1 : perN };
  } else {
    const per1 = 160, perN = 153;
    const segments = length <= per1 ? 1 : Math.ceil(length / perN);
    return { encoding: 'GSM-7', length, segments, perSegment: segments === 1 ? per1 : perN };
  }
}

function ActiveToggle({ value, onChange }: { value: boolean; onChange:(v:boolean)=>void }) {
  const [v, setV] = useState(value)
  const [busy, setBusy] = useState(false)
  useEffect(() => setV(value), [value])
  return (
    <button
      onClick={async () => { setBusy(true); setV(!v); try { await onChange(!v) } finally { setBusy(false) } }}
      className={`px-2 py-1 text-xs rounded-full border ${v ? 'border-emerald-400/30 bg-emerald-500/15' : 'border-white/10 bg-white/5'}`}
      disabled={busy}
      aria-busy={busy}
    >
      {v ? 'Active' : 'Paused'}
    </button>
  )
}

function ScheduleBadge({ trigger }: { trigger: Automation['trigger'] }) {
  const text =
    trigger.kind === 'event'
      ? [
          `On ${trigger.event}`,
          trigger.delayMinutes ? `+${trigger.delayMinutes}m` : '',
          trigger.match ? `match ${Object.entries(trigger.match).map(([k,v])=>`${k}=${v}`).join(',')}` : '',
        ].filter(Boolean).join(' • ')
      : humanizeSchedule(trigger)
  return (
    <span className="text-[11px] px-2 py-1 rounded-full bg-white/5 border border-white/10 inline-block">
      {text}
    </span>
  )
}

function humanizeSchedule(s: Extract<Automation['trigger'], {kind:'schedule'}>) {
  if (s.rrule) return s.rrule
  const every =
    s.every === 'day' ? 'Every day' :
    s.every === 'week' ? 'Every week' :
    s.every === 'month' ? 'Every month' :
    s.every === 'year' ? 'Every year' : 'Custom'
  return s.at ? `${every} at ${s.at}` : every
}

function nextOccurrences(trigger: Automation['trigger'], count = 3): string[] {
  if (trigger.kind !== 'schedule') return []
  const out: string[] = []
  try {
    const now = new Date()
    const [h, m] = (trigger.at || '09:00').split(':').map(n => parseInt(n, 10) || 0)
    let dt = new Date(now)
    dt.setSeconds(0, 0)
    dt.setHours(h, m, 0, 0)
    if (dt < now) dt = bump(dt, trigger.every || 'day')
    for (let i = 0; i < count; i++) {
      out.push(dt.toLocaleString())
      dt = bump(dt, trigger.every || 'day')
    }
  } catch {}
  return out

  function bump(d: Date, every: 'day'|'week'|'month'|'year') {
    const nd = new Date(d)
    if (every === 'day') nd.setDate(nd.getDate() + 1)
    else if (every === 'week') nd.setDate(nd.getDate() + 7)
    else if (every === 'month') nd.setMonth(nd.getMonth() + 1)
    else nd.setFullYear(nd.getFullYear() + 1)
    return nd
  }
}

function PreviewDrawer({
  a,
  onClose,
  onSave,
  onOpenTest,
  startEditing = false,
}: {
  a: Automation
  onClose: () => void
  onSave: (id: string, patch: Partial<Automation>) => Promise<void>
  onOpenTest: () => void
  startEditing?: boolean
}) {

  const isSMS = a.action.kind === 'sms'
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  useEffect(() => { if (editing && editorRef.current) editorRef.current.focus() }, [editing])

  // drafts
  const [draftBody, setDraftBody] = useState(
    isSMS ? (a.action as any).text : (a.action as any).body
  )
  const [draftSubject, setDraftSubject] = useState(
    a.action.kind === 'email' ? (a.action as any).subject : ''
  )
  const smsStats = isSMS ? smsParts(draftBody) : null

  // reset drafts when switching items
  useEffect(() => {
    const sms = a.action.kind === 'sms'
    setDraftBody(sms ? (a.action as any).text : (a.action as any).body)
    setDraftSubject(!sms ? (a.action as any).subject : '')
    setEditing(startEditing)
  }, [a.id, startEditing])

  async function save() {
    try {
      setBusy(true)
      if (a.action.kind === 'sms') {
        await onSave(a.id, { action: { ...a.action, text: draftBody } as any })
      } else {
        await onSave(a.id, {
          action: { ...a.action, subject: draftSubject, body: draftBody } as any,
        })
      }
      setEditing(false)
    } catch (e: any) {
      alert(e?.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed top-0 right-0 h-full w-[min(460px,90vw)] bg-neutral-950/95 backdrop-blur border-l border-white/10 shadow-2xl z-40" role="dialog" aria-label="Automation preview">
      <div className="p-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="opacity-80" />
          <div className="font-medium truncate">{a.title}</div>
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none"
            >
              Edit
            </button>
          ) : (
            <>
              <button
                onClick={() => setEditing(false)}
                className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                onClick={save}
                className="text-xs px-2 py-1 border border-white/15 bg-white/10 hover:bg-white/20 rounded-none"
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
          <button onClick={onClose} className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none">Close</button>
        </div>
      </div>

      <div className="p-3 space-y-3 text-sm">
        <div>
          <div className="text-xs text-white/60 mb-1">When</div>
          <ScheduleBadge trigger={a.trigger} />
        </div>

        <div>
          <div className="text-xs text-white/60 mb-1">Channel</div>
          <div className="inline-flex items-center gap-2 text-white/80">
            {isSMS ? <Phone size={14} /> : <Mail size={14} />}
            {isSMS ? 'SMS' : 'Email'}
          </div>
        </div>

        <div className="mt-2 border border-white/10 bg-white/5 rounded-2xl p-3">
          {!editing ? (
            // read-only preview
            isSMS ? (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1">Preview</div>
                <div className="ml-auto max-w-[85%] rounded-2xl px-3 py-2 shadow-sm bg-gray-900 text-white whitespace-pre-wrap">
                  {(a.action as any).text}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1">Preview</div>
                <div className="font-semibold">{(a.action as any).subject}</div>
                <div className="rounded-2xl px-3 py-2 shadow-sm bg-gray-900 text-white whitespace-pre-wrap">
                  {(a.action as any).body}
                </div>
              </div>
            )
          ) : (
            // editor
            <div className="space-y-2">
              {a.action.kind === 'email' && (
                <label className="block text-xs">
                  Subject
                  <input
                    ref={editorRef as React.RefObject<HTMLInputElement>}
                    value={draftSubject}
                    onChange={e => setDraftSubject(e.target.value)}
                    className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm"
                  />
                </label>
              )}
              <label className="block text-xs">
                {a.action.kind === 'sms' ? 'Message' : 'Body'}
                <textarea
                  ref={a.action.kind === 'sms' ? (editorRef as React.RefObject<HTMLTextAreaElement>) : undefined}
                  rows={6}
                  value={draftBody}
                  onChange={e => setDraftBody(e.target.value)}
                  className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm font-mono"
                />
                {a.action.kind === 'sms' && smsStats && (
                  <div className="text-[11px] text-white/60">
                    {smsStats.segments === 1
                      ? `${smsStats.length} / ${smsStats.perSegment} (${smsStats.encoding})`
                      : `${smsStats.length} chars • ${smsStats.segments} segments @ ${smsStats.perSegment} each (${smsStats.encoding})`}
                  </div>
                )}
              </label>

              <div className="text-[11px] text-white/60">
                Tips: use tokens like <code className="font-mono">{'{contact.firstName}'}</code>, <code className="font-mono">{'{appointment.date}'}</code>, <code className="font-mono">{'{user.name}'}</code>.
              </div>
            </div>
          )}
        </div>

        {/* Sticky action bar — always visible */}
        <div className="sticky bottom-0 p-2 border-t border-white/10 bg-neutral-950/95 backdrop-blur flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none"
          >
            Back to list
          </button>

          {!editing ? (
            <>
              <button
                onClick={() => setEditing(true)}
                className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none"
              >
                Edit
              </button>
              <button
                onClick={onOpenTest}
                className="text-xs px-2 py-1 border border-white/15 bg-white/10 hover:bg-white/20 rounded-none inline-flex items-center gap-1"
                title="Test / simulate"
              >
                <Send size={12} /> Test
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(false)}
                className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                onClick={save}
                className="text-xs px-2 py-1 border border-white/15 bg-white/10 hover:bg-white/20 rounded-none"
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- Test Drawer (friendly testing without going live) ---------- */

function TestDrawer({
  a,
  onClose,
  onSendTest,
  onSimulate,
}: {
  a: Automation
  onClose: () => void
  onSendTest: () => Promise<void> | void
  onSimulate: (payload: any) => Promise<any>
}) {
  const [mode, setMode] = useState<'send'|'simulate'>('send')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string>('')
  const [contactId, setContactId] = useState('')
  const [payload, setPayload] = useState('{\n  "example": true\n}')

  const nexts = nextOccurrences(a.trigger)

  async function doSend() {
    setBusy(true); setResult('')
    try {
      await onSendTest()
      setResult('✅ Test sent (check your inbox/phone).')
    } catch (e:any) {
      setResult(`❌ ${e?.message || 'Send failed'}`)
    } finally { setBusy(false) }
  }

  async function doSim() {
    setBusy(true); setResult('')
    try {
      let body: any = { contactId: contactId || undefined }
      try { body.payload = JSON.parse(payload) } catch { body.payload = payload }
      const j = await onSimulate(body)
      setResult(JSON.stringify(j, null, 2))
    } catch (e:any) {
      setResult(`❌ ${e?.message || 'Simulate failed'}`)
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed top-0 right-0 z-50 h-full w-[min(560px,95vw)] bg-neutral-950/95 backdrop-blur border-l border-white/10 shadow-2xl">
        <div className="p-3 border-b border-white/10 flex items-center justify-between">
          <div className="font-medium">Test “{a.title}”</div>
          <button onClick={onClose} className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none">
            Close
          </button>
        </div>

        <div className="p-3 space-y-3 text-sm">
          <div className="inline-flex rounded-md border border-white/10 overflow-hidden">
            <button className={`px-3 py-1.5 text-xs ${mode==='send'?'bg-white/10':''}`} onClick={()=>setMode('send')}>Send test</button>
            <button className={`px-3 py-1.5 text-xs border-l border-white/10 ${mode==='simulate'?'bg-white/10':''}`} onClick={()=>setMode('simulate')}>Simulate</button>
          </div>

          <div>
            <div className="text-xs text-white/60 mb-1">When</div>
            <ScheduleBadge trigger={a.trigger} />
            {nexts.length>0 && (
              <div className="mt-2 text-xs text-white/60">
                Next runs: {nexts.join(' • ')}
              </div>
            )}
          </div>

          <div className="border border-white/10 rounded-2xl p-3 bg-white/5">
            {mode === 'send' ? (
              <div className="space-y-2">
                <div className="text-xs text-white/70">
                  Sends to your user contact by default. (You can add custom targets later.)
                </div>
                {a.action.kind === 'sms' ? (
                  <div className="ml-auto max-w-[85%] rounded-2xl px-3 py-2 shadow-sm bg-gray-900 text-white whitespace-pre-wrap">
                    {(a.action as any).text}
                  </div>
                ) : (
                  <>
                    <div className="font-semibold">{(a.action as any).subject}</div>
                    <div className="rounded-2xl px-3 py-2 shadow-sm bg-gray-900 text-white whitespace-pre-wrap">
                      {(a.action as any).body}
                    </div>
                  </>
                )}
                <div className="pt-2">
                  <button
                    disabled={busy}
                    onClick={doSend}
                    className="px-3 py-1.5 text-sm border border-white/15 bg-white/10 hover:bg-white/20 rounded-none"
                  >
                    {busy ? 'Sending…' : 'Send test to me'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs block">
                  Contact ID (optional)
                  <input
                    value={contactId}
                    onChange={e=>setContactId(e.target.value)}
                    placeholder="e.g. c_123"
                    className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm"
                  />
                </label>
                <label className="text-xs block">
                  Event payload (JSON ok)
                  <textarea
                    rows={6}
                    value={payload}
                    onChange={e=>setPayload(e.target.value)}
                    className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm font-mono"
                  />
                </label>
                <div className="pt-2">
                  <button
                    disabled={busy}
                    onClick={doSim}
                    className="px-3 py-1.5 text-sm border border-white/15 bg-white/10 hover:bg-white/20 rounded-none"
                  >
                    {busy ? 'Simulating…' : 'Run simulation'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {result && (
            <div className="text-xs">
              <div className="mb-1 text-white/60">Result</div>
              <pre className="max-h-[30vh] overflow-auto p-2 rounded bg-black/60 border border-white/10 whitespace-pre-wrap">
                {result}
              </pre>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/* ---------- AI Hub ---------- */

function RulesMini({ items, onOpenRules }: { items: Automation[]; onOpenRules: () => void }) {
  const top = items.slice(0, 6)
  return (
    <div className="glass rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">Recent rules</div>
        <button onClick={onOpenRules} className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none">
          Manage rules
        </button>
      </div>
      {top.length === 0 ? (
        <div className="text-xs text-white/60">No rules yet.</div>
      ) : (
        <ul className="space-y-1 text-sm">
          {top.map(a => (
            <li key={a.id} className="flex items-center justify-between">
              <div className="truncate">
                <span className="font-medium">{a.title}</span>
                <span className="text-xs text-white/50 ml-2">{a.meta?.category || 'custom'}</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                {a.action.kind.toUpperCase()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AIHubView({
  items,
  onQuickAdd,
  goToTab,
  onOpenBuilder,
}: {
  items: Automation[]
  onQuickAdd: (key: string) => void
  goToTab: (t: Tab) => void
  onOpenBuilder: () => void
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {/* Inbound Voice AI */}
      <div className="glass rounded-xl p-3 space-y-2">
        <div className="text-sm font-medium mb-1">Inbound Voice AI</div>
        <div className="text-xs text-white/70">Answer calls, collect intent, book, and route. Configure numbers & call-flows.</div>
        <div className="flex gap-2">
          <a href="/phones?tab=routing" className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">Open Routing</a>
          <button onClick={() => window.dispatchEvent(new Event('voicehud:open'))} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">
            Open HUD
          </button>
        </div>
        <ul className="text-xs text-white/70 list-disc ml-5 mt-2">
          <li>Quiet hours & fallback to human</li>
          <li>Whitelisted intents (billing, new job, scheduling)</li>
          <li>Recording + transcript to Activity</li>
        </ul>
      </div>

      {/* Outbound Voice AI */}
      <div className="glass rounded-xl p-3 space-y-2">
        <div className="text-sm font-medium mb-1">Outbound Voice AI</div>
        <div className="text-xs text-white/70">Hands-off call campaigns with opt-out & throttling.</div>
        <div className="flex gap-2">
          <button onClick={() => goToTab('nurture')} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">
            Annual Nurture
          </button>
          <a href="/chatter" className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">Inbox</a>
        </div>
        <ul className="text-xs text-white/70 list-disc ml-5 mt-2">
          <li>Guardrails: quiet hours, max per day</li>
          <li>Tokens from CRM & appointment data</li>
          <li>Test mode before publish</li>
        </ul>
      </div>

      {/* Rules Mini */}
      <RulesMini items={items} onOpenRules={() => goToTab('rules')} />

      {/* SMS AI */}
      <div className="glass rounded-xl p-3 space-y-2">
        <div className="text-sm font-medium mb-1">SMS AI</div>
        <div className="text-xs text-white/70">Auto-replies & smart follow-ups in text threads.</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onQuickAdd('lead-instant-reply')} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">
            Add New Lead Auto-Reply
          </button>
          <button onClick={() => onQuickAdd('appt-reminder')} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">
            Add Appt Reminder
          </button>
          <button onClick={() => onQuickAdd('review-referral')} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">
            Add Review Ask
          </button>
          <button onClick={onOpenBuilder} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/10 hover:bg-white/20">
            Create custom rule
          </button>
        </div>
        <div className="text-xs text-white/60">Manage content in <button className="underline" onClick={() => goToTab('rules')}>Rules</button>.</div>
      </div>

      {/* Email AI */}
      <div className="glass rounded-xl p-3 space-y-2">
        <div className="text-sm font-medium mb-1">Email AI</div>
        <div className="text-xs text-white/70">Summaries, replies, and scheduled check-ins.</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onQuickAdd('annual-nurture')} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">
            Add Annual Nurture
          </button>
          <button onClick={() => goToTab('gallery')} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">
            Browse Templates
          </button>
          <button onClick={onOpenBuilder} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/10 hover:bg-white/20">
            Create custom rule
          </button>
        </div>
        <div className="text-xs text-white/60">Preview & test in <button className="underline" onClick={() => goToTab('rules')}>Rules</button>.</div>
      </div>
    </div>
  )
}