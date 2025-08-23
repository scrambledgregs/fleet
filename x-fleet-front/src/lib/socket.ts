// x-fleet-front/src/lib/socket.ts
import { io, Socket } from "socket.io-client";

// ---- env helpers (works in Vite & during SSR) ----
const ENV: Record<string, string | undefined> =
  typeof import.meta !== "undefined" && (import.meta as any).env
    ? ((import.meta as any).env as Record<string, string | undefined>)
    : {};

const SOCKET_URL =
  ENV.VITE_SOCKET_URL ||
  ENV.VITE_API_BASE ||
  (typeof window !== "undefined" ? window.location.origin : "");

const WITH_CREDENTIALS = (ENV.VITE_SOCKET_WITH_CREDENTIALS || "") === "true";
const DEBUG = (ENV.VITE_SOCKET_DEBUG || "") === "true";
const API_BASE = ENV.VITE_API_BASE || "";

// --- Tenant helpers ---
export function getTenantId(): string {
  if (typeof window === "undefined") return "default";
  const qs = new URLSearchParams(window.location.search);
  return (qs.get("clientId") || qs.get("tenantId") || "default").toLowerCase();
}

// Stamp X-Tenant-Id on any fetch you make
export function withTenant(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers || {});
  headers.set("X-Tenant-Id", getTenantId());
  return { ...init, headers };
}

// Convenience fetch that applies tenant header and honors API_BASE when provided
export function apiFetch(path: string, init: RequestInit = {}) {
  const url = API_BASE ? `${API_BASE}${path}` : path; // use relative path if no API_BASE
  return fetch(url, withTenant(init));
}

// Create a *new* socket
export function makeSocket(tenantId: string = getTenantId()): Socket {
  const s = io(SOCKET_URL, {
    transports: ["websocket"],
    withCredentials: WITH_CREDENTIALS,
    auth: { tenantId }, // server reads this
    query: { tenantId }, // …and also this (extra safety)
    path: "/socket.io",
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 10000,
  });

  if (DEBUG) {
    s.on("connect", () => console.log("[socket] connected", s.id, { tenantId }));
    s.on("disconnect", (reason) => console.log("[socket] disconnect:", reason));
    s.on("connect_error", (err) => console.warn("[socket] connect_error:", err.message));
    s.onAny((event, ...args) => {
      const first = args[0];
      try {
        console.log("[socket evt]", event, typeof first === "object" ? { ...first } : first);
      } catch {
        console.log("[socket evt]", event);
      }
    });
  }

  return s;
}

// --- Singleton accessors (prevents duplicate connections on HMR / route changes) ---
declare global {
  interface Window {
    __xFleetSocket?: (Socket & { __tenantId?: string });
  }
}

export function getSocket(tenantId: string = getTenantId()): Socket {
  if (typeof window === "undefined") return makeSocket(tenantId);

  const existing = window.__xFleetSocket;
  // If we already have a socket for this tenant, reuse it (even if reconnecting)
  if (existing && existing.__tenantId === tenantId) {
    return existing;
  }

  if (existing) {
    try {
      existing.disconnect();
    } catch {}
  }

  const s = makeSocket(tenantId) as Socket & { __tenantId?: string };
  s.__tenantId = tenantId;
  window.__xFleetSocket = s;
  return s;
}

export function switchTenant(newTenantId: string): Socket {
  return getSocket(newTenantId);
}

export function closeSocket() {
  if (typeof window === "undefined") return;
  const s = window.__xFleetSocket;
  if (s) {
    try {
      s.disconnect();
    } catch {}
    delete window.__xFleetSocket; // remove the property instead of assigning undefined
  }
}

// Await connection (handy in pages that must be online before proceeding)
export function awaitConnection(s: Socket, ms = 8000): Promise<void> {
  if (s.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (e: any) => {
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    const t: ReturnType<typeof setTimeout> = setTimeout(() => {
      cleanup();
      reject(new Error("socket connect timeout"));
    }, ms);
    const cleanup = () => {
      clearTimeout(t);
      s.off("connect", onConnect);
      s.off("connect_error", onError);
    };
    s.once("connect", onConnect);
    s.once("connect_error", onError);
  });
}

// --- Module-level singleton (default export) ---
const socket = getSocket(); // will reuse across HMR via window.__xFleetSocket
export default socket;
export { socket };