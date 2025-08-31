// src/components/TopBar.jsx
import logo from '../images/logo-1.png'

import {
  Mic, MicOff, Settings as SettingsIcon, Wand2,
  Megaphone, X
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { API_BASE } from '../config'
import { resolveTenantId } from '../lib/http'

// -----------------------------
// Portaled UI bits
// -----------------------------
function Portal({ children }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

function AnnouncementBanner({ data, onClose }) {
  if (!data) return null
  const colorByLevel = {
    info: 'from-[var(--brand-orange)] to-[var(--brand-orange2)]',
    warn: 'from-yellow-500 to-amber-600',
    critical: 'from-red-500 to-rose-600',
  }
  const gradient = colorByLevel[data.level] || colorByLevel.info

  return (
    <Portal>
      <div className="fixed inset-x-0 top-0 z-[200] px-4 py-3 pointer-events-none">
        <div className={`pointer-events-auto mx-auto max-w-6xl rounded-2xl shadow-2xl ring-1 ring-white/25 text-white bg-gradient-to-r ${gradient}`}>
          <div className="flex items-start gap-3 p-3">
            <Megaphone size={20} className="mt-0.5 shrink-0" />
            <div className="text-base leading-6 font-semibold whitespace-pre-wrap">
              {data.message}
            </div>
            <button
              onClick={onClose}
              className="ml-auto inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/20"
              aria-label="Dismiss announcement"
              title="Dismiss"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

function AnnouncementModal({ open, onClose, onSend, isLight }) {
  const [message, setMessage] = useState('')
  const [level, setLevel] = useState('info')      // info | warn | critical
  const [seconds, setSeconds] = useState(120)     // auto-dismiss
  const [sending, setSending] = useState(false)
  const taRef = useRef(null)

  // Reset contents when opened
  useEffect(() => {
    if (!open) return
    setMessage('')
    setLevel('info')
    setSeconds(120)
  }, [open])

  // Focus once when opened (and keep caret at end)
  useEffect(() => {
    if (!open) return
    const t = taRef.current
    if (t) {
      t.focus()
      const len = t.value.length
      try { t.setSelectionRange(len, len) } catch {}
    }
  }, [open])

  // Close on ESC
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const label = isLight ? 'text-[#111]/70' : 'text-white/80'
  const input = isLight
    ? 'bg-black/5 border border-black/10 text-[#111] placeholder-[#111]/40'
    : 'bg-black/30 border border-white/10 text-white placeholder-white/40'

  if (!open) return null

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/60"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <div className="w-full max-w-lg rounded-2xl bg-[#111] text-white ring-1 ring-white/15 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Megaphone size={18} />
              <h3 className="font-semibold">Make an announcement</h3>
            </div>
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/10"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <label className={`block text-xs mb-1 ${label}`}>Message</label>
          <textarea
            ref={taRef}
            rows={5}
            className={`w-full rounded-xl px-3 py-2 mb-3 focus:outline-none ${input}`}
            placeholder="What should everyone see?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-xs mb-1 ${label}`}>Level</label>
              <div className="flex gap-2">
                {['info','warn','critical'].map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLevel(lvl)}
                    className={[
                      'px-3 py-1.5 rounded-xl text-sm border',
                      level === lvl ? 'bg-white/15 border-white/20' : 'border-white/15 hover:bg-white/10'
                    ].join(' ')}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={`block text-xs mb-1 ${label}`}>Auto-dismiss (seconds)</label>
              <input
                type="number"
                min={10}
                step={10}
                className={`w-full rounded-xl px-3 py-2 focus:outline-none ${input}`}
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value || 0))}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-xl border border-white/15 hover:bg-white/10"
              type="button"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={sending || !message.trim()}
              onClick={async () => {
                if (!message.trim()) return
                setSending(true)
                try {
                  await onSend?.({
                    message: message.trim(),
                    level,
                    expiresInSec: Number(seconds) || 120,
                  })
                  onClose()
                } finally {
                  setSending(false)
                }
              }}
              className="px-3 py-2 rounded-xl bg-gradient-to-r from-[var(--brand-orange)] to-[var(--brand-orange2)] font-semibold disabled:opacity-60"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

// -----------------------------
// Top bar
// -----------------------------
export default function TopBar({
  variant = 'gray',
  rightSlot = null,
  ..._unused
}) {
  const { pathname } = useLocation()
  const onRequestPage = pathname === '/requestappointment'
  const isLight = variant === 'light'
  const tenantId = resolveTenantId()

  // Voice AI
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
  const toggleVoice = useCallback(async (next) => {
    setVoiceOn(next)
    try {
      await fetch(`${API_BASE}/api/voice/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
    } catch {}
  }, [])

  // Command palette
  const openCommandPalette = useCallback(() => {
    window.dispatchEvent(new CustomEvent('commandpalette:open'))
  }, [])

  // Announcements
  const [announceOpen, setAnnounceOpen] = useState(false)
  const [incoming, setIncoming] = useState(null) // { message, level, expiresInSec, at }
  const bcRef = useRef(null)

  // Listen cross-tabs
  useEffect(() => {
    try {
      const bc = new BroadcastChannel('announcements')
      bcRef.current = bc
      bc.onmessage = (ev) => {
        if (ev?.data?.message) setIncoming(ev.data)
      }
      return () => bc.close()
    } catch {
      const key = 'announce:last'
      const onStorage = (e) => {
        if (e.key === key && e.newValue) {
          try { setIncoming(JSON.parse(e.newValue)) } catch {}
        }
      }
      window.addEventListener('storage', onStorage)
      return () => window.removeEventListener('storage', onStorage)
    }
  }, [])

  // Hide banner after TTL
  useEffect(() => {
    if (!incoming?.expiresInSec) return
    const t = setTimeout(() => setIncoming(null), Number(incoming.expiresInSec) * 1000)
    return () => clearTimeout(t)
  }, [incoming])

  // Send announcement
  const sendAnnouncement = useCallback(async ({ message, level, expiresInSec }) => {
    const payload = {
      message,
      level,
      expiresInSec: Number(expiresInSec) || 120,
      at: Date.now(),
      tenantId,
    }

    // Backend (best-effort)
    try {
      await fetch(`${API_BASE}/api/announcements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId,
        },
        body: JSON.stringify(payload),
      })
    } catch {}

    // Local broadcast
    try { bcRef.current?.postMessage(payload) } catch {}
    try { localStorage.setItem('announce:last', JSON.stringify(payload)) } catch {}

    // Show immediately here
    setIncoming(payload)
  }, [tenantId])

  // ---------------- styles ----------------
  const shell = 'topbar-base relative flex items-center justify-between px-4 h-14'
  const byVariant = {
    gray: 'text-white bg-[var(--brand-gray)]',
    gradient: 'text-white',
    light: 'text-[#111] bg-[var(--brand-white)] topbar--light',
  }
  const settingsBtn = isLight
    ? 'inline-flex items-center justify-center w-9 h-9 rounded-full text-[#111]/70 hover:text-[#111] hover:bg-black/5'
    : 'inline-flex items-center justify-center w-9 h-9 rounded-full text-white/80 hover:text-white hover:bg-white/10'
  const commandPill =
    (isLight
      ? 'bg-black/5 hover:bg-black/10 border border-black/10 text-[#111]/80'
      : 'bg-white/5 hover:bg-white/10 border border-white/15 text-white/85')

  return (
    <>
      {/* Global banner */}
      <AnnouncementBanner data={incoming} onClose={() => setIncoming(null)} />

      {/* Composer */}
      <AnnouncementModal
        open={announceOpen}
        onClose={() => setAnnounceOpen(false)}
        onSend={sendAnnouncement}
        isLight={isLight}
      />

      <header
        className={`${shell} ${byVariant[variant] || byVariant.gray}`}
        style={variant === 'gradient'
          ? { background: 'linear-gradient(90deg,#ff052f,#ef4021)' }
          : undefined}
      >
        {/* Slim accent strip */}
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

          {/* Announce */}
          <button
            type="button"
            onClick={() => setAnnounceOpen(true)}
            className={isLight
              ? 'hidden md:inline-flex items-center gap-2 h-8 rounded-full px-3 text-sm bg-black/5 hover:bg-black/10 border border-black/10 text-[#111]/80'
              : 'hidden md:inline-flex items-center gap-2 h-8 rounded-full px-3 text-sm bg-white/5 hover:bg-white/10 border border-white/15 text-white/85'}
            title="Make an announcement"
          >
            <Megaphone size={14} className="opacity-90" />
            <span className="hidden lg:inline">Announce</span>
          </button>

          {/* Command */}
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

          {/* Book Job */}
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

          {/* Voice AI */}
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

          {/* Settings */}
          <Link to="/settings" aria-label="Settings" className={settingsBtn}>
            <SettingsIcon size={22} />
          </Link>
        </div>
      </header>
    </>
  )
}