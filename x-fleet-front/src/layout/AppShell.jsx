// src/layout/AppShell.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import TopBar from '../components/TopBar.jsx'
import SideNav from '../components/SideNav.jsx'
import CommandBar from '../components/CommandBar'   // TS component
import PhoneDock from '../components/PhoneDock'     // TS component
import FloatingCTA from '../components/FloatingCTA.jsx'
import { Outlet } from 'react-router-dom'
import {
  PhoneOutgoing, PlayCircle, PauseCircle, Square, SkipForward,
  Upload, ListChecks, Clock
} from 'lucide-react'

// one-time front-end bridge -> backend /api/voice/call
import { installVoiceBridge } from '../voice/bridge'

// ---------------------------
// Minimal inline Power Dialer
// ---------------------------
function PowerDialerDock() {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const [queue, setQueue] = useState([])
  const [i, setI] = useState(0)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [delayMs, setDelayMs] = useState(2500)
  const [maxCallMs, setMaxCallMs] = useState(45000)
  const timerRef = useRef(null)
  const gapRef = useRef(null)

  const norm = (s) => {
    if (!s) return ''
    const digits = s.replace(/[^\d+]/g, '')
    if (!digits) return ''
    if (digits.startsWith('+')) return digits
    if (/^\d{10}$/.test(digits)) return '+1' + digits
    if (/^\d{11}$/.test(digits)) return '+' + digits
    return digits
  }

  function parseList(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const nums = []
    for (const line of lines) {
      const parts = line.split(/[,\t;]/).map(x => x.trim()).filter(Boolean)
      const candidate = parts.find(p => /[\d+][\d\s().-]{6,}/.test(p)) || line
      const n = norm(candidate)
      if (n) nums.push(n)
    }
    return Array.from(new Set(nums))
  }

  useEffect(() => { setQueue(parseList(raw)); setI(0) }, [raw])

  useEffect(() => {
    const onEnded = () => advanceAfterGap()
    window.addEventListener('voice:call-ended', onEnded)
    return () => window.removeEventListener('voice:call-ended', onEnded)
  }, [running, paused])

  // close on ESC
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function dialCurrent() {
    const to = queue[i]
    if (!to) return
    window.dispatchEvent(new CustomEvent('voice:dial', { detail: { to } }))
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { advanceAfterGap() }, maxCallMs)
  }

  function advanceAfterGap() {
    clearTimeout(timerRef.current)
    if (!running || paused) return
    clearTimeout(gapRef.current)
    gapRef.current = setTimeout(() => {
      setI(prev => {
        const next = prev + 1
        if (next < queue.length) setTimeout(dialCurrent, 0)
        else setRunning(false)
        return next
      })
    }, delayMs)
  }

  function onStart() {
    if (!queue.length) return
    setRunning(true); setPaused(false); setI(0)
    setTimeout(dialCurrent, 0)
  }
  const onPause  = () => { setPaused(true); clearTimeout(timerRef.current); clearTimeout(gapRef.current) }
  const onResume = () => { if (!running) return; setPaused(false); advanceAfterGap() }
  function onStop()  { setRunning(false); setPaused(false); clearTimeout(timerRef.current); clearTimeout(gapRef.current) }
  function onNext()  {
    clearTimeout(timerRef.current); clearTimeout(gapRef.current)
    setI(prev => {
      const next = Math.min(prev + 1, queue.length)
      if (next < queue.length) setTimeout(dialCurrent, 0)
      else setRunning(false)
      return next
    })
  }

  const progress = useMemo(() => {
    const total = Math.max(queue.length, 1)
    return Math.min(100, Math.round((i / total) * 100))
  }, [i, queue.length])

  return (
    <>
      {/* Floating Dialer button (offset from PhoneDock, hidden on very small screens) */}
      <button
        aria-label="Open Power Dialer"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-24 z-40 hidden sm:inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white shadow-lg ring-1 ring-white/15 hover:bg-white/15 focus:outline-none"
        title="Power Dialer"
      >
        <ListChecks size={20} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full sm:max-w-lg sm:rounded-2xl sm:shadow-2xl border border-white/10 bg-[#161b22]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <PhoneOutgoing size={16} className="text-white/80" />
                <div className="font-semibold">Power Dialer</div>
              </div>
              <div className="text-xs text-white/60">
                {i}/{queue.length} • <span className="inline-flex items-center gap-1"><Clock size={12} /> {Math.round(maxCallMs/1000)}s</span>
              </div>
            </div>

            <div className="px-4 py-3 flex items-center gap-2">
              {!running ? (
                <button className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-orange)] px-3 h-9 text-sm font-semibold text-white shadow hover:bg-[var(--brand-orange2)] disabled:opacity-50" onClick={onStart} disabled={!queue.length} title="Start">
                  <PlayCircle size={16} /> Start
                </button>
              ) : paused ? (
                <button className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 h-9 text-sm font-semibold text-white hover:bg-white/15" onClick={onResume} title="Resume">
                  <PlayCircle size={16} /> Resume
                </button>
              ) : (
                <button className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 h-9 text-sm font-semibold text-white hover:bg-white/15" onClick={onPause} title="Pause">
                  <PauseCircle size={16} /> Pause
                </button>
              )}

              <button className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 h-9 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-50" onClick={onNext} disabled={!running || i >= queue.length - 1} title="Next">
                <SkipForward size={16} /> Next
              </button>

              <button className="ml-auto inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 h-9 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-50" onClick={onStop} disabled={!running} title="Stop">
                <Square size={14} /> Stop
              </button>
            </div>

            <div className="px-4 pb-2 flex items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-2">
                Gap
                <input type="number" min={500} step={500} value={delayMs} onChange={e => setDelayMs(parseInt(e.target.value || '0', 10))} className="w-20 h-8 rounded bg-white/5 border border-white/10 px-2" />
                ms
              </label>
              <label className="inline-flex items-center gap-2">
                Max call
                <input type="number" min={5000} step={5000} value={maxCallMs} onChange={e => setMaxCallMs(parseInt(e.target.value || '0', 10))} className="w-24 h-8 rounded bg-white/5 border border-white/10 px-2" />
                ms
              </label>
            </div>

            <div className="mx-4 h-1 rounded-full bg-white/10 overflow-hidden mb-3">
              <div className="h-full bg-gradient-to-r from-[var(--brand-orange)] to-[var(--brand-orange2)]" style={{ width: `${progress}%` }} />
            </div>

            <div className="px-4 pb-4">
              <div className="flex items-center justify-between mb-1 text-xs text-white/60">
                <div className="inline-flex items-center gap-1"><Upload size={12} /> Paste numbers (CSV or one per line)</div>
                <div className="text-white/50">{queue.length} parsed</div>
              </div>
              <textarea
                rows={6}
                value={raw}
                onChange={e => setRaw(e.target.value)}
                placeholder={`Example:\nJohn, (555) 111-2222\n+15553334444\n(555) 999-8888`}
                className="w-full resize-y rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------
