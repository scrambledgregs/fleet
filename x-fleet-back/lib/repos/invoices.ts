// x-fleet-back/lib/repos/invoices.ts
// Minimal multi-tenant, in-memory invoice repository for the prototype.
// Computes totals, tracks payments, and exposes CRUD-ish helpers.

import { normalizeTenantId, newId } from './memory';

export type Money = number; // USD for now

export type InvoiceItem = {
  id?: string;
  description: string;       // normalized from name/title/description
  quantity: number;          // normalized from quantity/qty
  unitPrice: number;         // normalized from unitPrice/price/rate
  sku?: string;
  unit?: string;             // optional (from estimator)
  notes?: string;            // optional (from estimator)
};

export type Payment = {
  id: string;
  amount: Money;
  method?: 'card' | 'ach' | 'cash' | 'check' | 'other';
  externalId?: string;
  at: string;   // ISO timestamp
  memo?: string;
};

export type InvoiceStatus = 'draft' | 'open' | 'partial' | 'paid' | 'void';

export interface Invoice {
  id: string;
  clientId: string;         // tenant id
  contactId: string;
  items: InvoiceItem[];
  taxRate: number;          // 0..1 (we'll normalize if 0..100 is provided)
  currency: string;         // 'USD'
  notes?: string;
  meta?: Record<string, any>;
  issuedAt: string;         // ISO
  dueAt?: string;           // ISO
  status: InvoiceStatus;

  // Calculated fields
  subtotal: Money;
  tax: Money;
  total: Money;

  // Payments
  payments: Payment[];
  balance: Money;
}

// --- Internal store: tenant -> (invoiceId -> invoice)
const invoicesByClient = new Map<string, Map<string, Invoice>>();

function bag(clientId?: string) {
  const t = normalizeTenantId(clientId);
  if (!invoicesByClient.has(t)) invoicesByClient.set(t, new Map());
  return invoicesByClient.get(t)!;
}

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function normalizeTaxRate(r: unknown): number {
  const n = Number(r ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Accept either 0..1 or 0..100 (Estimator uses e.g. 8.875)
  return n > 1 ? round2(n / 100) : n;
}

// Accept flexible item shapes (Estimator/etc.) and normalize
export function normalizeInvoiceItem(raw: any): InvoiceItem {
  const description =
    String(raw?.description ?? raw?.name ?? raw?.title ?? 'Item').slice(0, 200);

  const quantity = Number(raw?.quantity ?? raw?.qty ?? 1);
  const unitPrice = Number(raw?.unitPrice ?? raw?.price ?? raw?.rate ?? 0);

  return {
    id: raw?.id || newId('ln_'),
    description,
    quantity: Number.isFinite(quantity) ? quantity : 1,
    unitPrice: round2(Number.isFinite(unitPrice) ? unitPrice : 0),
    sku: raw?.sku ? String(raw.sku) : undefined,
    unit: raw?.unit ? String(raw.unit).slice(0, 24) : undefined,
    notes: raw?.notes ? String(raw.notes).slice(0, 500) : undefined,
  };
}

export function normalizeInvoiceItems(list: any[]): InvoiceItem[] {
  return Array.isArray(list) ? list.map(normalizeInvoiceItem) : [];
}

function computeTotals(items: InvoiceItem[], taxRateInput: number) {
  const taxRate = normalizeTaxRate(taxRateInput);
  const subtotal = round2(
    (items || []).reduce(
      (s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0),
      0
    )
  );
  const tax = round2(subtotal * taxRate);
  const total = round2(subtotal + tax);
  return { subtotal, tax, total };
}

// Create a new invoice (defaults to status 'open')
export function createInvoice(
  clientId: string,
  args: {
    contactId: string;
    items: InvoiceItem[] | any[]; // accepts flexible shapes
    taxRate?: number;
    currency?: string;
    notes?: string;
    meta?: Record<string, any>;
    issuedAt?: string;
    dueAt?: string;
    status?: InvoiceStatus; // default 'open'
  }
): Invoice {
  const t = normalizeTenantId(clientId);
  const b = bag(t);
  const id = newId('inv_');

  const items = normalizeInvoiceItems(args.items || []);
  const taxRate = normalizeTaxRate(args.taxRate);

  const { subtotal, tax, total } = computeTotals(items, taxRate);

  const inv: Invoice = {
    id,
    clientId: t,
    contactId: String(args.contactId),
    items,
    taxRate,
    currency: args.currency || 'USD',
    notes: args.notes,
    meta: args.meta || {},
    issuedAt: args.issuedAt || new Date().toISOString(),
    dueAt: args.dueAt,
    status: args.status || 'open',
    subtotal,
    tax,
    total,
    payments: [],
    balance: total,
  };

  b.set(id, inv);
  return inv;
}

export function getInvoice(clientId: string, invoiceId: string): Invoice | undefined {
  return bag(clientId).get(invoiceId);
}

export function listInvoices(clientId: string): Invoice[] {
  return Array.from(bag(clientId).values()).sort(
    (a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime()
  );
}

// Patch selected fields; recomputes totals and status based on payments/balance
export function updateInvoice(
  clientId: string,
  invoiceId: string,
  patch: Partial<
    Pick<
      Invoice,
      'items' | 'taxRate' | 'currency' | 'notes' | 'meta' | 'status' | 'dueAt' | 'issuedAt'
    >
  >
): Invoice | undefined {
  const b = bag(clientId);
  const cur = b.get(invoiceId);
  if (!cur) return undefined;

  let items = cur.items;
  let taxRate = cur.taxRate;

  if (patch.items) items = normalizeInvoiceItems(patch.items as any[]);
  if (typeof patch.taxRate === 'number') taxRate = normalizeTaxRate(patch.taxRate);

  const totals = computeTotals(items, taxRate);
  const paid = round2((cur.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0));
  const balance = round2(totals.total - paid);

  const next: Invoice = {
    ...cur,
    ...patch,
    items,
    taxRate,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    balance,
  };

  // Auto-reconcile status unless explicitly overridden
  if (!patch.status) {
    next.status = balance <= 0 ? 'paid' : paid > 0 ? 'partial' : next.status || 'open';
  }

  b.set(invoiceId, next);
  return next;
}

// Record a payment and reconcile status/balance
export function recordPayment(
  clientId: string,
  invoiceId: string,
  args: { amount: Money; method?: Payment['method']; externalId?: string; at?: string; memo?: string }
): Invoice | undefined {
  const b = bag(clientId);
  const cur = b.get(invoiceId);
  if (!cur) return undefined;

  const pay: Payment = {
    id: newId('pay_'),
    amount: round2(Number(args.amount || 0)),
    method: args.method,
    externalId: args.externalId,
    at: args.at || new Date().toISOString(),
    memo: args.memo,
  };

  const payments = [...(cur.payments || []), pay];
  const paid = round2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
  const balance = round2(cur.total - paid);

  const next: Invoice = {
    ...cur,
    payments,
    balance,
    status: balance <= 0 ? 'paid' : 'partial',
  };

  b.set(invoiceId, next);
  return next;
}

export function voidInvoice(clientId: string, invoiceId: string): Invoice | undefined {
  const b = bag(clientId);
  const cur = b.get(invoiceId);
  if (!cur) return undefined;
  const next = { ...cur, status: 'void' as InvoiceStatus };
  b.set(invoiceId, next);
  return next;
}

// Dev/Test helper
export function __clearInvoices(clientId?: string) {
  const t = normalizeTenantId(clientId);
  invoicesByClient.set(t, new Map());
}