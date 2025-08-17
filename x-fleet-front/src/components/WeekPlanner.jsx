// src/components/WeekPlanner.jsx
import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Clock } from 'lucide-react'
import JobDetails from './JobDetails.jsx'
import { API_BASE } from '../config'
import JobCard from './JobCard'

const fallbackWeek = [
  { id:'J-158', day:'Tue', time:'1:15 PM', address:'Palm Ln, Phoenix', lat:33.455, lng:-112.05, jobType:'Reroof', estValue:35000, territory:'EAST' },
  { id:'J-221', day:'Tue', time:'12:40 PM', address:'Monroe St, Phoenix', lat:33.442, lng:-112.08, jobType:'Repair', estValue:2200, territory:'WEST' },
  { id:'J-412', day:'Wed', time:'4:10 PM', address:'Thomas Rd, Phoenix', lat:33.436, lng:-112.06, jobType:'Reroof', estValue:18000, territory:'EAST' },
  { id:'J-501', day:'Thu', time:'10:00 AM', address:'Oak St, Phoenix', lat:33.46, lng:-112.02, jobType:'Inspection', estValue:0, territory:'EAST' }
]

export default function WeekPlanner({ selectedJobId, onSelectJob }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)

  // drawer state
  const [openId, setOpenId] = useState(null)
  const [openSeed, setOpenSeed] = useState(null)
  const useLocalDrawer = !onSelectJob

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
      } catch {
        setItems(fallbackWeek)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // client settings (for payday badge)
  const [settings, setSettings] = useState({ paydayThreshold: 2500 })
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/client-settings?clientId=default`)
        const j = await r.json()
        if (j?.ok && j?.settings) setSettings(j.settings)
      } catch {
        /* keep default */
      }
    })()
  }, [])

  // group by day label
  const groups = useMemo(() => {
    const by = {}
    for (const j of items) (by[j.day] ||= []).push(j)
    return by
  }, [items])

  // actions
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
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
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
    } catch {
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
    }catch{
      alert('Approve failed. Is the backend running?')
    }
  }

  // open drawer with id + seed
  const handleOpen = (job) => {
    const id = job?.appointmentId || job?.id
    if (!id) return
    setOpenId(id)
    setOpenSeed(job)
  }

  if (loading) {
    return (
      <div className="text-white/60 text-sm p-3 flex items-center gap-2">
        <Clock size={16}/> Loading week…
      </div>
    )
  }

  const daysOrder = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

  return (
    <div className="space-y-3 overflow-auto" style={{ maxHeight:'70vh' }}>
      {useLocalDrawer && openId && (
        <JobDetails
          jobId={openId}
          seed={openSeed}
          onClose={() => { setOpenId(null); setOpenSeed(null) }}
        />
      )}

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
     
        {groups[day].map(job => {
          const id = job.appointmentId || job.id
          return (
            <JobCard
            key={id}
            job={job}
            paydayThreshold={settings?.paydayThreshold ?? 2500}
            isSelected={id === selectedJobId}
            busy={busy === id}
            onOpen={() => {
              if (onSelectJob) {
                onSelectJob(job)        // ← propagate to parent/right panel
                } else {
                  setOpenId(id)           // ← fallback to local drawer
                  setOpenSeed(job)
                }
              }}
              onSuggest={() => suggest(job)}
              onApprove={() => approve(job)}
              />
            )
          })}
          </div>
        </div>
      ))}
    </div>
  )
}