// AppShell
// ---------------------------
export default function AppShell({ mode, setMode, compact, setCompact }) {
  // Install the voice bridge once
  useEffect(() => {
    try { installVoiceBridge() } catch {}
  }, [])

  // Let the command bar toggle compact density (⌘K → “Toggle Compact Density”)
  useEffect(() => {
    const onToggle = () => setCompact?.((v) => !v)
    window.addEventListener('ui:toggle-compact', onToggle)
    return () => window.removeEventListener('ui:toggle-compact', onToggle)
  }, [setCompact])

  return (
    <div className={'min-h-screen text-white flex flex-col ' + (compact ? 'compact-root' : '')}>
      <TopBar />
      <CommandBar />

      {/* Full-height layout: main grows, children can scroll */}
      <main className="relative z-0 flex-1 min-h-0 grid grid-cols-12 gap-x-6 gap-y-4 p-4 lg:p-6">
        {/* LEFT: SideNav — force it above any floating UI and ensure clicks always land */}
        <aside className="col-span-12 lg:col-span-2 pr-3 lg:pr-4 lg:border-r lg:border-white/10 min-h-0 relative z-50 pointer-events-auto">
          <div className="sticky top-4">
            <SideNav />
          </div>
        </aside>

        {/* RIGHT: Routed content — stretches and scrolls within */}
        <section className="col-span-12 lg:col-span-10 min-h-0 flex flex-col relative z-10">
          <div className="flex-1 min-h-0">
            <Outlet />
          </div>
        </section>
      </main>

      {/* Floating Phone/SMS dock (Twilio SMS live) */}
      <PhoneDock />

      {/* Minimal inline Power Dialer */}
      <PowerDialerDock />

      {/* Affiliate CTA (bottom-left, auto-hides on /affiliate) */}
      <FloatingCTA />
    </div>
  )
}