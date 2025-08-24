// Thin multi-tenant in-memory repo for team profiles, presence & kudos.

import { normalizeTenantId, TenantId } from './memory';
import { createEvent, recordAndEmit, BaseEvent } from '../events';

export type UserId = string;
export type Role = 'owner' | 'admin' | 'member';

export type Profile = {
  id: string;           // profile id (== userId in MVP)
  userId: string;       // same as id for now
  name: string;
  handle?: string;      // @handle unique within tenant (best-effort)
  title?: string;
  phone?: string;
  email?: string;
  location?: string;
  timezone?: string;
  bio?: string;
  avatarUrl?: string | null;
  color?: string | null;    // brand color for generated avatar
  skills?: string[];
  links?: { label: string; url: string }[];
  createdAt: string;
  updatedAt: string;
  stats?: {
    kudosReceived?: number;
    messages?: number;
  };
  pinnedChannels?: string[];

  // NEW admin/permission fields
  role?: Role;               // 'member' by default
  mutedUntil?: string | null; // ISO until when posting is muted
  disabled?: boolean;         // soft-removal from team
};

export type Presence = {
  userId: string;
  status: 'online' | 'away' | 'dnd' | 'offline';
  lastActiveAt: string; // ISO
};

export type Kudos = {
  id: string;
  fromUserId: string;
  toUserId: string;
  emoji?: string;       // "👏", "💯" etc
  message?: string;
  at: string;           // ISO
};

const profilesByClient = new Map<TenantId, Map<UserId, Profile>>();
const presenceByClient = new Map<TenantId, Map<UserId, Presence>>();
const kudosByClient = new Map<TenantId, Kudos[]>();

function nowISO() { return new Date().toISOString(); }

export function listProfiles(clientId?: string) {
  const t = normalizeTenantId(clientId);
  // Hide disabled users by default
  return Array.from((profilesByClient.get(t) || new Map()).values())
    .filter(p => !p.disabled);
}

export function getProfile(clientId: string | undefined, userId: string) {
  const t = normalizeTenantId(clientId);
  return profilesByClient.get(t)?.get(String(userId)) || null;
}

export function upsertProfile(
  io: { emit: (ch: string, payload: any) => void },
  clientId: string | undefined,
  userId: string,
  patch: Partial<Profile>
): Profile {
  const t = normalizeTenantId(clientId);
  if (!profilesByClient.has(t)) profilesByClient.set(t, new Map());
  const bag = profilesByClient.get(t)!;

  const existing = bag.get(userId);
  const now = nowISO();
  const next: Profile = {
    id: userId,
    userId,
    name: patch.name || existing?.name || 'Unnamed',
    handle: patch.handle ?? existing?.handle,
    title: patch.title ?? existing?.title,
    phone: patch.phone ?? existing?.phone,
    email: patch.email ?? existing?.email,
    location: patch.location ?? existing?.location,
    timezone: patch.timezone ?? existing?.timezone,
    bio: patch.bio ?? existing?.bio,
    avatarUrl: patch.avatarUrl ?? existing?.avatarUrl ?? null,
    color: patch.color ?? existing?.color ?? null,
    skills: patch.skills ?? existing?.skills ?? [],
    links: patch.links ?? existing?.links ?? [],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    stats: existing?.stats || { kudosReceived: 0, messages: 0 },
    pinnedChannels: patch.pinnedChannels ?? existing?.pinnedChannels ?? [],

    // NEW fields (defaulting if absent)
    role: patch.role ?? existing?.role ?? 'member',
    mutedUntil: patch.mutedUntil ?? existing?.mutedUntil ?? null,
    disabled: patch.disabled ?? existing?.disabled ?? false,
  };

  // naive handle uniqueness (best effort)
  if (next.handle) {
    const taken = Array.from(bag.values()).some(p => p.userId !== userId && p.handle === next.handle);
    if (taken) next.handle = `${next.handle}-${Math.random().toString(36).slice(2,5)}`;
  }

  bag.set(userId, next);

  const ev = createEvent('lead.updated' as any, t, next, {
    source: 'system',
    mode: 'manual',
    subject: { repId: userId, repName: next.name },
    meta: { kind: 'profile.upsert' }
  });
  recordAndEmit(io, ev as BaseEvent);

  try { io.emit('profile:updated', { clientId: t, profile: next }); } catch {}
  return next;
}

export function setPresence(
  io: { emit: (ch: string, payload: any) => void },
  clientId: string | undefined,
  userId: string,
  status: Presence['status']
): Presence {
  const t = normalizeTenantId(clientId);
  if (!presenceByClient.has(t)) presenceByClient.set(t, new Map());
  const bag = presenceByClient.get(t)!;
  const p: Presence = { userId, status, lastActiveAt: nowISO() };
  bag.set(userId, p);
  try { io.emit('presence:updated', { clientId: t, presence: p }); } catch {}
  return p;
}

export function listPresence(clientId?: string) {
  const t = normalizeTenantId(clientId);
  return Array.from((presenceByClient.get(t) || new Map()).values());
}

export function sendKudos(
  io: { emit: (ch: string, payload: any) => void },
  clientId: string | undefined,
  fromUserId: string,
  toUserId: string,
  emoji?: string,
  message?: string
): Kudos {
  const t = normalizeTenantId(clientId);
  const k: Kudos = {
    id: 'kdz_' + Math.random().toString(36).slice(2),
    fromUserId, toUserId, emoji, message, at: nowISO()
  };
  if (!kudosByClient.has(t)) kudosByClient.set(t, []);
  kudosByClient.get(t)!.push(k);

  // bump stats
  const to = getProfile(t, toUserId);
  if (to) {
    to.stats = to.stats || {};
    to.stats.kudosReceived = (to.stats.kudosReceived || 0) + 1;
  }

  try { io.emit('kudos:created', { clientId: t, kudos: k }); } catch {}
  return k;
}

/* ===========================
   Admin helpers & guards
=========================== */

export function setRole(clientId: string | undefined, userId: string, role: Role): Profile | null {
  const t = normalizeTenantId(clientId);
  const bag = profilesByClient.get(t);
  if (!bag) return null;
  const p = bag.get(userId);
  if (!p) return null;
  p.role = role;
  p.updatedAt = nowISO();
  return p;
}

export function muteUser(clientId: string | undefined, userId: string, untilISO: string): Profile | null {
  const t = normalizeTenantId(clientId);
  const bag = profilesByClient.get(t);
  if (!bag) return null;
  const p = bag.get(userId);
  if (!p) return null;
  p.mutedUntil = untilISO;
  p.updatedAt = nowISO();
  return p;
}

export function unmuteUser(clientId: string | undefined, userId: string): Profile | null {
  const t = normalizeTenantId(clientId);
  const bag = profilesByClient.get(t);
  if (!bag) return null;
  const p = bag.get(userId);
  if (!p) return null;
  p.mutedUntil = null;
  p.updatedAt = nowISO();
  return p;
}

export function disableUser(clientId: string | undefined, userId: string, disabled = true): Profile | null {
  const t = normalizeTenantId(clientId);
  const bag = profilesByClient.get(t);
  if (!bag) return null;
  const p = bag.get(userId);
  if (!p) return null;
  p.disabled = disabled;
  p.updatedAt = nowISO();
  return p;
}

export function isMuted(clientId: string | undefined, userId: string) {
  const p = getProfile(clientId, userId);
  if (!p || !p.mutedUntil) return false;
  return new Date(p.mutedUntil).getTime() > Date.now();
}

export function isDisabled(clientId: string | undefined, userId: string) {
  const p = getProfile(clientId, userId);
  return !!p?.disabled;
}