// src/components/SideNav.jsx
import { NavLink } from 'react-router-dom'
import {
  LayoutGrid, Users, Truck, Calendar, Package, BadgeDollarSign,
  FileText, MessageSquare, Activity, Bot, Settings
} from 'lucide-react'

// Order: Dashboard, Jobs (Bookings), Contacts, Calendar, Estimator, Messages, Fleet, Automations, Activity, Industry Packs, Affiliates, Settings
const LINKS = [
  { to: '/',        label: 'Dashboard', icon: LayoutGrid, end: true }, // exact match for home
  { to: '/jobs',    label: 'Bookings',  icon: LayoutGrid },            // your Jobs (DashboardContent)
  { to: '/contacts',label: 'Contacts',  icon: Users },
  { to: '/calendar',label: 'Calendar',  icon: Calendar },
  { to: '/estimator',label: 'Estimator',icon: FileText },
  { to: '/chatter', label: 'Messages',  icon: MessageSquare },
  { to: '/vehicles',label: 'Fleet',     icon: Truck },
  { to: '/automations', label: 'Automations', icon: Bot },
  { to: '/events',  label: 'Activity',  icon: Activity },
  { to: '/packs',   label: 'Industry Packs', icon: Package },
  { to: '/affiliate', label: 'Affiliates', icon: BadgeDollarSign },
  { to: '/settings', label: 'Settings', icon: Settings },
]

// Render a single row so we can use NavLink’s children-as-a-function
function LinkRow({ to, end, label, Icon }) {
  return (
    <NavLink
      to={to}
      end={!!end}
      className={({ isActive }) =>
        [
          'group relative flex items-center gap-3 rounded-xl px-3 py-2 transition',
          isActive ? 'bg-white/5 text-white' : 'text-white/75 hover:text-white hover:bg-white/5',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={[
              'absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full',
              isActive
                ? 'bg-gradient-to-b from-[var(--brand-orange)] to-[var(--brand-orange2)]'
                : 'bg-transparent group-hover:bg-white/10',
            ].join(' ')}
          />
          <Icon
            size={18}
            className={isActive ? 'text-white' : 'text-white/70 group-hover:text-white'}
          />
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  )
}

export default function SideNav() {
  return (
    <nav className="space-y-1">
      <ul className="flex flex-col gap-1">
        {LINKS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <LinkRow to={to} end={end} label={label} Icon={Icon} />
          </li>
        ))}
      </ul>
    </nav>
  )
}