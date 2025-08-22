// src/pages/EventsPage.tsx
import React, { useEffect, useMemo, useState } from 'react'

type DomainEvent = {
  id: string
  type: string
  clientId?: string
  at: string
  payload?: any
  meta?: { source?: string; user?: string }
}

type ApiResp =
  | { ok: true; events?: any[]; items?: any[] }
  | { ok: false; error: string }

export default function EventsPage() {
  const [events, setEvents] = useState<DomainEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  async function load() {
    try {
      setLoading(true)
      const url = `/api/events?limit=50`
      const r = await fetch(url, { headers: { Accept: 'application/json' } })
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json')) {
        const text = await r.text()
        throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 120)}`)
      }
      const j: ApiResp = await r.json()
      if (!('ok' in j) || !j.ok) throw new Error((j as any).error || 'Failed to load events')

      const rows = (j as any).events ?? (j as any).items ?? []
      const mapped: DomainEvent[] = rows.map((e: any) => ({
        id: String(e.id),
        type: String(e.name || e.type || 'event'),
        clientId: e.clientId ?? e.client ?? undefined,
        at: String(e.ts || e.at || new Date().toISOString()),
        payload: e.payload ?? {},
        meta: { source: e.source || e.meta?.source, user: e.meta?.user || e.user },
      }))

      mapped.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      setEvents(mapped)
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Failed to load events')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  const filtered = useMemo(() => {
    const qNorm = q.trim().toLowerCase()
    return events.filter(ev => {
      const typeOk = !typeFilter || ev.type === typeFilter
      if (!typeOk) return false
      if (!qNorm) return true
      const hay = JSON.stringify(ev).toLowerCase()
      return hay.includes(qNorm)
    })
  }, [events, q, typeFilter])

  const uniqueTypes = useMemo(
    () => Array.from(new Set(events.map(e => e.type))).sort(),
    [events]
  )

  function contactLabel(p: any): string {
    return (
      p?.contactName ||
      p?.contact?.name ||
      p?.customerName ||
      p?.contactId ||
      p?.contact?.id ||
      '—'
    )
  }
  function userLabel(ev: DomainEvent): string {
    const p = ev.payload || {}
    return (
      ev.meta?.user ||
      p.assignedRepName ||
      p.assignedTo ||
      p.user ||
      p.ownerName ||
      '—'
    )
  }

  return (
    <div className="glass p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search payload, contactId, etc."
            className="px-3 py-2 text-sm bg-neutral-900 border border-white/10 outline-none focus:border-white/30"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-neutral-900 border border-white/10 outline-none focus:border-white/30"
          >
            <option value="">All types</option>
            {uniqueTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2 text-sm border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-red-400 text-sm">{error}</div>}

      <div className="border border-white/10">
        {/* Header: Type / Contact / User / Time */}
        <div className="grid grid-cols-[14rem,1fr,12rem,14rem] text-xs bg-neutral-900/70 border-b border-white/10">
          <div className="px-3 py-2">Type</div>
          <div className="px-3 py-2">Contact</div>
          <div className="px-3 py-2">User</div>
          <div className="px-3 py-2">Time</div>
        </div>

        {filtered.length === 0 && !loading && (
          <div className="px-3 py-6 text-sm text-white/60">No events yet.</div>
        )}

        <ul className="divide-y divide-white/10">
          {filtered.map(ev => (
            <li key={ev.id} className="grid grid-cols-[14rem,1fr,12rem,14rem] text-sm hover:bg-white/5">
              <div className="px-3 py-2 font-medium">{ev.type}</div>
              <div className="px-3 py-2 text-white/70">{contactLabel(ev.payload)}</div>
              <div className="px-3 py-2 text-white/70">{userLabel(ev)}</div>
              <div className="px-3 py-2 text-white/70">
                {new Date(ev.at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}