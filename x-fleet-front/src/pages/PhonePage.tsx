// x-fleet-front/src/pages/PhonePage.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Phone,
  PhoneCall,
  RefreshCcw,
  Play,
  Trash2,
  Plus,
  Save,
  ArrowUp,
  ArrowDown,
  UserPlus,
} from 'lucide-react'
import { makeSocket, getTenantId, withTenant } from '../lib/socket'
import { initVoiceClient } from '../lib/voice'
import { API_BASE } from '../config'
import CallRouting from './CallRouting' // 👈 tab-embedded IVR editor

const API_HTTP_BASE = `${API_BASE}`.endsWith('/api') ? API_BASE : `${API_BASE}/api`

type VoiceStatus = {
  id: string
  status: string
  to?: string
  from?: string
  error?: string
  at: string
}

type Recording = {
  id: string
  url: string | null
  from: string | null
  to: string | null
  durationSec: number | null
  at: string
  status: string
}

type Assignment = { userId: string; phone: string }

function normalizeE164(input: string) {
  const s = (input || '').replace(/[^\d+]/g, '')
  if (!s) return ''
  if (s.startsWith('+')) return s
  if (/^\d{10}$/.test(s)) return '+1' + s // US default
  if (/^\d{11}$/.test(s)) return '+' + s
  return s
}

