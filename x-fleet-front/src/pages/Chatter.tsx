// src/pages/Chatter.tsx
import React, { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { API_BASE } from '../config'
import EmailDraftComposer from '../components/EmailDraftComposer'
import { makeSocket, getTenantId, withTenant } from '../lib/socket'
import { initVoiceClient } from '../lib/voice'
import {
  Phone,
  Plus,
  Send as SendIcon,
  Search,
  Mail,
  MessageSquare,
  Bot,            // lucide uses "Bot" (not "Robot")
  PhoneCall,
  ChevronDown,
} from 'lucide-react'

type Contact = {
  id: string | number
  name?: string
  phones?: string[]
  emails?: string[]
  company?: string
  address?: string
}

type MsgMeta = { subject?: string } | null

type ChatMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  channel: 'sms' | 'email'
  text: string
  createdAt: string
  meta?: MsgMeta
}

type RecordingItem = {
  id: string
  url: string | null
  from: string | null
  to: string | null
  durationSec: number | null
  at: string | null
  status: string | null
  recordingSid: string | null
  callSid: string | null
}

export default function Chatter(): JSX.Element {
  const { contactId } = useParams()
  const navigate = useNavigate()

  // Refs
  const inputRef = useRef<HTMLInputElement | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  // tenant (shared for sockets + HTTP)
  const tenantId = useMemo(() => getTenantId(), [])

  // Measure the composer so we can pad the message list accordingly
  const [composerHeight, setComposerHeight] = useState<number>(0)
  useEffect(() => {
    if (!composerRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const h = (e.target as HTMLElement)?.offsetHeight || 0
        setComposerHeight((prev) => (prev !== h ? h : prev))
      }
    })
    ro.observe(composerRef.current)
    return () => ro.disconnect()
  }, [])

  // ---- Viewport fit: make this page exactly fill the visible viewport below any header ----
  const [vpHeight, setVpHeight] = useState<string>('100dvh')
  useEffect(() => {
    const update = () => {
      const top = viewportRef.current?.getBoundingClientRect().top ?? 0
      const vh = (window.visualViewport?.height || window.innerHeight) - top
      setVpHeight(`${Math.max(0, Math.round(vh))}px`)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    window.visualViewport?.addEventListener('resize', update)
    const raf = requestAnimationFrame(update) // catch late layout
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      window.visualViewport?.removeEventListener('resize', update)
      cancelAnimationFrame(raf)
    }
  }, [])

  // tenant-scoped socket
  const socket = useMemo(() => makeSocket(), [])

  // Voice: bridge window events <-> server socket
  useEffect(() => {
    if (!socket) return
    initVoiceClient(socket, tenantId)
  }, [socket, tenantId])

  // conversations (left rail)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactsLoading, setContactsLoading] = useState<boolean>(false)
  const [q, setQ] = useState<string>('')

  // chat
  const [loading, setLoading] = useState<boolean>(true)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState<boolean>(false)
  const [text, setText] = useState<string>('')

  // composer / routing
  const [to, setTo] = useState<string>('')
  const [manualId, setManualId] = useState<string | null>(null)
  const [autopilot, setAutopilot] = useState<boolean>(true)
  const [composerMode, setComposerMode] = useState<'sms' | 'email'>('sms')

  // “From” selector (reads env)
  const fromChoices = useMemo<string[]>(() => {
    const env = (import.meta && import.meta.env) || {}
    const raw =
      (env as any).VITE_TWILIO_FROM_NUMBERS ||
      (env as any).VITE_TWILIO_FROM ||
      ''
    return String(raw)
      .split(/[,\s]+/)
      .map((s: string) => s.trim())
      .filter(Boolean)
  }, [])
  const [fromNum, setFromNum] = useState<string>(fromChoices[0] || '')

  // recordings bucket (local, event-driven)
  const REC_OPEN_KEY = 'chatter-rec-open'
  const [recOpen, setRecOpen] = useState<boolean>(() => (localStorage.getItem(REC_OPEN_KEY) ?? '1') === '1')
  const [recItems, setRecItems] = useState<RecordingItem[]>([])

  useEffect(() => {
    function onRec(e: Event) {
      const ce = e as unknown as CustomEvent<any>
      const d = (ce.detail || {}) as Partial<RecordingItem> & { recordingSid?: string; callSid?: string; at?: string }
      const id = d.recordingSid || `${d.callSid || 'call'}:${d.at || Date.now()}`
      const row: RecordingItem = {
        id,
        url: d.url || null,
        from: (d as any).from || null,
        to: (d as any).to || null,
        durationSec: typeof d.durationSec === 'number' ? d.durationSec : null,
        at: d.at || new Date().toISOString(),
        status: (d as any).status || 'completed',
        recordingSid: d.recordingSid || null,
        callSid: d.callSid || null,
      }
      setRecItems((prev) => {
        const dedup = prev.filter((x) => x.id !== id)
        return [row, ...dedup].slice(0, 15)
      })
      setRecOpen(true)
    }
    window.addEventListener('voice:recording-ready', onRec as EventListener)
    return () => window.removeEventListener('voice:recording-ready', onRec as EventListener)
  }, [])
  useEffect(() => {
    localStorage.setItem(REC_OPEN_KEY, recOpen ? '1' : '0')
  }, [recOpen])

  const effectiveId = contactId ?? manualId ?? undefined
  const contactLabel = contactId || manualId || (to ? `manual:${to}` : '—')

  // helpers
  const normalizePhone = (p?: string) => {
    if (!p) return ''
    let s = String(p).replace(/[^\d]/g, '')
    if (s.length === 10) s = '1' + s
    if (!s.startsWith('+')) s = '+' + s
    return s
  }
  const idToPhone = (effective?: string | null, toField?: string) => {
    if (effective?.startsWith('manual:')) return normalizePhone(effective.slice(7))
    return normalizePhone(toField)
  }

  const pushUnique = (incoming: Partial<ChatMessage> & { sid?: string; id?: string; meta?: MsgMeta; from?: string; at?: string; createdAt?: string; direction?: ChatMessage['direction']; channel?: ChatMessage['channel']; text?: string; }) => {
    setMessages((ms) => {
      const id = incoming.sid || incoming.id || `${incoming.direction || 'msg'}_${Date.now()}`
      if (ms.some((x) => x.id === id)) return ms
      const channel: 'sms' | 'email' = incoming.channel || (incoming.meta?.subject ? 'email' : 'sms')
      return [
        ...ms,
        {
          id,
          direction: (incoming.direction || (incoming.from ? 'inbound' : 'outbound')) as ChatMessage['direction'],
          channel,
          text: incoming.text ?? '',
          createdAt: incoming.at || incoming.createdAt || new Date().toISOString(),
          meta: incoming.meta || null,
        },
      ]
    })
  }

  // fetch contacts for left rail
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setContactsLoading(true)
        const r = await fetch(`${API_BASE}/api/contacts?clientId=${encodeURIComponent(tenantId)}`, withTenant())
        const j = await r.json()
        if (!alive) return
        setContacts(Array.isArray(j.contacts) ? (j.contacts as Contact[]) : [])
      } catch {
        if (alive) setContacts([])
      } finally {
        if (alive) setContactsLoading(false)
      }
    })()
    return () => { alive = false }
  }, [tenantId])

  const selectedContact = useMemo(
    () => contacts.find(c => String(c.id) === String(contactId)),
    [contacts, contactId]
  )

  // load or seed conversation
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        if (!effectiveId) {
          if (alive) setMessages([])
          return
        }

        // ensure conversation
        const r1 = await fetch(
          `${API_BASE}/api/mock/ghl/contact/${encodeURIComponent(effectiveId)}/conversations?clientId=${encodeURIComponent(tenantId)}`,
          withTenant()
        )
        const j1 = await r1.json()
        let convoId = j1?.conversations?.[0]?.id as string | undefined

        if (!convoId) {
          const r2 = await fetch(`${API_BASE}/api/mock/ghl/send-message`, withTenant({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contactId: effectiveId,
              text: '(test) First message',
              direction: 'outbound',
              clientId: tenantId,
            }),
          }))
          const j2 = await r2.json()
          convoId = j2.conversationId as string
        }

        // fetch + normalize messages
        const r3 = await fetch(
          `${API_BASE}/api/mock/ghl/conversation/${encodeURIComponent(convoId!)}/messages?clientId=${encodeURIComponent(tenantId)}`,
          withTenant()
        )
        const j3 = await r3.json()
        if (!alive) return

        const base = Array.isArray(j3.messages) ? (j3.messages as any[]) : []
        const normalized: ChatMessage[] = base.map((m) => ({
          id: m.sid || m.id,
          direction: (m.direction || (m.from ? 'inbound' : 'outbound')) as ChatMessage['direction'],
          channel: (m.channel || (m.meta?.subject ? 'email' : 'sms')) as ChatMessage['channel'],
          text: m.text ?? '',
          createdAt: m.at || m.createdAt || new Date().toISOString(),
          meta: (m.meta || null) as MsgMeta,
        }))

        setMessages(normalized)
        setError(null)
      } catch (e: any) {
        if (alive) setError(e?.message || 'Failed to load conversation')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [effectiveId, tenantId])

  // live updates
  useEffect(() => {
    const onInbound = (m: any) => {
      if (m.contactId && effectiveId && m.contactId !== effectiveId) return
      pushUnique({ ...m, direction: 'inbound' })
    }
    const onOutbound = (m: any) => {
      if (m.contactId && effectiveId && m.contactId !== effectiveId) return
      pushUnique({ ...m, direction: 'outbound' })
    }
    socket.on('sms:inbound', onInbound)
    socket.on('sms:outbound', onOutbound)
    return () => {
      socket.off('sms:inbound', onInbound)
      socket.off('sms:outbound', onOutbound)
    }
  }, [socket, effectiveId])

  // cleanup must return void
  useEffect(() => {
    return () => { socket.close() }
  }, [socket])

  // ----- Guarded Auto-scroll (never yank the page) -----
  const isNearBottom = (el: HTMLElement, threshold = 140) => {
    const diff = el.scrollHeight - el.scrollTop - el.clientHeight
    return diff <= threshold
  }
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (el.scrollHeight > el.clientHeight + 2 && isNearBottom(el, 140)) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, composerHeight])

  // Focus the SMS input without scrolling the page
  useEffect(() => {
    if (!effectiveId || !inputRef.current) return
    try {
      inputRef.current.focus({ preventScroll: true })
    } catch {
      inputRef.current.focus()
    }
  }, [effectiveId])

  // extract email subject/body from stored snippet when meta.subject missing
  function extractEmailParts(text = '', meta?: MsgMeta) {
    if (meta?.subject) return { subject: meta.subject, body: text || '' }
    let subject = ''
    let body = text || ''
    const emDash = body.indexOf(' — ')
    if (emDash > -1 && emDash < 140) {
      subject = body.slice(0, emDash).trim()
      body = body.slice(emDash + 3).trim()
      return { subject, body }
    }
    const nl = body.indexOf('\n')
    if (nl > -1 && nl < 140) {
      subject = body.slice(0, nl).trim()
      body = body.slice(nl + 1).trim()
    }
    return { subject, body }
  }

  // ---------- Per-contact AI state ----------
  const lastFetchedPhoneRef = useRef<string>('')
  const lastFetchAtRef = useRef<Record<string, number>>({})
  const autopilotFetchInflight = useRef<boolean>(false)

  const sanitizePhone = (p = '') => {
    const digits = String(p).replace(/\D/g, '')
    if (!digits) return ''
    const withCtry = digits.length === 10 ? '1' + digits : digits
    return '+' + withCtry
  }

  const fetchAutopilotOnce = async (raw?: string) => {
    const phone = sanitizePhone(raw)
    if (!phone || phone.length < 12) return
    const now = Date.now()
    const last = lastFetchAtRef.current[phone] || 0
    if (now - last < 10_000) return
    lastFetchAtRef.current[phone] = now
    if (lastFetchedPhoneRef.current === phone) return
    if (autopilotFetchInflight.current) return
    autopilotFetchInflight.current = true
    lastFetchedPhoneRef.current = phone
    try {
      const r = await fetch(
        `${API_BASE}/api/agent/state?phone=${encodeURIComponent(phone)}&clientId=${encodeURIComponent(tenantId)}`,
        withTenant()
      )
      const j = await r.json()
      if ((j as any)?.ok) setAutopilot(!!(j as any).state?.autopilot)
    } catch {}
    finally { autopilotFetchInflight.current = false }
  }

  useEffect(() => {
    const phoneCandidate = idToPhone(effectiveId ?? null, to)
    fetchAutopilotOnce(phoneCandidate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveId])

  async function handleToggleAutopilot(next: boolean) {
    if (next === autopilot) return
    setAutopilot(next)
    const phone = idToPhone(effectiveId ?? null, to)
    if (!phone) return
    try {
      await fetch(`${API_BASE}/api/agent/autopilot`, withTenant({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, enabled: next, clientId: tenantId }),
      }))
    } catch {}
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    const id = contactId || manualId || (to.trim() ? `manual:${to.trim()}` : null)
    if (!id) { setError('Enter a phone number in "To"'); return }
    if (!contactId && !manualId) setManualId(id)

    try {
      setSending(true)
      const r = await fetch(`${API_BASE}/api/mock/ghl/send-message`, withTenant({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: id,
          text,
          direction: 'outbound',
          autopilot,
          to: to.trim() || undefined,
          from: fromNum || undefined,
          clientId: tenantId,
        }),
      }))
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok || j?.ok === false) {
        throw new Error(j?.error || 'Failed to send')
      }
      setText('')
      setError(null)
      try { inputRef.current?.focus({ preventScroll: true }) } catch {}
    } catch (err: any) {
      setError(err.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const filteredContacts = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return contacts
    return contacts.filter(c =>
      (c.name || '').toLowerCase().includes(qq) ||
      (c.phones || []).some(p => (p || '').toLowerCase().includes(qq))
    )
  }, [contacts, q])

  // Fill exactly the visible viewport below the app header.
  return (
    <div
      ref={viewportRef}
      className="grid grid-cols-12 gap-4 min-h-0 overflow-hidden px-3 bg-neutral-950 text-white"
      style={{ height: vpHeight }}
    >
      {/* LEFT: Threads */}
      <div className="col-span-12 md:col-span-3 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-3 flex flex-col h-full min-h-0 overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold tracking-[-0.01em]">Threads</div>
          <button
            onClick={() => { setManualId(null); setTo(''); setMessages([]); setError(null); }}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-xl border border-white/10 hover:bg-white/10 transition"
            title="New thread"
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>

        <div className="flex-none relative mb-2">
          <Search className="w-4 h-4 absolute left-2 top-2.5 opacity-60 pointer-events-none" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search name or phone"
            className="w-full bg-black/30 border border-white/10 rounded-xl pl-8 pr-2 py-2 text-sm outline-none focus:border-white/30"
            aria-label="Search threads"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-auto space-y-1 pr-1">
          {contactsLoading && <div className="text-xs text-white/60">Loading…</div>}
          {!contactsLoading && filteredContacts.length === 0 && (
            <div className="text-xs text-white/60">No contacts yet.</div>
          )}
          {filteredContacts.map(c => (
            <button
              key={String(c.id)}
              onClick={() => navigate(`/chatter/${encodeURIComponent(String(c.id))}`)}
              className={
                "w-full text-left px-3 py-2 rounded-xl transition border " +
                (String(c.id) === String(contactId)
                  ? "bg-white/10 border-white/15 shadow-inner"
                  : "bg-transparent border-transparent hover:bg-white/5 hover:border-white/10")
              }
            >
              <div className="text-sm font-medium truncate">{c.name || '—'}</div>
              <div className="text-[11px] text-white/60 truncate">
                {(c.phones && c.phones[0]) || (c.emails && c.emails[0]) || 'No contact info'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* CENTER: Chat */}
      <div className="col-span-12 md:col-span-6 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-3 flex flex-col h-full min-h-0 relative overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        {/* header */}
        <div className="flex-none flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-[11px] text-white/60">Thread</div>
            <div className="font-mono text-sm truncate max-w-[40vw]" title={contactLabel}>{contactLabel}</div>
            <span
              className={
                "text-[10px] px-2 py-0.5 rounded-full border " +
                (autopilot ? "bg-emerald-600/20 text-emerald-200 border-emerald-500/20" : "bg-zinc-700/30 text-zinc-200 border-white/10")
              }
              title="AI Autopilot status"
            >
              {autopilot ? "Autopilot ON" : "Autopilot OFF"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-white/80 select-none">
              <input
                type="checkbox"
                checked={autopilot}
                onChange={(e) => handleToggleAutopilot(e.target.checked)}
                disabled={!idToPhone(effectiveId ?? null, to)}
                className="accent-emerald-400"
              />
              <Bot className="w-3.5 h-3.5 opacity-80" /> Chat AI
            </label>

            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded-xl border border-white/10 text-[11px] hover:bg-white/10"
              onClick={() => window.dispatchEvent(new CustomEvent('voicehud:open'))}
              title="Open Voice HUD"
            >
              <PhoneCall className="w-3.5 h-3.5" /> Call
            </button>
          </div>
        </div>

        {/* messages (bottom padding equals composer height) */}
        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-auto overscroll-contain space-y-2 pr-1 border border-white/10 rounded-xl p-3 bg-gradient-to-b from-black/20 to-black/10"
          style={{ paddingBottom: (composerHeight || 56) + 12 }}
          tabIndex={-1}
          aria-label="Conversation"
        >
          {loading && <div className="text-sm text-white/60">Loading…</div>}
          {error && <div className="text-sm text-red-400">{error}</div>}
          {!loading && !error && messages.length === 0 && (
            <div className="text-sm text-white/60">No messages yet.</div>
          )}

          {!loading && !error && messages.map((m) => {
            const isOut = m.direction === 'outbound'
            const isEmail = (m.channel === 'email') || m.meta?.subject
            const { subject, body } = isEmail ? extractEmailParts(m.text, m.meta) : { subject: "", body: m.text }

            return (
              <div key={m.id} className={"group w-full flex " + (isOut ? "justify-end" : "justify-start")}>
                <div
                  className={
                    (isOut
                      ? "ml-auto bg-white text-black"
                      : "mr-auto bg-white/10 text-white border border-white/10") +
                    " max-w-[75%] rounded-2xl px-3 py-2 shadow-lg"
                  }
                >
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide opacity-60 mb-1">
                    {isEmail ? <Mail className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                    <span>{isEmail ? 'EMAIL' : 'SMS'}</span>
                  </div>

                  {isEmail && subject && (
                    <div className="text-xs font-semibold mb-1">{subject}</div>
                  )}

                  <div className="text-sm whitespace-pre-wrap">
                    {body || <span className="opacity-50">(no text)</span>}
                  </div>

                  <div className={"mt-1 text-[11px] opacity-60 " + (isOut ? "text-black/60" : "text-white/70")}>
                    {new Date(m.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            )
          })}

          <div ref={bottomRef} />
        </div>

        {/* Composer overlay: pinned to card edges */}
        <div
          ref={composerRef}
          className="absolute inset-x-0 bottom-0 z-10 border-t border-white/10 bg-black/60 backdrop-blur-md p-3 rounded-b-2xl"
        >
          {/* segmented control */}
          <div className="mb-2 inline-flex overflow-hidden rounded-xl border border-white/10 bg-black/40">
            <button
              onClick={() => setComposerMode('sms')}
              className={'px-3 py-1.5 text-xs inline-flex items-center gap-1 ' + (composerMode === 'sms' ? 'bg-white/10' : 'hover:bg-white/5')}
              aria-pressed={composerMode === 'sms'}
            >
              <MessageSquare className="w-3.5 h-3.5" /> SMS
            </button>
            <button
              onClick={() => setComposerMode('email')}
              className={'px-3 py-1.5 text-xs inline-flex items-center gap-1 border-l border-white/10 ' + (composerMode === 'email' ? 'bg-white/10' : 'hover:bg-white/5')}
              aria-pressed={composerMode === 'email'}
            >
              <Mail className="w-3.5 h-3.5" /> Email
            </button>
          </div>

          {composerMode === 'sms' ? (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-xs text-white/70">From</label>
                <div className="relative">
                  <select
                    value={fromNum}
                    onChange={(e) => setFromNum(e.target.value)}
                    className="appearance-none w-56 bg-black/30 border border-white/10 rounded-xl pl-3 pr-8 py-1.5 text-sm outline-none focus:border-white/30"
                  >
                    {fromChoices.length === 0 && <option value="">(env not set)</option>}
                    {fromChoices.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 absolute right-2 top-2.5 opacity-60 pointer-events-none" />
                </div>

                <label className="text-xs text-white/70">To</label>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="+1 555 555 0123"
                  className="w-56 bg-black/30 border border-white/10 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-white/30"
                />

                <span className="text-xs text-white/70">
                  AI Autopilot: <strong className="font-semibold">{autopilot ? 'ON' : 'OFF'}</strong>
                </span>
              </div>

              <form onSubmit={handleSend} className="mt-2 flex gap-2">
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !sending && text.trim()) handleSend(e) }}
                  placeholder="Type a message…"
                  className="flex-1 bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-white/30"
                  aria-label="Type message"
                />
                <button
                  type="submit"
                  disabled={sending || !text.trim() || (!contactId && !to.trim())}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-white/10 hover:bg-white/10 disabled:opacity-50"
                >
                  <SendIcon className="w-4 h-4" /> Send
                </button>
              </form>
            </>
          ) : (
            <div className="border border-white/10 rounded-xl p-2 bg-neutral-900 max-h-[40vh] overflow-auto shadow-lg">
              <EmailDraftComposer
                contactId={effectiveId || null}
                to={selectedContact?.emails?.[0] || ''}
                replyTo="dispatch@proto.nonstopautomation.com"
                defaultTone="friendly"
                defaultContext={`Customer: ${selectedContact?.name || ''}.
Contact: ${(selectedContact?.phones?.[0] || selectedContact?.emails?.[0] || '')}.
Write a short, friendly follow-up about their request.`}
                onQueued={(m) => pushUnique(m as any)}
              />
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Details + Recent Calls */}
      <div className="col-span-12 md:col-span-3 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-3 flex flex-col h-full min-h-0 overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        <div className="text-sm font-semibold mb-2">Details</div>
        {selectedContact ? (
          <div className="space-y-2 text-sm min-h-0 overflow-auto pr-1">
            <div className="text-base font-semibold">{selectedContact.name}</div>
            {selectedContact.company && <div className="text-white/70">{selectedContact.company}</div>}
            {(selectedContact.phones?.[0] || selectedContact.emails?.[0]) && (
              <div className="text-white/80">
                {selectedContact.phones?.[0] || selectedContact.emails?.[0]}
              </div>
            )}
            {selectedContact.address && (
              <div className="text-white/60">{selectedContact.address}</div>
            )}
            <div className="pt-2 flex gap-2">
              {selectedContact.phones?.[0] && (
                <a href={`tel:${selectedContact.phones[0]}`} className="px-2 py-1 rounded-xl border border-white/10 hover:bg-white/10 text-xs inline-flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" /> Call Now
                </a>
              )}
              <Link to="/requestappointment" className="px-2 py-1 rounded-xl border border-white/10 hover:bg-white/10 text-xs">
                New Job
              </Link>
              <button
                className="px-2 py-1 rounded-xl border border-white/10 hover:bg-white/10 text-xs"
                onClick={() => setComposerMode(m => (m === 'email' ? 'sms' : 'email'))}
              >
                {composerMode === 'email' ? 'SMS…' : 'Email…'}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-white/60">Pick a thread to see contact details.</div>
        )}

        {/* RECENT CALLS (collapsible) */}
        <div className="mt-4">
          <button
            onClick={() => setRecOpen(v => !v)}
            className="w-full text-left text-sm font-semibold flex items-center justify-between px-3 py-2 rounded-xl border border-white/10 hover:bg-white/10"
          >
            <span className="inline-flex items-center gap-2"><Phone className="w-4 h-4" /> Recent Calls</span>
            <ChevronDown className={'w-4 h-4 transition-transform ' + (recOpen ? 'rotate-180' : '')} />
          </button>
          {recOpen && (
            <div className="mt-2 space-y-2 min-h-0 overflow-auto pr-1">
              {recItems.length === 0 && (
                <div className="text-xs text-white/60 px-1">No recordings yet.</div>
              )}
              {recItems.map(item => <RecordingRow key={item.id} item={item} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** --- Small recording row component --- */
function RecordingRow({ item }: { item: RecordingItem }) {
  const who = [item.from, '→', item.to].filter(Boolean).join(' ') || 'Call'
  const when = (() => {
    const d = item.at ? new Date(item.at) : new Date()
    const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
    if (diff < 60) return `${diff}s ago`
    const m = Math.floor(diff / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    return `${h}h ago`
  })()
  const dur = typeof item.durationSec === 'number' ? `${Math.round(item.durationSec)}s` : '—'
  return (
    <div className="px-3 py-2 rounded-xl bg-black/30 border border-white/10">
      <div className="flex items-center justify-between text-xs">
        <div className="text-white/80 truncate">{who}</div>
        <div className="text-white/50 ml-2 whitespace-nowrap">{when}</div>
      </div>
      <div className="mt-1 text-[11px] text-white/60">
        SID: {item.recordingSid || item.callSid || '—'} • Duration: {dur} • Status: {item.status || '—'}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <a
          href={item.url || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs font-semibold border ${
            item.url ? 'text-white border-white/15 hover:bg-white/10' : 'text-white/40 border-white/10 pointer-events-none'
          }`}
        >
          Open
        </a>
        <button
          onClick={async () => { if (item.url) { try { await navigator.clipboard.writeText(item.url) } catch {} } }}
          disabled={!item.url}
          className={`inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs font-semibold border ${
            item.url ? 'text-white border-white/15 hover:bg-white/10' : 'text-white/40 border-white/10'
          }`}
          title="Copy link"
        >
          Copy link
        </button>
      </div>
    </div>
  )
}