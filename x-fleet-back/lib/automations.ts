// lib/automations.ts
// Minimal, in-memory automations engine:
// - Triggers listen for domain events (e.g., "contact.disposition.created", "appointment.booked")
// - Filters are simple key=value matches against event.payload (no DSL, no graphs)
// - Actions: webhook POST, SMS, Email
// Works in TS or JS projects (server.js can import this .ts because allowJs is on)

import axios from 'axios';
import { sendSMS } from './twilio.js';
import { sendEmail } from './mailgun';
import { BaseEvent } from './events'

// ---------- Types (lightweight) ----------
export type EventEnvelope = {
  id: string;
  name: string;              // e.g., 'contact.disposition.created'
  clientId?: string | null;  // tenant
  payload: Record<string, any>;
  meta?: Record<string, any>;
  at: string;                // ISO timestamp
};

type Trigger = {
  /** Event name to listen for. Supports exact match or suffix wildcard: "contact.*" */
  event: string;
  /** Optional key=value filters against event.payload (all must match) */
  filters?: Record<string, string | number | boolean>;
};

type WebhookAction = {
  kind: 'webhook';
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  /** Optional JSONata-like pick list later; for now we send full {event, clientId} */
  bodyTemplate?: Record<string, any>;
};

type SmsAction = {
  kind: 'sms';
  /** Phone number (E.164) or a path into payload like "$.phone" */
  to: string;
  /** Message template; can reference payload fields via {payload.key} */
  text: string;
};

type EmailAction = {
  kind: 'email';
  to: string;            // literal email or {payload.email} pattern in future
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
};

type Action = WebhookAction | SmsAction | EmailAction;

export type Automation = {
  id: string;
  clientId: string;     // tenant
  name: string;         // short label
  enabled: boolean;
  trigger: Trigger;
  actions: Action[];
  createdAt: string;    // ISO
  updatedAt: string;    // ISO
};

// ---------- Store (in-memory) ----------
const store = new Map<string, Map<string, Automation>>(); // clientId -> (id -> automation)

function getBag(clientId: string) {
  if (!store.has(clientId)) store.set(clientId, new Map());
  return store.get(clientId)!;
}

const newId = (p = 'auto_') => p + Math.random().toString(36).slice(2);

// ---------- Utilities ----------
function matchesEventName(pattern: string, name: string) {
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return name === prefix || name.startsWith(prefix + '.');
  }
  return pattern === name;
}

function allFiltersMatch(filters: Trigger['filters'] | undefined, payload: any) {
  if (!filters) return true;
  return Object.entries(filters).every(([k, v]) => {
    const got = payload?.[k];
    return String(got) === String(v);
  });
}

function renderTemplate(input: string, ev: EventEnvelope) {
  // very small templating: {payload.xyz} and {event.name}
  return input
    .replace(/\{payload\.([a-zA-Z0-9_.$-]+)\}/g, (_m, path) => {
      const parts = String(path).split('.');
      let cur: any = ev.payload;
      for (const p of parts) cur = cur?.[p];
      return (cur ?? '').toString();
    })
    .replace(/\{event\.name\}/g, ev.name);
}

type AnyEventEnvelope = EventEnvelope | BaseEvent<any>;

function toEnvelope(ev: AnyEventEnvelope): EventEnvelope {
  return {
    id: ev.id,
    name: ev.name,
    clientId: (ev as any).clientId ?? null,
    payload: (ev as any).payload ?? {},
    meta: (ev as any).meta,
    at: (ev as any).at ?? (ev as any).ts ?? new Date().toISOString(),
  };
}

