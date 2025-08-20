// src/layout/AppShell.jsx
import { Outlet } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import StatBar from '../components/StatBar.jsx'
import SideNav from '../components/SideNav.jsx'

export default function AppShell({ mode, setMode, compact, setCompact }) {
  return (
    <div className={'min-h-screen text-white ' + (compact ? 'compact-root' : '')}>
      {/* Global header */}
      <TopBar
        mode={mode}
        setMode={setMode}
        compact={compact}
        setCompact={setCompact}
      />

      {/* Global KPIs */}
      <div className={'px-6 ' + (compact ? 'pt-2' : 'pt-4')}>
        <StatBar />
      </div>

      {/* Shell grid: fixed left nav + page content */}
      <main className={'grid grid-cols-12 ' + (compact ? 'gap-4 p-4' : 'gap-6 p-6')}>
        <aside className="col-span-12 lg:col-span-2">
          <div className="sticky top-4">
            <SideNav />
          </div>
        </aside>

        {/* Each route renders its page body here (no TopBar/StatBar inside pages) */}
        <section className="col-span-12 lg:col-span-10">
          <Outlet />
        </section>
      </main>
    </div>
  )
}