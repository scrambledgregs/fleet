import { useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../config';

/**
 * JobMessages
 * - Ensures (or creates) a conversation for the job's contact
 * - Shows messages as chat bubbles
 * - Lets you send a message
 * - Toggle AI Autopilot per-contact
 */
export default function JobMessages({ jobId }) {
  const [loading, setLoading] = useState(true);
  const [conversationId, setConversationId] = useState(null);
  const [contact, setContact] = useState(null);
  const [phone, setPhone] = useState(null);
  const [autopilot, setAutopilot] = useState(true);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  // autoscroll to bottom when messages change
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Ensure we have a conversation + initial messages
useEffect(() => {
  let alive = true;
  (async () => {
    try {
      setLoading(true);

      const r = await fetch(`${API_BASE}/api/job/${encodeURIComponent(jobId)}/ensure-thread`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'default' })
      });
      const j = await r.json();
      if (!alive) return;
      if (!j.ok) throw new Error(j.error || 'failed to ensure thread');

      setConversationId(j.conversationId || null);
      setContact(j.contact || null);
      setPhone(j.phone || null);

      // 👇 Force AI OFF in job drawer
      setAutopilot(false);

      if (j.conversationId) {
        await loadMessages(j.conversationId, alive);
      } else {
        setMessages([]);
      }
    } catch (e) {
      if (!alive) return;
      console.warn('[JobMessages] ensure-thread failed:', e?.message || e);
      setMessages([]);
    } finally {
      if (!alive) return;
      setLoading(false);
    }
  })();
  return () => { alive = false; };
}, [jobId]);

  async function loadMessages(convId, aliveFlag = true) {
    try {
      const r = await fetch(`${API_BASE}/api/mock/ghl/conversation/${encodeURIComponent(convId)}/messages`);
      const j = await r.json();
      if (!aliveFlag) return;
      setMessages(Array.isArray(j.messages) ? j.messages : []);
    } catch (e) {
      if (!aliveFlag) return;
      console.warn('[JobMessages] load messages failed:', e?.message || e);
      setMessages([]);
    }
  }

  async function handleRefresh() {
    if (!conversationId) return;
    await loadMessages(conversationId, true);
  }

  async function handleToggleAutopilot(next) {
    setAutopilot(next);
    try {
      await fetch(`${API_BASE}/api/agent/autopilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: contact?.id || null,
          phone: phone || null,
          enabled: !!next
        })
      });
    } catch (e) {
      console.warn('[JobMessages] autopilot toggle failed:', e?.message || e);
    }
  }

async function handleSend() {
  const t = text.trim();
  if (!t || !contact?.id) return;
  setSending(true);
  try {
    const r = await fetch(`${API_BASE}/api/mock/ghl/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactId: contact.id,
        text: t,
        direction: 'outbound',
        autopilot: false,          // 👈 force OFF for job drawer
        fromJob: true,             // 👈 tell backend this came from job drawer
        appointmentId: jobId,
        clientId: 'default',
        to: phone || undefined
      })
    });
    const j = await r.json();
    if (j?.conversationId && j.conversationId !== conversationId) {
      setConversationId(j.conversationId);
    }
    setText('');
    setTimeout(() => handleRefresh(), 300);
  } catch (e) {
    console.warn('[JobMessages] send failed:', e?.message || e);
  } finally {
    setSending(false);
  }
}

  // Simple, clean chat bubble styles (Tailwind)
  const Bubble = ({ m }) => {
    const inbound = (m.direction || '').toLowerCase() === 'inbound';
    const time = useMemo(() => {
      try { return new Date(m.createdAt).toLocaleString(); } catch { return ''; }
    }, [m.createdAt]);

    return (
      <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-snug
          ${inbound ? 'bg-white/10 text-white' : 'bg-blue-500/80 text-white'}
        `}>
          {m.text || <span className="text-white/60">(no text)</span>}
          <div className="mt-1 text-[10px] opacity-70">{time}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="glass rounded-none p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-white/60">Messages</div>

        <div className="flex items-center gap-3">
         <label className="flex items-center gap-1 text-xs select-none opacity-60">
  <input type="checkbox" disabled checked={false} readOnly />
  <span>AI Autopilot (off in Job view)</span>
</label>

          <button
            onClick={handleRefresh}
            className="px-2 py-1 rounded-none glass text-xs hover:bg-panel/70"
            disabled={!conversationId}
            title="Refresh messages"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-white/60">Loading…</div>
      ) : !contact?.id ? (
        <div className="text-xs text-red-400">No contact on job.</div>
      ) : (
        <>
          <div
            ref={listRef}
            className="h-40 sm:h-48 overflow-auto pr-1 space-y-2 border border-white/10 rounded-none p-2 bg-black/20"
          >
            {messages.length === 0 ? (
              <div className="text-xs text-white/50">No messages yet.</div>
            ) : (
              messages.map((m) => <Bubble key={m.id} m={m} />)
            )}
          </div>

          <div className="mt-2 flex gap-2">
            <input
              className="flex-1 rounded-none bg-black/30 border border-white/10 px-2 py-1 text-sm outline-none focus:border-white/30"
              placeholder="Type a message…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={!contact?.id || sending}
            />
            <button
              onClick={handleSend}
              disabled={!contact?.id || sending || !text.trim()}
              className="px-3 py-1 rounded-none glass text-sm hover:bg-panel/70 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}