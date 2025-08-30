// src/lib/http.ts
import axios, {
  type AxiosInstance,
  type AxiosStatic,
  type InternalAxiosRequestConfig,
} from "axios";

// ---------------------------------------------------------
// Globals/types for safe fetch patching
// ---------------------------------------------------------
declare global {
  interface Window {
    __TENANT_FETCH_PATCHED__?: boolean;
  }
}

const isBrowser = typeof window !== "undefined";

// A shared axios instance for your app
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "", // relative -> same origin unless env provided
});

// Decide tenant per request: query -> localStorage -> subdomain -> default
export function resolveTenantId(): string {
  if (!isBrowser) return "default";
  const qs = new URLSearchParams(window.location.search);
  const fromQS = qs.get("tenantId") || qs.get("clientId");
  const stored = localStorage.getItem("tenantId") || "";
  const host = window.location.hostname;
  const sub = host.split(".")[0];
  const isLocal = host === "localhost" || host === "127.0.0.1";
  const fromSub = !isLocal && sub && sub !== "www" ? sub : "";
  // Force the "localhost" tenant when developing locally (matches your curl)
  return (fromQS || stored || fromSub || (isLocal ? "localhost" : "default")).toLowerCase();
}

function touchesFleetApi(cfg: InternalAxiosRequestConfig): boolean {
  const url = cfg.url || "";
  if (url.startsWith("/api")) return true;
  if (cfg.baseURL && /\/api($|\/)/.test(cfg.baseURL)) return true;
  try {
    const u = new URL(url, isBrowser ? window.location.origin : "http://localhost");
    return u.pathname.startsWith("/api");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------
// Axios: attach tenant header + clientId param
// ---------------------------------------------------------
function addTenantInterceptor(instance: AxiosInstance | AxiosStatic) {
  instance.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
    if (!isBrowser) return cfg;
    if (!touchesFleetApi(cfg)) return cfg;

    const tenant = resolveTenantId();

    // Header (respect if caller already set one)
    cfg.headers = cfg.headers ?? {};
    const h = cfg.headers as Record<string, any>;
    if (!("X-Tenant-Id" in h) && !("x-tenant-id" in h)) {
      h["X-Tenant-Id"] = tenant;
    }

    // Ensure clientId=tenant in the querystring (some endpoints read this)
    try {
      const u = new URL(cfg.url || "", window.location.origin);
      if (!u.searchParams.has("clientId") && !u.searchParams.has("tenantId")) {
        u.searchParams.set("clientId", tenant);
      }
      const hash = u.hash || "";
      cfg.url = u.pathname + (u.search ? `?${u.searchParams.toString()}` : "") + hash;
    } catch {
      // ignore URL parse errors
    }

    return cfg;
  });
}

// Apply to BOTH: your instance and the global axios
addTenantInterceptor(api);
addTenantInterceptor(axios);

// ---------------------------------------------------------
// Global fetch patch: ensure /api calls also get tenant + base URL
// ---------------------------------------------------------
if (isBrowser && !window.__TENANT_FETCH_PATCHED__) {
  window.__TENANT_FETCH_PATCHED__ = true;

  const ORIG_FETCH = window.fetch.bind(window);
  const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      let urlStr = typeof input === "string" ? input : (input as Request).url;

      // Only touch Fleet API calls
      const isRelativeApi = typeof urlStr === "string" && urlStr.startsWith("/api/");
      const isAbsoluteApi =
        typeof urlStr === "string" &&
        API_BASE &&
        urlStr.startsWith(API_BASE) &&
        new URL(urlStr).pathname.startsWith("/api/");

      if (!isRelativeApi && !isAbsoluteApi) {
        return ORIG_FETCH(input, init);
      }

      const tenant = resolveTenantId();

      // Build a URL to modify query params
      const u = isRelativeApi
        ? new URL(urlStr, window.location.origin)
        : new URL(urlStr);

      // Ensure clientId=tenant is present (unless already set)
      if (!u.searchParams.has("clientId") && !u.searchParams.has("tenantId")) {
        u.searchParams.set("clientId", tenant);
      }

      // Add/merge headers with X-Tenant-Id
      const headers = new Headers(init?.headers || (typeof input !== "string" ? (input as Request).headers : undefined));
      if (!headers.has("X-Tenant-Id")) {
        headers.set("X-Tenant-Id", tenant);
      }

      // Route relative /api/... to API_BASE if provided
      const finalUrl =
        isRelativeApi && API_BASE
          ? `${API_BASE}${u.pathname}${u.search}`
          : u.toString();

      if (import.meta.env.DEV) {
        // lightweight debug to verify what the page actually calls
        // eslint-disable-next-line no-console
        console.debug("[tenant fetch]", { finalUrl, tenant });
      }

      const nextInit: RequestInit = { ...(init || {}), headers };
      return ORIG_FETCH(finalUrl, nextInit);
    } catch {
      // In case of any parsing error, fall back to original fetch
      return ORIG_FETCH(input, init);
    }
  };
}

// Handy helper if you want to switch tenants at runtime
export function setTenantId(id: string) {
  if (!isBrowser) return;
  localStorage.setItem("tenantId", id.toLowerCase());
}

export default api;