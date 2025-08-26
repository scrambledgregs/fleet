// src/pages/JobBoard.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays, CheckCircle2, Columns3, Filter, List, Plus,
  Search, Timer, Users2, ChevronLeft, ChevronRight, XCircle, LayoutGrid
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../config'
import { makeSocket, getTenantId, withTenant } from '../lib/socket'
import type { Job } from '../types/schedule'

/* -------------------------------------------------------------------------- */
/* Design helpers                                                             */
/* -------------------------------------------------------------------------- */

const API_HTTP_BASE = `${API_BASE}`.endsWith('/api') ? API_BASE : `${API_BASE}/api`
const glassPanel =
  'rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur shadow-[inset_0_1px_0_rgba(255,255,255,.05)]'
const fmtTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''

/* -------------------------------------------------------------------------- */
/* Board model                                                                */
/* -------------------------------------------------------------------------- */

type StageId =
  | 'lead'
  | 'scheduled'
  | 'enroute'
  | 'working'
  | 'followup'
  | 'completed'
  | 'lost'

type Stage = {
  id: StageId
  name: string
  color: string           // header accent
  wipLimit?: number
}

const STAGES: Stage[] = [
  { id: 'lead',      name: 'Lead',        color: 'bg-sky-500/20 text-sky-200' },
  { id: 'scheduled', name: 'Scheduled',   color: 'bg-indigo-500/20 text-indigo-200' },
  { id: 'enroute',   name: 'En-Route',    color: 'bg-amber-500/20 text-amber-200' },
  { id: 'working',   name: 'In Progress', color: 'bg-emerald-500/20 text-emerald-200', wipLimit: 8 },
  { id: 'followup',  name: 'Follow-up',   color: 'bg-fuchsia-500/20 text-fuchsia-200' },
  { id: 'completed', name: 'Completed',   color: 'bg-lime-500/20 text-lime-200' },
  { id: 'lost',      name: 'Lost/Cancelled', color: 'bg-rose-500/20 text-rose-200' },
]

// infer a stage when API doesn’t send a clean one
function inferStage(j: Job): StageId {
  const raw = (j as any).stage ?? (j as any).status ?? (j as any).pipeline?.stage ?? ''
  const s = String(raw).toLowerCase()
  if (s.includes('lead') || s.includes('new')) return 'lead'
  if (s.includes('sched')) return 'scheduled'
  if (s.includes('route') || s.includes('dispatch')) return 'enroute'
  if (s.includes('work') || s.includes('progress') || s.includes('install')) return 'working'
  if (s.includes('follow')) return 'followup'
  if (s.includes('complete') || s.includes('done')) return 'completed'
  if (s.includes('lost') || s.includes('cancel')) return 'lost'
  const now = Date.now()
  const start = j.startTimeISO ? new Date(j.startTimeISO).getTime() : now
  return start > now ? 'scheduled' : 'lead'
}

const colorForJob = (j: Job) => {
  const key = (j.jobType || j.assignedRepName || '').toLowerCase()
  if (key.includes('install'))  return 'bg-indigo-500/18 text-indigo-200 ring-indigo-400/25'
  if (key.includes('inspect'))  return 'bg-amber-500/18 text-amber-200 ring-amber-400/25'
  if (key.includes('service'))  return 'bg-emerald-500/18 text-emerald-200 ring-emerald-400/25'
  if (key.includes('estimate')) return 'bg-sky-500/18 text-sky-200 ring-sky-400/25'
  return 'bg-white/06 text-white/85 ring-white/10'
}

/* -------------------------------------------------------------------------- */

type Mode = 'board' | 'swimlanes'
type Density = 'cozy' | 'compact'

