// src/App.jsx
import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './layout/AppShell.jsx'

import DashboardContent from './pages/DashboardContent.jsx'
import ContactsPage from './pages/Contacts.jsx'
import VehiclesPage from './pages/Vehicles.jsx'
import Calendar from './pages/Calendar.jsx'
import Affiliate from './pages/Affiliate.jsx'
import IndustryPacks from './pages/IndustryPacks.jsx'
import Estimator from './pages/Estimator'
import RoofMeasure from './pages/RoofMeasure'
import Chatter from './pages/Chatter'
import EventsPage from './pages/EventsPage'
import Settings from './pages/Settings.jsx'
import Onboarding from './pages/Onboarding.jsx'
import Signup from './pages/Signup.jsx'
import AutomationsPage from './pages/Automations'
import RequestAppointment from './pages/RequestAppointment.jsx'
import FloatingCTA from './components/FloatingCTA.jsx'

// If you still want the techs check, re-add your effect here
function RequireSetup({ children }) {
  return children
}

export default function App() {
  const [mode, setMode] = useState('Approve')
  const [compact, setCompact] = useState(false)

  return (
    <Router>
      <Routes>
        {/* PAGES WITH CHROME */}
        <Route element={<AppShell mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />}>
          <Route
            index
            element={
              <RequireSetup>
                <DashboardContent />
              </RequireSetup>
            }
          />
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
      </Routes>

      <FloatingCTA />
    </Router>
  )
}