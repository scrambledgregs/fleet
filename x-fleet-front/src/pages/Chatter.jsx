// src/pages/Chatter.jsx
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useEffect, useState, useMemo, useRef } from 'react'
import { io } from 'socket.io-client'
import TopBar from '../components/TopBar.jsx'
import SideNav from '../components/SideNav.jsx'
import { API_BASE } from '../config'

export default function Chatter() {
  const { contactId } = useParams()
  const navigate = useNavigate()
  const bottomRef = useRef(null)
  const inputRef = useRef(null) // focus the composer

  // one socket for this component
  const socket = useMemo(() => io(API_BASE, { transports: ['websocket'] }), [])

  // local topbar state (same shape as Dashboard)
  const [mode, setMode] = useState('Approve')
  const [compact, setCompact] = useState(false)

  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState([])
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const [text, setText] = useState('')

  // composer controls
  const [to, setTo] = useState('')
  const [manualId, setManualId] = useState(null)
  const [autopilot, setAutopilot] = useState(true)

  // active conversation id: URL contact or committed manual id
  const effectiveId = contactId || manualId
  const contactLabel = contactId || manualId || (to ? `manual:${to}` : '—')

  // helper to append but avoid dupes
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

  // load (or seed) the conversation for effectiveId
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

  // live updates from backend (AI replies land here)
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
      // socket closed on unmount below
    }
  }, [socket, effectiveId])

  // close socket on unmount
  useEffect(() => () => { socket.close() }, [socket])

  // auto-scroll to bottom on new messages
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // when a thread becomes active, focus the composer
  useEffect(() => {
    if (effectiveId) inputRef.current?.focus()
  }, [effectiveId])

  async function handleSend(e) {
    e.preventDefault()
    if (!text.trim()) return

    // decide which id to use
    const id =
      contactId ||
      manualId ||
      (to.trim() ? `manual:${to.trim()}` : null)

    if (!id) {
      setError('Enter a phone number in "To"')
      return
    }

    // first time sending to a typed number → commit it
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
      inputRef.current?.focus() // keep typing
    } catch (err) {
      setError(err.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={'min-h-screen text-white ' + (compact ? 'compact-root' : '')}>
      <TopBar mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />

      <main className={'grid grid-cols-12 ' + (compact ? 'gap-4 p-4' : 'gap-6 p-6')}>
        <aside className="col-span-12 lg:col-span-2">
          <SideNav active="chatter" onChange={(id) => { if (id !== 'chatter') navigate('/') }} />
        </aside>

        <section className="col-span-12 lg:col-span-10 glass rounded-none p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-xs text-white/60">Chatter</div>
              <div className="text-lg font-semibold">Contact #{contactLabel}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="px-2 py-1 rounded-none glass text-xs"
                onClick={() => { setManualId(null); setTo(''); setMessages([]); setError(null); }}
              >
                New thread
              </button>
              <Link to="/" className="px-2 py-1 rounded-none glass text-xs hover:bg-panel/70">
                ← Back to Dispatch
              </Link>
            </div>
          </div>

          {loading && <div className="text-sm text-white/60">Loading…</div>}
          {error && <div className="text-sm text-red-400">{error}</div>}

          {!loading && !error && (
            <>
              <div className="h-[50vh] min-h-[320px] overflow-auto space-y-2 pr-1 border border-white/10 rounded-none p-3 bg-white/5">
                {messages.length === 0 && <div className="text-sm text-white/60">No messages yet.</div>}
                {messages.map((m) => (
                  <div key={m.id} className="text-xs">
                    <div className="text-white/50 mb-0.5">
                      {new Date(m.createdAt).toLocaleString()} • {m.direction}
                    </div>
                    <div className="text-white/90">
                      {m.text || <span className="text-white/50">(no text)</span>}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* composer controls */}
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
        </section>
      </main>
    </div>
  )
}