// x-fleet-back/routes/invoices.ts
import express from 'express';
import crypto from 'crypto';
import type { Server as SocketIOServer } from 'socket.io';

import {
  createInvoice,
  listInvoices,
  getInvoice,
  updateInvoice,
  recordPayment,
  normalizeInvoiceItems,
  type InvoiceItem,
} from '../lib/repos/invoices';

import { createEvent, recordAndEmit } from '../lib/events';
import { dispatchEvent } from '../lib/automations';

// tiny helper to number-ify safely
const n = (v: any, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

// --- accept-intent helpers (signed token, stateless) ---
const SECRET = process.env.ACCEPT_SECRET || 'dev-accept-secret';
const round2 = (x: number) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

type AcceptIntent = {
  v: 1;
  tenantId: string;
  contactId: string;
  depositPct: number; // 0..100
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    unit?: string;
    notes?: string;
  }>;
  taxRate: number; // % (e.g., 8.875)
  notes?: string;
  customer?: { name?: string; email?: string; phone?: string; address?: string };
  createdAt: string; // ISO
  exp: number;       // ms epoch
};

function b64url(s: Buffer | string) { return Buffer.isBuffer(s) ? s.toString('base64url') : Buffer.from(s).toString('base64url'); }

function signIntent(data: AcceptIntent): string {
  const payload = b64url(JSON.stringify(data));
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyIntentToken(token: string): AcceptIntent | null {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!json?.exp || Date.now() > Number(json.exp)) return null;
  return json as AcceptIntent;
}

