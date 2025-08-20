import { CalendarDays, Users, AlertTriangle, MessageSquare, Truck, Calendar as CalendarIcon, Package, Link as LinkIcon } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'

const NAV = [
  { id: 'planner',   label: 'Jobs',          Icon: CalendarDays,  to: '/' },
  { id: 'contacts',  label: 'Contacts',      Icon: Users,         to: '/contacts' },
  // You mentioned AI Alerts shouldn't be in the sidenav; leaving it out by default.
  { id: 'chatter',   label: 'Chatter',       Icon: MessageSquare, to: '/chatter' },
  { id: 'vehicles',  label: 'Vehicles',      Icon: Truck,         to: '/vehicles' },
  { id: 'calendar',  label: 'Calendar',      Icon: CalendarIcon,  to: '/calendar' },
  { id: 'packs',     label: 'Industry Packs',Icon: Package,       to: '/packs' },
  { id: 'affiliate', label: 'Affiliate',     Icon: LinkIcon,      to: '/affiliate' },
]

export default function SideNav({ active, tab = 'planner', onChange }) {
  const location = useLocation()

  return (
    <nav className="relative z-10 shrink-0 w-14 sm:w-48 border-r border-white/10 pr-1 sm:pr-2 mr-2 sm:mr-3">
      <div className="py-1 sm:py-2 flex sm:block gap-1 sm:gap-2">
        {NAV.map(({ id, label, Icon, to }) => {
          const isActive = location.pathname === to || location.pathname.startsWith(to + '/')

          const base = 'group relative w-12 sm:w-full h-10 sm:h-11 flex items-center justify-center sm:justify-start gap-2 rounded-lg transition px-0 sm:px-3'
          const cls  = isActive
            ? `${base} bg-white/10 ring-1 ring-white/20 text-white`
            : `${base} text-white/70 hover:bg-white/5 hover:text-white`

          return (
            <NavLink key={id} to={to} className={cls} title={label}>
              {isActive && (
                <span className="hidden sm:block absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-sky-400 rounded-full" />
              )}
              <Icon size={18} className="shrink-0" />
              <span className="hidden sm:inline text-sm">{label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}