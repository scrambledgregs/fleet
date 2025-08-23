// x-fleet-back/lib/repos/memory.ts
// Thin multi-tenant in-memory repository for the prototype.
// Centralizes all per-tenant Maps so server.js can import from here,
// and we can later swap this behind the same interface with a DB/Redis.

export type TenantId = string;

// --- Utilities ---
export const normalizeTenantId = (t?: string): TenantId =>
  String(t || 'default').trim().toLowerCase();

// Generic TTL Map with optional LRU trimming and key normalizer
export function ttlMap<K = any, V = any>(
  ttlMs: number,
  opts: { max?: number; normalizeKey?: (key: K) => string } = {}
) {
  const max = Number.isFinite(opts.max) ? (opts.max as number) : undefined;
  const norm = typeof opts.normalizeKey === 'function' ? opts.normalizeKey : (k: K) => String(k);

  const store = new Map<string, { v: V; t: number }>(); // normalizedKey -> { v, t }

  const api = {
    get(key: K): V | null {
      const k = norm(key);
      const row = store.get(k);
      if (!row) return null;
      if (Date.now() - row.t > ttlMs) {
        store.delete(k);
        return null;
      }
      // refresh LRU by re-inserting
      store.delete(k);
      store.set(k, { v: row.v, t: row.t });
      return row.v;
    },
    set(key: K, value: V) {
      const k = norm(key);
      store.set(k, { v: value, t: Date.now() });
      if (max && store.size > max) {
        const oldestKey = store.keys().next().value;
        if (oldestKey) store.delete(oldestKey);
      }
    },
    has(key: K) {
      return api.get(key) != null;
    },
    delete(key: K) {
      return store.delete(norm(key));
    },
    clear() {
      store.clear();
    },
    size() {
      return store.size;
    },
    _dumpInternal() {
      // debugging helper
      return Array.from(store.entries());
    },
  };

  return api;
}

// --- Shared caches (exported so server/routes can reuse) ---
const q = (n: any) => Number(n).toFixed(4); // ~11m precision at equator

export type LatLng = { lat: number; lng: number };

export const geocodeCache = ttlMap<string, LatLng>(24 * 60 * 60 * 1000, {
  max: 10_000,
  normalizeKey: (addr) => String(addr || '').trim().toLowerCase(),
});

export const driveCache = ttlMap<{ from: LatLng; to: LatLng }, number>(6 * 60 * 60 * 1000, {
  max: 20_000,
  normalizeKey: (k) => {
    if (!k || !k.from || !k.to) return '∅';
    return `${q(k.from.lat)},${q(k.from.lng)}|${q(k.to.lat)},${q(k.to.lng)}`;
  },
});

// --- Data shapes kept intentionally loose for the prototype ---
export interface ContactSummary {
  id: string;
  name?: string;
  company?: string | null;
  phones?: string[];
  emails?: string[];
  address?: any;
  tags?: string[];
  kind?: string;
  lastAppointmentAt?: string | null;
  appointments?: number;
  lastDisposition?: any;
  dispositions?: any[];
}

export interface Job {
  appointmentId: string;
  startTime: string; // ISO
  endTime: string;   // ISO
  jobType?: string;
  estValue?: number;
  territory?: string | null;
  address?: any;
  lat?: number | null;
  lng?: number | null;
  assignedUserId?: string | null;
  assignedRepName?: string | null;
  contact?: any;
}

export interface Tech {
  id: string;
  name: string;
  skills?: string[];
  territory?: string | null;
  route?: any[];
}

export interface Vehicle {
  id: string;
  name: string;
  plate?: string;
  capacity?: number;
  notes?: string;
}

// --- The multi-tenant in-memory stores ---
export const jobsByClient = new Map<TenantId, Map<string, Job>>();
export const techsByClient = new Map<TenantId, Tech[]>();
export const vehiclesByClient = new Map<TenantId, Vehicle[]>();
export const contactsByClient = new Map<TenantId, Map<string, ContactSummary>>();

// Per-contact AI autopilot preference (keyed by contact id or E.164 phone)
export const autopilotPref = new Map<string, boolean>();

// --- Helper accessors (server.js can import & use these) ---
export function jobsMap(clientId?: string) {
  const t = normalizeTenantId(clientId);
  if (!jobsByClient.has(t)) jobsByClient.set(t, new Map());
  return jobsByClient.get(t)!;
}

export function techsList(clientId?: string) {
  const t = normalizeTenantId(clientId);
  if (!techsByClient.has(t)) techsByClient.set(t, []);
  return techsByClient.get(t)!;
}

export function vehiclesList(clientId?: string) {
  const t = normalizeTenantId(clientId);
  if (!vehiclesByClient.has(t)) vehiclesByClient.set(t, []);
  return vehiclesByClient.get(t)!;
}

export function contactBag(clientId?: string) {
  const t = normalizeTenantId(clientId);
  if (!contactsByClient.has(t)) contactsByClient.set(t, new Map());
  return contactsByClient.get(t)!;
}

// Autopilot preference helpers
export function setAutoPref(args: { id?: string | null; phone?: string | null; enabled: boolean }) {
  const { id, phone, enabled } = args || {};
  if (typeof enabled !== 'boolean') return;
  if (id) autopilotPref.set(String(id), enabled);
  if (phone) autopilotPref.set(String(phone), enabled);
}

export function getAutoPref(args: { id?: string | null; phone?: string | null }) {
  const { id, phone } = args || {};
  if (id != null && autopilotPref.has(String(id))) return autopilotPref.get(String(id))!;
  if (phone != null && autopilotPref.has(String(phone))) return autopilotPref.get(String(phone))!;
  return null; // means “no override saved”
}

// Convenience for tests/dev
export function clearTenant(clientId?: string) {
  const t = normalizeTenantId(clientId);
  jobsByClient.set(t, new Map());
  techsByClient.set(t, []);
  vehiclesByClient.set(t, []);
  contactsByClient.set(t, new Map());
  // do not clear autopilotPref globally to avoid nuking other tenants by mistake
}

export function clearAll() {
  jobsByClient.clear();
  techsByClient.clear();
  vehiclesByClient.clear();
  contactsByClient.clear();
  autopilotPref.clear();
  geocodeCache.clear();
  driveCache.clear();
}

// A tiny new-id helper (kept here so server.js can import one place if needed)
export function newId(prefix = 'id_') {
  return prefix + Math.random().toString(36).slice(2);
}