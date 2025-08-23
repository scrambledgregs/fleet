// src/voice/bridge.ts
import { io, Socket } from 'socket.io-client';

let installed = false;

export function installVoiceBridge() {
  if (installed) return;

  // HMR-safe global guard so we don't reattach listeners on Vite reloads
  const KEY = '__xFleetVoiceBridgeInstalled';
  if ((window as any)[KEY]) return;
  (window as any)[KEY] = true;

  installed = true;

  // Allow either VITE_API_ORIGIN or VITE_API_URL; fall back to same-origin
  const rawOrigin =
    (import.meta as any).env?.VITE_API_ORIGIN ??
    (import.meta as any).env?.VITE_API_URL ??
    `${location.protocol}//${location.host}`;

  const API_ORIGIN = String(rawOrigin).replace(/\/$/, '');

  const socket: Socket = io(API_ORIGIN, {
    transports: ['websocket'],
    // path is '/socket.io' by default; keep explicit in case you ever change it on the server
    path: '/socket.io',
    withCredentials: false,
  });

  socket.on('voice:status', (payload: any) => {
    window.dispatchEvent(new CustomEvent('voice:status', { detail: payload }));

    const ended = new Set(['completed', 'canceled', 'busy', 'failed', 'no-answer']);
    const status = String(payload?.status || '').toLowerCase();
    if (ended.has(status)) {
      // PowerDialerDock only checks the event name, no detail needed
      window.dispatchEvent(new Event('voice:call-ended'));
    }
  });

  // Recording ready → toast + re-emit for consumers
  socket.on('voice:recording', (payload: {
    callSid?: string;
    recordingSid?: string;
    status?: string;
    url?: string;           // .mp3 URL from server
    durationSec?: number | null;
    to?: string | null;
    from?: string | null;
    at?: string;
  }) => {
    window.dispatchEvent(
      new CustomEvent('voice:recording-ready', { detail: payload })
    );

    if (payload?.url) {
      const who = [payload?.from, '→', payload?.to].filter(Boolean).join(' ') || 'Call';
      const dur =
        typeof payload?.durationSec === 'number'
          ? ` • ${Math.round(payload.durationSec)}s`
          : '';
      showToast(`Recording ready: ${who}${dur}`, payload.url);
    }
  });

  // Browser → backend: start a call
  window.addEventListener('voice:dial', async (e: Event) => {
    try {
      const detail = (e as CustomEvent).detail || {};
      const to = detail.to;
      if (!to) return;

      const res = await fetch(`${API_ORIGIN}/api/voice/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Dial failed (${res.status})`);
      }
      // success statuses will arrive via 'voice:status'
    } catch (err: any) {
      window.dispatchEvent(
        new CustomEvent('voice:error', {
          detail: { when: 'dial', message: err?.message || String(err) },
        })
      );
    }
  });
}

/** Minimal, dependency-free toast */
function showToast(text: string, href?: string) {
  ensureToastStyles();

  const wrap =
    (document.querySelector('#xfleet-toast-wrap') as HTMLDivElement) ||
    (() => {
      const d = document.createElement('div');
      d.id = 'xfleet-toast-wrap';
      d.style.cssText =
        'position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:9999;';
      document.body.appendChild(d);
      return d;
    })();

  const card = document.createElement('div');
  card.className = 'xfleet-toast';
  card.innerHTML = `
    <div class="body">
      <span>${escapeHtml(text)}</span>
      ${href ? `<a class="link" href="${href}" target="_blank" rel="noopener">Open</a>` : ''}
    </div>
  `;
  wrap.appendChild(card);

  setTimeout(() => {
    card.style.opacity = '0';
    setTimeout(() => card.remove(), 300);
  }, 5000);
}

function ensureToastStyles() {
  if (document.getElementById('xfleet-toast-css')) return;
  const style = document.createElement('style');
  style.id = 'xfleet-toast-css';
  style.textContent = `
    .xfleet-toast {
      background: rgba(22,27,34,0.96);
      color: #fff;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,.35);
      padding: 10px 12px;
      max-width: 360px;
      transition: opacity .3s ease;
      font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, "Apple Color Emoji","Segoe UI Emoji";
    }
    .xfleet-toast .body { display:flex; align-items:center; gap:12px; }
    .xfleet-toast .link {
      margin-left:auto;
      text-decoration:none;
      padding:6px 10px;
      border-radius:8px;
      border:1px solid rgba(255,255,255,0.15);
      color:#fff;
    }
    .xfleet-toast .link:hover { background: rgba(255,255,255,0.08); }
  `;
  document.head.appendChild(style);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[ch]
  );
}