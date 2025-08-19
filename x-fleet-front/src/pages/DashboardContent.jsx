// src/pages/DashboardContent.jsx
import { useState } from 'react'
import LeftPanel from '../components/LeftPanel.jsx'
import MapPanel from '../components/MapPanel.jsx'
import JobDetails from '../components/JobDetails.jsx'

export default function DashboardContent({ mode }) {
  const [selectedJob, setSelectedJob] = useState(null)

  return (
    <>
      <div className="grid grid-cols-12 gap-6">
        <section className="col-span-12 lg:col-span-5 glass rounded-none p-3">
          <LeftPanel
            tab="planner"
            mode={mode}
            selectedJobId={selectedJob?.id || selectedJob?.appointmentId}
            onSelectJob={setSelectedJob}
          />
        </section>

        <section className="col-span-12 lg:col-span-7 glass rounded-none overflow-hidden">
          <MapPanel
            highlightedJobId={selectedJob?.id || selectedJob?.appointmentId}
            onPinClick={setSelectedJob}
          />
        </section>
      </div>

      {selectedJob && (
        <JobDetails
          jobId={selectedJob.appointmentId || selectedJob.id}
          seed={selectedJob}
          onClose={() => setSelectedJob(null)}
        />
      )}
    </>
  )
}