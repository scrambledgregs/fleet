import { useState, type ReactNode } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import AppShell from './layout/AppShell.jsx'

// Pages
import Dashboard from './pages/Dashboard'
import DashboardContent from './pages/DashboardContent.jsx'
import ContactsPage from './pages/Contacts'
import VehiclesPage from './pages/Vehicles.jsx'
import Calendar from './pages/Calendar'
import Affiliate from './pages/Affiliate.jsx'
import IndustryPacks from './pages/IndustryPacks.jsx'
import Estimator from './pages/Estimator'
import RoofMeasure from './pages/RoofMeasure'
import Invoices from './pages/Invoices'
import Chatter from './pages/Chatter'
import EventsPage from './pages/EventsPage'
import Settings from './pages/Settings'
import Onboarding from './pages/Onboarding.jsx'
import Signup from './pages/Signup.jsx'
import AutomationsPage from './pages/Automations'
import PhonePage from './pages/PhonePage'
import RequestAppointment from './pages/RequestAppointment.jsx'
import VoiceHUD from './components/VoiceHUD'
import AIHub from './pages/AIHub'
import JobBoard from './pages/JobBoard'
import LeadHub from './pages/LeadHub'
import PricingPage from './pages/PricingPage'
import SalesTracker from "./pages/SalesTracker"
import "../src/lib/http";

// import without extension so it resolves FloatingCTA.tsx
import FloatingCTA from './components/FloatingCTA'

// Team hub
import Team from './pages/Team'
import TeamFeed from './pages/TeamFeed'

function RequireSetup({ children }: { children: ReactNode }) {
  return <>{children}</>
}

function RouteAwareHUD() {
  const { pathname } = useLocation()
  // Hide the floating HUD anywhere under /phones
  if (pathname.startsWith('/phones')) return null
  return <VoiceHUD />
}

export default function App() {
  const [mode, setMode] = useState<'Approve' | 'Auto'>('Approve')
  const [compact, setCompact] = useState(false)

  return (
    <Router>
      <Routes>
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
          <Route index element={<RequireSetup><Dashboard /></RequireSetup>} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="home" element={<Navigate to="/" replace />} />

          {/* Jobs/Bookings */}
          <Route path="jobs" element={<DashboardContent mode={mode} />} />
          <Route path="bookings" element={<Navigate to="/jobs" replace />} />

          {/* CRM */}
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="chatter" element={<Chatter />} />

          {/* Team hub */}
          <Route path="team">
            <Route index element={<Team />} />
            <Route path="feed" element={<TeamFeed />} />
          </Route>
          <Route path="chat" element={<Navigate to="/team" replace />} />
          <Route path="directory" element={<Navigate to="/team?tab=directory" replace />} />

          {/* Other */}
          <Route path="vehicles" element={<VehiclesPage />} />
          <Route path="/sales" element={<SalesTracker />} />
          <Route path="leads" element={<LeadHub />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="ai" element={<AIHub />} />
          <Route path="packs" element={<IndustryPacks />} />
          <Route path="affiliate" element={<Affiliate />} />
          <Route path="estimator" element={<Estimator />} />
          <Route path="measure/roof" element={<RoofMeasure />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="phones" element={<PhonePage />} />
          <Route path="automations" element={<AutomationsPage />} />

          {/* ✅ Correct path */}
          <Route path="jobboard" element={<JobBoard />} />

          {/* Handy aliases */}
          <Route path="production" element={<Navigate to="/jobboard" replace />} />
          <Route path="board" element={<Navigate to="/jobboard" replace />} />

          <Route path="settings" element={<Settings />} />
        </Route>

        {/* No-chrome pages */}
        <Route path="/signup" element={<Signup />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/requestappointment" element={<RequestAppointment />} />
        <Route path="/pricing" element={<PricingPage />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <RouteAwareHUD />
      <FloatingCTA />
    </Router>
  )
}