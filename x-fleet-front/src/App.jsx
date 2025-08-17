// App.jsx
import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'

import TopBar from './components/TopBar.jsx'
import StatBar from './components/StatBar.jsx'
import LeftPanel from './components/LeftPanel.jsx'
import MapPanel from './components/MapPanel.jsx'
import RequestAppointment from './pages/RequestAppointment.jsx'
import JobDetails from './components/JobDetails.jsx' // <-- ensure this exists

function Dashboard({ mode, setMode, compact, setCompact }) {
  // NEW: central selection lives here so any view can open details
  const [selectedJob, setSelectedJob] = useState(null)

  return (
    <div className={'min-h-screen text-white ' + (compact ? 'compact-root' : '')}>
      <TopBar mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />
      <div className={'px-6 ' + (compact ? 'pt-2' : 'pt-4')}>
        <StatBar />
      </div>

      <main className={'grid grid-cols-12 ' + (compact ? 'gap-4 p-4' : 'gap-6 p-6')}>
        <section className="col-span-12 lg:col-span-5 glass rounded-none p-3">
          <LeftPanel
            mode={mode}
            selectedJobId={selectedJob?.id || selectedJob?.appointmentId}
            onSelectJob={(job) => setSelectedJob(job)}   // <-- important
          />
        </section>

        <section className="col-span-12 lg:col-span-7 glass rounded-none overflow-hidden">
          <MapPanel
            compact={compact}
            highlightedJobId={selectedJob?.id || selectedJob?.appointmentId}
            onPinClick={(job) => setSelectedJob(job)}    // optional: sync from map too
          />
        </section>
      </main>

      {/* One place to show details, regardless of view */}
      {selectedJob && (
        <JobDetails job={selectedJob} onClose={() => setSelectedJob(null)} />
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