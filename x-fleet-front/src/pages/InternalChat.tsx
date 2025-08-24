import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getSocket, apiFetch, getTenantId } from '../lib/socket';

type Channel = {
  id: string;
  name: string;
  topic?: string;
  members?: string[];
  createdAt?: string;
  lastMessageAt?: string | null;
};

type ChatMessage = {
  id: string;
  channelId: string;
  userId: string;
  userName: string;
  text: string;
  attachments?: any[];
  at: string; // ISO
};

export default function InternalChat() {
  const clientId = useMemo(() => getTenantId(), []);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const [newChanName, setNewChanName] = useState('');
  const [newChanTopic, setNewChanTopic] = useState('');
  const [draft, setDraft] = useState('');

  const [typers, setTypers] = useState<Record<string, string>>({});

  // scrolling / submit plumbing
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // throttle typing pings
  const typingGateRef = useRef<number | null>(null);

  // de-dupe incoming messages (optimistic + socket echoes)
  const seenIdsRef = useRef<Set<string>>(new Set());

  // ---------- helpers ----------
  function isNearBottom(el: HTMLElement, px = 120) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < px;
  }

  async function markRead(channelId: string, lastId?: string) {
    try {
      await apiFetch(`/api/chat/channels/${encodeURIComponent(channelId)}/read`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, userId: 'me', lastReadMessageId: lastId || null }),
      });
    } catch {}
  }

  function notifyTyping(isTyping = true) {
    if (!activeId) return;
    if (typingGateRef.current) return; // ~1.5s gate
    typingGateRef.current = window.setTimeout(() => (typingGateRef.current = null), 1500);
    apiFetch(`/api/chat/channels/${encodeURIComponent(activeId)}/typing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, userId: 'me', userName: 'You', isTyping }),
    }).catch(() => {});
  }

  function seedSeen(list: ChatMessage[]) {
    const s = seenIdsRef.current;
    s.clear();
    for (const m of list) s.add(m.id);
  }

  function pushIfNew(m: ChatMessage) {
    const s = seenIdsRef.current;
    if (s.has(m.id)) return false;
    s.add(m.id);
    setMsgs(prev => [...prev, m]);
    return true;
  }

  // ---------- load channels ----------
  async function loadChannels() {
    setLoadingChannels(true);
    try {
      const r = await apiFetch(`/api/chat/channels?clientId=${clientId}`);
      const j = await r.json();
      if (j?.ok && Array.isArray(j.channels)) {
        setChannels(j.channels);
        if (!activeId && j.channels[0]?.id) setActiveId(j.channels[0].id);
      }
    } finally {
      setLoadingChannels(false);
    }
  }

  // ---------- load messages ----------
  async function loadMessages(channelId: string) {
    if (!channelId) return;
    setLoadingMsgs(true);
    try {
      const r = await apiFetch(
        `/api/chat/channels/${encodeURIComponent(channelId)}/messages?clientId=${clientId}`
      );
      const j = await r.json();
      if (j?.ok && Array.isArray(j.messages)) {
        setMsgs(j.messages);
        seedSeen(j.messages);
        const last = j.messages[j.messages.length - 1];
        if (last?.id) markRead(channelId, last.id);
      } else {
        setMsgs([]);
        seedSeen([]);
      }
    } finally {
      setLoadingMsgs(false);
      requestAnimationFrame(() => {
        const el = scrollerRef.current;
        if (el && el.scrollHeight > el.clientHeight && isNearBottom(el, 140)) {
          bottomRef.current?.scrollIntoView({ behavior: 'auto' });
        }
      });
    }
  }

  // ---------- initial ----------
  useEffect(() => {
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeId) loadMessages(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // ---------- sockets ----------
  useEffect(() => {
    const s = getSocket(clientId);

    const onChanCreated = (payload: { channel: Channel }) => {
      if (!payload?.channel) return;
      setChannels(prev => {
        const exists = prev.some(c => c.id === payload.channel.id);
        const next = exists ? prev : [payload.channel, ...prev];
        return next.sort((a, b) => {
          const ta = new Date(a.lastMessageAt || a.createdAt || 0).getTime();
          const tb = new Date(b.lastMessageAt || b.createdAt || 0).getTime();
          return tb - ta;
        });
      });
    };

    const onMessage = (payload: { channelId: string; message: ChatMessage }) => {
      if (!payload?.message) return;

      // reorder channels
      setChannels(prev =>
        prev
          .map(c => (c.id === payload.channelId ? { ...c, lastMessageAt: payload.message.at } : c))
          .sort((a, b) => {
            const ta = new Date(a.lastMessageAt || a.createdAt || 0).getTime();
            const tb = new Date(b.lastMessageAt || b.createdAt || 0).getTime();
            return tb - ta;
          })
      );

      // append if viewing this channel (de-duped)
      if (payload.channelId === activeId) {
        const el = scrollerRef.current!;
        const sticky = el ? isNearBottom(el) : true;
        const added = pushIfNew(payload.message);
        if (added && sticky) {
          requestAnimationFrame(() =>
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
          );
        }
        if (added) markRead(payload.channelId, payload.message.id).catch(() => {});
      }
    };

    const onTyping = (p: {
      channelId: string;
      userId: string;
      userName?: string;
      isTyping?: boolean;
    }) => {
      if (!p || p.channelId !== activeId || p.userId === 'me') return;
      setTypers(prev => {
        const next = { ...prev };
        if (p.isTyping) next[p.userId] = p.userName || 'Someone';
        else delete next[p.userId];
        return next;
      });
      // auto-clear stale typing after 3s
      setTimeout(() => {
        setTypers(prev => {
          const next = { ...prev };
          delete next[p.userId];
          return next;
        });
      }, 3000);
    };

    s.on('chat:channel:created', onChanCreated);
    s.on('chat:message', onMessage);
    s.on('chat:typing', onTyping);

    return () => {
      s.off('chat:channel:created', onChanCreated);
      s.off('chat:message', onMessage);
      s.off('chat:typing', onTyping);
    };
  }, [activeId, clientId]);

  // ---------- actions ----------
  async function createChannel(e: React.FormEvent) {
    e.preventDefault();
    const name = newChanName.trim();
    if (!name) return;
    const resp = await apiFetch('/api/chat/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, name, topic: newChanTopic }),
    });
    const j = await resp.json();
    if (j?.ok && j.channel?.id) {
      setNewChanName('');
      setNewChanTopic('');
      setActiveId(j.channel.id); // optimistic select
    }
  }

  async function sendMessage() {
    if (!activeId) return;
    const text = draft.trim();
    if (!text) return;

    // Send (no optimistic append; we rely on socket echo + de-dupe)
    const payload = { clientId, userId: 'me', userName: 'You', text };
    try {
      await apiFetch(`/api/chat/channels/${encodeURIComponent(activeId)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setDraft('');
      notifyTyping(false);
    } catch {}
  }

  const activeChan = channels.find(c => c.id === activeId) || null;

  return (
    // Fixed viewport height + min-h-0 to prevent any child from expanding layout
<div className="flex h-full min-h-0 bg-zinc-950 text-zinc-100">      {/* Left: channels */}
      <aside className="w-72 border-r border-zinc-800/80 bg-zinc-900/60 backdrop-blur-md min-h-0 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800/80">
          <h2 className="text-sm font-semibold tracking-wide">Team Chat</h2>
          <p className="text-[11px] text-zinc-400">Tenant: {clientId}</p>
        </div>

        <div className="p-3 border-b border-zinc-800/80">
          <form onSubmit={createChannel} className="space-y-2">
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              placeholder="New channel name"
              value={newChanName}
              onChange={(e) => setNewChanName(e.target.value)}
            />
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              placeholder="Topic (optional)"
              value={newChanTopic}
              onChange={(e) => setNewChanTopic(e.target.value)}
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 text-white text-sm py-1.5 shadow-sm hover:brightness-110 active:brightness-95 transition"
              disabled={!newChanName.trim()}
            >
              Create channel
            </button>
          </form>
        </div>

        <div className="px-2 pb-3 overflow-auto min-h-0">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 px-2 mb-1">
            Channels {loadingChannels ? '…' : ''}
          </div>
          <ul className="space-y-1">
            {channels.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setActiveId(c.id)}
                  className={[
                    'w-full text-left px-3 py-2 rounded-lg transition',
                    activeId === c.id
                      ? 'bg-zinc-800 text-zinc-50 ring-1 ring-zinc-700'
                      : 'hover:bg-zinc-800/60 text-zinc-200',
                  ].join(' ')}
                >
                  <div className="text-sm font-medium truncate">#{c.name}</div>
                  {c.topic ? (
                    <div
                      className={
                        activeId === c.id
                          ? 'text-xs text-zinc-300 truncate'
                          : 'text-xs text-zinc-400 truncate'
                      }
                    >
                      {c.topic}
                    </div>
                  ) : null}
                </button>
              </li>
            ))}
            {!channels.length && !loadingChannels && (
              <li className="px-2 py-2 text-sm text-zinc-500">No channels yet</li>
            )}
          </ul>
        </div>
      </aside>

      {/* Right: messages */}
      <main ref={scrollerRef} className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        {/* Header */}
            <div className="sticky top-0 z-10 px-4 py-3 border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur-md">          <div className="text-sm font-semibold tracking-wide">
            {activeChan ? `#${activeChan.name}` : 'Select a channel'}
          </div>
          {activeChan?.topic ? (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-zinc-800/70 px-2 py-0.5 text-[11px] text-zinc-300">
              {activeChan.topic}
            </div>
          ) : null}
        </div>

        {/* Messages list */}
        <div
            className="flex-1 min-h-0 p-4 bg-[linear-gradient(180deg,#0b0b0f_0%,#0f0f15_100%)]"
            aria-live="polite"
            >
          {loadingMsgs && <div className="text-sm text-zinc-400">Loading messages…</div>}
          {!loadingMsgs && !msgs.length && activeChan && (
            <div className="text-sm text-zinc-500">No messages yet.</div>
          )}

          <ul className="space-y-3">
            {msgs.map((m, idx) => {
              const mine = m.userId === 'me';
              const prev = msgs[idx - 1];
              const newDay =
                !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
              return (
                <React.Fragment key={m.id}>
                  {newDay && (
                    <li className="my-2 flex justify-center">
                      <span className="rounded-full bg-zinc-800/70 px-3 py-0.5 text-[11px] text-zinc-300">
                        {new Date(m.at).toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </li>
                  )}
                  <li className={mine ? 'flex justify-end' : 'flex justify-start'}>
                    <div className={['flex items-start gap-3 max-w-[72ch]', mine ? 'flex-row-reverse' : ''].join(' ')}>
                      <div className="h-8 w-8 rounded-full bg-zinc-700/70 shrink-0" />
                      <div className={['rounded-2xl px-3 py-2 shadow-sm', mine ? 'bg-orange-600/90 text-white' : 'bg-zinc-800/80 text-zinc-100'].join(' ')}>
                        <div className="text-[12px] opacity-80">
                          <span className="font-medium">{m.userName}</span>{' '}
                          <span className="opacity-70">
                            {new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="mt-0.5 text-sm whitespace-pre-wrap">{m.text}</div>
                      </div>
                    </div>
                  </li>
                </React.Fragment>
              );
            })}
          </ul>
          <div ref={bottomRef} />
        </div>

        {/* Typing indicator */}
        {Object.values(typers).length > 0 && (
          <div className="px-4 py-2 text-xs text-zinc-300 bg-zinc-900/70 border-t border-zinc-800/80">
            <span className="mr-1">{Object.values(typers).join(', ')} is typing</span>
            <span className="inline-flex gap-1 align-middle">
              <span className="h-1 w-1 rounded-full bg-zinc-300 animate-bounce [animation-delay:0ms]" />
              <span className="h-1 w-1 rounded-full bg-zinc-300 animate-bounce [animation-delay:120ms]" />
              <span className="h-1 w-1 rounded-full bg-zinc-300 animate-bounce [animation-delay:240ms]" />
            </span>
            …
          </div>
        )}

        {/* Composer (sticky; never changes layout height) */}
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="sticky bottom-0 z-10 p-3 border-t border-zinc-800/80 bg-zinc-900/80 backdrop-blur-md"
        >
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              disabled={!activeId}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                notifyTyping(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  formRef.current?.requestSubmit(); // single source of truth (no double fire)
                }
              }}
              placeholder={
                activeId
                  ? 'Message #channel  •  Shift+Enter for newline'
                  : 'Select a channel to start…'
              }
              className="flex-1 resize-none max-h-28 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:bg-zinc-800/40"
            />
            <button
              className="rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white px-4 py-2 text-sm shadow hover:brightness-110 active:brightness-95 disabled:opacity-50"
              disabled={!activeId || !draft.trim()}
            >
              Send
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}