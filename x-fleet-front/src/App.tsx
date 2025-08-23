// x-fleet-front/src/App.tsx
import { useState, type ReactNode } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './layout/AppShell.jsx'

// Pages
import Dashboard from './pages/Dashboard'                // Metrics dashboard (home)
import DashboardContent from './pages/DashboardContent.jsx'  // Jobs/Bookings board (expects mode/compact props)
import ContactsPage from './pages/Contacts.jsx'
import VehiclesPage from './pages/Vehicles.jsx'
import Calendar from './pages/Calendar.jsx'
import Affiliate from './pages/Affiliate.jsx'
import IndustryPacks from './pages/IndustryPacks.jsx'
import Estimator from './pages/Estimator'
import RoofMeasure from './pages/RoofMeasure'
import Chatter from './pages/Chatter'
import EventsPage from './pages/EventsPage'
import Settings from './pages/Settings'
import Onboarding from './pages/Onboarding.jsx'
import Signup from './pages/Signup.jsx'
import AutomationsPage from './pages/Automations'
import RequestAppointment from './pages/RequestAppointment.jsx'
import FloatingCTA from './components/FloatingCTA.jsx'

function RequireSetup({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export default function App() {
  const [mode, setMode] = useState<'Approve' | 'Auto'>('Approve')
  const [compact, setCompact] = useState(false)

  return (
    <Router>
      <Routes>
        {/* PAGES WITH CHROME */}
        <Route
          element={
            <AppShell
              mode={mode}
              setMode={setMode}
              compact={compact}
              setCompact={setCompact}
            />
          }
        >
          {/* HOME → Metrics Dashboard */}
          <Route
            index
            element={
              <RequireSetup>
                <Dashboard />
              </RequireSetup>
            }
          />
          {/* Aliases for the dashboard */}
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="home" element={<Navigate to="/" replace />} />

          {/* Jobs/Bookings board */}
          <Route
            path="jobs"
            element={
              <DashboardContent
                mode={mode}
              />
            }
          />
          {/* Alias so old links to /bookings still work */}
          <Route path="bookings" element={<Navigate to="/jobs" replace />} />

          {/* Other sections */}
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="vehicles" element={<VehiclesPage />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="packs" element={<IndustryPacks />} />
          <Route path="affiliate" element={<Affiliate />} />
          <Route path="estimator" element={<Estimator />} />
          <Route path="measure/roof" element={<RoofMeasure />} />
          <Route path="chatter" element={<Chatter />} />
          <Route path="chatter/:contactId" element={<Chatter />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="automations" element={<AutomationsPage />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* PAGES WITHOUT CHROME */}
        <Route path="/signup" element={<Signup />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/requestappointment" element={<RequestAppointment />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <FloatingCTA />
    </Router>
  )
}