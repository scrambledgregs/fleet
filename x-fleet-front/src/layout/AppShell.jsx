// src/layout/AppShell.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import TopBar from '../components/TopBar.jsx'
import SideNav from '../components/SideNav.jsx'
import CommandBar from '../components/CommandBar'
import PhoneDock from '../components/PhoneDock'
import FloatingCTA from '../components/FloatingCTA.jsx'
import confetti from 'canvas-confetti'
import { makeSocket, getTenantId, withTenant } from '../lib/socket'
import { Outlet } from 'react-router-dom'
import {
  PhoneOutgoing, PlayCircle, PauseCircle, Square, SkipForward,
  Upload, ListChecks, Clock
} from 'lucide-react'
import { installVoiceBridge } from '../voice/bridge'

const fireTestPaid = async () => {
  try {
    const base =
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) ||
      (typeof window !== 'undefined' ? window.location.origin : '')
    const invoiceId = 'demo_' + Date.now().toString(36)
    const r = await fetch(
      `${base.replace(/\/$/, '')}/api/invoices/${encodeURIComponent(invoiceId)}/pay`,
      {
        method: 'POST',
        ...withTenant({ headers: { 'Content-Type': 'application/json' } }),
        body: JSON.stringify({ clientId: getTenantId(), amount: 499.0 }),
      }
    )
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j?.ok) return
    confetti({ particleCount: 160, spread: 70, origin: { y: 0.6 } })
    setTimeout(() => confetti({ particleCount: 120, spread: 90, origin: { y: 0.6 }, scalar: 0.9 }), 180)
  } catch {}
}

/* ==== Power Dialer (unchanged) ==== */
function PowerDialerDock() {
  // ... (unchanged)
}

/* ==== AppShell ==== */
export default function AppShell({ mode, setMode, compact, setCompact }) {
  useEffect(() => { try { installVoiceBridge() } catch {} }, [])
  useEffect(() => {
    const onToggle = () => setCompact?.((v) => !v)
    window.addEventListener('ui:toggle-compact', onToggle)
    return () => window.removeEventListener('ui:toggle-compact', onToggle)
  }, [setCompact])

  return (
    <div className={'min-h-screen text-white flex flex-col ' + (compact ? 'compact-root' : '')}>
      <TopBar />
      <CommandBar />

      {/* IMPORTANT: add min-h-0 so inner flex/grid children can shrink and scroll internally */}
      <main className="relative z-0 flex-1 min-h-0 grid grid-cols-12 gap-x-6 gap-y-4 p-4 lg:p-6">
        {/* LEFT: SideNav */}
        <aside className="col-span-12 lg:col-span-2 pr-3 lg:pr-4 lg:border-r lg:border-white/10">
          <div className="sticky top-4">
            <SideNav />
          </div>
        </aside>

        {/* RIGHT: Routed content — allow it to shrink and host its own overflow */}
        <section className="col-span-12 lg:col-span-10 min-h-0 flex flex-col">
          <Outlet />
        </section>
      </main>

      <PhoneDock />
      <PowerDialerDock />

      {import.meta.env?.DEV && (
        <button
          onClick={fireTestPaid}
          className="fixed bottom-24 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-green-600/90 hover:bg-green-600 px-4 h-10 text-sm font-semibold text-white shadow-lg ring-1 ring-white/10"
          title="Simulate invoice.paid"
          aria-label="Simulate invoice paid"
        >
          Paid 🎉
        </button>
      )}

      <FloatingCTA />
    </div>
  )
}