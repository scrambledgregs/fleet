// x-fleet-front/src/hooks/useVoiceStream.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { makeSocket, getTenantId, withTenant } from '../lib/socket';

type VoiceStatusEvent = {
  sid: string;
  status: string;
  from?: string | null;
  to?: string | null;
  at?: string;
  dir?: string;
};

type VoiceRecordingEvent = {
  callSid: string;
  status: string;
  url?: string | null;
  recordingSid?: string | null;
  durationSec?: number | null;
  to?: string | null;
  from?: string | null;
  callStatus?: string | null;
  at?: string;
};

type HistoryItem = { status: string; at: string };

export type CallRow = {
  sid: string;
  from: string | null;
  to: string | null;
  status: string;
  lastUpdate: string;
  history: HistoryItem[];
  recordingUrl?: string;
  recordingDuration?: number | null;
};

type StatusEvent = { type: 'status'; at?: string; data: VoiceStatusEvent };
type RecordingEvent = { type: 'recording'; at?: string; data: VoiceRecordingEvent };
type AnyEvent = StatusEvent | RecordingEvent;

const sockets = new Map<string, Socket>();

function getSocketForTenant(tenantId?: string): Socket {
  const key = String(tenantId || 'default').toLowerCase();
  if (!sockets.has(key)) sockets.set(key, makeSocket(key));
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return sockets.get(key)!;
}

function apiBase(): string {
  const env =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE) || '';
  if (env) return String(env).replace(/\/$/, '');
  return (typeof window !== 'undefined' ? window.location.origin : '').replace(/\/$/, '');
}

/**
 * Subscribe to per-tenant voice events and expose convenience helpers.
 */
export function useVoiceStream(initialTenant?: string) {
  const [tenantId, setTenantId] = useState<string>(
    String(initialTenant || getTenantId() || 'default').toLowerCase()
  );
  const [events, setEvents] = useState<AnyEvent[]>([]);
  const callsRef = useRef<Map<string, CallRow>>(new Map());

  // version bump so optimistic updates re-compute `calls`
  const [version, bump] = useState(0);

  const calls: CallRow[] = useMemo(() => {
    const arr = Array.from(callsRef.current.values());
    arr.sort((a, b) => new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime());
    return arr;
  }, [events, version]);

  useEffect(() => {
    const socket = getSocketForTenant(tenantId);

    const onStatus = (ev: VoiceStatusEvent) => {
      if (!ev || !ev.sid) return;

      const prevRow: CallRow =
        callsRef.current.get(ev.sid) || ({
          sid: ev.sid,
          from: ev.from ?? null,
          to: ev.to ?? null,
          status: 'unknown',
          lastUpdate: new Date().toISOString(),
          history: [] as HistoryItem[],
        } as CallRow);

      const at = ev.at || new Date().toISOString();

      const next: CallRow = {
        ...prevRow,
        from: ev.from ?? prevRow.from,
        to: ev.to ?? prevRow.to,
        status: ev.status || prevRow.status,
        lastUpdate: at,
        history: [...prevRow.history, { status: ev.status || 'unknown', at }].slice(-20),
      };

      callsRef.current.set(ev.sid, next);

      setEvents((prev): AnyEvent[] => [{ type: 'status' as const, at, data: ev }, ...prev].slice(0, 200));
    };

    const onRecording = (ev: VoiceRecordingEvent) => {
      if (!ev || !ev.callSid) return;

      const prevRow: CallRow =
        callsRef.current.get(ev.callSid) || ({
          sid: ev.callSid,
          from: ev.from ?? null,
          to: ev.to ?? null,
          status: ev.callStatus || 'completed',
          lastUpdate: new Date().toISOString(),
          history: [] as HistoryItem[],
        } as CallRow);

      const at = ev.at || new Date().toISOString();

      const next: CallRow = {
        ...prevRow,
        status: ev.callStatus || prevRow.status || 'completed',
        lastUpdate: at,
        recordingUrl: ev.url ?? prevRow.recordingUrl,
        recordingDuration:
          typeof ev.durationSec === 'number' ? ev.durationSec : prevRow.recordingDuration ?? null,
        history: [...prevRow.history, { status: ev.callStatus || 'completed', at }].slice(-20),
      };

      callsRef.current.set(ev.callSid, next);

      setEvents((prev): AnyEvent[] =>
        [{ type: 'recording' as const, at, data: ev }, ...prev].slice(0, 200)
      );
    };

    socket.on('voice:status', onStatus);
    socket.on('voice:recording', onRecording);

    return () => {
      socket.off('voice:status', onStatus);
      socket.off('voice:recording', onRecording);
    };
  }, [tenantId]);

  const placeCall = useCallback(
    async (to: string, opts: Record<string, unknown> = {}) => {
      const base = apiBase();
      const r = await fetch(`${base}/api/voice/call`, {
        method: 'POST',
        ...withTenant({ headers: { 'Content-Type': 'application/json' } }),
        body: JSON.stringify({ to, opts }),
      });

      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        sid?: string;
        status?: string;
        error?: string;
      };

      if (!j?.ok || !j?.sid) throw new Error(j?.error || 'call_failed');

      // optimistic insert; socket will update with real status transitions
      const now = new Date().toISOString();
      const prevRow =
        callsRef.current.get(j.sid) ||
        ({
          sid: j.sid,
          from: null as string | null,
          to,
          status: j.status || 'queued',
          lastUpdate: now,
          history: [] as HistoryItem[],
        } as CallRow);

      const next: CallRow = {
        ...prevRow,
        to,
        status: j.status || 'queued',
        lastUpdate: now,
        history: [...prevRow.history, { status: j.status || 'queued', at: now }].slice(-20),
      };

      callsRef.current.set(j.sid, next);
      bump((x) => x + 1);

      return j;
    },
    []
  );

  return { tenantId, setTenantId, calls, events, placeCall };
}