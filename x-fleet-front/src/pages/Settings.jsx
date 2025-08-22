// src/pages/Settings.jsx
import { useState } from 'react'
import TeamSettings from '../settings/TeamSettings.jsx'
import VehiclesSettings from '../settings/VehiclesSettings.jsx'

export default function Settings() {
  const [tab, setTab] = useState('team') // 'team' | 'vehicles' | 'integrations' | 'company'

  return (
    <div className="glass rounded-none p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Settings</h1>
        <div className="flex gap-2 text-sm">
          <button onClick={() => setTab('team')}         className={`px-3 py-1.5 rounded-none ${tab==='team'?'bg-blue-600':'glass'}`}>Team</button>
          <button onClick={() => setTab('vehicles')}     className={`px-3 py-1.5 rounded-none ${tab==='vehicles'?'bg-blue-600':'glass'}`}>Vehicles</button>
          <button onClick={() => setTab('integrations')} className={`px-3 py-1.5 rounded-none ${tab==='integrations'?'bg-blue-600':'glass'}`}>Integrations</button>
          <button onClick={() => setTab('company')}      className={`px-3 py-1.5 rounded-none ${tab==='company'?'bg-blue-600':'glass'}`}>Company</button>
        </div>
      </div>

      {tab === 'team' && <TeamSettings />}
      {tab === 'vehicles' && <VehiclesSettings />}
      {tab === 'integrations' && <div className="text-sm text-white/70">Connect GHL, Google Calendar, QuickBooks… (coming soon)</div>}
      {tab === 'company' && <div className="text-sm text-white/70">Company profile, service areas, working hours… (coming soon)</div>}
    </div>
  )
}