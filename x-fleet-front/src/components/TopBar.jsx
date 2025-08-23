// src/components/TopBar.jsx
import logo from '../images/logo-1.png'

import { Mic, MicOff, Settings as SettingsIcon, Wand2 } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { API_BASE } from '../config'

export default function TopBar({
  variant = 'gray',
  rightSlot = null,
  ..._unused // swallow legacy props
}) {
  const { pathname } = useLocation()
  const onRequestPage = pathname === '/requestappointment'
  const isLight = variant === 'light'

  // Voice AI state (system)
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

  function openCommandPalette() {
    window.dispatchEvent(new CustomEvent('commandpalette:open'))
  }

  const shell = 'topbar-base relative flex items-center justify-between px-4 h-14'
  const byVariant = {
    gray: 'text-white bg-[var(--brand-gray)]',
    gradient: 'text-white',
    light: 'text-[#111] bg-[var(--brand-white)] topbar--light',
  }

  const settingsBtn = isLight
    ? 'inline-flex items-center justify-center w-9 h-9 rounded-full text-[#111]/70 hover:text-[#111] hover:bg-black/5'
    : 'inline-flex items-center justify-center w-9 h-9 rounded-full text-white/80 hover:text-white hover:bg-white/10'

  // Command launcher pill (single icon)
  const commandPill =
    (isLight
      ? 'bg-black/5 hover:bg-black/10 border border-black/10 text-[#111]/80'
      : 'bg-white/5 hover:bg-white/10 border border-white/15 text-white/85')

  return (
    <header
      className={`${shell} ${byVariant[variant] || byVariant.gray}`}
      style={variant === 'gradient'
        ? { background: 'linear-gradient(90deg,#ff052f,#ef4021)' }
        : undefined}
    >
      {/* Slim accent strip for gray */}
      {variant === 'gray' && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[var(--brand-orange)] to-[var(--brand-orange2)]" />
      )}

      {/* Left: Logo */}
      <div className="flex items-center gap-3 min-w-0">
        <Link to="/" aria-label="Home" className="shrink-0">
          <img src={logo} alt="Nonstop" className="h-6 w-auto select-none" draggable="false" />
        </Link>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        {rightSlot}

        {/* Command launcher (pill, ONE icon) */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Open Command (⌘K)"
          title="Command (⌘K)"
          onClick={openCommandPalette}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openCommandPalette()
            }
          }}
          className={`hidden md:inline-flex items-center gap-2 h-8 rounded-full px-2.5 text-sm transition select-none focus:outline-none ${commandPill}`}
        >
          <Wand2 size={14} className="opacity-90" />
          <span className="hidden lg:inline">Command</span>
          <span className="hidden lg:inline text-[11px] opacity-70 ml-1">⌘K</span>
        </div>

        {/* Book Job (primary) */}
        {variant === 'gradient' ? (
          <Link
            to="/requestappointment"
            aria-label="Open Request Appointment"
            className={`bg-white text-[var(--brand-orange)] font-semibold rounded-full px-3 h-8 inline-flex items-center ${onRequestPage ? 'opacity-90' : ''}`}
          >
            Book Job
          </Link>
        ) : (
          <Link
            to="/requestappointment"
            aria-label="Open Request Appointment"
            className={`btn-primary rounded-full px-3 h-8 inline-flex items-center ${onRequestPage ? 'ring-2 ring-white/20' : ''}`}
          >
            Book Job
          </Link>
        )}

        {/* Voice AI toggle (the only mic in the top bar) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={voiceOn}
            onClick={() => toggleVoice(!voiceOn)}
            title={voiceOn ? 'Voice AI: On' : 'Voice AI: Off'}
            className={[
              'relative inline-flex h-8 w-14 rounded-full border transition focus:outline-none',
              isLight
                ? 'bg-black/10 border-black/10 focus:ring-2 focus:ring-black/20'
                : 'bg-white/10 border-white/15 focus:ring-2 focus:ring-white/20'
            ].join(' ')}
            aria-label="Toggle Voice AI"
          >
            <span
              className={[
                'absolute left-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform duration-200',
                voiceOn ? 'translate-x-6' : ''
              ].join(' ')}
            >
              {voiceOn
                ? <Mic size={14} className={isLight ? 'text-[#111]' : 'text-[var(--brand-gray)]'} />
                : <MicOff size={14} className={isLight ? 'text-[#111]' : 'text-[var(--brand-gray)]'} />}
            </span>
          </button>

          <span className="flex items-center gap-1.5 text-xs font-medium">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: voiceOn ? 'var(--status-green)' : (isLight ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.35)') }}
            />
            <span className={`${isLight ? 'text-[#111]/80' : 'text-white/80'}`}>Voice AI</span>
          </span>
        </div>

        {/* Settings icon */}
        <Link to="/settings" aria-label="Settings" className={settingsBtn}>
          <SettingsIcon size={22} />
        </Link>
      </div>
    </header>
  )
}