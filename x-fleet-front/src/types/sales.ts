// src/types/sales.ts

export type Rep = {
  id: string;
  name: string;
  defaultCommissionPct: number; // e.g., 0.10 for 10%
};

export type Payment = {
  stripe_charge_id: string;
  paid_at: string;              // ISO timestamp
  amount: number;               // cents
  net?: number | null;          // cents (optional)
  customer_name?: string | null;
};

export type CommissionRow = {
  name: string;
  commission_usd: number;       // already converted to dollars
  rep_id?: string;  
};

export type OutstandingRow = {
  name: string;
  outstanding_usd: number;      // already converted to dollars
};

export type CustomerSummary = {
  id: string;
  name: string;
  created_at: string | null;
  total_paid_cents: number;
  last_payment_at?: string | null;
  payments: number;
  // NEW: manual assignment (optional fields)
  assigned_rep_id?: string | null;
  assigned_rep_name?: string | null;
};