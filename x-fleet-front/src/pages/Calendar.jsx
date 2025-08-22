// src/pages/Calendar.jsx
import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import JobDetails from '../components/JobDetails.jsx'
import { API_BASE } from '../config'
import { io } from 'socket.io-client'

const API_HTTP_BASE = `${API_BASE}`.endsWith('/api') ? API_BASE : `${API_BASE}/api`
const SOCKET_BASE_FROM_API = `${API_BASE}`.replace(/\/api\/?$/, '')

export default function Calendar() {
  const navigate = useNavigate()

  const [searchParams] = useSearchParams()
  const dateParam = searchParams.get('date')
  const targetDayFromParam = (() => {
    if (!dateParam) return null
    const d = new Date(dateParam)
    if (isNaN(d)) return null
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
  })()

  // Drawer state
  const [openId, setOpenId] = useState(null)
  const [openSeed, setOpenSeed] = useState(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [items, setItems] = useState([])

  // view + grouping controls
  const [view, setView] = useState('week')      // 'week' | 'day' | 'month'
  useEffect(() => { if (dateParam) setView('day') }, [dateParam])
  const [groupBy, setGroupBy] = useState('none')// 'none' | 'user' | 'vehicle' | 'territory'

  // filters
  const [tech, setTech] = useState('all')
  const [territory, setTerritory] = useState('all')

  const loadWeek = useCallback(async () => {
    try {
      setLoading(true)
      const r = await fetch(`${API_HTTP_BASE}/week-appointments`)
      const j = await r.json()
      if (!Array.isArray(j)) throw new Error('Bad response')
      setItems(j)
      setError(null)
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadWeek() }, [loadWeek])

  // options
  const techs = useMemo(() => {
    const s = new Set(items.map(i => i.assignedRepName).filter(Boolean))
    return ['all', ...Array.from(s)]
  }, [items])
  const territories = useMemo(() => {
    const s = new Set(items.map(i => i.territory).filter(Boolean))
    return ['all', ...Array.from(s)]
  }, [items])

  // filter
  const filtered = items.filter(i =>
    (tech === 'all' || i.assignedRepName === tech) &&
    (territory === 'all' || i.territory === territory)
  )

  // helpers
  const weekdayOrder = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  const byDay = useMemo(() => {
    const m = new Map()
    for (const it of filtered) {
      if (!m.has(it.day)) m.set(it.day, { dateText: it.dateText, rows: [] })
      m.get(it.day).rows.push(it)
    }
    return Array.from(m.entries())
      .sort((a,b)=>weekdayOrder.indexOf(a[0]) - weekdayOrder.indexOf(b[0]))
      .map(([day,val]) => ({ day, dateText: val.dateText, rows: val.rows.sort((x,y)=>new Date(x.startTimeISO)-new Date(y.startTimeISO)) }))
  }, [filtered])

  const grouped = useMemo(() => {
    if (groupBy === 'none') return { All: filtered }
    const keyFn = {
      user: (i) => i.assignedRepName || 'Unassigned',
      vehicle: (i) => i.vehicleName || 'Unassigned',
      territory: (i) => i.territory || '—',
    }[groupBy] || (()=>'All')
    const m = new Map()
    for (const it of filtered) {
      const k = keyFn(it)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(it)
    }
    for (const [, arr] of m.entries()) {
      arr.sort((a,b)=>new Date(a.startTimeISO)-new Date(b.startTimeISO))
    }
    return Object.fromEntries(m.entries())
  }, [filtered, groupBy])

  // Day view: pick either the date from the URL (?date=...) or the busiest day
  const dayKey = useMemo(() => {
    if (byDay.length === 0) return null
    if (targetDayFromParam && byDay.some(d => d.day === targetDayFromParam)) {
      return targetDayFromParam
    }
    return byDay.reduce((a, b) => (a.rows.length >= b.rows.length ? a : b)).day
  }, [byDay, targetDayFromParam])

  // Rows for the selected day
  const dayRows = useMemo(() => {
    if (!dayKey) return []
    const entry = byDay.find(d => d.day === dayKey)
    return entry ? entry.rows : []
  }, [byDay, dayKey])

  const socketRef = useRef(null)
  useEffect(() => {
    const s = io(SOCKET_BASE_FROM_API, { transports: ['websocket'] })
    socketRef.current = s
    const refresh = () => loadWeek()
    s.on('connect', refresh)
    s.on('job:created', refresh)
    s.on('job:updated', refresh)
    s.on('ai:booking', refresh)
    return () => {
      s.off('connect', refresh)
      s.off('job:created', refresh)
      s.off('job:updated', refresh)
      s.off('ai:booking', refresh)
      s.close()
    }
  }, [loadWeek])

  // ----------------- RENDER (content only; AppShell renders chrome) -----------------
  return (
    <>
      <div className="grid grid-cols-12 gap-4">
        {/* Controls */}
        <div className="col-span-12 md:col-span-3 glass rounded-none p-3">
         

          <div className="space-y-3">
            <div>
              <div className="text-xs text-white/60 mb-1">View</div>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={()=>setView('day')} className={`px-2 py-1 rounded-none text-sm ${view==='day'?'bg-blue-600':'glass'}`}>Day</button>
                <button onClick={()=>setView('week')} className={`px-2 py-1 rounded-none text-sm ${view==='week'?'bg-blue-600':'glass'}`}>Week</button>
                <button onClick={()=>setView('month')} className={`px-2 py-1 rounded-none text-sm ${view==='month'?'bg-blue-600':'glass'}`}>Month</button>
              </div>
            </div>

            <div>
              <div className="text-xs text-white/60 mb-1">Group</div>
              <select
                value={groupBy}
                onChange={e=>setGroupBy(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30"
              >
                <option value="none">None</option>
                <option value="user">User</option>
                <option value="vehicle">Vehicle</option>
                <option value="territory">Territory</option>
              </select>
            </div>

            <div>
              <div className="text-xs text-white/60 mb-1">Technician</div>
              <select
                value={tech}
                onChange={e=>setTech(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30"
              >
                {techs.map(t => <option key={t} value={t}>{t==='all'?'All':t}</option>)}
              </select>
            </div>

            <div>
              <div className="text-xs text-white/60 mb-1">Territory</div>
              <select
                value={territory}
                onChange={e=>setTerritory(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30"
              >
                {territories.map(t => <option key={t} value={t}>{t==='all'?'All':t}</option>)}
              </select>
            </div>

            <button
              onClick={()=>navigate('/requestappointment')}
              className="w-full px-3 py-2 rounded-none glass text-sm hover:bg-panel/70"
            >
              New Appointment
            </button>

            {error && <div className="text-xs text-red-400">{error}</div>}
            {loading && <div className="text-xs text-white/60">Loading…</div>}
          </div>
        </div>

        {/* Canvas */}
        <div className="col-span-12 md:col-span-9 glass rounded-none p-3">
          {view === 'week' && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Week</div>
                <div className="text-xs text-white/60">{filtered.length} appointments</div>
              </div>

              <div className="grid grid-cols-7 gap-3">
                {byDay.map(({ day, dateText, rows }) => (
                  <div key={day} className="bg-white/5 border border-white/10 rounded-none p-2">
                    <div className="flex items-baseline justify-between mb-2">
                      <div className="text-sm font-semibold">{day}</div>
                      <div className="text-[11px] text-white/60">{dateText}</div>
                    </div>
                    <div className="space-y-2">
                      {rows.length === 0 && <div className="text-xs text-white/50">No jobs</div>}
                      {rows.map(r => (
                        <button
                          key={r.id}
                          onClick={() => { setOpenId(r.id); setOpenSeed(r); }}
                          className="w-full text-left rounded-2xl px-3 py-2 bg-gray-900 hover:ring-1 hover:ring-white/20 cursor-pointer"
                        >
                          <div className="text-xs opacity-80">{fmtTime(r.startTimeISO)}</div>
                          <div className="text-sm font-medium truncate">{r.contact?.name || '—'}</div>
                          <div className="text-[11px] opacity-70 truncate">{r.jobType} • {r.address || '—'}</div>
                          {(r.assignedRepName || r.travelMinutesFromPrev != null) && (
                            <div className="mt-1 text-[11px] opacity-70">
                              {r.assignedRepName || 'Unassigned'}
                              {r.travelMinutesFromPrev != null && ` • +${r.travelMinutesFromPrev}m drive`}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {Array.from({ length: Math.max(0, 7 - byDay.length) }).map((_,i)=>(
                  <div key={'pad'+i} className="bg-white/5 border border-white/10 rounded-none p-2">
                    <div className="text-sm font-semibold opacity-50">—</div>
                  </div>
                ))}
              </div>

              {groupBy !== 'none' && (
                <div className="mt-6">
                  <div className="text-sm font-semibold mb-2">Grouped by {groupBy}</div>
                  <div className="grid md:grid-cols-2 gap-3">
                    {Object.entries(grouped).map(([k, arr]) => (
                      <div key={k} className="bg-white/5 border border-white/10 rounded-none p-2">
                        <div className="text-sm font-medium mb-2">{k}</div>
                        <div className="space-y-2">
                          {arr.length === 0 && <div className="text-xs text-white/50">No jobs</div>}
                          {arr.map(r => (
                            <button
                              key={r.id}
                              onClick={() => { setOpenId(r.id); setOpenSeed(r); }}
                              className="w-full text-left rounded-2xl px-3 py-2 bg-gray-900 hover:ring-1 hover:ring-white/20 cursor-pointer"
                            >
                              <div className="text-xs opacity-80">{r.day} • {fmtTime(r.startTimeISO)}</div>
                              <div className="text-sm font-medium truncate">{r.contact?.name || '—'}</div>
                              <div className="text-[11px] opacity-70 truncate">{r.jobType} • {r.address || '—'}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {view === 'day' && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Day</div>
                <div className="text-xs text-white/60">{dayKey || '—'}</div>
              </div>
              <div className="space-y-2">
                {dayRows.length === 0 && <div className="text-sm text-white/60">No jobs today.</div>}
                {dayRows.map(r => (
                  <div
                    key={r.id}
                    onClick={() => { setOpenId(r.id); setOpenSeed(r); }}
                    className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-none p-2 hover:ring-1 hover:ring-white/20 cursor-pointer"
                  >
                    <div className="text-sm font-semibold w-16 shrink-0">{fmtTime(r.startTimeISO)}</div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{r.contact?.name || '—'}</div>
                      <div className="text-[11px] opacity-70">{r.jobType} • {r.address || '—'}</div>
                      <div className="text-[11px] opacity-70 mt-1">
                        {(r.assignedRepName || 'Unassigned')}{r.travelMinutesFromPrev!=null && ` • +${r.travelMinutesFromPrev}m drive`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {view === 'month' && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Month</div>
                <div className="text-xs text-white/60">preview</div>
              </div>
              <div className="grid grid-cols-7 gap-2">
                {byDay.map(({ day, dateText, rows }) => (
                  <div key={day} className="bg-white/5 border border-white/10 rounded-none p-2 h-32 overflow-hidden">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-semibold">{day}</div>
                      <div className="text-[10px] text-white/60">{dateText}</div>
                    </div>
                    <div className="text-[11px] opacity-80">{rows.length} job(s)</div>
                    <div className="mt-1 space-y-1">
                      {rows.slice(0,3).map(r => (
                        <div
                          key={r.id}
                          onClick={() => { setOpenId(r.id); setOpenSeed(r); }}
                          className="text-[11px] truncate bg-gray-900 px-2 py-0.5 rounded-2xl hover:ring-1 hover:ring-white/20 cursor-pointer"
                        >
                          {fmtTime(r.startTimeISO)} • {r.contact?.name || '—'}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Job drawer */}
      {openId && (
        <JobDetails
          jobId={openId}
          seed={openSeed}
          onClose={() => { setOpenId(null); setOpenSeed(null); }}
        />
      )}
    </>
  )
}