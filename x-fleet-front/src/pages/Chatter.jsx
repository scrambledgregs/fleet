// src/pages/Chatter.jsx
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useEffect, useState, useMemo, useRef } from 'react'
import { io } from 'socket.io-client'
import { API_BASE } from '../config'
import EmailDraftComposer from '../components/EmailDraftComposer'

export default function Chatter() {
  const { contactId } = useParams()
  const navigate = useNavigate()
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Measure the composer so we can pad the message list accordingly
  const composerRef = useRef(null)
  const [composerHeight, setComposerHeight] = useState(0)
  useEffect(() => {
    if (!composerRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const h = e.target?.offsetHeight || 0
        setComposerHeight((prev) => (prev !== h ? h : prev))
      }
    })
    ro.observe(composerRef.current)
    return () => ro.disconnect()
  }, [])

  const socket = useMemo(() => io(API_BASE, { transports: ['websocket'] }), [])

  // conversations (left rail)
  const [contacts, setContacts] = useState([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [q, setQ] = useState('')

  // chat
  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState([])
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const [text, setText] = useState('')

  // composer / routing
  const [to, setTo] = useState('')
  const [manualId, setManualId] = useState(null)
  const [autopilot, setAutopilot] = useState(true)
  const [composerMode, setComposerMode] = useState('sms') // 'sms' | 'email'

  const effectiveId = contactId || manualId
  const contactLabel = contactId || manualId || (to ? `manual:${to}` : '—')

  // helpers
  const normalizePhone = (p) => {
    if (!p) return ''
    let s = String(p).replace(/[^\d]/g, '')
    if (s.length === 10) s = '1' + s
    if (!s.startsWith('+')) s = '+' + s
    return s
  }
  const idToPhone = (effective, toField) => {
    if (effective?.startsWith('manual:')) return normalizePhone(effective.slice(7))
    return normalizePhone(toField)
  }

  const pushUnique = (incoming) => {
    setMessages((ms) => {
      const id = incoming.sid || incoming.id || `${incoming.direction || 'msg'}_${Date.now()}`
      if (ms.some((x) => x.id === id)) return ms
      const channel = incoming.channel || (incoming.meta?.subject ? 'email' : 'sms')
      return [
        ...ms,
        {
          id,
          direction: incoming.direction || (incoming.from ? 'inbound' : 'outbound'),
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
        const r = await fetch(`${API_BASE}/api/contacts`)
        const j = await r.json()
        if (!alive) return
        setContacts(Array.isArray(j.contacts) ? j.contacts : [])
      } catch {
        if (alive) setContacts([])
      } finally {
        if (alive) setContactsLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

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
        const r1 = await fetch(`${API_BASE}/api/mock/ghl/contact/${encodeURIComponent(effectiveId)}/conversations`)
        const j1 = await r1.json()
        let convoId = j1?.conversations?.[0]?.id

        if (!convoId) {
          const r2 = await fetch(`${API_BASE}/api/mock/ghl/send-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contactId: effectiveId,
              text: '(test) First message',
              direction: 'outbound',
            }),
          })
          const j2 = await r2.json()
          convoId = j2.conversationId
        }

        // fetch + normalize messages
        const r3 = await fetch(`${API_BASE}/api/mock/ghl/conversation/${encodeURIComponent(convoId)}/messages`)
        const j3 = await r3.json()
        if (!alive) return

        const base = Array.isArray(j3.messages) ? j3.messages : []
        const normalized = base.map((m) => ({
          id: m.sid || m.id,
          direction: m.direction || (m.from ? 'inbound' : 'outbound'),
          channel: m.channel || (m.meta?.subject ? 'email' : 'sms'),
          text: m.text ?? '',
          createdAt: m.at || m.createdAt || new Date().toISOString(),
          meta: m.meta || null,
        }))

        setMessages(normalized)
        setError(null)
      } catch (e) {
        if (alive) setError(e?.message || 'Failed to load conversation')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [effectiveId])

  // live updates
  useEffect(() => {
    const onInbound = (m) => {
      if (m.contactId && effectiveId && m.contactId !== effectiveId) return
      pushUnique({ ...m, direction: 'inbound' })
    }
    const onOutbound = (m) => {
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

  useEffect(() => {
    return () => socket.close()
  }, [socket])

  // Auto-scroll message list (not the page)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => { if (effectiveId) inputRef.current?.focus() }, [effectiveId])

  // extract email subject/body from stored snippet when meta.subject missing
  function extractEmailParts(text = '', meta) {
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

  // ---------- Per-contact AI state (fetch once / debounced) ----------
  const lastFetchedPhoneRef = useRef('')
  const lastFetchAtRef = useRef({}); // phone -> last fetch timestamp (ms)
  const autopilotFetchInflight = useRef(false);
  const debounceRef = useRef(0)

  const sanitizePhone = (p = '') => {
    const digits = String(p).replace(/\D/g, '')
    if (!digits) return ''
    const withCtry = digits.length === 10 ? '1' + digits : digits
    return '+' + withCtry
  }

  const fetchAutopilotOnce = async (raw) => {
    const phone = sanitizePhone(raw);
    if (!phone || phone.length < 12) return;

    // hard throttle: only 1 fetch per phone every 10s
    const now = Date.now();
    const last = lastFetchAtRef.current[phone] || 0;
    if (now - last < 10_000) return;
    lastFetchAtRef.current[phone] = now;

    if (lastFetchedPhoneRef.current === phone) return;
    if (autopilotFetchInflight.current) return;
    autopilotFetchInflight.current = true;

    lastFetchedPhoneRef.current = phone;

    try {
      const r = await fetch(`${API_BASE}/api/agent/state?phone=${encodeURIComponent(phone)}`);
      const j = await r.json();
      if (j?.ok) setAutopilot(!!j.state?.autopilot);
    } catch {
      // ignore
    } finally {
      autopilotFetchInflight.current = false;
    }
  };

  // One-time fetch when the thread (effectiveId) changes.
  useEffect(() => {
    const phoneCandidate = idToPhone(effectiveId, to)
    fetchAutopilotOnce(phoneCandidate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveId])

  async function handleToggleAutopilot(next) {
    if (next === autopilot) return;
    setAutopilot(next);
    const phone = idToPhone(effectiveId, to);
    if (!phone) return;
    try {
      await fetch(`${API_BASE}/api/agent/autopilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, enabled: next }),
      });
    } catch {}
  }

  async function handleSend(e) {
    e.preventDefault()
    if (!text.trim()) return
    const id = contactId || manualId || (to.trim() ? `manual:${to.trim()}` : null)
    if (!id) { setError('Enter a phone number in "To"'); return }
    if (!contactId && !manualId) setManualId(id)

    try {
      setSending(true)
      const r = await fetch(`${API_BASE}/api/mock/ghl/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: id,
          text,
          direction: 'outbound',
          autopilot,
          to: to.trim() || undefined,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.ok === false) throw new Error(j?.error || 'Failed to send')

      // Do not optimistically append; wait for socket echo.
      setText('')
      setError(null)
      inputRef.current?.focus()
    } catch (err) {
      setError(err.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const filteredContacts = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return contacts
    return contacts.filter(c =>
      c.name?.toLowerCase().includes(qq) ||
      (c.phones || []).some(p => p?.toLowerCase().includes(qq))
    )
  }, [contacts, q])

  // --------------------- CONTENT ONLY (AppShell provides the chrome) ---------------------
  return (
    <div className="grid grid-cols-12 gap-3 h-full min-h-0 overflow-hidden">
      {/* LEFT: Threads */}
      <div className="col-span-12 md:col-span-3 glass rounded-none p-2 flex flex-col min-h-0">
        <div className="flex-none">
          <div className="text-sm font-semibold mb-2">Threads</div>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search name or phone…"
            className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30 mb-2"
          />
        </div>
        <div className="flex-1 min-h-0 overflow-auto space-y-1 pr-1">
          {contactsLoading && <div className="text-xs text-white/60">Loading…</div>}
          {!contactsLoading && filteredContacts.length === 0 && (
            <div className="text-xs text-white/60">No contacts yet.</div>
          )}
          {filteredContacts.map(c => (
            <button
              key={c.id}
              onClick={() => navigate(`/chatter/${encodeURIComponent(c.id)}`)}
              className={
                "w-full text-left px-2 py-2 rounded-none transition " +
                (String(c.id) === String(contactId)
                  ? "bg-white/15 border border-white/10"
                  : "hover:bg-white/10")
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
      <div className="col-span-12 md:col-span-6 glass rounded-none p-2 flex flex-col min-h-0 relative">
        {/* header */}
        <div className="flex-none flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="text-[11px] text-white/60">Thread</div>
            <div className="font-mono text-sm">{contactLabel}</div>
            <span
              className={
                "text-[10px] px-1.5 py-0.5 rounded " +
                (autopilot ? "bg-emerald-600/30 text-emerald-200" : "bg-zinc-600/30 text-zinc-200")
              }
            >
              {autopilot ? "Autopilot ON" : "Autopilot OFF"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-white/80">
              <input
                type="checkbox"
                checked={autopilot}
                onChange={(e) => handleToggleAutopilot(e.target.checked)}
                disabled={!idToPhone(effectiveId, to)}
              />
              Chat AI (per contact)
            </label>

            <button
              className="px-2 py-1 rounded-none glass text-[11px]"
              onClick={() => { setManualId(null); setTo(''); setMessages([]); setError(null); }}
            >
              New thread
            </button>
          </div>
        </div>

        {/* messages (bottom padding equals composer height) */}
        <div
          className="flex-1 min-h-0 overflow-auto space-y-2 pr-1 border border-white/10 rounded-none p-2 bg-white/5"
          style={{ paddingBottom: composerHeight ? composerHeight + 12 : 12 }}
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
              <div
                key={m.id}
                className={
                  isOut
                    ? "ml-auto max-w-[75%] rounded-2xl px-3 py-2 shadow-sm bg-gray-900 text-white"
                    : "mr-auto max-w-[75%] rounded-2xl px-3 py-2 shadow-sm bg-white/10 border border-white/10"
                }
              >
                <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1">
                  {isEmail ? 'EMAIL' : 'SMS'}
                </div>

                {isEmail && subject && (
                  <div className="text-xs font-semibold mb-1">{subject}</div>
                )}

                <div className="text-sm whitespace-pre-wrap">
                  {body || <span className="text-white/50">(no text)</span>}
                </div>

                <div className="mt-1 text-[11px] opacity-60">
                  {new Date(m.createdAt).toLocaleString()}
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Composer overlay: absolute bottom, never pushes content */}
        <div
          ref={composerRef}
          className="absolute inset-x-0 bottom-0 z-10 border-t border-white/10 bg-black/40 backdrop-blur-sm p-2"
        >
          {/* segmented control */}
          <div className="mb-2 inline-flex overflow-hidden rounded-md border border-white/10">
            <button
              onClick={() => setComposerMode('sms')}
              className={'px-3 py-1.5 text-xs ' + (composerMode === 'sms' ? 'bg-white/10' : 'hover:bg-white/5')}
            >
              SMS
            </button>
            <button
              onClick={() => setComposerMode('email')}
              className={
                'px-3 py-1.5 text-xs border-l border-white/10 ' +
                (composerMode === 'email' ? 'bg-white/10' : 'hover:bg-white/5')
              }
            >
              Email
            </button>
          </div>

          {composerMode === 'sms' ? (
            <>
              <div className="flex items-center gap-3">
                <label className="text-xs text-white/70">To</label>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="+1 555 555 0123"
                  className="w-48 bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30"
                />
                <span className="text-xs text-white/60">
                  AI Autopilot: <strong>{autopilot ? 'ON' : 'OFF'}</strong>
                </span>
              </div>

              <div className="mt-2 flex gap-2">
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !sending && text.trim()) handleSend(e) }}
                  placeholder="Type a message…"
                  className="flex-1 bg-black/30 border border-white/10 rounded-none px-3 py-2 text-sm outline-none focus:border-white/30"
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !text.trim() || (!contactId && !to.trim())}
                  className="px-3 py-2 rounded-none glass text-sm hover:bg-panel/70 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </>
          ) : (
            <div className="border border-white/10 rounded-none p-2 bg-neutral-900 max-h-[40vh] overflow-auto shadow-lg">
              <EmailDraftComposer
                contactId={effectiveId || null}
                to={selectedContact?.emails?.[0] || ''}
                replyTo="dispatch@proto.nonstopautomation.com"
                defaultTone="friendly"
                defaultContext={`Customer: ${selectedContact?.name || ''}.
Contact: ${(selectedContact?.phones?.[0] || selectedContact?.emails?.[0] || '')}.
Write a short, friendly follow-up about their request.`}
                onQueued={(m) => pushUnique(m)}
              />
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Details */}
      <div className="col-span-12 md:col-span-3 glass rounded-none p-2 flex flex-col min-h-0 overflow-auto">
        <div className="text-sm font-semibold mb-2">Details</div>
        {selectedContact ? (
          <div className="space-y-2 text-sm">
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
                <a href={`tel:${selectedContact.phones[0]}`} className="px-2 py-1 rounded-none glass text-xs">
                  Call Now
                </a>
              )}
              <Link to="/requestappointment" className="px-2 py-1 rounded-none glass text-xs">
                New Job
              </Link>
              <button
                className="px-2 py-1 rounded-none glass text-xs"
                onClick={() => setComposerMode(m => (m === 'email' ? 'sms' : 'email'))}
              >
                {composerMode === 'email' ? 'SMS…' : 'Email…'}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-white/60">Pick a thread to see contact details.</div>
        )}
      </div>
    </div>
  )
}