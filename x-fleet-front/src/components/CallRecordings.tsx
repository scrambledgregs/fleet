// src/components/CallRecordings.tsx
import React, { useEffect, useMemo, useState } from 'react';

type RecordingPayload = {
  callSid?: string;
  recordingSid?: string;
  status?: string;         // 'completed' etc.
  url?: string;            // .mp3 URL from server
  durationSec?: number | null;
  to?: string | null;
  from?: string | null;
  at?: string;             // ISO from server
};

type Item = RecordingPayload & {
  id: string;              // stable key
  insertedAt: number;      // ms epoch
};

const OPEN_KEY = 'xfleet-recordings-open';

export default function CallRecordings() {
  const [open, setOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem(OPEN_KEY);
    return saved ? saved === '1' : true;
  });
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
     function onReady(e: Event) {
   const detail = (e as CustomEvent<RecordingPayload>).detail;
      if (!detail) return;
      const id = detail.recordingSid || `${detail.callSid || 'call'}:${detail.at || Date.now()}`;
      const next: Item = {
        ...detail,
        id,
        insertedAt: Date.now(),
      };
      setItems(prev => {
        const dedup = prev.filter(x => x.id !== id);
        // keep last 10
        return [next, ...dedup].slice(0, 10);
      });
      setOpen(true);
    }

    window.addEventListener('voice:recording-ready', onReady);
    return () => window.removeEventListener('voice:recording-ready', onReady);
  }, []);

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  }, [open]);

  const hasItems = items.length > 0;
  const title = useMemo(() => `Recordings ${hasItems ? `(${items.length})` : ''}`, [hasItems, items.length]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed z-40 rounded-full bg-white/10 text-white px-3 h-10 text-sm font-semibold border border-white/10 hover:bg-white/15"
        style={{
            // sit to the LEFT of the PhoneDock (≈72px) with a little gap
            right: '96px',               // 72px dock + 24px gap
            bottom: '24px'               // keep it low, clear of content
        }}  
        aria-label="Open recordings"
        title="Open recordings"
      >
        {title}
      </button>
    );
  }

  return (
    <div
        className="fixed z-40 w-[calc(100%-2rem)] sm:w-[360px] rounded-2xl bg-[#161b22]/95 border border-white/10 shadow-2xl backdrop-blur-md"
        style={{
            right: '16px',
            // sit ABOVE the dock (≈72px) with gap so it doesn’t cover FABs
            bottom: '112px'              // 72px dock + 24px gap + ~16px breathing room
        }}
    >      
  <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="flex items-center gap-2">
          {hasItems && (
            <button
              onClick={() => setItems([])}
              className="text-xs text-white/60 hover:text-white"
              title="Clear list"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="text-xs text-white/60 hover:text-white"
            title="Hide"
          >
            Hide
          </button>
        </div>
      </div>

      <div className="max-h-[50vh] overflow-auto">
        {!hasItems && (
          <div className="px-3 py-4 text-xs text-white/60">
            When Twilio finishes a recording, it’ll show up here.
          </div>
        )}

        {items.map((it) => (
          <Row key={it.id} item={it} />
        ))}
      </div>
    </div>
  );
}

function Row({ item }: { item: Item }) {
  const who = useMemo(() => {
    const from = item.from || '';
    const to = item.to || '';
    return [from, '→', to].filter(Boolean).join(' ');
  }, [item.from, item.to]);

  const when = useMemo(() => {
    const d = item.at ? new Date(item.at) : new Date(item.insertedAt);
    const now = Date.now();
    const diff = Math.max(0, Math.floor((now - d.getTime()) / 1000));
    if (diff < 60) return `${diff}s ago`;
    const m = Math.floor(diff / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
  }, [item.at, item.insertedAt]);

  const dur = typeof item.durationSec === 'number' ? `${Math.round(item.durationSec)}s` : '—';

  async function copyLink() {
    if (!item.url) return;
    try {
      await navigator.clipboard.writeText(item.url);
    } catch { /* ignore */ }
  }

  return (
    <div className="px-3 py-2 border-b border-white/5 last:border-0">
      <div className="flex items-center justify-between text-xs">
        <div className="text-white/80 truncate">{who || 'Call'}</div>
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
          onClick={copyLink}
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
  );
}