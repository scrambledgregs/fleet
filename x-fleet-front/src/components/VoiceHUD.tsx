// x-fleet-front/src/components/VoiceHUD.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useVoiceStream } from '../hooks/useVoiceStream';
import { withTenant } from '../lib/socket';

function getInitialTenant(): string {
  const qs = new URLSearchParams(window.location.search);
  return (
    qs.get('tenantId') ||
    qs.get('clientId') ||
    localStorage.getItem('tenantId') ||
    'default'
  ).toLowerCase();
}

function apiBase(): string {
  const env =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE) || '';
  if (env) return String(env).replace(/\/$/, '');
  return (typeof window !== 'undefined' ? window.location.origin : '').replace(/\/$/, '');
}

const pill =
  'text-xs px-2 py-0.5 rounded-full bg-gray-800 text-white whitespace-nowrap';

export default function VoiceHUD(): JSX.Element {
  const [open, setOpen] = useState<boolean>(true);
  const [tenant, setTenant] = useState<string>(getInitialTenant());
  const { tenantId, setTenantId, calls, events, placeCall } = useVoiceStream(tenant);
  const [to, setTo] = useState<string>('');

  // Voice AI toggle
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(false);
  const [toggling, setToggling] = useState<boolean>(false);

  useEffect(() => {
    if (tenant !== tenantId) setTenantId(tenant);
    localStorage.setItem('tenantId', tenant);
  }, [tenant, tenantId, setTenantId]);

  // Let any page open/toggle the HUD via window events
useEffect(() => {
  const onOpen = () => setOpen(true);
  const onToggle = () => setOpen((v) => !v);
  window.addEventListener('voicehud:open', onOpen);
  window.addEventListener('voicehud:toggle', onToggle);
  return () => {
    window.removeEventListener('voicehud:open', onOpen);
    window.removeEventListener('voicehud:toggle', onToggle);
  };
}, []);

  // Load current Voice AI state from the backend
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${apiBase()}/api/voice/state`, withTenant());
        const j = await r.json().catch(() => ({} as any));
        setVoiceEnabled(!!j?.enabled);
      } catch {
        // ignore
      }
    };
    load();
  }, [tenantId]);

  const mediaEvents = useMemo(
    () => events.filter((e) => e.type === 'media').slice(0, 10),
    [events]
  );

  const active = useMemo(() => calls.filter((c) => c.status !== 'completed'), [calls]);
  const recordings = useMemo(
    () => calls.filter((c) => c.recordingUrl).slice(0, 5),
    [calls]
  );

  async function onDial(e: React.FormEvent) {
    e.preventDefault();
    const dest = to.trim();
    if (!dest) return;
    try {
      await placeCall(dest);
      setTo('');
    } catch (err: any) {
      // eslint-disable-next-line no-alert
      alert(`Call failed: ${err?.message || err}`);
    }
  }

  async function onToggleVoice() {
    setToggling(true);
    try {
      const next = !voiceEnabled;
      const r = await fetch(`${apiBase()}/api/voice/state`, {
        method: 'POST',
        ...withTenant({ headers: { 'Content-Type': 'application/json' } }),
        body: JSON.stringify({ enabled: next }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (j?.ok) setVoiceEnabled(!!j.enabled);
      else throw new Error(j?.error || 'toggle_failed');
    } catch (e: any) {
      alert(`Toggle failed: ${e?.message || e}`);
    } finally {
      setToggling(false);
    }
  }

  return (
    <div
    className="fixed z-50 text-sm font-sans"
    style={{ right: '1rem', bottom: 'calc(env(safe-area-inset-bottom) + 6.5rem)' }}
  >
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-2 rounded-xl shadow-md bg-black/80 text-white hover:bg-black"
        title="Toggle Voice HUD"
      >
        {open ? 'Hide' : 'Show'} Voice HUD
      </button>

      {open && (
        <div className="mt-2 w-[380px] max-h-[70vh] overflow-hidden rounded-2xl shadow-lg bg-white border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  voiceEnabled ? 'bg-emerald-500' : 'bg-gray-300'
                }`}
              />
              <span className="font-medium">Voice (tenant: {tenantId})</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onToggleVoice}
                disabled={toggling}
                className={`text-xs border rounded-md px-2 py-1 ${
                  voiceEnabled
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    : 'bg-gray-50 border-gray-300 text-gray-700'
                }`}
                title="Enable/Disable Voice AI (affects inbound Twilio calls)"
              >
                {toggling ? '...' : voiceEnabled ? 'Voice: ON' : 'Voice: OFF'}
              </button>
              <select
                value={tenant}
                onChange={(e) => setTenant(e.target.value.toLowerCase())}
                className="text-xs border rounded-md px-2 py-1"
                title="Tenant"
              >
                <option value="default">default</option>
                {/* add more tenant ids here if you want a quick switcher */}
              </select>
            </div>
          </div>

          <form onSubmit={onDial} className="px-4 py-2 flex gap-2 border-b border-gray-100">
            <input
              className="flex-1 rounded-lg border px-3 py-2 outline-none focus:ring"
              placeholder="Enter phone (+1...)"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <button
              type="submit"
              className="rounded-lg px-3 py-2 bg-blue-600 text-white hover:bg-blue-700"
            >
              Call
            </button>
          </form>

          <div className="px-4 py-3 space-y-3 overflow-y-auto max-h-[52vh]">
            <section>
              <div className="text-xs uppercase text-gray-500 mb-1">Active calls</div>
              {active.length === 0 ? (
                <div className="text-gray-400 text-sm">No active calls</div>
              ) : (
                <ul className="space-y-2">
                  {active.map((c) => (
                    <li key={c.sid} className="p-2 rounded-lg bg-gray-50 border border-gray-100">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{c.to || c.from || c.sid.slice(0, 8)}</div>
                        <span className={pill}>{c.status}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(c.lastUpdate).toLocaleTimeString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="text-xs uppercase text-gray-500 mb-1">Media stream</div>
              {mediaEvents.length === 0 ? (
                <div className="text-gray-400 text-sm">No media events yet</div>
              ) : (
                <ul className="space-y-2">
                  {mediaEvents.map((e, idx) => {
                    const d = e.data as any;
                    const label =
                      d?.type === 'start'
                        ? `Stream started (callSid: ${d?.callSid || '—'})`
                        : d?.type === 'stop'
                        ? 'Stream stopped'
                        : 'WebSocket closed';
                    return (
                      <li key={idx} className="flex items-center justify-between">
                        <div className="truncate">{label}</div>
                        <span className="text-xs text-gray-500">
                          {new Date((e.at as string) || Date.now()).toLocaleTimeString()}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <div className="text-xs uppercase text-gray-500 mb-1">Recent recordings</div>
              {recordings.length === 0 ? (
                <div className="text-gray-400 text-sm">None yet</div>
              ) : (
                <ul className="space-y-2">
                  {recordings.map((c) => (
                    <li key={c.sid} className="flex items-center justify-between">
                      <a
                        className="text-blue-600 underline truncate"
                        href={c.recordingUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={c.recordingUrl}
                      >
                        {c.sid.slice(0, 10)}… ({c.recordingDuration ?? '—'}s)
                      </a>
                      <span className="text-xs text-gray-500">
                        {new Date(c.lastUpdate).toLocaleTimeString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}