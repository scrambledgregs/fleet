// lib/repos/voice.ts
// Lightweight in‑memory store for phone numbers & call sessions.
// Replace with a DB later.

export type VoiceNumber = {
  sid?: string | null;         // optional Twilio SID if provisioned
  phone: string;               // E.164
  tenantId: string;            // which tenant owns this number
  userId?: string | null;      // optional: assigned user/agent
  label?: string | null;       // display name
  friendlyName?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CallSession = {
  sid: string;
  tenantId: string;
  direction: 'outbound' | 'inbound';
  from?: string | null;
  to?: string | null;
  status: string;              // queued | ringing | answered | completed | failed | etc.
  startedAt?: string | null;
  endedAt?: string | null;
  recordingUrl?: string | null;
  recordingSid?: string | null;
  durationSec?: number | null;
};

const numbersByPhone = new Map<string, VoiceNumber>();     // phone -> number record
const sessionsBySid = new Map<string, CallSession>();      // CallSid -> session

export function upsertNumber(n: Omit<VoiceNumber, 'createdAt'|'updatedAt'>) {
  const phone = String(n.phone);
  const prev = numbersByPhone.get(phone);
  const now = new Date().toISOString();
  const row: VoiceNumber = {
    createdAt: prev?.createdAt || now,
    updatedAt: now,
    friendlyName: null,
    label: null,
    userId: null,
    sid: null,
    ...prev,
    ...n,
    phone,
  };
  numbersByPhone.set(phone, row);
  return row;
}

export function listNumbers({ tenantId }: { tenantId?: string } = {}) {
  const all = Array.from(numbersByPhone.values());
  return tenantId ? all.filter(n => n.tenantId === tenantId) : all;
}

export function assignNumberToUser(phone: string, userId: string | null) {
  const row = numbersByPhone.get(phone);
  if (!row) return null;
  row.userId = userId;
  row.updatedAt = new Date().toISOString();
  numbersByPhone.set(phone, row);
  return row;
}

export function createOrUpdateSession(partial: Partial<CallSession> & { sid: string }) {
  const prev = sessionsBySid.get(partial.sid);
  const now = new Date().toISOString();
  const row: CallSession = {
    sid: partial.sid,
    tenantId: partial.tenantId || prev?.tenantId || 'default',
    direction: (partial.direction as any) || prev?.direction || 'inbound',
    from: partial.from ?? prev?.from ?? null,
    to: partial.to ?? prev?.to ?? null,
    status: partial.status || prev?.status || 'queued',
    startedAt: partial.startedAt ?? prev?.startedAt ?? (partial.status ? now : null),
    endedAt: partial.endedAt ?? prev?.endedAt ?? null,
    recordingUrl: partial.recordingUrl ?? prev?.recordingUrl ?? null,
    recordingSid: partial.recordingSid ?? prev?.recordingSid ?? null,
    durationSec: partial.durationSec ?? prev?.durationSec ?? null,
  };
  sessionsBySid.set(row.sid, row);
  return row;
}

export function getSession(sid: string) {
  return sessionsBySid.get(sid) || null;
}

export function listSessions({ tenantId }: { tenantId?: string } = {}) {
  const all = Array.from(sessionsBySid.values());
  return tenantId ? all.filter(s => s.tenantId === tenantId) : all;
}