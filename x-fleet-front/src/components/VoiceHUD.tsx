import React, { useEffect, useMemo, useState } from 'react';
import { useVoiceStream } from '../hooks/useVoiceStream';

function getInitialTenant(): string {
  const qs = new URLSearchParams(window.location.search);
  return (
    qs.get('tenantId') ||
    qs.get('clientId') ||
    localStorage.getItem('tenantId') ||
    'default'
  ).toLowerCase();
}

const pill =
  'text-xs px-2 py-0.5 rounded-full bg-gray-800 text-white whitespace-nowrap';

export default function VoiceHUD(): JSX.Element {
  const [open, setOpen] = useState<boolean>(true);
  const [tenant, setTenant] = useState<string>(getInitialTenant());
  const { tenantId, setTenantId, calls, placeCall } = useVoiceStream(tenant);
  const [to, setTo] = useState<string>('');

  useEffect(() => {
    if (tenant !== tenantId) setTenantId(tenant);
    localStorage.setItem('tenantId', tenant);
  }, [tenant, tenantId, setTenantId]);

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

  return (
    <div className="fixed bottom-4 right-4 z-50 text-sm font-sans">
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
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-medium">Voice (tenant: {tenantId})</span>
            </div>
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