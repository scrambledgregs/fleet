// src/pages/Calendar.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Filter, MapPin, Plus, Users2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import JobDetails from '../components/JobDetails'
import JobCard from '../components/JobCard'
import { API_BASE } from '../config'
import { makeSocket, getTenantId, withTenant } from '../lib/socket'
import type { Job } from '../types/schedule'

const API_HTTP_BASE = `${API_BASE}`.endsWith('/api') ? API_BASE : `${API_BASE}/api`
const weekdayOrder = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] as const
const fmtTime = (iso?: string) => iso ? new Date(iso).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : ''
const colorForJob = (j: Job) => {
  const key = (j.jobType || j.assignedRepName || '').toLowerCase()
  if (key.includes('install')) return 'bg-indigo-500/18 text-indigo-200 ring-indigo-400/25'
  if (key.includes('inspect')) return 'bg-amber-500/18 text-amber-200 ring-amber-400/25'
  if (key.includes('service')) return 'bg-emerald-500/18 text-emerald-200 ring-emerald-400/25'
  if (key.includes('estimate')) return 'bg-sky-500/18 text-sky-200 ring-sky-400/25'
  const hues = ['rose','violet','cyan','lime','fuchsia','orange'] as const
  const h = hues[Math.abs(hashString(key)) % hues.length]
  return `bg-${h}-500/18 text-${h}-200 ring-${h}-400/25`
}
function hashString(s:string){ let h=0; for(let i=0;i<s.length;i++) h=(h<<5)-h+s.charCodeAt(i); return h }
function startOfWeek(d:Date){ const x=new Date(d); const diff=x.getDay(); x.setDate(x.getDate()-diff); x.setHours(0,0,0,0); return x }
const iso = (d:Date)=> new Date(d).toISOString()
function monthGrid(date:Date){ const first=new Date(date.getFullYear(),date.getMonth(),1); const start=startOfWeek(first); const days:Date[]=[]; for(let i=0;i<42;i++){ const d=new Date(start); d.setDate(start.getDate()+i); days.push(d) } return days }

type View = 'day'|'week'|'month'

