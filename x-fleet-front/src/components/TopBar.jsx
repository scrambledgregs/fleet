// src/components/TopBar.jsx
import { Bolt } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { API_BASE } from '../config'

export default function TopBar({ title = '', subtitle = '', rightSlot = null }) {
  const { pathname } = useLocation()
  const onRequestPage = pathname === '/requestappointment'

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
    setVoiceOn(next)
    try {
      await fetch(`${API_BASE}/api/voice/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
    } catch {}
  }

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-white/5">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-2">
        {/* Brand + Page Title */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-none bg-accent/20 flex items-center justify-center">
            <Bolt className="text-accent" size={18} />
          </div>
          <div className="font-semibold tracking-tight">NONSTOP</div>
          {title && (
            <>
              <div className="h-5 w-px bg-white/10 mx-2" />
              <div className="min-w-0">
                <div className="text-base font-semibold truncate">{title}</div>
                {subtitle ? (
                  <div className="text-[11px] text-white/60 truncate">{subtitle}</div>
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {rightSlot}

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
            Book Job
          </Link>

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

          <Link
            to="/settings"
            className="glass hover:bg-panel/70 text-sm px-3 py-1.5 rounded-none"
          >
            Settings
          </Link>
        </div>
      </div>
    </header>
  )
}