export default function PhonePage() {
  const tenantId = useMemo(() => getTenantId(), [])
  const socketRef = useRef<any>(null)

  // 🔀 Tabs: Calls | Routing
  const [tab, setTab] = useState<'calls' | 'routing'>(() => {
    const qs = new URLSearchParams(window.location.search)
    return (qs.get('tab') as 'calls' | 'routing') || 'calls'
  })
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search)
    qs.set('tab', tab)
    window.history.replaceState(null, '', `${window.location.pathname}?${qs.toString()}`)
  }, [tab])

  // Calls tab state
  const [to, setTo] = useState('')
  const [statusFeed, setStatusFeed] = useState<VoiceStatus[]>([])
  const [recs, setRecs] = useState<Recording[]>([])

  // Numbers/Assignments/Rollover
  const [numbers, setNumbers] = useState<string[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [rollover, setRollover] = useState<string[]>([])
  const [loadingNums, setLoadingNums] = useState(false)

  // Forms
  const [newNumber, setNewNumber] = useState('')
  const [assignUserId, setAssignUserId] = useState('')
  const [assignPhone, setAssignPhone] = useState('')

  // Socket + voice once
  useEffect(() => {
    if (socketRef.current) return
    const s = makeSocket()
    socketRef.current = s
    initVoiceClient(s, tenantId)

    const onStatus = (payload: any) => {
      setStatusFeed((f) =>
        [...f, { ...payload, id: `${Date.now()}:${Math.random()}` }].slice(-200)
      )
    }

    const onRec = (e: any) => {
      const d = e?.detail ?? {}
      const id = d.recordingSid || `${d.callSid || 'call'}:${d.at || Date.now()}`
      setRecs((r) => [{ id, ...d }, ...r].slice(0, 50))
    }

    s.on?.('voice:status', onStatus)
    window.addEventListener('voice:recording-ready', onRec as EventListener)

    return () => {
      s.off?.('voice:status', onStatus)
      window.removeEventListener('voice:recording-ready', onRec as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchTenantVoiceState() {
    try {
      setLoadingNums(true)
      const r = await fetch(`${API_HTTP_BASE}/voice/numbers?tenantId=${tenantId}`, withTenant())
      const j = await r.json()
      if (j?.ok) {
        setNumbers(j.numbers || [])
        setAssignments(Array.isArray(j.assignments) ? j.assignments : [])
        setRollover(Array.isArray(j.rollover) ? j.rollover : [])
        if (!assignPhone && j.numbers?.[0]) setAssignPhone(j.numbers[0])
      }
    } catch {
      // ignore
    } finally {
      setLoadingNums(false)
    }
  }

  useEffect(() => {
    fetchTenantVoiceState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function dial() {
    const n = normalizeE164(to)
    if (!n) return
    window.dispatchEvent(new CustomEvent('voice:dial', { detail: { to: n } }))
    setTo('')
  }

  // ---- Numbers CRUD ----
  async function addNumber() {
    const phone = normalizeE164(newNumber)
    if (!phone) return
    try {
      const r = await fetch(`${API_HTTP_BASE}/voice/numbers`, withTenant({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, tenantId }),
      }))
      const j = await r.json()
      if (!j?.ok) throw new Error(j?.error || 'failed')
      setNewNumber('')
      await fetchTenantVoiceState()
    } catch (e: any) {
      alert(`Add failed: ${e?.message || e}`)
    }
  }

  async function removeNumber(phone: string) {
    try {
      const r = await fetch(`${API_HTTP_BASE}/voice/numbers`, withTenant({
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, tenantId }),
      }))
      const j = await r.json()
      if (!j?.ok) throw new Error(j?.error || 'failed')
      await fetchTenantVoiceState()
    } catch (e: any) {
      alert(`Remove failed: ${e?.message || e}`)
    }
  }

  // ---- Rollover order ----
  function moveRollover(idx: number, dir: -1 | 1) {
    setRollover((cur) => {
      const arr = cur.slice()
      const j = idx + dir
      if (j < 0 || j >= arr.length) return arr
      const tmp = arr[idx]
      arr[idx] = arr[j]
      arr[j] = tmp
      return arr
    })
  }

  async function saveRollover() {
    try {
      const r = await fetch(`${API_HTTP_BASE}/voice/rollover`, withTenant({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, numbers: rollover }),
      }))
      const j = await r.json()
      if (!j?.ok) throw new Error(j?.error || 'failed')
      await fetchTenantVoiceState()
    } catch (e: any) {
      alert(`Save failed: ${e?.message || e}`)
    }
  }

  // ---- Assignments ----
  async function addAssignment() {
    const userId = (assignUserId || '').trim()
    const phone = normalizeE164(assignPhone || '')
    if (!userId || !phone) return
    try {
      const r = await fetch(`${API_HTTP_BASE}/voice/assign`, withTenant({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, userId, phone }),
      }))
      const j = await r.json()
      if (!j?.ok) throw new Error(j?.error || 'failed')
      setAssignUserId('')
      await fetchTenantVoiceState()
    } catch (e: any) {
      alert(`Assign failed: ${e?.message || e}`)
    }
  }

  return (
    <div className="p-4 space-y-6">
      {/* Header with tabs */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Phone /> Phones
        </h1>
        <div className="inline-flex overflow-hidden rounded-md border border-white/10">
          <button
            onClick={() => setTab('calls')}
            className={'px-3 py-1.5 text-xs ' + (tab === 'calls' ? 'bg-white/10' : 'hover:bg-white/5')}
          >
            Calls
          </button>
          <button
            onClick={() => setTab('routing')}
            className={
              'px-3 py-1.5 text-xs border-l border-white/10 ' +
              (tab === 'routing' ? 'bg-white/10' : 'hover:bg-white/5')
            }
          >
            Routing
          </button>
        </div>
      </div>

      {tab === 'routing' ? (
        // 📞 Call-Tree / IVR editor
        <CallRouting />
      ) : (
        // 📟 Calls tab
        <>
          {/* Dialer */}
          <div className="flex gap-2">
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Enter number (E.164)"
              className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1"
            />
            <button
              onClick={dial}
              className="px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 flex items-center gap-1"
            >
              <PhoneCall size={16} /> Dial
            </button>
          </div>

          {/* Numbers registry */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="font-medium">Tenant Numbers</h2>
              <button onClick={fetchTenantVoiceState} className="text-xs flex items-center gap-1">
                <RefreshCcw size={12} /> Refresh
              </button>
            </div>

            {/* Add number */}
            <div className="flex gap-2 items-center">
              <input
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                placeholder="Add number (already provisioned in Twilio) e.g. +15551234567"
                className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1"
              />
              <button
                onClick={addNumber}
                className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1"
              >
                <Plus size={14} /> Add
              </button>
            </div>

            {loadingNums && <div className="text-sm text-white/60">Loading…</div>}
            {!loadingNums && numbers.length === 0 && (
              <div className="text-sm text-white/60">No numbers registered.</div>
            )}
            <ul className="space-y-1">
              {numbers.map((n) => (
                <li key={n} className="text-sm flex items-center justify-between">
                  <span className="font-mono">{n}</span>
                  <button
                    onClick={() => removeNumber(n)}
                    className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
                    title="Remove from tenant"
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Rollover order */}
          <div className="space-y-2">
            <h2 className="font-medium">Rollover Order</h2>
            {rollover.length === 0 && (
              <div className="text-sm text-white/60">
                No rollover set. Add numbers above, then arrange here.
              </div>
            )}
            <ul className="space-y-1">
              {rollover.map((n, idx) => (
                <li
                  key={n}
                  className="text-sm flex items-center justify-between bg-black/20 border border-white/10 rounded px-2 py-1"
                >
                  <span className="font-mono">{n}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveRollover(idx, -1)}
                      className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10"
                      aria-label="Move up"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      onClick={() => moveRollover(idx, 1)}
                      className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10"
                      aria-label="Move down"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <button
              onClick={saveRollover}
              disabled={rollover.length === 0}
              className="mt-1 inline-flex items-center gap-1 px-3 py-1 rounded bg-white/10 border border-white/15 hover:bg-white/15 disabled:opacity-50 text-sm"
            >
              <Save size={14} /> Save Rollover
            </button>
          </div>

          {/* Direct assignments */}
          <div className="space-y-2">
            <h2 className="font-medium">Direct Number → User</h2>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                value={assignUserId}
                onChange={(e) => setAssignUserId(e.target.value)}
                placeholder="User ID (e.g. t1, t2 …)"
                className="w-48 bg-black/30 border border-white/10 rounded px-2 py-1 text-sm"
              />
              <select
                value={assignPhone}
                onChange={(e) => setAssignPhone(e.target.value)}
                className="w-56 bg-black/30 border border-white/10 rounded px-2 py-1 text-sm"
              >
                {numbers.length === 0 && <option value="">(no numbers)</option>}
                {numbers.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <button
                onClick={addAssignment}
                className="inline-flex items-center gap-1 px-3 py-1 rounded bg-white/10 border border-white/15 hover:bg-white/15 text-sm"
              >
                <UserPlus size={14} /> Assign
              </button>
            </div>

            <ul className="space-y-1 text-sm">
              {assignments.map((a) => (
                <li
                  key={`${a.userId}:${a.phone}`}
                  className="flex items-center justify-between bg-black/15 border border-white/10 rounded px-2 py-1"
                >
                  <span>
                    <span className="text-white/70">User</span>{' '}
                    <code className="font-mono">{a.userId}</code>{' '}
                    <span className="text-white/70">→</span>{' '}
                    <code className="font-mono">{a.phone}</code>
                  </span>
                </li>
              ))}
              {assignments.length === 0 && (
                <li className="text-white/60">No direct assignments yet.</li>
              )}
            </ul>
          </div>

          {/* Live status feed */}
          <div>
            <h2 className="font-medium mb-2">Call Status</h2>
            <ul className="space-y-1 text-sm max-h-40 overflow-auto">
              {statusFeed.map((s) => (
                <li key={s.id} className="text-white/80">
                  <span className="font-mono">{s.at?.slice(11, 19) || '--:--:--'}</span> — {s.status}
                  {s.to && <> → {s.to}</>}
                  {s.error && <span className="text-red-400"> ({s.error})</span>}
                </li>
              ))}
            </ul>
          </div>

          {/* Recordings */}
          <div>
            <h2 className="font-medium mb-2">Recent Recordings</h2>
            <ul className="space-y-2 text-sm">
              {recs.map((r) => (
                <li key={r.id} className="p-2 border border-white/10 rounded bg-black/20">
                  <div className="flex justify-between">
                    <div>
                      {r.from ?? '—'} → {r.to ?? '—'}
                    </div>
                    <div>{Math.round(r.durationSec || 0)}s</div>
                  </div>
                  <div className="flex gap-2 mt-1">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-emerald-400"
                      >
                        <Play size={14} /> Play
                      </a>
                    ) : (
                      <span className="text-white/40">No file</span>
                    )}
                  </div>
                </li>
              ))}
              {recs.length === 0 && <li className="text-white/60">No recordings yet.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}