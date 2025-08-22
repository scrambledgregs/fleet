// src/layout/AppShell.jsx
import TopBar from '../components/TopBar.jsx'
import StatBar from '../components/StatBar.jsx'
import SideNav from '../components/SideNav.jsx'
import { Outlet, useLocation } from 'react-router-dom'

const TITLES = {
  '/':              { title: 'Dashboard',     subtitle: 'Today’s work at a glance' },
  '/contacts':      { title: 'Contacts',      subtitle: 'Manage people & companies' },
  '/vehicles':      { title: 'Vehicles',      subtitle: 'Fleet status & assignments' },
  '/calendar':      { title: 'Calendar',      subtitle: 'Week, day and routes' },
  '/packs':         { title: 'Industry Packs',subtitle: 'Plug-and-play presets' },
  '/affiliate':     { title: 'Affiliate',     subtitle: 'Earn 40% lifetime revenue' },
  '/estimator':     { title: 'Estimator',     subtitle: 'Build and send estimates' },
  '/measure/roof':  { title: 'Roof Measure',  subtitle: 'Satellite measure & materials' },
  '/chatter':       { title: 'Chatter',       subtitle: 'Text and email in one place' },
  '/events':        { title: 'Activity',      subtitle: 'Audit log of system events' },
  '/automations':   { title: 'Automations',   subtitle: 'Out-of-the-box flows you control' },
  '/settings':      { title: 'Settings',      subtitle: 'Team, vehicles, integrations' },
}

export default function AppShell({ mode, setMode, compact, setCompact }) {
  const { pathname } = useLocation()
  const base = '/' + pathname.split('/').filter(Boolean)[0]
 

  return (
    <div className={'min-h-screen text-white ' + (compact ? 'compact-root' : '')}>
      <TopBar mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />

      <div className={'px-6 ' + (compact ? 'pt-2' : 'pt-4')}>
        <StatBar />
      </div>

      <main className={'grid grid-cols-12 ' + (compact ? 'gap-4 p-4' : 'gap-6 p-6')}>
        <aside className="col-span-12 lg:col-span-2">
          <div className="sticky top-4">
            <SideNav />
          </div>
        </aside>

        <section className="col-span-12 lg:col-span-10">
          <Outlet />
        </section>
      </main>
    </div>
  )
}