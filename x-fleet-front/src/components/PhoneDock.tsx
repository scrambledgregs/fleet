import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Phone, PhoneCall, Send, X } from 'lucide-react'
import type { Socket } from 'socket.io-client'
import { getSocket, getTenantId, withTenant } from '../lib/socket'

type SMS = {
  id: string
  dir: 'in' | 'out'
  text: string
  at: string   // ISO string
  to?: string
  from?: string
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch { return '' }
}

function normalizePhone(input: string) {
  const s = (input || '').replace(/[^\d+]/g, '')
  if (!s) return ''
  if (s.startsWith('+')) return s
  if (/^\d{10}$/.test(s)) return '+1' + s // US default
  if (/^\d{11}$/.test(s)) return '+' + s
  return s
}

// same API base strategy used elsewhere (Vite env or window origin)
function apiBase(): string {
  const env =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE) || ''
  if (env) return String(env).replace(/\/$/, '')
  return (typeof window !== 'undefined' ? window.location.origin : '').replace(/\/$/, '')
}

export default function PhoneDock() {
  const tenantId = useMemo(() => getTenantId(), [])
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState<string>(() => localStorage.getItem('phonedock.to') || '')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [feed, setFeed] = useState<SMS[]>(() => {
    try {
      const raw = localStorage.getItem('phonedock.feed')
      return raw ? (JSON.parse(raw) as SMS[]) : []
    } catch { return [] }
  })
  const [unseen, setUnseen] = useState(0)

  // persist small bits
  useEffect(() => { localStorage.setItem('phonedock.to', to) }, [to])
  useEffect(() => { localStorage.setItem('phonedock.feed', JSON.stringify(feed.slice(-300))) }, [feed])
  useEffect(() => { if (open) setUnseen(0) }, [open])

  // socket: reuse singleton for this tenant (no duplicate connections)
  const socketRef = useRef<Socket | null>(null)
  useEffect(() => {
    const s = getSocket(tenantId)
    socketRef.current = s

    const onInbound = (m: any) => {
      const item: SMS = {
        id: m.sid || crypto.randomUUID(),
        dir: 'in',
        text: m.text ?? m.Body ?? '',
        at: m.at || new Date().toISOString(),
        from: m.from, to: m.to
      }
      setFeed((f) => f.concat(item))
      setUnseen((u) => (open ? 0 : Math.min(u + 1, 99)))
    }

    const onOutbound = (m: any) => {
      const item: SMS = {
        id: m.sid || crypto.randomUUID(),
        dir: 'out',
        text: m.text ?? '',
        at: m.at || new Date().toISOString(),
        to: m.to
      }
      setFeed((f) => f.concat(item))
    }

    s.on('sms:inbound', onInbound)
    s.on('sms:outbound', onOutbound)

    return () => {
      s.off('sms:inbound', onInbound)
      s.off('sms:outbound', onOutbound)
      socketRef.current = null
      // NOTE: do not disconnect the singleton here
    }
  }, [tenantId, open])

  const items = useMemo(() => feed.slice(-300), [feed])

  // optimistic local append for snappy UX
  function appendLocalOutbound(message: string, dest: string) {
    setFeed((f) =>
      f.concat([{ id: crypto.randomUUID(), dir: 'out', text: message, at: new Date().toISOString(), to: dest }])
    )
  }

  async function onSend(e?: React.FormEvent) {
    e?.preventDefault()
    const dest = normalizePhone(to)
    const body = text.trim()
    if (!dest || !body) return

    setBusy(true)
    appendLocalOutbound(body, dest)
    setText('')

    try {
      const r = await fetch(`${apiBase()}/api/sms/send`, withTenant({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: dest, text: body, clientId: tenantId }),
      }))
      const j = await r.json().catch(() => ({}))
      if (!j?.ok) {
        setFeed((f) =>
          f.concat([{ id: crypto.randomUUID(), dir: 'out', text: `⚠️ send failed: ${j?.error || r.status}`, at: new Date().toISOString(), to: dest }])
        )
      }
    } catch (err: any) {
      setFeed((f) =>
        f.concat([{ id: crypto.randomUUID(), dir: 'out', text: `⚠️ network error: ${err?.message || 'failed'}`, at: new Date().toISOString(), to: dest }])
      )
    } finally {
      setBusy(false)
    }
  }

  async function onCall() {
    const dest = normalizePhone(to)
    if (!dest) return
    try {
      // Dial via backend (same path VoiceHUD uses)
      const r = await fetch(`${apiBase()}/api/voice/call`, {
        method: 'POST',
        ...withTenant({ headers: { 'Content-Type': 'application/json' } }),
        body: JSON.stringify({ to: dest, opts: {} }),
      })
      const j = await r.json().catch(() => ({} as any))
      if (!j?.ok) {
        // eslint-disable-next-line no-alert
        alert(`Call failed: ${j?.error || r.status}`)
      } else {
        setOpen(false)
      }
    } catch (e: any) {
      // eslint-disable-next-line no-alert
      alert(`Call failed: ${e?.message || e}`)
    }
  }

  return (
    <>
      {/* Floating action button (bottom-right, safe-area aware) */}
      <button
        aria-label="Open Phone & SMS"
        onClick={() => setOpen(true)}
        className="fixed right-6 bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] z-50 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-orange)] text-white shadow-lg ring-1 ring-white/20 hover:bg-[var(--brand-orange2)] focus:outline-none"
      >
        <Phone size={20} />
        {unseen > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-[11px] leading-5 text-white text-center ring-1 ring-white/20"
            aria-label={`${unseen} unread messages`}
          >
            {unseen > 99 ? '99+' : unseen}
          </span>
        )}
      </button>

      {/* Slide-up panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="w-full sm:max-w-md sm:rounded-2xl sm:shadow-2xl border border-white/10 bg-[#161b22]">
            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Phone size={16} className="text-white/80" />
                <div className="font-semibold">Phone &amp; SMS</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* composer */}
            <form onSubmit={onSend} className="px-4 pt-3 pb-2 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="tel"
                  placeholder="To (e.g. +15551234567)"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 h-10 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                />
                <button
                  type="button"
                  onClick={onCall}
                  disabled={!normalizePhone(to)}
                  className="inline-flex items-center gap-2 rounded-lg bg-white/10 border border-white/15 px-3 h-10 text-sm text-white hover:bg-white/15 disabled:opacity-50"
                  title="Call"
                >
                  <PhoneCall size={16} />
                </button>
                <button
                  type="submit"
                  disabled={busy || !to || !text.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-orange)] px-3 h-10 text-sm font-semibold text-white shadow hover:bg-[var(--brand-orange2)] disabled:opacity-50"
                >
                  <Send size={16} /> Send
                </button>
              </div>
              <textarea
                rows={3}
                placeholder="Type a message…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full resize-y rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </form>

            {/* feed */}
            <div className="px-2 pb-3 max-h-[45vh] overflow-y-auto">
              <ul className="space-y-1.5">
                {items.map((m) => (
                  <li key={m.id} className={m.dir === 'out' ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={
                        'max-w-[85%] rounded-xl px-3 py-2 text-sm ' +
                        (m.dir === 'out'
                          ? 'bg-[var(--brand-orange)]/20 border border-white/10'
                          : 'bg-white/5 border border-white/10')
                      }
                    >
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      <div className="mt-1 text-[11px] text-white/50">{fmtTime(m.at)}</div>
                    </div>
                  </li>
                ))}
                {items.length === 0 && (
                  <li className="px-3 py-4 text-sm text-white/50">
                    No messages yet. Send your first SMS above.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  )
}