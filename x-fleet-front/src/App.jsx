import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'

import TopBar from './components/TopBar.jsx'
import StatBar from './components/StatBar.jsx'
import SideNav from './components/SideNav.jsx'
import LeftPanel from './components/LeftPanel.jsx'
import MapPanel from './components/MapPanel.jsx'
import RequestAppointment from './pages/RequestAppointment.jsx'
import JobDetails from './components/JobDetails.jsx'
import Chatter from './pages/Chatter'
import Onboarding from './pages/Onboarding.jsx'
import Signup from './pages/Signup.jsx'
import Settings from './pages/Settings.jsx'
import ContactsPage from './pages/Contacts.jsx'
import VehiclesPage from './pages/Vehicles.jsx'
import Calendar from './pages/Calendar.jsx'
import Affiliate from './pages/Affiliate.jsx'
import IndustryPacks from './pages/IndustryPacks.jsx'
import FloatingCTA from './components/FloatingCTA.jsx'
import Estimator from "./pages/Estimator";
import RoofMeasure from "./pages/RoofMeasure";
import { API_BASE } from './config'

// --- Small inline guard: if no techs yet, send to /onboarding ---
function RequireSetup({ children }) {
  const [loading, setLoading] = useState(true)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/techs?clientId=default`)
        const j = await r.json().catch(() => ({}))
        if (!alive) return
        const count = Number(j?.count || 0)
        setOk(count > 0)
      } catch {
        if (!alive) return
        setOk(false)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  if (loading) return null
  if (!ok) return <Navigate to="/onboarding" replace />
  return children
}

function Dashboard({ mode, setMode, compact, setCompact }) {
  const [selectedJob, setSelectedJob] = useState(null)
  const [tab, setTab] = useState('planner') // 'planner' | 'contacts' | 'chatter' | 'vehicles'
  const location = useLocation()

  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const t = q.get('tab')
    if (t && ['planner','contacts','chatter','vehicles'].includes(t)) {
      setTab(t)
    }
  }, [location.search])

  return (
    <div className={'min-h-screen text-white ' + (compact ? 'compact-root' : '')}>
      <TopBar mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />
      <div className={'px-6 ' + (compact ? 'pt-2' : 'pt-4')}>
        <StatBar />
      </div>

      <main className={'grid grid-cols-12 ' + (compact ? 'gap-4 p-4' : 'gap-6 p-6')}>
        <aside className="col-span-12 lg:col-span-2">
          <SideNav tab={tab} onChange={setTab} />
        </aside>

        <section className="col-span-12 lg:col-span-4 xl:col-span-5 glass rounded-none p-3">
          <LeftPanel
            tab={tab}
            mode={mode}
            selectedJobId={selectedJob?.id || selectedJob?.appointmentId}
            onSelectJob={(job) => setSelectedJob(job)}
          />
        </section>

        <section className="col-span-12 lg:col-span-6 xl:col-span-5 glass rounded-none overflow-hidden">
          <MapPanel
            compact={compact}
            highlightedJobId={selectedJob?.id || selectedJob?.appointmentId}
            onPinClick={(job) => setSelectedJob(job)}
          />
        </section>
      </main>

      {selectedJob && (
        <JobDetails
          jobId={selectedJob.appointmentId || selectedJob.id}
          seed={selectedJob}
          onClose={() => setSelectedJob(null)}
        />
      )}
    </div>
  )
}

export default function App() {
  const [mode, setMode] = useState('Approve')
  const [compact, setCompact] = useState(false)

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            <RequireSetup>
              <Dashboard mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />
            </RequireSetup>
          }
        />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/estimator" element={<Estimator />} />
        <Route path="/measure/roof" element={<RoofMeasure />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/vehicles" element={<VehiclesPage />} />
        <Route path="/packs" element={<IndustryPacks />} />
        <Route path="/affiliate" element={<Affiliate />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/requestappointment" element={<RequestAppointment />} />
        <Route path="/chatter" element={<Chatter />} />
        <Route path="/chatter/:contactId" element={<Chatter />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>

      {/* Global CTA visible on most pages */}
      <FloatingCTA />
    </Router>
  )
}