// src/lib/salesApi.ts
import api, { resolveTenantId } from "./http";
import type {
  Rep,
  Payment,
  CommissionRow,
  OutstandingRow,
  CustomerSummary,
} from "../types/sales";

/** Build consistent tenant headers/params for every call */
function tcfg() {
  const tenant = resolveTenantId();
  return {
    tenant,
    headers: { "X-Tenant-Id": tenant },
    params: { clientId: tenant },
  } as const;
}

// -----------------------------
// Reps
// -----------------------------
export const getReps = async (): Promise<Rep[]> => {
  const { headers, params } = tcfg();
  const { data } = await api.get<Rep[]>("/api/reps", { headers, params });
  return Array.isArray(data) ? data : [];
};

// Create a rep
export const createRep = async (rep: {
  name: string;
  defaultCommissionPct?: number; // fraction (e.g., 0.15)
}): Promise<{ ok: true; id?: string }> => {
  const { tenant, headers } = tcfg();
  const { data } = await api.post(
    "/api/reps",
    { ...rep, tenantId: tenant, clientId: tenant },
    { headers }
  );
  return data;
};

// -----------------------------
// Payments
// -----------------------------

/**
 * Unassigned payments only; NO backend amount/commissionable filters.
 * We explicitly force minUsd=0 to avoid any server default threshold.
 */
export const getUnassignedPayments = async (): Promise<Payment[]> => {
  const { headers, params } = tcfg();
  const { data } = await api.get("/api/payments", {
    headers,
    params: { ...params, unassigned: 1, minUsd: 0, includeRep: 1 },
  });
  return Array.isArray(data) ? (data as Payment[]) : (data?.items ?? []);
};

/**
 * Fetch ALL payments via pagination so the client can compute per-rep totals.
 * Returns both assigned and unassigned payments; callers can filter as needed.
 *
 * Overloads:
 *   listAllPayments(1, 500)                -> start at page 1, pageSize 500
 *   listAllPayments({ pageSize: 500 })     -> pageSize 500
 *   listAllPayments({ since, until, ... }) -> time-bounded
 */
export function listAllPayments(
  pageStart?: number,
  pageSize?: number
): Promise<Payment[]>;
export function listAllPayments(opts?: {
  since?: Date | string;
  until?: Date | string;
  includeUnassigned?: boolean; // currently not used server-side; filter on client
  max?: number; // hard guard
  pageSize?: number; // default 250
}): Promise<Payment[]>;
export async function listAllPayments(arg1?: any, arg2?: any): Promise<Payment[]> {
  const { headers, params } = tcfg();

  // Defaults
  let pageStart = 1;
  let pageSize = 250;
  let max = 5000;
  let since: string | undefined;
  let until: string | undefined;

  // Argument normalization
  if (typeof arg1 === "number") {
    pageStart = arg1 || 1;
    if (typeof arg2 === "number" && arg2 > 0) pageSize = arg2;
  } else if (arg1 && typeof arg1 === "object") {
    if (typeof arg1.pageSize === "number" && arg1.pageSize > 0) {
      pageSize = arg1.pageSize;
    }
    if (typeof arg1.max === "number" && arg1.max > 0) {
      max = arg1.max;
    }
    if (arg1.since) {
      since = typeof arg1.since === "string" ? arg1.since : arg1.since.toISOString();
    }
    if (arg1.until) {
      until = typeof arg1.until === "string" ? arg1.until : arg1.until.toISOString();
    }
  }

  const q: Record<string, any> = {
    ...params,
    paged: 1,
    page: pageStart,
    pageSize,
    includeRep: 1, // ensure sales_rep_id is included
    minUsd: 0,     // fetch EVERYTHING, client filters later
  };
  if (since) q.since = since;
  if (until) q.until = until;

  const all: Payment[] = [];
  for (let page = pageStart; page < 9999; page++) {
    q.page = page;
    const { data } = await api.get("/api/payments", { headers, params: q });
    const items: Payment[] = Array.isArray(data) ? data : (data?.items ?? []);
    if (!items.length) break;

    all.push(...items);
    if (all.length >= max) break;
    if (items.length < pageSize) break;
  }
  return all;
}

// -----------------------------
// Assign a payment to a rep
// -----------------------------
export const assignPaymentRep = async (
  chargeId: string,
  repId: string,
  commissionPct?: number
): Promise<{ ok: true }> => {
  const { tenant, headers } = tcfg();
  const { data } = await api.post(
    "/api/payments",
    {
      action: "assign",
      chargeId,
      repId,
      commissionPct,
      clientId: tenant, // keep body + header in sync
    },
    { headers }
  );
  return data;
};

// -----------------------------
// Analytics (optional server endpoints we still expose)
// -----------------------------
export type Range = "mtd" | "qtd" | "ytd" | "last-30" | "this-month";

export const getCommissionByRep = async (
  range: Range = "mtd"
): Promise<CommissionRow[]> => {
  const { headers, params } = tcfg();
  const { data } = await api.get("/api/analytics/commission-by-rep", {
    headers,
    params: { ...params, range },
  });
  return Array.isArray(data) ? (data as CommissionRow[]) : [];
};

export const getOutstandingByCustomer = async (): Promise<OutstandingRow[]> => {
  const { headers, params } = tcfg();
  const { data } = await api.get("/api/analytics/outstanding-by-customer", {
    headers,
    params,
  });
  return Array.isArray(data) ? (data as OutstandingRow[]) : [];
};

export const getCustomersBreakdown = async (): Promise<CustomerSummary[]> => {
  const { headers, params } = tcfg();
  const { data } = await api.get("/api/analytics/customers", { headers, params });
  return Array.isArray(data) ? (data as CustomerSummary[]) : [];
};

// -----------------------------
// Customer ↔ Rep assignments
// -----------------------------
export type CustomerRepRow = {
  customerId: string;
  repId: string | null;
  repName?: string | null;
};

export const listCustomerReps = async (): Promise<CustomerRepRow[]> => {
  const { headers, params } = tcfg();
  const { data } = await api.get("/api/customer-reps", { headers, params });
  if (Array.isArray(data)) return data as CustomerRepRow[];
  if (data && Array.isArray(data.items)) return data.items as CustomerRepRow[];
  return [];
};

export const assignCustomerRep = async (
  customerId: string,
  repId: string | null
): Promise<{ ok: true; saved?: { customerId: string; repId: string }; removed?: string }> => {
  const { tenant, headers } = tcfg();
  const { data } = await api.post(
    "/api/customer-reps",
    { customerId, repId, tenantId: tenant, clientId: tenant },
    { headers }
  );
  return data;
};

export const unassignCustomerRep = (customerId: string) =>
  assignCustomerRep(customerId, null);

// -----------------------------
// Commission payouts
// -----------------------------
export const createCommissionPayout = async (
  repId: string,
  amountUsd: number,
  note?: string
): Promise<{ ok: true }> => {
  const { tenant, headers } = tcfg();
  const { data } = await api.post(
    "/api/commissions/payout",
    { repId, amountUsd, note, tenantId: tenant, clientId: tenant },
    { headers }
  );
  return data;
};