export default function createInvoicesRouter(io: SocketIOServer) {
  const router = express.Router();

  // Simple room emitter to scope events per-tenant
  const ioForTenant = (tenantId?: string) => {
    const room = String(tenantId || 'default').toLowerCase();
    return { emit: (event: string, payload: any) => io.to(room).emit(event, payload) };
  };

  // --- Create invoice ---
  // POST /api/invoices
  // body: { clientId?, contactId, items: [{ description, quantity, unitPrice, sku?, unit?, notes? }], taxRate?, currency?, notes?, dueAt?, meta?, issuedAt?, status? }
  router.post('/invoices', (req, res) => {
    try {
      const clientId = (req.body?.clientId || req.tenantId || 'default').trim();
      const contactId = String(req.body?.contactId || '').trim();
      const items = Array.isArray(req.body?.items) ? normalizeInvoiceItems(req.body.items) : [];
      if (!contactId || !items.length) {
        return res.status(400).json({ ok: false, error: 'contactId and items[] are required' });
      }

      const inv = createInvoice(clientId, {
        contactId,
        items,
        taxRate: n(req.body?.taxRate, 0),
        currency: req.body?.currency || 'USD',
        notes: req.body?.notes,
        meta: req.body?.meta || {},
        issuedAt: req.body?.issuedAt,
        dueAt: req.body?.dueAt,
        status: req.body?.status || 'open',
      });

      return res.status(201).json({ ok: true, invoice: inv });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message || 'create_failed' });
    }
  });

  // --- List invoices ---
  // GET /api/invoices?clientId=...
  router.get('/invoices', (req, res) => {
    try {
      const clientId = (String(req.query.clientId || req.tenantId || 'default')).trim();
      const items = listInvoices(clientId);
      res.json({ ok: true, items });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'list_failed' });
    }
  });

  // --- Get one ---
  // GET /api/invoices/:id
  router.get('/invoices/:id', (req, res) => {
    try {
      const clientId = (req.query.clientId as string) || (req.tenantId as string) || 'default';
      const inv = getInvoice(clientId, req.params.id);
      if (!inv) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, invoice: inv });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'get_failed' });
    }
  });

  // --- Update (items/tax/etc) ---
  // PATCH /api/invoices/:id
  router.patch('/invoices/:id', (req, res) => {
    try {
      const clientId = (req.body?.clientId || req.query?.clientId || req.tenantId || 'default').trim();
      const patch = { ...req.body };
      // Only allow safe fields; totals are recomputed in repo
      const allowed = ['items', 'taxRate', 'currency', 'notes', 'meta', 'status', 'dueAt', 'issuedAt'] as const;
      const clean: any = {};
      for (const k of allowed) if (k in patch) clean[k] = patch[k];
      const inv = updateInvoice(clientId, req.params.id, clean);
      if (!inv) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, invoice: inv });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'update_failed' });
    }
  });

  // --- Record a payment (confetti trigger if now fully paid) ---
  // POST /api/invoices/:id/pay
  // body: { clientId?, amount, method?, externalId?, at?, memo? }
  router.post('/invoices/:id/pay', async (req, res) => {
    try {
      const clientId = (req.body?.clientId || req.query?.clientId || req.tenantId || 'default').trim();
      const amount = n(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ ok: false, error: 'amount > 0 required' });
      }

      const inv = recordPayment(clientId, req.params.id, {
        amount,
        method: req.body?.method,
        externalId: req.body?.externalId,
        at: req.body?.at,
        memo: req.body?.memo,
      });

      if (!inv) return res.status(404).json({ ok: false, error: 'not_found' });

      // Emit socket events
      const tenantId = (req.tenantId as string) || clientId || 'default';

      // Always notify invoice updated
      io.to(String(tenantId).toLowerCase()).emit('invoice:updated', {
        id: inv.id,
        status: inv.status,
        balance: inv.balance,
        total: inv.total,
        contactId: inv.contactId,
        at: new Date().toISOString(),
      });

      // If fully paid -> trigger confetti + domain event
      if (inv.status === 'paid') {
        io.to(String(tenantId).toLowerCase()).emit('invoice:paid', {
          id: inv.id,
          total: inv.total,
          contactId: inv.contactId,
          at: new Date().toISOString(),
        });

        try {
          const ev = createEvent(
            'invoice.paid',
            tenantId,
            { invoiceId: inv.id, total: inv.total, contactId: inv.contactId },
            { source: 'api', idempotencyKey: `invoice:${inv.id}:paid` }
          );
          recordAndEmit(ioForTenant(tenantId), ev);
          await dispatchEvent(ev);
        } catch (e) {
          // soft-fail; logging only
          console.warn('[invoice.paid] event dispatch warning:', (e as any)?.message || e);
        }
      }

      res.json({ ok: true, invoice: inv });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'pay_failed' });
    }
  });

  // ================== CUSTOMER ACCEPT FLOW ==================

  // POST /api/estimates/prepare
  // body: { contactId, items[], taxRate(%), notes?, customer?, depositPct? (default 30) }
  router.post('/estimates/prepare', (req, res) => {
    try {
      const tenantId = (req.tenantId as string) || 'default';
      const contactId = String(req.body?.contactId || '').trim() || 'unknown';
      const depositPct = Math.max(1, Math.min(100, Number(req.body?.depositPct ?? 30)));
      const items = normalizeInvoiceItems(Array.isArray(req.body?.items) ? req.body.items : []);
      const taxRatePct = Number(req.body?.taxRate ?? 0); // estimator sends % (e.g., 8.875)
      const notes = req.body?.notes;
      const customer = req.body?.customer || {};

      // Simple totals (mirror estimator)
      const subtotal = round2(items.reduce((s, it) => s + (Number(it.quantity)||0)*(Number(it.unitPrice)||0), 0));
      const tax = round2(subtotal * (Math.max(0, taxRatePct) / 100));
      const total = round2(subtotal + tax);
      const depositAmount = round2(total * (depositPct / 100));

      const intent: AcceptIntent = {
        v: 1,
        tenantId,
        contactId,
        depositPct,
        items: items.map(it => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, unit: it.unit, notes: it.notes })),
        taxRate: taxRatePct,
        notes,
        customer,
        createdAt: new Date().toISOString(),
        exp: Date.now() + 30 * 24 * 3600 * 1000, // 30 days
      };
      const token = signIntent(intent);

      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
      const host = req.get('host');
      const url = `${proto}://${host}/p/accept/${token}`;

      // (optional) emit "estimate.intent.created"
      try {
        const ev = createEvent(
          'estimate.intent.created',
          tenantId,
          { contactId, total, depositPct, depositAmount },
          { source: 'api' }
        );
        recordAndEmit(ioForTenant(tenantId), ev);
        dispatchEvent(ev).catch(() => {});
      } catch {}

      res.json({ ok: true, token, url, depositAmount, total });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'prepare_failed' });
    }
  });

  // GET /api/estimates/preview/:token
  router.get('/estimates/preview/:token', (req, res) => {
    const intent = verifyIntentToken(req.params.token);
    if (!intent) return res.status(404).json({ ok: false, error: 'invalid_or_expired' });
    res.json({
      ok: true,
      contactId: intent.contactId,
      customer: intent.customer || {},
      items: intent.items,
      taxRate: intent.taxRate,
      notes: intent.notes,
      depositPct: intent.depositPct,
      createdAt: intent.createdAt,
      expiresAt: new Date(intent.exp).toISOString(),
    });
  });

  // POST /api/estimates/accept/:token
  // body: { signerName?: string, signerEmail?: string }
  router.post('/estimates/accept/:token', async (req, res) => {
    try {
      const intent = verifyIntentToken(req.params.token);
      if (!intent) return res.status(404).json({ ok: false, error: 'invalid_or_expired' });

      const { tenantId, contactId, depositPct } = intent;

      // Recompute total for safety
      const subtotal = round2(intent.items.reduce((s, it) => s + (Number(it.quantity)||0)*(Number(it.unitPrice)||0), 0));
      const tax = round2(subtotal * (Math.max(0, intent.taxRate) / 100));
      const total = round2(subtotal + tax);
      const depositAmount = round2(total * (Math.max(1, Math.min(100, depositPct)) / 100));

      // Create the DEPOSIT invoice (single line item)
      const inv = createInvoice(tenantId, {
        contactId,
        items: [
          { description: `Deposit (${Math.round(depositPct)}%)`, quantity: 1, unitPrice: depositAmount },
        ],
        notes: `Auto-created from accepted estimate. Signer: ${req.body?.signerName || 'unknown'}.`,
        status: 'open',
      });

      // Emit events
      try {
        const ev1 = createEvent(
          'estimate.accepted',
          tenantId,
          { contactId, total, depositPct, depositAmount, invoiceId: inv.id, signer: req.body?.signerName },
          { source: 'public' }
        );
        recordAndEmit(ioForTenant(tenantId), ev1);
        await dispatchEvent(ev1);
      } catch (e) {
        console.warn('[estimate.accepted] event dispatch warning:', (e as any)?.message || e);
      }

      res.status(201).json({ ok: true, invoice: inv });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'accept_failed' });
    }
  });

  return router;
}