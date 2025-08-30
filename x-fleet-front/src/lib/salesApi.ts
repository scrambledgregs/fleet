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

// -----------------------------
// Payments (unassigned + commissionable)
// -----------------------------
export const getUnassignedPayments = async (): Promise<Payment[]> => {
  const { headers, params } = tcfg();
  const { data } = await api.get("/api/payments", {
    headers,
    params: { ...params, unassigned: 1, commissionable: 1 },
  });
  // Support both shapes from the backend
  return Array.isArray(data) ? (data as Payment[]) : (data?.items ?? []);
};

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
// Analytics
// -----------------------------
export type Range = "this-month" | "last-30";

export const getCommissionByRep = async (
  range: Range = "this-month"
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

export const unassignCustomerRep = (customerId: string) => assignCustomerRep(customerId, null);

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