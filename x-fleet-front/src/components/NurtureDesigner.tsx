// src/components/NurtureDesigner.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Calendar, Mail, MessageSquare, Save, RefreshCcw, Plus, Trash2 } from 'lucide-react'
import { withTenant, getTenantId } from '../lib/socket'

type Channel = 'sms' | 'email'
type Touch = {
  id: string
  month: number   // 0..11
  day: number     // 1..28 (safe)
  channel: Channel
  templateName: string
  timeOfDay?: string // '09:00'
}
type Program = {
  id: string
  name: string
  audience: { leads: boolean; customers: boolean }
  quietHours?: { start: string; end: string } // '21:00'..'08:00'
  throttlePerDay?: number
  touches: Touch[]
}

function apiBase(): string {
  const env =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE) || ''
  if (env) return String(env).replace(/\/$/, '')
  return (typeof window !== 'undefined' ? window.location.origin : '').replace(/\/$/, '')
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function randId() {
  return Math.random().toString(36).slice(2, 10)
}

function sanitizeDay(d: number) {
  const n = Math.max(1, Math.min(28, Math.floor(d || 1)))
  return n
}

export default function NurtureDesigner() {
  const tenantId = useMemo(() => getTenantId(), [])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState<{ enrolled: number; nextRunsToday: number } | null>(null)

  // one default program for now
  const [program, setProgram] = useState<Program>(() => ({
    id: 'annual-default',
    name: 'Annual Nurture',
    audience: { leads: true, customers: true },
    quietHours: { start: '21:00', end: '08:00' },
    throttlePerDay: 250,
    touches: [
      { id: randId(), month: 0, day: 10, channel: 'sms',   templateName: 'New Year Check-In', timeOfDay: '10:00' },
      { id: randId(), month: 5, day: 12, channel: 'email', templateName: 'Summer Tune-Up',     timeOfDay: '09:30' },
      { id: randId(), month: 10, day: 6, channel: 'sms',   templateName: 'Pre-Winter Reminder', timeOfDay: '11:15' },
    ],
  }))

  // Load persisted program (if backend returns one)
  async function loadProgram() {
    try {
      setLoading(true)
      const r = await fetch(`${apiBase()}/api/nurture/program?id=${encodeURIComponent(program.id)}&clientId=${encodeURIComponent(tenantId)}`, withTenant())
      if (!r.ok) throw new Error('load failed')
      const j = await r.json().catch(() => ({}))
      if (j?.ok && j.program) setProgram(j.program as Program)
    } catch {
      // fine: keep local defaults
    } finally {
      setLoading(false)
    }
  }

  // Load simple stats (enrollment and today’s scheduled count)
  async function loadStats() {
    try {
      const r = await fetch(`${apiBase()}/api/nurture/stats?id=${encodeURIComponent(program.id)}&clientId=${encodeURIComponent(tenantId)}`, withTenant())
      const j = await r.json().catch(() => ({}))
      if (j?.ok) setStats({ enrolled: j.enrolled || 0, nextRunsToday: j.nextRunsToday || 0 })
    } catch {
      setStats(null)
    }
  }

  useEffect(() => {
    loadProgram()
    loadStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  function addTouch(ch: Channel) {
    setProgram((p) => ({
      ...p,
      touches: [
        ...p.touches,
        { id: randId(), month: new Date().getMonth(), day: 10, channel: ch, templateName: ch === 'sms' ? 'SMS Touch' : 'Email Touch', timeOfDay: '10:00' },
      ],
    }))
  }

  function updateTouch(id: string, patch: Partial<Touch>) {
    setProgram((p) => ({
      ...p,
      touches: p.touches.map(t => t.id === id ? { ...t, ...patch } : t),
    }))
  }

  function removeTouch(id: string) {
    setProgram((p) => ({ ...p, touches: p.touches.filter(t => t.id !== id) }))
  }

  async function save() {
    try {
      setSaving(true)
      const r = await fetch(`${apiBase()}/api/nurture/program`, {
        method: 'POST',
        ...withTenant({ headers: { 'Content-Type': 'application/json' } }),
        body: JSON.stringify({ program, clientId: tenantId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!j?.ok) throw new Error(j?.error || 'save failed')
      await loadStats()
      // Optional toast:
      // eslint-disable-next-line no-alert
      alert('Nurture saved')
    } catch (e: any) {
      alert(`Save failed: ${e?.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  const touchesByMonth = useMemo(() => {
    const bucket: Record<number, Touch[]> = {}
    for (let i = 0; i < 12; i++) bucket[i] = []
    for (const t of program.touches) bucket[t.month].push(t)
    for (let i = 0; i < 12; i++) bucket[i].sort((a,b) => a.day - b.day)
    return bucket
  }, [program.touches])

  // Simple preview of the next 12 months of sends
  const preview = useMemo(() => {
    const now = new Date()
    const items: { when: string; label: string }[] = []
    for (let i = 0; i < 12; i++) {
      const m = (now.getMonth() + i) % 12
      const year = now.getFullYear() + Math.floor((now.getMonth() + i) / 12)
      for (const t of touchesByMonth[m]) {
        const when = new Date(year, m, sanitizeDay(t.day))
        items.push({
          when: when.toDateString(),
          label: `${MONTHS[m]} ${sanitizeDay(t.day)} • ${t.channel.toUpperCase()} — ${t.templateName}`,
        })
      }
    }
    return items.slice(0, 24)
  }, [touchesByMonth])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={18} />
          <div className="text-lg font-semibold">Annual Nurture</div>
          {stats && (
            <div className="text-xs text-white/70 ml-2">
              Enrolled: <b>{stats.enrolled}</b> • Next 24h: <b>{stats.nextRunsToday}</b>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadProgram}
            className="text-xs inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 hover:bg-white/10"
            title="Reload from server"
          >
            <RefreshCcw size={12} /> Reload
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="text-xs inline-flex items-center gap-1 rounded bg-sky-600 px-3 py-1 text-white border border-sky-400/40 hover:bg-sky-500 disabled:opacity-50"
          >
            <Save size={12} /> Save
          </button>
        </div>
      </div>

      {/* Audience + Guardrails */}
      <div className="glass rounded-xl p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-sm font-medium">Audience</div>
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={program.audience.leads}
              onChange={(e) => setProgram(p => ({ ...p, audience: { ...p.audience, leads: e.target.checked } }))}
            /> Leads
          </label>
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={program.audience.customers}
              onChange={(e) => setProgram(p => ({ ...p, audience: { ...p.audience, customers: e.target.checked } }))}
            /> Customers
          </label>

          <div className="mx-3 h-6 w-px bg-white/10" />

          <div className="text-sm font-medium">Quiet hours</div>
          <input
            className="w-24 bg-black/30 border border-white/10 rounded px-2 py-1 text-sm"
            value={program.quietHours?.start || '21:00'}
            onChange={(e) => setProgram(p => ({ ...p, quietHours: { ...(p.quietHours || { start: '21:00', end: '08:00' }), start: e.target.value } }))}
          />
          <span className="text-sm text-white/60">to</span>
          <input
            className="w-24 bg-black/30 border border-white/10 rounded px-2 py-1 text-sm"
            value={program.quietHours?.end || '08:00'}
            onChange={(e) => setProgram(p => ({ ...p, quietHours: { ...(p.quietHours || { start: '21:00', end: '08:00' }), end: e.target.value } }))}
          />

          <div className="mx-3 h-6 w-px bg-white/10" />

          <div className="text-sm font-medium">Throttle/day</div>
          <input
            type="number"
            min={10}
            className="w-24 bg-black/30 border border-white/10 rounded px-2 py-1 text-sm"
            value={program.throttlePerDay ?? 250}
            onChange={(e) => setProgram(p => ({ ...p, throttlePerDay: Math.max(10, Number(e.target.value || 250)) }))}
          />
        </div>
      </div>

      {/* Year planner */}
      <div className="glass rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Year Planner</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => addTouch('sms')}
              className="text-xs inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 hover:bg-white/10"
            >
              <MessageSquare size={12} /> Add SMS
            </button>
            <button
              onClick={() => addTouch('email')}
              className="text-xs inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 hover:bg-white/10"
            >
              <Mail size={12} /> Add Email
            </button>
          </div>
        </div>

        {/* Month columns */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {MONTHS.map((m, idx) => (
            <div key={m} className="rounded-lg border border-white/10 bg-white/5 p-2">
              <div className="text-xs font-semibold mb-2">{m}</div>
              <ul className="space-y-2">
                {touchesByMonth[idx].map(t => (
                  <li key={t.id} className="rounded bg-black/25 border border-white/10 p-2">
                    <div className="flex items-center gap-2 mb-1">
                      {t.channel === 'sms' ? <MessageSquare size={14} /> : <Mail size={14} />}
                      <input
                        className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs"
                        value={t.templateName}
                        onChange={(e) => updateTouch(t.id, { templateName: e.target.value })}
                      />
                      <button
                        onClick={() => removeTouch(t.id)}
                        className="text-xs text-rose-400 hover:text-rose-300"
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-white/70">Day</label>
                      <input
                        type="number"
                        min={1}
                        max={28}
                        className="w-16 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs"
                        value={t.day}
                        onChange={(e) => updateTouch(t.id, { day: sanitizeDay(Number(e.target.value || 1)) })}
                      />
                      <label className="text-[11px] text-white/70 ml-2">Time</label>
                      <input
                        type="time"
                        className="w-28 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs"
                        value={t.timeOfDay || '10:00'}
                        onChange={(e) => updateTouch(t.id, { timeOfDay: e.target.value })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              {/* Quick add for the month */}
              <div className="mt-2 flex items-center gap-1">
                <button
                  onClick={() => setProgram(p => ({ ...p, touches: [...p.touches, { id: randId(), month: idx, day: 10, channel: 'sms', templateName: 'SMS Touch', timeOfDay: '10:00' }] }))}
                  className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/10"
                >
                  <Plus size={12} /> SMS
                </button>
                <button
                  onClick={() => setProgram(p => ({ ...p, touches: [...p.touches, { id: randId(), month: idx, day: 10, channel: 'email', templateName: 'Email Touch', timeOfDay: '10:00' }] }))}
                  className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/10"
                >
                  <Plus size={12} /> Email
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="glass rounded-xl p-3">
        <div className="text-sm font-medium mb-2">Preview (next 12 months)</div>
        <ul className="text-sm space-y-1 max-h-48 overflow-auto">
          {preview.map((p, i) => (
            <li key={i} className="text-white/80">{p.when} — {p.label}</li>
          ))}
          {preview.length === 0 && <li className="text-white/60 text-sm">No touches configured.</li>}
        </ul>
      </div>

      {loading && <div className="text-xs text-white/60">Loading program…</div>}
    </div>
  )
}