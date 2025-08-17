// src/components/Inbox.jsx
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { API_BASE } from '../config'
import { Send, MessageSquare, Users } from 'lucide-react'

const fetcher = (url) => fetch(url).then((r) => r.json())

function classNames(...xs) {
  return xs.filter(Boolean).join(' ')
}

// ---- Message bubble ---------------------------------------------------------
function Bubble({ m }) {
  const isOut = m.direction === 'outbound'
  return (
    <div className={classNames('flex mb-2', isOut ? 'justify-end' : 'justify-start')}>
      <div
        className={classNames(
          'max-w-[75%] rounded-lg px-3 py-2 text-sm',
          isOut ? 'bg-blue-500/20 border border-blue-500/30' : 'bg-white/10 border border-white/10'
        )}
        title={new Date(m.createdAt).toLocaleString()}
      >
        {m.text || (m.attachments?.length ? '📎 Attachment' : '—')}
      </div>
    </div>
  )
}

// ---- Conversation panel -----------------------------------------------------
function Conversation({ conversationId }) {
  const { data, error, isLoading, mutate } = useSWR(
    conversationId ? `${API_BASE}/api/mock/ghl/conversation/${conversationId}/messages` : null,
    fetcher,
    { refreshInterval: 5000 } // 5s poll
  )

  const [draft, setDraft] = useState('')
  const messages = useMemo(() => data?.messages ?? [], [data])

  async function send() {
    const text = draft.trim()
    if (!text || !conversationId) return
    setDraft('')

    // optimistic append
    const optimistic = {
      id: 'tmp_' + Math.random().toString(36).slice(2),
      direction: 'outbound',
      channel: 'sms',
      text,
      createdAt: new Date().toISOString(),
    }
    mutate(
      (prev) => ({ ...(prev || {}), messages: [...(prev?.messages || []), optimistic] }),
      false
    )

    // backend expects contactId for mock creation; we emulate by reusing last inbound/outbound's contact
    // If you want 100% accuracy, keep contactId on the left list and pass it down.
    const contactIdGuess = data?.contactId || 'contact-demo'

    try {
      await fetch(`${API_BASE}/api/mock/ghl/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: contactIdGuess, text, direction: 'outbound', channel: 'sms' }),
      })
    } finally {
      mutate() // revalidate
    }
  }

  if (!conversationId) {
    return (
      <div className="h-full flex items-center justify-center text-white/50">
        Select a conversation to start chatting
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
        {isLoading && <div className="text-xs text-white/50">Loading messages…</div>}
        {error && <div className="text-xs text-red-300">Failed to load messages</div>}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
      </div>

      <div className="border-t border-white/10 p-2 flex items-center gap-2">
        <input
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-white/20"
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button
          onClick={send}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-blue-500/20 border border-blue-500/30 hover:bg-blue-500/30 transition"
        >
          <Send size={14} /> Send
        </button>
      </div>
    </div>
  )
}

// ---- Left list (contacts/conversations) ------------------------------------
function ListItem({ active, title, subtitle, onClick }) {
  return (
    <button
      onClick={onClick}
      className={classNames(
        'w-full text-left px-3 py-2 rounded-lg border transition',
        active
          ? 'bg-white/10 border-white/20'
          : 'bg-transparent border-white/5 hover:bg-white/5 hover:border-white/10'
      )}
    >
      <div className="text-sm">{title}</div>
      {subtitle && <div className="text-[11px] text-white/50 mt-0.5">{subtitle}</div>}
    </button>
  )
}

export default function Inbox() {
  // For now: a small static roster that maps to mock contacts you’ll message.
  // Later, replace with your real “drivers” or “customers” query.
  const contacts = [
    { id: 'c_alex', name: 'Alex (Driver A)' },
    { id: 'c_jordan', name: 'Jordan (Driver B)' },
    { id: 'c_casey', name: 'Casey (Driver C)' },
  ]

  // When you click a contact, we create/reuse a mock conversation id.
  const [activeContact, setActiveContact] = useState(contacts[0]?.id || null)
  const { data: convoList, mutate: refreshConvos } = useSWR(
    activeContact ? `${API_BASE}/api/mock/ghl/contact/${activeContact}/conversations` : null,
    fetcher
  )
  const conversationId = convoList?.conversations?.[0]?.id || null

  // Ensure a conversation exists when switching contacts by sending a noop message once
  async function ensureConversation(contactId) {
    setActiveContact(contactId)
    // create/reuse
    await fetch(`${API_BASE}/api/mock/ghl/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, text: '👋', direction: 'outbound', channel: 'sms' }),
    })
    refreshConvos()
  }

  return (
    <div className="grid grid-cols-12 gap-3 h-full">
      {/* Left column: contacts */}
      <aside className="col-span-4 border-r border-white/10 pr-2">
        <div className="flex items-center gap-2 mb-2">
          <Users size={16} className="text-white/70" />
          <div className="text-xs text-white/70">Drivers</div>
        </div>
        <div className="space-y-1">
          {contacts.map((c) => (
            <ListItem
              key={c.id}
              active={activeContact === c.id}
              title={c.name}
              subtitle="Tap to chat"
              onClick={() => ensureConversation(c.id)}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2 text-white/50 text-[11px]">
          <MessageSquare size={14} />
          <span>Messages sync every 5s (mock API)</span>
        </div>
      </aside>

      {/* Right column: conversation */}
      <section className="col-span-8 min-h-0">
        <Conversation conversationId={conversationId} />
      </section>
    </div>
  )
}