// src/lib/salesApi.ts
import { api } from "./api";
import type {
  Rep,
  Payment,
  CommissionRow,
  OutstandingRow,
  CustomerSummary,
} from "../types/sales";

// Reps
export const getReps = (): Promise<Rep[]> => api(`/api/reps`);

// Payments (unassigned only)
export const getUnassignedPayments = (): Promise<Payment[]> =>
  api(`/api/payments?unassigned=1`);

// Assign a payment to a rep
export const assignPaymentRep = (
  chargeId: string,
  repId: string,
  commissionPct?: number
): Promise<{ ok: true }> =>
  api(`/api/payments`, {
    method: "POST",
    body: JSON.stringify({
      action: "assign",
      chargeId,
      repId,
      commissionPct,
    }),
  });

// Analytics
export type Range = "this-month" | "last-30";

export const getCommissionByRep = (
  range: Range = "this-month"
): Promise<CommissionRow[]> =>
  api(`/api/analytics/commission-by-rep?range=${encodeURIComponent(range)}`);

export const getOutstandingByCustomer = (): Promise<OutstandingRow[]> =>
  api(`/api/analytics/outstanding-by-customer`);

export const getCustomersBreakdown = (): Promise<CustomerSummary[]> =>
  api(`/api/analytics/customers`);

// -----------------------------
// Customer ↔ Rep assignments
// -----------------------------
export type CustomerRepRow = {
  customerId: string;
  repId: string | null;
  repName?: string | null;
};

// List all current assignments for the tenant
export const listCustomerReps = async (): Promise<CustomerRepRow[]> => {
  const r = await api(`/api/customer-reps`);
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.items)) return r.items;
  return [];
};

// Set or unset an assignment (pass null to unassign)
export const assignCustomerRep = (
  customerId: string,
  repId: string | null
): Promise<{ ok: true; saved?: { customerId: string; repId: string }; removed?: string }> =>
  api(`/api/customer-reps`, {
    method: "POST",
    body: JSON.stringify({ customerId, repId }),
  });

// Convenience: unassign wrapper
export const unassignCustomerRep = (customerId: string) =>
  assignCustomerRep(customerId, null);

// Trigger a commission payout for a rep (server will record/send actual payment)
export const createCommissionPayout = (
  repId: string,
  amountUsd: number,
  note?: string
): Promise<{ ok: true }> =>
  api(`/api/commissions/payout`, {
    method: "POST",
    body: JSON.stringify({ repId, amountUsd, note }),
  });