export default function JobBoard() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // filters
  const [q, setQ] = useState('')
  const [onlyHighValue, setOnlyHighValue] = useState(false)
  const [assignees, setAssignees] = useState<string[]>([])

  // view
  const [mode, setMode] = useState<Mode>('board')
  const [density, setDensity] = useState<Density>('cozy')

  // live refresh
  const socketRef = useRef<ReturnType<typeof makeSocket> | null>(null)

  /* -------------------------------- Fetch --------------------------------- */

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null)

      const url = new URL(`${API_HTTP_BASE}/appointments`)
      url.searchParams.set('clientId', getTenantId())
      const now = new Date()
      const start = new Date(now); start.setDate(now.getDate()-7); start.setHours(0,0,0,0)
      const end = new Date(now); end.setDate(now.getDate()+21); end.setHours(23,59,59,999)
      url.searchParams.set('start', start.toISOString())
      url.searchParams.set('end', end.toISOString())

      const r = await fetch(url.toString(), withTenant())
      if (!r.ok) throw new Error('Failed to load')
      const j = await r.json()

      const arr: any[] = Array.isArray(j) ? j : j?.items || []
      const mapped: Job[] = arr.map((it) => ({
        id: String(it.id ?? it.appointmentId ?? crypto.randomUUID()),
        appointmentId: String(it.appointmentId ?? it.id ?? ''),
        startTimeISO: it.startTimeISO ?? it.startTime ?? it.start ?? it.start_iso,
        endTimeISO:   it.endTimeISO   ?? it.endTime   ?? it.end   ?? it.end_iso,
        jobType: it.jobType,
        estValue: Number(it.estValue ?? it.est_value ?? it.estimate ?? 0) || 0,
        territory: it.territory ?? '',
        address: it.address,
        lat: Number(it.lat ?? it.latitude ?? NaN),
        lng: Number(it.lng ?? it.longitude ?? NaN),
        assignedUserId:  it.assignedUserId != null ? String(it.assignedUserId) : null,
        assignedRepName: it.assignedRepName ?? null,
        contact: it.contact ?? {
          name: it.contactName ?? it.customer?.name ?? '—',
          phones: it.contact?.phones ?? [it.phone ?? it.customer?.phone].filter(Boolean),
          emails: it.contact?.emails ?? [it.email ?? it.customer?.email].filter(Boolean),
          address: it.contact?.address ?? it.customer?.address ?? it.address,
        },
        ...(it || {}),
      }))
      setJobs(mapped)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load')
      setJobs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const s = makeSocket(); socketRef.current = s
    const refresh = () => load()
    s.on('connect', refresh)
    s.on('job:created', refresh)
    s.on('job:updated', refresh)
    s.on('ai:booking', refresh)
    s.on('ai:suggestion', refresh)
    return () => { s.close() }
  }, [load])

  /* ------------------------------ Derivations ------------------------------ */

  const assigneeOptions = useMemo(() => {
    const set = new Set<string>()
    jobs.forEach(j => j.assignedRepName && set.add(j.assignedRepName))
    return Array.from(set).sort()
  }, [jobs])
  const assigneeLanes = useMemo(() => ['Unassigned', ...assigneeOptions], [assigneeOptions])

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase()
    return jobs.filter(j => {
      if (onlyHighValue && (j.estValue || 0) < 2500) return false
      if (assignees.length && (!j.assignedRepName || !assignees.includes(j.assignedRepName))) return false
      if (!qn) return true
      const hay = [
        j.contact?.name, j.jobType, j.territory, j.assignedRepName,
        (j as any)?.address?.address, (j as any)?.address?.city
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(qn)
    })
  }, [jobs, q, onlyHighValue, assignees])

  const byStage = useMemo(() => {
    const map = new Map<StageId, Job[]>()
    STAGES.forEach(s => map.set(s.id, []))
    for (const j of filtered) {
      const s = (j as any).stageId as StageId || inferStage(j)
      if (!map.has(s)) map.set(s, [])
      map.get(s)!.push(j)
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => {
        const ta = a.startTimeISO ? new Date(a.startTimeISO).getTime() : 0
        const tb = b.startTimeISO ? new Date(b.startTimeISO).getTime() : 0
        if (ta !== tb) return ta - tb
        return (b.estValue || 0) - (a.estValue || 0)
      })
    }
    return map
  }, [filtered])

  // stage + assignee buckets (for swimlanes grid)
  const byStageAssignee = useMemo(() => {
    const m = new Map<string, Job[]>() // key `${stage}|${assignee}`
    const key = (stage: StageId, who: string) => `${stage}|${who || 'Unassigned'}`
    for (const j of filtered) {
      const st = (j as any).stageId as StageId || inferStage(j)
      const who = j.assignedRepName || 'Unassigned'
      const k = key(st, who)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(j)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const ta = a.startTimeISO ? new Date(a.startTimeISO).getTime() : 0
        const tb = b.startTimeISO ? new Date(b.startTimeISO).getTime() : 0
        if (ta !== tb) return ta - tb
        return (b.estValue || 0) - (a.estValue || 0)
      })
    }
    return m
  }, [filtered])

  /* ------------------------------ Drag & drop ------------------------------ */

  const dragIdRef = useRef<string | null>(null)
  const onDragStart = (id: string) => (e: React.DragEvent) => {
    dragIdRef.current = id
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const dropToStage = (stage: StageId) => async (e: React.DragEvent) => {
    e.preventDefault()
    const id = (e.dataTransfer.getData('text/plain') || dragIdRef.current) as string
    if (!id) return
    setJobs(prev => prev.map(j => j.id === id ? ({ ...(j as any), stageId: stage }) : j))
    try {
      await fetch(`${API_HTTP_BASE}/appointments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
        ...withTenant(),
      } as any)
    } catch {}
    dragIdRef.current = null
  }

  const dropToStageAssignee = (stage: StageId, who: string) => async (e: React.DragEvent) => {
    e.preventDefault()
    const id = (e.dataTransfer.getData('text/plain') || dragIdRef.current) as string
    if (!id) return
    const assignedRepName = (who === 'Unassigned') ? null : who
    setJobs(prev => prev.map(j => j.id === id ? ({ ...(j as any), stageId: stage, assignedRepName }) : j))
    try {
      await fetch(`${API_HTTP_BASE}/appointments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, assignedRepName }),
        ...withTenant(),
      } as any)
    } catch {}
    dragIdRef.current = null
  }

  /* --------------------------------- UI ----------------------------------- */

  const cardPad = density === 'compact' ? 'px-2 py-1.5' : 'px-3 py-2'
  const cardTitle = density === 'compact' ? 'text-[12px]' : 'text-sm'
  const cardMeta = density === 'compact' ? 'text-[10px]' : 'text-[11px]'

  return (
    <div className="w-full px-4 lg:px-6">
      {/* Toolbar */}
      <div className={`${glassPanel} p-4 mb-6`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Columns3 size={18} className="opacity-90" />
            <div className="text-sm font-semibold">Job Board</div>

            {/* View toggle (Board / Swimlanes) */}
            <div className="h-4 w-px bg-white/10 mx-1 hidden md:block" />
            <div className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.06] p-1">
              <button
                onClick={()=>setMode('board')}
                className={`px-3 py-1.5 text-xs rounded-lg ${mode==='board'?'bg-white/20 shadow-sm':'hover:bg-white/10 text-white/85'}`}
              >
                Board
              </button>
              <button
                onClick={()=>setMode('swimlanes')}
                className={`px-3 py-1.5 text-xs rounded-lg ${mode==='swimlanes'?'bg-white/20 shadow-sm':'hover:bg-white/10 text-white/85'}`}
              >
                Swimlanes
              </button>
            </div>

            {/* Density toggle */}
            <div className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.06] p-1 ml-2">
              <button
                onClick={()=>setDensity('cozy')}
                className={`px-3 py-1.5 text-xs rounded-lg ${density==='cozy'?'bg-white/20 shadow-sm':'hover:bg-white/10 text-white/85'}`}
              >
                Cozy
              </button>
              <button
                onClick={()=>setDensity('compact')}
                className={`px-3 py-1.5 text-xs rounded-lg ${density==='compact'?'bg-white/20 shadow-sm':'hover:bg-white/10 text-white/85'}`}
              >
                Compact
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link to="/requestappointment"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs">
              <Plus size={14}/> New job
            </Link>
          </div>
        </div>

        {/* Filters row */}
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_260px_200px]">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-2.5 text-white/50" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, type, territory, address…"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-8 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-white/70" />
            <label className="text-xs flex items-center gap-2">
              <input type="checkbox" checked={onlyHighValue}
                onChange={(e)=>setOnlyHighValue(e.target.checked)} />
              High value (≥ $2,500)
            </label>
          </div>
          <AssigneeMulti
            options={assigneeOptions}
            selected={assignees}
            onChange={setAssignees}
          />
        </div>

        {error && <div className="mt-2 text-xs text-rose-300">{error}</div>}
        {loading && <div className="mt-2 text-xs text-white/70">Loading…</div>}
      </div>

      {/* ======== Mode: Board (columns by stage) ======== */}
      {mode === 'board' && (
        <div className="grid gap-4 xl:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {STAGES.map(stage => {
            const list = byStage.get(stage.id) || []
            const overLimit = stage.wipLimit && list.length > stage.wipLimit
            return (
              <section key={stage.id}
                onDragOver={(e)=>e.preventDefault()}
                onDrop={dropToStage(stage.id)}
                className={`rounded-3xl border border-white/10 bg-white/[0.04] p-3 min-h-[380px] flex flex-col`}
                aria-label={`${stage.name} column`}
              >
                <header className="flex items-center justify-between mb-2">
                  <div className="inline-flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${stage.color}`}>{stage.name}</span>
                    {stage.wipLimit && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${overLimit ? 'bg-rose-500/20 text-rose-200' : 'bg-white/10 text-white/70'}`}>
                        WIP {list.length}/{stage.wipLimit}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-white/60">{list.length}</div>
                </header>

                <div className="flex-1 space-y-2 overflow-auto pr-1">
                  {list.length === 0 && <div className="text-xs text-white/50 py-6 text-center">No jobs</div>}
                  {list.map(j => (
                    <Card key={j.id} j={j} onDragStart={onDragStart(j.id)} pad={cardPad} titleCls={cardTitle} metaCls={cardMeta}/>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* ======== Mode: Swimlanes (rows by assignee × columns by stage) ======== */}
      {mode === 'swimlanes' && (
        <div className="space-y-6">
          {/* Header row with stage labels */}
          <div className="grid grid-cols-[220px] sm:grid-cols-[240px] md:grid-cols-[280px] lg:grid-cols-[320px]  xl:grid-cols-[360px] 2xl:grid-cols-[380px] gap-2">
            <div className="text-[11px] text-white/60 px-1">Assignee</div>
          </div>
          {assigneeLanes.map(who => (
            <div key={who}>
              <div className="grid grid-cols-[220px_minmax(0,1fr)] sm:grid-cols-[240px_minmax(0,1fr)] md:grid-cols-[280px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)] gap-3">
                {/* Lane label */}
                <div className={`${glassPanel} p-3`}>
                  <div className="text-sm font-medium truncate">{who}</div>
                  <div className="text-[11px] text-white/60">
                    {(assigneeOptions.includes(who) ? filtered.filter(j=>j.assignedRepName===who) : filtered.filter(j=>!j.assignedRepName)).length} job(s)
                  </div>
                </div>

                {/* The row grid of stages */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7 gap-3">
                  {STAGES.map(stage => {
                    const key = `${stage.id}|${who}`
                    const items = byStageAssignee.get(key) || []
                    return (
                      <section key={key}
                        onDragOver={(e)=>e.preventDefault()}
                        onDrop={dropToStageAssignee(stage.id, who)}
                        className="rounded-3xl border border-white/10 bg-white/[0.04] p-2 min-h-[180px] flex flex-col"
                        aria-label={`${who} • ${stage.name}`}
                      >
                        <header className="flex items-center justify-between mb-1">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${stage.color}`}>{stage.name}</span>
                          <span className="text-[10px] text-white/60">{items.length}</span>
                        </header>
                        <div className="flex-1 space-y-2 overflow-auto pr-0.5">
                          {items.length === 0 && <div className="text-[11px] text-white/50 py-3 text-center">—</div>}
                          {items.map(j => (
                            <Card key={j.id} j={j} onDragStart={onDragStart(j.id)} pad={cardPad} titleCls={cardTitle} metaCls={cardMeta}/>
                          ))}
                        </div>
                      </section>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Small components                                                            */
/* -------------------------------------------------------------------------- */

function Card({
  j, onDragStart, pad, titleCls, metaCls,
}:{
  j: Job
  onDragStart: (e: React.DragEvent) => void
  pad: string
  titleCls: string
  metaCls: string
}) {
  return (
    <article
      draggable
      onDragStart={onDragStart}
      className={`rounded-xl ${pad} ring-1 hover:ring-white/30 cursor-grab active:cursor-grabbing ${colorForJob(j)}`}
      title={`${j.jobType ?? 'Job'} • ${j.assignedRepName ?? 'Unassigned'}`}
    >
      <div className="flex items-center justify-between">
        <div className={`${metaCls} opacity-80`}>
          {fmtTime(j.startTimeISO)} • {j.assignedRepName ?? 'Unassigned'}
        </div>
        {(j.estValue ?? 0) > 0 && (
          <div className={`${metaCls} opacity-80`}>${Math.round(Number(j.estValue || 0)).toLocaleString()}</div>
        )}
      </div>
      <div className={`${titleCls} font-medium truncate`}>{j.contact?.name || '—'}</div>
      <div className={`${metaCls} opacity-75 truncate`}>{j.jobType} • {j.territory || '—'}</div>
    </article>
  )
}

function AssigneeMulti({
  options, selected, onChange,
}:{
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
}){
  const toggle = (v:string) =>
    onChange(selected.includes(v) ? selected.filter(x=>x!==v) : [...selected, v])

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <Users2 size={14} className="text-white/70 min-w-[14px]" />
      <div className="flex flex-wrap gap-2">
        {options.length === 0 && <span className="text-xs text-white/50">No assignees yet</span>}
        {options.map(opt => {
          const active = selected.includes(opt)
          return (
            <button key={opt} onClick={()=>toggle(opt)}
              className={`px-2 py-1 rounded-full text-xs border ${active ? 'bg-white/20 border-white/20' : 'bg-white/10 border-white/10 hover:bg-white/15'}`}>
              {opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}