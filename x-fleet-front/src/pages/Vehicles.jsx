// src/pages/Vehicles.jsx
import { useState } from 'react'
import TopBar from '../components/TopBar.jsx'
import SideNav from '../components/SideNav.jsx'
import StatBar from '../components/StatBar.jsx'
import VehiclesPanel from '../components/VehiclesPanel.jsx'

export default function VehiclesPage() {
  const [compact, setCompact] = useState(false)

  return (
    <div className={'min-h-screen text-white ' + (compact ? 'compact-root' : '')}>
      <TopBar compact={compact} setCompact={setCompact} />

      <div className={'px-6 ' + (compact ? 'pt-2' : 'pt-4')}>
        <StatBar />
      </div>

      <main className={'grid grid-cols-12 ' + (compact ? 'gap-4 p-4' : 'gap-6 p-6')}>
        <aside className="col-span-12 lg:col-span-2">
          <SideNav active="vehicles" />
        </aside>

        <section className="col-span-12 lg:col-span-10">
          <div className="glass rounded-none p-3">
            <div className="flex items-center justify-between mb-3">
              <h1 className="text-sm font-semibold">Vehicles</h1>
            </div>
            <VehiclesPanel />
          </div>
        </section>
      </main>
    </div>
  )
}