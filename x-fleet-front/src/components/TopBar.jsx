// components/TopBar.jsx
import { Bolt, ToggleLeft, ToggleRight } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

export default function TopBar({ mode, setMode, compact, setCompact }) {
  const isAuto = mode === 'Auto'
  const { pathname } = useLocation()
  const onRequestPage = pathname === '/requestappointment'

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-white/5">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-2">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-none bg-accent/20 flex items-center justify-center">
            <Bolt className="text-accent" size={18} />
          </div>
          <div className="font-semibold tracking-tight">Smart Dispatch Companion</div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {/* Request Appointment */}
          <Link
            to="/requestappointment"
            aria-label="Open Request Appointment"
            className={[
              "text-sm px-3 py-1.5 rounded-none transition",
              onRequestPage
                ? "bg-blue-600 text-white hover:bg-blue-500"
                : "glass hover:bg-panel/70 text-white"
            ].join(' ')}
          >
            Request Appointment
          </Link>

          {/* Mode toggle */}
          <div className="text-sm text-white/60 hidden sm:block">Dispatch Mode</div>
          <button
            onClick={() => setMode(isAuto ? 'Approve' : 'Auto')}
            className="flex items-center gap-2 rounded-none px-2 py-1 glass hover:bg-panel/70 transition"
            aria-label="Toggle Dispatch Mode"
          >
            {isAuto ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
            <span className="text-sm">{isAuto ? 'Auto' : 'Approve'}</span>
          </button>

          {/* Compact toggle */}
          <button
            onClick={() => setCompact(!compact)}
            className="flex items-center gap-2 rounded-none px-2 py-1 glass hover:bg-panel/70 transition"
            aria-label="Toggle Compact Layout"
          >
            <span className="text-sm">{compact ? 'Compact: On' : 'Compact: Off'}</span>
          </button>
        </div>
      </div>
    </header>
  )
}