async function runAction(a: Action, ev: EventEnvelope) {
  if (a.kind === 'webhook') {
    const method = a.method || 'POST';
    const body =
      a.bodyTemplate
        ? JSON.parse(renderTemplate(JSON.stringify(a.bodyTemplate), ev))
        : { event: ev.name, clientId: ev.clientId ?? null, payload: ev.payload, meta: ev.meta ?? null };
    await axios.request({
      method,
      url: a.url,
      headers: { 'Content-Type': 'application/json', ...(a.headers || {}) },
      data: body,
      timeout: 20000,
    });
    return { ok: true };
  }

  if (a.kind === 'sms') {
    const to = renderTemplate(a.to, ev);
    const text = renderTemplate(a.text, ev);
    await sendSMS(to, text);
    return { ok: true };
  }

  if (a.kind === 'email') {
    const to = renderTemplate(a.to, ev);
    const subject = renderTemplate(a.subject, ev);
    const html = a.html ? renderTemplate(a.html, ev) : undefined;
    const text = a.text ? renderTemplate(a.text, ev) : undefined;
    await sendEmail({ to, subject, html, text, replyTo: a.replyTo });
    return { ok: true };
  }

  return { ok: false, error: 'unknown_action' };
}

// ---------- Public API ----------
export function listAutomations(clientId?: string) {
  if (clientId) {
    return Array.from(getBag(clientId).values());
  }
  // all clients
  const out: Automation[] = [];
  for (const bag of store.values()) out.push(...bag.values());
  return out;
}

export function createAutomation(input: Omit<Automation, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = newId();
  const now = new Date().toISOString();
  const row: Automation = { ...input, id, createdAt: now, updatedAt: now };
  getBag(input.clientId).set(id, row);
  return row;
}

export function updateAutomation(clientId: string, id: string, patch: Partial<Omit<Automation, 'id' | 'clientId'>>) {
  const bag = getBag(clientId);
  const cur = bag.get(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  bag.set(id, next);
  return next;
}

export function deleteAutomation(clientId: string, id: string) {
  return getBag(clientId).delete(id);
}

export async function dispatchEvent(ev: AnyEventEnvelope) {
  const env = toEnvelope(ev);

  const bag = env.clientId ? getBag(env.clientId) : null;
  const candidates: Automation[] = [];

  if (bag) {
    for (const a of bag.values()) {
      if (!a.enabled) continue;
      if (!matchesEventName(a.trigger.event, env.name)) continue;
      if (!allFiltersMatch(a.trigger.filters, env.payload)) continue;
      candidates.push(a);
    }
  }

  const results: any[] = [];
  for (const auto of candidates) {
    for (const action of auto.actions) {
      try {
        const r = await runAction(action, env);
        results.push({ automationId: auto.id, action: action.kind, ok: r.ok !== false, error: r.error || null });
      } catch (e: any) {
        results.push({ automationId: auto.id, action: action.kind, ok: false, error: e?.message || String(e) });
      }
    }
  }
  return { matched: candidates.length, results };
}

// ---------- Express router (CRUD + test) ----------
import express from 'express';

export function registerAutomationRoutes() {
  const router = express.Router();

  // List
  router.get('/automations', (req, res) => {
    const clientId = (req.query.clientId as string) || 'default';
    res.json({ ok: true, items: listAutomations(clientId) });
  });

  // Create
  router.post('/automations', (req, res) => {
    try {
      const b = req.body || {};
      if (!b.clientId || !b.name || !b.trigger || !Array.isArray(b.actions)) {
        return res.status(400).json({ ok: false, error: 'clientId, name, trigger, actions required' });
      }
      const row = createAutomation({
        clientId: String(b.clientId),
        name: String(b.name),
        enabled: b.enabled !== false,
        trigger: b.trigger,
        actions: b.actions,
      });
      res.status(201).json({ ok: true, automation: row });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'create_failed' });
    }
  });

  // Update
  router.put('/automations/:id', (req, res) => {
    const clientId = (req.body?.clientId || req.query.clientId || 'default') as string;
    const id = req.params.id;
    const row = updateAutomation(clientId, id, req.body || {});
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, automation: row });
  });

  // Delete
  router.delete('/automations/:id', (req, res) => {
    const clientId = (req.query.clientId || 'default') as string;
    const ok = deleteAutomation(clientId, req.params.id);
    if (!ok) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, removed: req.params.id });
  });

  // Fire a test event against matching automations
  router.post('/automations/test', async (req, res) => {
    try {
      const ev = req.body as EventEnvelope;
      if (!ev?.name || !ev?.payload) {
        return res.status(400).json({ ok: false, error: 'event name and payload required' });
      }
      const out = await dispatchEvent(ev);
      res.json({ ok: true, ...out });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'test_failed' });
    }
  });

  return router;
}