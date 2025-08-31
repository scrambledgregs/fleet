// src/lib/api.ts
import axios from 'axios';

export const API_BASE =
  (import.meta as any)?.env?.VITE_API_BASE ||
  (typeof window !== 'undefined' ? window.location.origin : '');

export const TENANT_ID =
  (import.meta as any)?.env?.VITE_TENANT_ID || 'localhost';

// Axios client (default export)
const api = axios.create({ baseURL: API_BASE });
api.defaults.headers.common['X-Tenant-Id'] = TENANT_ID;
export default api;

// Optional: fetch helper
export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Tenant-Id': TENANT_ID,
    ...(init.headers || {}),
  } as Record<string, string>;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(typeof body === 'string' ? body : JSON.stringify(body));
  return body;
}