export default function Calendar(){
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initDateParam = searchParams.get('date')
  const initialDate = initDateParam ? new Date(initDateParam) : new Date()
  const [view, setView] = useState<View>(initDateParam ? 'day' : 'week')
  const [cursor, setCursor] = useState<Date>(initialDate)

  const [items, setItems] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string|null>(null)

  const [openId, setOpenId] = useState<string|null>(null)
  const [openSeed, setOpenSeed] = useState<Partial<Job>|null>(null)

  const [selectedTechs, setSelectedTechs] = useState<string[]>([])
  const [selectedTerritories, setSelectedTerritories] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [onlyHighValue, setOnlyHighValue] = useState(false)
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)

  const socketRef = useRef<ReturnType<typeof makeSocket>|null>(null)

  const loadRange = useCallback(async (startISO?:string, endISO?:string)=>{
    try{
      setLoading(true); setError(null)
      let url:URL
      if(startISO && endISO){
        url = new URL(`${API_HTTP_BASE}/appointments`)
        url.searchParams.set('clientId', getTenantId())
        url.searchParams.set('start', startISO)
        url.searchParams.set('end', endISO)
      }else{
        url = new URL(`${API_HTTP_BASE}/week-appointments`)
        url.searchParams.set('clientId', getTenantId())
      }
      const r = await fetch(url.toString(), withTenant())
      if(!r.ok) throw new Error('Failed to load')
      const j = await r.json()
      const arr:any[] = Array.isArray(j) ? j : j?.items || []
      const mapped:Job[] = arr.map((it)=>({
        id: String(it.id ?? it.appointmentId ?? crypto.randomUUID()),
        appointmentId: String(it.appointmentId ?? it.id ?? ''),
        day: it.day, dateText: it.dateText, time: it.time,
        startTimeISO: it.startTimeISO ?? it.startTime ?? it.start ?? it.start_iso ?? new Date().toISOString(),
        endTimeISO: it.endTimeISO ?? it.endTime ?? it.end ?? it.end_iso ?? undefined,
        jobType: it.jobType,
        estValue: Number(it.estValue ?? it.est_value ?? it.estimate ?? it.custom?.estValue ?? it.custom?.estimate ?? 0) || 0,
        territory: it.territory ?? '', address: it.address,
        lat: Number(it.lat ?? it.latitude ?? NaN), lng: Number(it.lng ?? it.longitude ?? NaN),
        fitScore: typeof it.fitScore==='number' ? it.fitScore : undefined,
        assignedUserId: it.assignedUserId!=null ? String(it.assignedUserId) : null,
        assignedRepName: it.assignedRepName ?? null, vehicleName: it.vehicleName ?? null,
        travelMinutesFromPrev: typeof it.travelMinutesFromPrev==='number' ? it.travelMinutesFromPrev : null,
        contact: it.contact ?? {
          name: it.contactName ?? it.customer?.name ?? '—',
          phones: it.contact?.phones ?? [it.phone ?? it.customer?.phone].filter(Boolean),
          emails: it.contact?.emails ?? [it.email ?? it.customer?.email ?? it.customer?.primaryEmail].filter(Boolean),
          address: it.contact?.address ?? it.customer?.address ?? it.address,
        },
      }))
      setItems(mapped)
    }catch(e:any){ setError(e?.message || 'Failed to load'); setItems([]) }
    finally{ setLoading(false) }
  },[])

  useEffect(()=>{
    if(view==='month'){
      const start=new Date(cursor.getFullYear(),cursor.getMonth(),1)
      const end=new Date(cursor.getFullYear(),cursor.getMonth()+1,0)
      start.setHours(0,0,0,0); end.setHours(23,59,59,999)
      loadRange(iso(start), iso(end))
    }else{
      const start=startOfWeek(cursor); const end=new Date(start)
      end.setDate(start.getDate()+6); end.setHours(23,59,59,999)
      loadRange(iso(start), iso(end))
    }
  },[cursor,view,loadRange])

  useEffect(()=>{ const s=makeSocket(); socketRef.current=s
    const refresh=()=> {
      if(view==='month'){
        const start=new Date(cursor.getFullYear(),cursor.getMonth(),1)
        const end=new Date(cursor.getFullYear(),cursor.getMonth()+1,0)
        start.setHours(0,0,0,0); end.setHours(23,59,59,999); loadRange(iso(start), iso(end))
      }else{
        const start=startOfWeek(cursor); const end=new Date(start)
        end.setDate(start.getDate()+6); end.setHours(23,59,59,999); loadRange(iso(start), iso(end))
      }
    }
    s.on('connect',refresh); s.on('job:created',refresh); s.on('job:updated',refresh)
    s.on('ai:booking',refresh); s.on('ai:suggestion',refresh)
    return ()=>{ s.close() }
  },[cursor,view,loadRange])

  const techs = useMemo(()=>{ const set=new Set<string>(); items.forEach(i=>i.assignedRepName && set.add(i.assignedRepName)); return Array.from(set).sort() },[items])
  const territories = useMemo(()=>{ const set=new Set<string>(); items.forEach(i=>i.territory && set.add(i.territory)); return Array.from(set).sort() },[items])
  const types = useMemo(()=>{ const set=new Set<string>(); items.forEach(i=>i.jobType && set.add(i.jobType)); return Array.from(set).sort() },[items])

  const filtered = useMemo(()=> items.filter(i=>{
    if(onlyUnassigned && i.assignedRepName) return false
    if(onlyHighValue && (i.estValue||0) < 2500) return false
    if(selectedTechs.length && (!i.assignedRepName || !selectedTechs.includes(i.assignedRepName))) return false
    if(selectedTerritories.length && (!i.territory || !selectedTerritories.includes(i.territory))) return false
    if(selectedTypes.length && (!i.jobType || !selectedTypes.includes(i.jobType))) return false
    return true
  }),[items,selectedTechs,selectedTerritories,selectedTypes,onlyHighValue,onlyUnassigned])

  const byDay = useMemo(()=> {
    const m=new Map<string,{dateText?:string; rows:Job[]}>()
    for(const it of filtered){
      const key = it.day ?? weekdayOrder[new Date(it.startTimeISO).getDay()]
      if(!m.has(key)) m.set(key,{dateText:it.dateText, rows:[]})
      m.get(key)!.rows.push(it)
    }
    return Array.from(m.entries())
      .sort((a,b)=> weekdayOrder.indexOf(a[0] as any) - weekdayOrder.indexOf(b[0] as any))
      .map(([day,val])=>({ day, dateText:val.dateText, rows: val.rows.sort((x,y)=> new Date(x.startTimeISO).getTime()-new Date(y.startTimeISO).getTime()) }))
  },[filtered])

  const dayRows = useMemo(()=>{ const d=weekdayOrder[cursor.getDay()]; const found=byDay.find(b=>b.day===d); return found?found.rows:[] },[byDay,cursor])

  const moveCursor=(delta:number)=>{ const next=new Date(cursor); if(view==='day') next.setDate(next.getDate()+delta); if(view==='week') next.setDate(next.getDate()+7*delta); if(view==='month') next.setMonth(next.getMonth()+delta); setCursor(next) }

  const niceRangeLabel = useMemo(()=> {
    if(view==='month') return cursor.toLocaleString(undefined,{month:'long', year:'numeric'})
    if(view==='week'){ const start=startOfWeek(cursor); const end=new Date(start); end.setDate(start.getDate()+6)
      const s=start.toLocaleDateString(undefined,{month:'short', day:'numeric'})
      const e=end.toLocaleDateString(undefined,{month:'short', day:'numeric', year:'numeric'})
      return `${s} – ${e}`
    }
    return cursor.toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric', year:'numeric'})
  },[cursor,view])

  return (
    <div className="w-full max-w-none px-4 lg:px-6">
      {/* Wider rail + flexible canvas */}
      <div className="grid gap-8 grid-cols-[minmax(420px,520px)_minmax(0,1fr)]">
        {/* STICKY RAIL */}
        <aside className="md:sticky md:top-16 self-start">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,.05)] backdrop-blur p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-2">
                <CalendarDays size={18} className="opacity-90" />
                <div className="text-sm font-semibold">Schedule</div>
              </div>
              <button onClick={()=>setCursor(new Date())} className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/10 hover:bg-white/20">Today</button>
            </div>

            {/* Segmented tabs like Team Chat */}
            <div className="flex items-center justify-between">
              <SegmentedTabs
                value={view}
                onChange={setView}
                items={[
                  { id: 'day',   label: 'Day' },
                  { id: 'week',  label: 'Week' },
                  { id: 'month', label: 'Month' },
                ]}
              />
              <div className="inline-flex items-center gap-1">
                <button onClick={()=>moveCursor(-1)} className="p-1.5 rounded-full hover:bg-white/10 border border-white/10" aria-label="Previous"><ChevronLeft size={16}/></button>
                <div className="text-sm px-2 text-white/85">{niceRangeLabel}</div>
                <button onClick={()=>moveCursor(1)} className="p-1.5 rounded-full hover:bg-white/10 border border-white/10" aria-label="Next"><ChevronRight size={16}/></button>
              </div>
            </div>

            {/* Filters */}
            <div className="space-y-4">
              <div className="flex items-center gap-2"><Filter size={14} className="opacity-70"/><div className="text-xs text-white/70">Filters</div></div>
              <PillGroup label="Assignees" options={techs} selected={selectedTechs} onToggle={(v)=>setSelectedTechs(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v])} icon={<Users2 size={12}/>}/>
              <PillGroup label="Territories" options={territories} selected={selectedTerritories} onToggle={(v)=>setSelectedTerritories(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v])} icon={<MapPin size={12}/>}/>
              <PillGroup label="Types" options={types} selected={selectedTypes} onToggle={(v)=>setSelectedTypes(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v])}/>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyUnassigned} onChange={(e)=>setOnlyUnassigned(e.target.checked)} />Unassigned only</label>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyHighValue} onChange={(e)=>setOnlyHighValue(e.target.checked)} />High value (≥ $2,500)</label>
              </div>
              <div className="flex items-center justify-between">
                <button onClick={()=>{ setSelectedTechs([]); setSelectedTerritories([]); setSelectedTypes([]); setOnlyHighValue(false); setOnlyUnassigned(false) }} className="text-xs underline text-white/70 hover:text-white/90">Clear filters</button>
                <button onClick={()=>navigate('/requestappointment')} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs"><Plus size={14}/> New appointment</button>
              </div>
              {error && <div className="text-xs text-rose-300">{error}</div>}
              {loading && <div className="text-xs text-white/70">Loading…</div>}
            </div>
          </div>
        </aside>

        {/* CANVAS */}
        <main className="min-h-[calc(100vh-120px)]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
            {view==='week' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold">Week</div>
                  <div className="text-xs text-white/60">{filtered.length} appointment(s)</div>
                </div>
                <div className="grid grid-cols-7 gap-3">
                  {byDay.map(({day,dateText,rows})=>(
                    <div key={day} className="rounded-2xl border border-white/10 bg-white/[0.03] p-2">
                      <div className="flex items-baseline justify-between mb-2">
                        <div className="text-sm font-semibold">{day}</div>
                        <div className="text-[11px] text-white/60">{dateText}</div>
                      </div>
                      <div className="space-y-2">
                        {rows.length===0 && <div className="text-xs text-white/50">No jobs</div>}
                        {rows.map(r=>(
                          <button key={r.id} onClick={()=>{ setOpenId(r.id); setOpenSeed(r) }} className={`w-full text-left rounded-xl px-3 py-2 ring-1 hover:ring-white/30 ${colorForJob(r)}`}>
                            <div className="text-[11px] opacity-80">{fmtTime(r.startTimeISO)} • {r.assignedRepName ?? 'Unassigned'}</div>
                            <div className="text-sm font-medium truncate">{r.contact?.name || '—'}</div>
                            <div className="text-[11px] opacity-75 truncate">{r.jobType} • {r.territory || '—'}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {view==='day' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold">Day</div>
                  <div className="text-xs text-white/60">
                    {cursor.toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'})}
                  </div>
                </div>
                <div className="space-y-2">
                  {dayRows.length===0 && <div className="text-sm text-white/60">No jobs today.</div>}
                  {dayRows.map(r=>(
                    <JobCard key={r.id} job={r} onOpen={(job)=>{ setOpenId(job.id); setOpenSeed(job) }} isSelected={openId===r.id}/>
                  ))}
                </div>
              </>
            )}

            {view==='month' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold">Month</div>
                  <div className="text-xs text-white/60">{cursor.toLocaleString(undefined,{month:'long', year:'numeric'})}</div>
                </div>
                <MonthGrid date={cursor} jobs={filtered} onOpen={(j)=>{ setOpenId(j.id); setOpenSeed(j) }} />
              </>
            )}
          </div>
        </main>
      </div>

      {openId && (
        <JobDetails jobId={openId} seed={openSeed ?? undefined} onClose={()=>{ setOpenId(null); setOpenSeed(null) }} />
      )}
    </div>
  )
}

/* ── Tabs styled like your Team Chat header ─────────────────────────────── */

function SegmentedTabs({
  value, onChange, items,
}:{
  value:'day'|'week'|'month'
  onChange:(v:'day'|'week'|'month')=>void
  items:{id:'day'|'week'|'month'; label:string}[]
}){
  return (
    <div role="tablist" aria-label="Calendar views"
         className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.06] p-1">
      {items.map(({id,label})=>{
        const active = value===id
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            onClick={()=>onChange(id)}
            className={`px-3 py-1.5 text-xs rounded-lg transition
              ${active ? 'bg-white/20 shadow-sm' : 'hover:bg-white/10 text-white/85'}
            `}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/* ── Pills & MonthGrid unchanged except for spacing ─────────────────────── */

function PillGroup({label,options,selected,onToggle,icon}:{label:string; options:string[]; selected:string[]; onToggle:(v:string)=>void; icon?:React.ReactNode}){
  if(!options.length) return null
  return (
    <div>
      <div className="text-xs text-white/70 mb-1 inline-flex items-center gap-1">{icon}{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map(opt=>{
          const active = selected.includes(opt)
          return (
            <button key={opt} onClick={()=>onToggle(opt)}
              className={`px-2 py-1 rounded-full text-xs border ${active?'bg-white/20 border-white/20':'bg-white/10 border-white/10 hover:bg-white/15'}`}
              title={opt}>{opt}</button>
          )
        })}
      </div>
    </div>
  )
}

function MonthGrid({date,jobs,onOpen}:{date:Date; jobs:Job[]; onOpen:(j:Job)=>void}){
  const cells = useMemo(()=>monthGrid(date),[date])
  const map = useMemo(()=>{
    const m=new Map<string,Job[]>()
    for(const j of jobs){
      const d=new Date(j.startTimeISO); const key=d.toISOString().slice(0,10)
      if(!m.has(key)) m.set(key,[])
      m.get(key)!.push(j)
    }
    for(const [,arr] of m){ arr.sort((a,b)=> new Date(a.startTimeISO).getTime()-new Date(b.startTimeISO).getTime()) }
    return m
  },[jobs])
  const thisMonth = date.getMonth()

  return (
    <div className="grid grid-cols-7 gap-2">
      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>(
        <div key={d} className="text-[11px] text-white/60 px-1">{d}</div>
      ))}
      {cells.map(d=>{
        const key=d.toISOString().slice(0,10)
        const dayJobs=map.get(key)||[]
        const isOtherMonth=d.getMonth()!==thisMonth
        const label=d.getDate()
        return (
          <div key={key} className={`rounded-2xl border p-2 min-h-[150px] ${isOtherMonth?'border-white/5 bg-white/[0.02] text-white/50':'border-white/10 bg-white/[0.03]'}`}>
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs font-medium">{label}</div>
              {dayJobs.length>3 && <div className="text-[10px] text-white/60">+{dayJobs.length-3} more</div>}
            </div>
            <div className="space-y-1">
              {dayJobs.slice(0,3).map(j=>(
                <button key={j.id} onClick={()=>onOpen(j)}
                  className={`w-full text-left rounded-lg px-2 py-1 ring-1 hover:ring-white/40 ${colorForJob(j)}`}
                  title={`${fmtTime(j.startTimeISO)} • ${j.jobType ?? ''}`}>
                  <div className="text-[10px] opacity-80">{fmtTime(j.startTimeISO)}</div>
                  <div className="text-[11px] truncate">{j.contact?.name || '—'}</div>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}