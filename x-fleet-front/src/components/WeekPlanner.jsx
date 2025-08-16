import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Wand2, CheckCircle2, Clock, Eye } from 'lucide-react'
import JobDetails from './JobDetails.jsx'
import { API_BASE } from '../config'

const fallbackWeek = [
  { id:'J-158', day:'Tue', time:'1:15 PM', address:'Palm Ln, Phoenix', lat:33.455, lng:-112.05, jobType:'Reroof', estValue:35000, territory:'EAST' },
  { id:'J-221', day:'Tue', time:'12:40 PM', address:'Monroe St, Phoenix', lat:33.442, lng:-112.08, jobType:'Repair', estValue:2200, territory:'WEST' },
  { id:'J-412', day:'Wed', time:'4:10 PM', address:'Thomas Rd, Phoenix', lat:33.436, lng:-112.06, jobType:'Reroof', estValue:18000, territory:'EAST' },
  { id:'J-501', day:'Thu', time:'10:00 AM', address:'Oak St, Phoenix', lat:33.46, lng:-112.02, jobType:'Inspection', estValue:0, territory:'EAST' }
]

export default function WeekPlanner(){
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null) // job id being processed
  const [openId, setOpenId] = useState(null)
  const [openSeed, setOpenSeed] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/week-appointments`)
        if (!r.ok) throw new Error('no api')
        const data = await r.json()
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const normalized = (data || []).map(j => {
  const d = new Date(j.startTime || Date.now())
  return {
    ...j,
    day: j.day || d.toLocaleDateString(undefined, { weekday: 'short', timeZone: tz }),
    time: j.time || d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }),
    dateText: j.dateText || d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: tz }),
  }
})
setItems(normalized.length ? normalized : fallbackWeek)
      } catch(e){
        setItems(fallbackWeek)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const groups = useMemo(() => {
    const by = {}
    for (const j of items){ (by[j.day] ||= []).push(j) }
    return by
  }, [items])

  async function suggest(job){
    setBusy(job.id)
    const startISO = new Date().toISOString()
    const endISO = new Date(Date.now()+60*60*1000).toISOString()
    const payload = {
      appointmentId: job.id,
      startTime: startISO, endTime: endISO,
      address: job.address, lat: job.lat, lng: job.lng,
      customer: { name: '—' },
      custom: { jobType: job.jobType, estValue: job.estValue, territory: job.territory }
    }
    try {
      const r = await fetch(`${API_BASE}/ghl/appointment-created`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
      })
      const data = await r.json().catch(()=>({}))
      setItems(prev => prev.map(x =>
        x.id===job.id
          ? ({
              ...x,
              suggestion: data?.decision || data?.candidates?.[0] || { repName:'(awaiting)', reason:'queued' },
              status: data?.action
            })
          : x
      ))
    } catch(e) {
      setItems(prev => prev.map(x => x.id===job.id ? ({ ...x, status:'error' }) : x))
    } finally {
      setBusy(null)
    }
  }

  async function approve(job){
    if(!job?.suggestion){
      alert('No suggestion to approve yet. Click Suggest first.')
      return
    }
    const repId = job.suggestion.repId || job.suggestion.repName || 'rep_unknown'
    const startISO = job.suggestion.startTime || new Date().toISOString()
    try{
      const r = await fetch(`${API_BASE}/apply-decision`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          appointmentId: job.id,
          repId,
          startTime: startISO,
          reason: job.suggestion?.reason || 'Approved via Planner'
        })
      })
      if(!r.ok) throw new Error('approve_failed')
      setItems(prev => prev.map(x => x.id===job.id ? ({ ...x, status: 'booked' }) : x))
    }catch(e){
      alert('Approve failed. Is the backend running?')
    }
  }

  if (loading) {
    return <div className="text-white/60 text-sm p-3 flex items-center gap-2">
      <Clock size={16}/> Loading week…
    </div>
  }

  const daysOrder = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

  return (
    <div className="space-y-3 overflow-auto" style={{maxHeight:'70vh'}}>
      {openId && <JobDetails jobId={openId} seed={openSeed} onClose={()=>{ setOpenId(null); setOpenSeed(null); }} />}

      {daysOrder.filter(d => groups[d]?.length).map(day => (
        <div key={day} className="glass rounded-none p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
<CalendarDays size={16} className="text-white/70"/>
<div className="font-semibold">
  {day}
  <span className="text-white/60 ml-2">• {groups[day][0]?.dateText}</span>
  </div>

            </div>
            <div className="text-xs text-white/60">{groups[day].length} appt(s)</div>
          </div>

          <div className="space-y-2">
            {groups[day].map(job => (
              <div key={job.id} className="border border-white/5 p-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{job.time} — {job.address}</div>
                  <div className="text-xs text-white/60">{job.jobType} • ${job.estValue.toLocaleString()} • {job.territory}</div>

                  {job.suggestion && (
                    <div className="text-xs mt-1">
                      <span className="text-success">Suggested:</span>{' '}
                      {job.suggestion.repName || job.suggestion.repId}{' '}
                      <span className="text-white/60">— {job.suggestion.reason}</span>
                    </div>
                  )}
                  {job.status==='booked' && <div className="text-xs text-success mt-1 flex items-center gap-1"><CheckCircle2 size={14}/> Auto-booked</div>}
                  {job.status==='awaiting_approval' && <div className="text-xs text-warning mt-1">Awaiting approval</div>}
                  {job.status==='error' && <div className="text-xs text-red-400 mt-1">Error suggesting</div>}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={()=>{ setOpenId(job.id); setOpenSeed(job); }}
                    className="px-2.5 py-1.5 rounded-none glass hover:bg-panel/70 transition text-sm flex items-center gap-2"
                  >
                    <Eye size={16}/> View
                  </button>

                  <button
                    disabled={busy===job.id}
                    onClick={()=>suggest(job)}
                    className="px-2.5 py-1.5 rounded-none bg-accent hover:brightness-110 transition text-sm flex items-center gap-2"
                  >
                    <Wand2 size={16}/> {busy===job.id?'Scoring…':'Suggest'}
                  </button>

                  <button
                    onClick={()=>approve(job)}
                    className="px-2.5 py-1.5 rounded-none glass hover:bg-panel/70 transition text-sm"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}