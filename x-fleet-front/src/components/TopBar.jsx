// components/TopBar.jsx
import { Bolt, ToggleLeft, ToggleRight } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { API_BASE } from '../config'

export default function TopBar({ mode, setMode, compact, setCompact }) {
  const isAuto = mode === 'Auto'
  const { pathname } = useLocation()
  const onRequestPage = pathname === '/requestappointment'

  // Voice AI global toggle state
  const [voiceOn, setVoiceOn] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/voice/state`)
        const j = await r.json()
        if (alive && j?.ok) setVoiceOn(!!j.enabled)
      } catch {}
    })()
    return () => { alive = false }
  }, [])

  async function toggleVoice(next) {
    setVoiceOn(next) // optimistic
    try {
      await fetch(`${API_BASE}/api/voice/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
    } catch {
      // optional: revert on error
      // setVoiceOn(v => !v)
    }
  }

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-white/5">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-2">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-none bg-accent/20 flex items-center justify-center">
            <Bolt className="text-accent" size={18} />
          </div>
          <div className="font-semibold tracking-tight">NONSTOP JOBS</div>
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

         {/* Voice AI toggle */}
<button
  onClick={() => toggleVoice(!voiceOn)}
  className={
    "flex items-center gap-2 px-2 py-1 rounded-md text-sm font-medium transition " +
    (voiceOn
      ? "bg-emerald-600 text-white hover:bg-emerald-500 shadow"
      : "bg-zinc-700 text-zinc-200 hover:bg-zinc-600")
  }
>
  <span className="w-2 h-2 rounded-full bg-current"></span>
  {voiceOn ? "Voice AI: ON" : "Voice AI: OFF"}
</button>

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