// x-fleet-front/src/lib/socket.ts
import { io, Socket } from "socket.io-client";

const SOCKET_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SOCKET_URL) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) ||
  (typeof window !== "undefined" ? window.location.origin : "");

export function getTenantId(): string {
  const qs = new URLSearchParams(window.location.search);
  return (qs.get("clientId") || qs.get("tenantId") || "default").toLowerCase();
}

export function makeSocket(tenantId = getTenantId()): Socket {
  return io(SOCKET_URL, {
    transports: ["websocket"],
    withCredentials: true,
    auth: { tenantId },                 // server reads this
    query: { tenantId },                // ...and also this (extra safety)
    path: "/socket.io",                 // explicit path to match server
  });
}

// NEW: stamp X-Tenant-Id on any fetch() you make
export function withTenant(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers || {});
  headers.set("X-Tenant-Id", getTenantId());
  return { ...init, headers };
}