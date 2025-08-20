// src/components/LeftPanel.jsx
import { useEffect, useState, useCallback, useMemo } from 'react'
import AlertList from './AlertList.jsx'
import Inbox from './Inbox.jsx'
import Vehicles from './VehiclesPanel.jsx'
import WeekPlanner from './WeekPlanner.jsx'
import ContactsPanel from './ContactsPanel'
import JobListByDay from './JobListByDay'
import { API_BASE } from '../config'

export default function LeftPanel({ mode, selectedJobId, onSelectJob, tab: externalTab }) {
  // Tab state: allow external control, fallback to local
  const [tabLocal, setTabLocal] = useState('planner')
  const tab = externalTab ?? tabLocal
  const setTab = setTabLocal

  // Planner view state (By Day / By Week)
  const [plannerView, setPlannerView] = useState('byday')

  // week-appointments data for the By Day view
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const fetchJobs = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/week-appointments`)
      const j = await r.json()
      if (Array.isArray(j)) setJobs(j)
      else if (Array.isArray(j?.data)) setJobs(j.data)
      else setJobs([])
    } catch (e) {
      setError(e?.message || 'Failed to load week appointments')
    } finally {
      setLoading(false)
    }
  }, [])

  // Load on enter Jobs tab (By Day) and when switching between By Day / By Week
  useEffect(() => {
    if (tab === 'planner' && plannerView === 'byday') fetchJobs()
  }, [tab, plannerView, fetchJobs])

  // Find the selected job (for any local needs)
  const selectedJob = useMemo(() => {
    if (!selectedJobId) return null
    return jobs.find(j => (j.id || j.appointmentId) === selectedJobId) || null
  }, [jobs, selectedJobId])

  return (
    <div className="h-full flex flex-col">
     
     

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">
          {tab === 'planner'
            ? 'Jobs'
            : tab === 'contacts'
            ? 'Contacts'
            : tab === 'alerts'
            ? 'AI Alerts'
            : tab === 'chatter'
            ? 'Chatter'
            : 'Vehicles'}
        </div>

        {/* View toggle only on Jobs */}
        {tab === 'planner' && (
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1 rounded bg-white/5 p-0.5">
              <button
                onClick={() => setPlannerView('byday')}
                className={[
                  'px-2 py-0.5 text-[11px] rounded transition',
                  plannerView === 'byday' ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5',
                ].join(' ')}
              >
                By Day
              </button>
              <button
                onClick={() => setPlannerView('byweek')}
                className={[
                  'px-2 py-0.5 text-[11px] rounded transition',
                  plannerView === 'byweek' ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5',
                ].join(' ')}
              >
                By Week
              </button>
            </div>
           
          <button
  onClick={() => {
    if (plannerView === 'byday') {
      fetchJobs()
    } else {
      setReloadKey((k) => k + 1)
    }
  }}
  className="text-[11px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 transition"
  title="Refresh"
>
  Refresh
</button>

          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'planner' ? (
          plannerView === 'byweek' ? (
            <WeekPlanner
  refreshToken={reloadKey}
  onSelectJob={(job) => onSelectJob?.(job)}
  selectedJobId={selectedJobId}
/>
          ) : (
            <div className="p-1">
              {loading && (
                <div className="grid gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-white/10 p-3 animate-pulse">
                      <div className="h-3 w-24 bg-white/10 rounded mb-2" />
                      <div className="h-4 w-48 bg-white/10 rounded mb-1" />
                      <div className="h-4 w-32 bg-white/10 rounded mb-3" />
                      <div className="h-3 w-full bg-white/10 rounded" />
                    </div>
                  ))}
                </div>
              )}

              {!loading && error && (
                <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2">
                  {error}
                </div>
              )}

              {!loading && !error && jobs.length === 0 && (
                <div className="text-sm text-white/60 border border-white/10 rounded p-3">
                  No jobs scheduled for this week.
                </div>
              )}

              {!loading && !error && jobs.length > 0 && (
                <JobListByDay
                  jobs={jobs}
                  selectedJobId={selectedJobId}
                  onSelect={(job) => onSelectJob?.(job)}    // open right-side panel
                  onMap={(job) => onSelectJob?.(job)}       // map click also selects
                />
              )}
            </div>
          )
        ) : tab === 'alerts' ? (
          <AlertList mode={mode} />
        ) : tab === 'contacts' ? (
          <ContactsPanel />
        ) : tab === 'chatter' ? (
          <Inbox />
        ) : (
          <Vehicles />
        )}
      </div>
    </div>
  )
}