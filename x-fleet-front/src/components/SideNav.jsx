import { NavLink } from 'react-router-dom'
import {
  LayoutGrid, Users, Truck, Calendar, Package, BadgeDollarSign,
  FileText, MessageSquare, Activity, Bot, Settings, Phone, Wrench
} from 'lucide-react'

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
          {Icon ? (
            <Icon size={18} className={isActive ? 'text-white' : 'text-white/70 group-hover:text-white'} />
          ) : (
            <span className="w-[18px]" />
          )}
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="px-3 pt-3 pb-1 text[11px] uppercase tracking-[0.12em] text-white/50">
      {children}
    </div>
  )
}

const SECTIONS = [
  {
    label: 'Overview',
    links: [{ to: '/', label: 'Dashboard', icon: LayoutGrid, end: true }],
  },
  {
    label: 'Office',
    links: [ 
      { to: '/chatter',  label: 'Messages',   icon: MessageSquare },
      { to: '/phones',   label: 'Phones',     icon: Phone },
      { to: '/team',     label: 'Team Chat',  icon: MessageSquare },
    ],
  },
  {
      label: 'LEADS',
    links: [
      { to: '/contacts', label: 'Contacts',   icon: Users },
      { to: '/leads',    label: 'Lead Hub',  icon: Activity },  
    ],
  },
  {
    label: 'Jobs',
    links: [
      { to: '/jobs',     label: 'Bookings',  icon: LayoutGrid },
      { to: '/calendar', label: 'Calendar',  icon: Calendar },
      { to: '/vehicles', label: 'Fleet',     icon: Truck },
      { to: '/jobboard', label: 'Production', icon: Wrench }, // ✅ matches route
    ],
  },
  {
    label: 'Accounting',
    links: [
      { to: '/estimator', label: 'Estimates', icon: FileText },
      { to: '/invoices',  label: 'Invoices',  icon: BadgeDollarSign },
    ],
  },
  {
    label: 'Automation',
    links: [
      { to: '/automations', label: 'Automations', icon: Bot },
      { to: '/events',      label: 'Activity',    icon: Activity },
    ],
  },
  {
    label: 'Catalog',
    links: [
      { to: '/packs',     label: 'Industry Packs', icon: Package },
      { to: '/affiliate', label: 'Affiliates',     icon: BadgeDollarSign },
    ],
  },
  {
    label: 'Settings',
    links: [{ to: '/settings', label: 'Settings', icon: Settings }],
  },
]

export default function SideNav() {
  return (
    <nav className="space-y-2">
      {SECTIONS.map(sec => (
        <div key={sec.label}>
          <SectionLabel>{sec.label}</SectionLabel>
          <ul className="flex flex-col gap-1">
            {sec.links.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <LinkRow to={to} end={end} label={label} Icon={Icon} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}