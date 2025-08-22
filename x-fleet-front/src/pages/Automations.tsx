// src/pages/Automations.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
  MessageSquare,
  CalendarCheck,
  Star,
  Clock,
  Send,
  Sparkles,
  Phone,
  Mail,
  Loader2,
  Trash2,
} from 'lucide-react'

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
      meta: { category: 'new-lead' },
    }),
  },
  {
    key: 'dispo-followup',
    Icon: Send,
    title: 'Disposition follow-up',
    blurb: 'Nudge after “Estimate Sent”.',
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
      meta: { category: 'disposition' },
    }),
  },
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
      meta: { category: 'appointment' },
    }),
  },
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
      meta: { category: 'reviews' },
    }),
  },
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
      meta: { category: 'nurture' },
    }),
  },
] as const

export default function AutomationsPage() {
  const [items, setItems] = useState<Automation[]>([])
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [preview, setPreview] = useState<Automation | null>(null)
  const [dryRunBusy, setDryRunBusy] = useState(false)

  async function load() {
    try {
      setLoading(true)
      const r = await fetch('/api/automations', { headers: { Accept: 'application/json' } })
      const j: ApiListResp = await r.json()
      if (!j.ok) throw new Error((j as any).error || 'Failed to load automations')
      setItems(j.items || [])
    } catch (e) {
      console.error(e)
      setItems([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

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
      if (!j.ok) throw new Error((j as any).error || 'Create failed')
      setItems(prev => [j.item, ...prev])
      setPreview(j.item) // open preview so users see what they just enabled
    } catch (e) {
      console.error(e)
      alert('Failed to create automation.')
    } finally {
      setSavingKey(null)
    }
  }

  async function toggleEnabledOptimistic(a: Automation, next: boolean) {
    // optimistic
    setItems(prev => prev.map(x => (x.id === a.id ? { ...x, enabled: next } : x)))
    try {
      const r = await fetch(`/api/automations/${encodeURIComponent(a.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const j: ApiOneResp = await r.json()
      if (!j.ok) throw new Error('Toggle failed')
      setItems(prev => prev.map(x => (x.id === a.id ? j.item : x)))
    } catch {
      // revert
      setItems(prev => prev.map(x => (x.id === a.id ? { ...x, enabled: a.enabled } : x)))
      alert('Could not update. Please try again.')
    }
  }

  async function removeAutomation(a: Automation) {
    if (!confirm(`Delete “${a.title}”?`)) return
    const keep = items
    setItems(prev => prev.filter(x => x.id !== a.id)) // optimistic
    try {
      const r = await fetch(`/api/automations/${encodeURIComponent(a.id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
    } catch {
      setItems(keep)
      alert('Delete failed.')
    }
  }

  async function dryRun(a: Automation) {
    setDryRunBusy(true)
    try {
      // Optional endpoint; safe to no-op on 404
      const r = await fetch(`/api/automations/${encodeURIComponent(a.id)}/dry-run`, { method: 'POST' })
      if (r.ok) {
        alert('Sent a test to your user contact (if configured).')
      } else {
        alert('Test sent (simulated). Wire /dry-run for full behavior.')
      }
    } catch {
      alert('Could not send test.')
    } finally {
      setDryRunBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return items
    return items.filter(a =>
      (a.title || '').toLowerCase().includes(qq) ||
      JSON.stringify(a.trigger).toLowerCase().includes(qq) ||
      JSON.stringify(a.action).toLowerCase().includes(qq)
    )
  }, [items, q])

  return (
    <div className="relative">
      {/* Hero header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="opacity-80" />
            
          </div>
          <p className="text-xs text-white/60">
            Create reminders, summaries, and checks. Audit logs live in{' '}
            <a className="underline" href="/events">Activity</a>.
          </p>
        </div>

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
      </div>

      {/* Recommended templates */}
      <div className="mb-4">
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
                  {savingKey === t.key ? 'Adding…' : 'Add'}
                  <span aria-hidden>→</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="border border-white/10 rounded-none">
        <div className="grid grid-cols-[1fr,16rem,16rem,9rem,9rem] text-xs bg-neutral-900/70 border-b border-white/10">
          <div className="px-3 py-2">Title</div>
          <div className="px-3 py-2">When</div>
          <div className="px-3 py-2">Action</div>
          <div className="px-3 py-2">Last run</div>
          <div className="px-3 py-2">Controls</div>
        </div>

        {filtered.length === 0 && !loading && (
          <div className="px-3 py-6 text-sm text-white/60">No automations yet.</div>
        )}

        <ul className="divide-y divide-white/10">
          {filtered.map(a => (
            <li
              key={a.id}
              className="grid grid-cols-[1fr,16rem,16rem,9rem,9rem] items-center text-sm hover:bg-white/5"
            >
              {/* Title */}
              <button
                className="px-3 py-2 text-left"
                onClick={() => setPreview(a)}
                title="Open preview"
              >
                <div className="font-medium truncate">{a.title}</div>
                <div className="text-xs text-white/60">{a.meta?.category || 'custom'}</div>
              </button>

              {/* When */}
              <div className="px-3 py-2 text-white/70 text-xs">
                <ScheduleBadge trigger={a.trigger} />
              </div>

              {/* Action */}
             <div className="px-3 py-2 text-white/70 text-xs truncate">
  {a.action.kind === 'sms' ? (
    <span className="inline-flex items-center gap-1">
      <Phone size={12} /> SMS → {a.action.to || 'contact'}:
      <span className="font-mono truncate max-w-[12rem]">
        {truncate((a.action as Extract<Automation['action'], {kind:'sms'}>).text, 60)}
      </span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <Mail size={12} /> Email → {a.action.to || 'contact'}:
      <span className="font-mono truncate max-w-[12rem]">
        {truncate((a.action as Extract<Automation['action'], {kind:'email'}>).subject, 40)}
      </span>
    </span>
  )}
</div>

              {/* Last run */}
              <div className="px-3 py-2 text-xs text-white/60">
                {a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : '—'}
              </div>

              {/* Controls */}
              <div className="px-3 py-2 flex items-center gap-2">
                <ActiveToggle value={a.enabled} onChange={(v) => toggleEnabledOptimistic(a, v)} />
                <button
                  onClick={() => dryRun(a)}
                  className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none disabled:opacity-50 inline-flex items-center gap-1"
                  disabled={dryRunBusy}
                  title="Send test to me"
                >
                  {dryRunBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Test
                </button>
                <button
                  onClick={() => removeAutomation(a)}
                  className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none inline-flex items-center gap-1"
                  title="Delete"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 text-xs text-white/50">
        Tip: personalize messages with tokens like <code className="font-mono">{"{contact.firstName}"}</code>, <code className="font-mono">{"{appointment.date}"}</code>, <code className="font-mono">{"{user.name}"}</code>.
      </div>

      {/* Right preview drawer */}
      {preview && (
        <PreviewDrawer a={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}

/* ---------- Small UI helpers ---------- */

function truncate(s: string, n: number) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
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
  if (s.rrule) return s.rrule // TODO: parse RRULE if you add a helper
  const every =
    s.every === 'day' ? 'Every day' :
    s.every === 'week' ? 'Every week' :
    s.every === 'month' ? 'Every month' :
    s.every === 'year' ? 'Every year' : 'Custom'
  return s.at ? `${every} at ${s.at}` : every
}

/* ---------- Preview Drawer ---------- */

function PreviewDrawer({ a, onClose }: { a: Automation; onClose: () => void }) {
  const isSMS = a.action.kind === 'sms'
  return (
    <div
      className="fixed top-0 right-0 h-full w-[min(460px,90vw)] bg-neutral-950/95 backdrop-blur border-l border-white/10 shadow-2xl z-40"
      role="dialog"
      aria-label="Automation preview"
    >
      <div className="p-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="opacity-80" />
          <div className="font-medium truncate">{a.title}</div>
        </div>
        <button onClick={onClose} className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none">
          Close
        </button>
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

     {/* Phone / email mock */}
<div className="mt-2 border border-white/10 bg-white/5 rounded-2xl p-3">
  {a.action.kind === 'sms' ? (
    (() => {
      const { text } = a.action; // narrowed to SMS
      return (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1">Preview</div>
          <div className="ml-auto max-w-[85%] rounded-2xl px-3 py-2 shadow-sm bg-gray-900 text-white whitespace-pre-wrap">
            {text}
          </div>
        </div>
      )
    })()
  ) : (
    (() => {
      const { subject, body } = a.action; // narrowed to Email
      return (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1">Preview</div>
          <div className="font-semibold">{subject}</div>
          <div className="rounded-2xl px-3 py-2 shadow-sm bg-gray-900 text-white whitespace-pre-wrap">
            {body}
          </div>
        </div>
      )
    })()
  )}
</div>

        <div className="text-xs text-white/60">
          Tokens will be filled at send time (e.g., <code className="font-mono">{"{contact.firstName}"}</code>,
          <code className="font-mono">{"{appointment.date}"}</code>, <code className="font-mono">{"{user.name}"}</code>).
        </div>
      </div>
    </div>
  )
}