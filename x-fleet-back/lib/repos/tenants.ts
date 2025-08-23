// x-fleet-back/lib/repos/tenants.ts
// Centralized, in-memory phone → tenant mapping for the prototype.
// Swappable later for Redis/DB behind the same functions.

import { normalizeTenantId } from './memory';

const phoneToTenant = new Map<string, string>();

/**
 * Optional seed via env:
 *   TWILIO_TENANT_MAP="+15551230000=acme, +15557654321=default"
 */
export function loadTenantPhoneSeeds(envValue = process.env.TWILIO_TENANT_MAP || '') {
  const s = String(envValue || '').trim();
  if (!s) return;
  for (const pair of s.split(',')) {
    const [rawPhone, rawTenant] = pair.split('=').map((x) => String(x || '').trim());
    if (!rawPhone || !rawTenant) continue;
    setTenantPhone(rawPhone, rawTenant);
  }
}

export function getTenantForPhone(phone?: string | null): string | null {
  const k = String(phone || '').trim();
  if (!k) return null;
  return phoneToTenant.get(k) || null;
}

export function setTenantPhone(phone: string, tenantId: string) {
  const k = String(phone || '').trim();
  const t = normalizeTenantId(tenantId);
  if (!k || !t) return;
  phoneToTenant.set(k, t);
}

export function removeTenantPhone(phone: string) {
  const k = String(phone || '').trim();
  if (!k) return;
  phoneToTenant.delete(k);
}

export function listTenantPhoneMap() {
  return Array.from(phoneToTenant.entries()).map(([phone, tenantId]) => ({ phone, tenantId }));
}