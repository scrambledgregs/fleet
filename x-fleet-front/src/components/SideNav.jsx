// src/components/SideNav.jsx
import { CalendarDays, Users, AlertTriangle, MessageSquare, Truck } from 'lucide-react'

const NAV = [
  { id: 'planner',  label: 'Jobs',     Icon: CalendarDays },
  { id: 'contacts', label: 'Contacts', Icon: Users },
  { id: 'alerts',   label: 'AI Alerts',Icon: AlertTriangle },
  { id: 'chatter',  label: 'Chatter',  Icon: MessageSquare },
  { id: 'vehicles', label: 'Vehicles', Icon: Truck },
]

export default function SideNav({
  active,          // preferred prop
  tab,             // legacy compatibility
  onChange,
  counts = {},     // optional: { planner: 12, contacts: 3, ... }
}) {
  const current = active ?? tab ?? 'planner'

  return (
    <nav className="shrink-0 w-14 sm:w-48 border-r border-white/10 pr-1 sm:pr-2 mr-2 sm:mr-3">
      <div className="py-1 sm:py-2 flex sm:block gap-1 sm:gap-2">
        {NAV.map(({ id, label, Icon }) => {
          const isActive = current === id
          const count = counts[id]
          return (
            <button
              key={id}
              onClick={() => onChange?.(id)}
              aria-pressed={isActive}
              title={label}
              className={[
                'group relative w-12 sm:w-full h-10 sm:h-11 flex items-center justify-center sm:justify-start gap-2 rounded-lg transition px-0 sm:px-3',
                isActive
                  ? 'bg-white/10 ring-1 ring-white/20 text-white'
                  : 'text-white/70 hover:bg-white/5 hover:text-white'
              ].join(' ')}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="hidden sm:block absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-sky-400 rounded-full" />
              )}

              <Icon size={18} className="shrink-0" />

              <span className="hidden sm:inline text-sm">{label}</span>

              {typeof count === 'number' && count > 0 && (
                <span className="hidden sm:inline ml-auto text-[11px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/80">
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}