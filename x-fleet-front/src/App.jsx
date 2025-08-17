// App.jsx
import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'

import TopBar from './components/TopBar.jsx'
import StatBar from './components/StatBar.jsx'
import SideNav from './components/SideNav.jsx'
import LeftPanel from './components/LeftPanel.jsx'
import MapPanel from './components/MapPanel.jsx'
import RequestAppointment from './pages/RequestAppointment.jsx'
import JobDetails from './components/JobDetails.jsx'

function Dashboard({ mode, setMode, compact, setCompact }) {
  // selection for details drawer
  const [selectedJob, setSelectedJob] = useState(null)
  // NEW: active tab for the left rail
  const [tab, setTab] = useState('planner') // 'planner' | 'contacts' | 'alerts' | 'chatter' | 'vehicles'

  return (
    <div className={'min-h-screen text-white ' + (compact ? 'compact-root' : '')}>
      <TopBar mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />
      <div className={'px-6 ' + (compact ? 'pt-2' : 'pt-4')}>
        <StatBar />
      </div>

      {/* Three-column layout: left rail, content column, map column */}
      <main className={'grid grid-cols-12 ' + (compact ? 'gap-4 p-4' : 'gap-6 p-6')}>
        {/* Left rail */}
        <aside className="col-span-12 lg:col-span-2">
          <SideNav tab={tab} onChange={setTab} />
        </aside>

        {/* Middle content column (jobs/contacts/alerts/chatter/vehicles lists) */}
        <section className="col-span-12 lg:col-span-4 xl:col-span-5 glass rounded-none p-3">
          <LeftPanel
            tab={tab}                               // <-- wire nav into LeftPanel
            mode={mode}
            selectedJobId={selectedJob?.id || selectedJob?.appointmentId}
            onSelectJob={(job) => setSelectedJob(job)}
          />
        </section>

        {/* Map column */}
        <section className="col-span-12 lg:col-span-6 xl:col-span-5 glass rounded-none overflow-hidden">
          <MapPanel
            compact={compact}
            highlightedJobId={selectedJob?.id || selectedJob?.appointmentId} // keep as-is to avoid functional changes
            onPinClick={(job) => setSelectedJob(job)}
          />
        </section>
      </main>

      {/* One place to show details, regardless of view */}
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
          element={<Dashboard mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />}
        />
        <Route path="/requestappointment" element={<RequestAppointment />} />
      </Routes>
    </Router>
  )
}