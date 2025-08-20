// src/pages/Chatter.jsx
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useEffect, useState, useMemo, useRef } from 'react'
import { io } from 'socket.io-client'
import TopBar from '../components/TopBar.jsx'
import SideNav from '../components/SideNav.jsx'
import { API_BASE } from '../config'
import StatBar from '../components/StatBar.jsx'

export default function Chatter() {
  const { contactId } = useParams()
  const navigate = useNavigate()
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // socket
  const socket = useMemo(() => io(API_BASE, { transports: ['websocket'] }), [])

  // local topbar state
  const [mode, setMode] = useState('Approve')
  const [compact, setCompact] = useState(false)

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
  const idToPhone = (effectiveId, toField) => {
    if (effectiveId?.startsWith('manual:')) return normalizePhone(effectiveId.slice(7))
    return normalizePhone(toField)
  }

  const pushUnique = (incoming) => {
    setMessages((ms) => {
      const id = incoming.sid || incoming.id || `${incoming.direction || 'msg'}_${Date.now()}`
      if (ms.some(x => x.id === id)) return ms
      return [
        ...ms,
        {
          id,
          direction: incoming.direction || (incoming.from ? 'inbound' : 'outbound'),
          text: incoming.text ?? '',
          createdAt: incoming.at || incoming.createdAt || new Date().toISOString(),
        }
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
        if (!effectiveId) { if (alive) setMessages([]); return }

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
              direction: 'outbound'
            }),
          })
          const j2 = await r2.json()
          convoId = j2.conversationId
        }

        const r3 = await fetch(`${API_BASE}/api/mock/ghl/conversation/${encodeURIComponent(convoId)}/messages`)
        const j3 = await r3.json()
        if (!alive) return
        setMessages(Array.isArray(j3.messages) ? j3.messages : [])
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

  useEffect(() => () => { socket.close() }, [socket])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (effectiveId) inputRef.current?.focus() }, [effectiveId])

  // load per-contact Chat AI setting when phone changes
  useEffect(() => {
    const phone = idToPhone(effectiveId, to)
    if (!phone) return
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/agent/state?phone=${encodeURIComponent(phone)}`)
        const j = await r.json()
        if (j?.ok) setAutopilot(!!j.state?.autopilot)
      } catch {}
    })()
  }, [effectiveId, to])

  async function handleToggleAutopilot(next) {
    setAutopilot(next)
    const phone = idToPhone(effectiveId, to)
    if (!phone) return
    try {
      await fetch(`${API_BASE}/api/agent/autopilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, enabled: next }),
      })
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
      setMessages(m => [...(Array.isArray(m) ? m : []), j.message ?? {
        id: `tmp_${Date.now()}`,
        direction: 'outbound',
        channel: 'sms',
        text,
        createdAt: new Date().toISOString(),
      }])
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
      (c.phones||[]).some(p => p?.toLowerCase().includes(qq))
    )
  }, [contacts, q])

  return (
    <div className={'min-h-screen text-white ' + (compact ? 'compact-root' : '')}>
      <TopBar mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />
      <div className={'px-6 ' + (compact ? 'pt-2' : 'pt-4')}>
        <StatBar />
      </div>

      <main className={'grid grid-cols-12 ' + (compact ? 'gap-4 p-4' : 'gap-6 p-6')}>
        <aside className="col-span-12 lg:col-span-2">
          <SideNav active="chatter" onChange={(id) => { if (id !== 'chatter') navigate('/') }} />
        </aside>

        {/* Three-panel chat */}
        <section className="col-span-12 lg:col-span-10">
          <div className="grid grid-cols-12 gap-4">
            {/* LEFT: Threads */}
            <div className="col-span-12 md:col-span-3 glass rounded-none p-3">
              <div className="text-sm font-semibold mb-2">Threads</div>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search name or phone…"
                className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30 mb-3"
              />
              {contactsLoading && <div className="text-xs text-white/60">Loading…</div>}
              {!contactsLoading && filteredContacts.length === 0 && (
                <div className="text-xs text-white/60">No contacts yet.</div>
              )}
              <div className="space-y-1 max-h-[60vh] overflow-auto pr-1">
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
            <div className="col-span-12 md:col-span-6 glass rounded-none p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="text-xs text-white/60">Thread</div>
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
                    className="px-2 py-1 rounded-none glass text-xs"
                    onClick={() => { setManualId(null); setTo(''); setMessages([]); setError(null); }}
                  >
                    New thread
                  </button>
                </div>
              </div>

              {loading && <div className="text-sm text-white/60">Loading…</div>}
              {error && <div className="text-sm text-red-400">{error}</div>}

              {!loading && !error && (
                <>
                  <div className="h-[50vh] min-h-[320px] overflow-auto space-y-2 pr-1 border border-white/10 rounded-none p-3 bg-white/5">
                    {messages.length === 0 && <div className="text-sm text-white/60">No messages yet.</div>}
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        className={
                          m.direction === 'outbound'
                            ? "ml-auto max-w-[75%] rounded-2xl px-3 py-2 shadow-sm bg-gray-900 text-white"
                            : "mr-auto max-w-[75%] rounded-2xl px-3 py-2 shadow-sm bg-white/10 border border-white/10"
                        }
                      >
                        <div className="text-sm whitespace-pre-wrap">
                          {m.text || <span className="text-white/50">(no text)</span>}
                        </div>
                        <div className="mt-1 text-[11px] opacity-60">
                          {new Date(m.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))}
                    <div ref={bottomRef} />
                  </div>

                  {/* composer */}
                  <div className="mt-3 flex items-center gap-3">
                    <label className="text-xs text-white/70">To</label>
                    <input
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      placeholder="+1 555 555 0123"
                      className="w-48 bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30"
                    />
                    <label className="flex items-center gap-2 text-xs text-white/80">
                      <input
                        type="checkbox"
                        checked={autopilot}
                        onChange={(e) => setAutopilot(e.target.checked)}
                      />
                      AI Autopilot
                    </label>
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
              )}
            </div>

            {/* RIGHT: Details */}
            <div className="col-span-12 md:col-span-3 glass rounded-none p-3">
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
                  </div>
                </div>
              ) : (
                <div className="text-xs text-white/60">
                  Pick a thread to see contact details.
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}