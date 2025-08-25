// src/lib/api.ts
const BASE =
  (import.meta as any)?.env?.VITE_API_BASE ||
  (typeof window !== 'undefined' ? window.location.origin : '');

const TENANT_ID =
  (import.meta as any)?.env?.VITE_TENANT_ID || 'default';

export async function api(path: string, init: RequestInit = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Tenant-Id': TENANT_ID,
    ...(init.headers || {}),
  };

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  // Try to decode JSON, fall back to text
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const msg = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(msg || `Request failed: ${res.status}`);
  }
  return body;
}