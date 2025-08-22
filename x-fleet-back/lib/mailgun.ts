// lib/mailgun.ts
import axios from 'axios';
import { createHmac, timingSafeEqual } from 'node:crypto';

const MG_BASE   = (process.env.MAILGUN_BASE_URL ?? 'https://api.mailgun.net/v3').replace(/\/+$/,'');
const MG_DOMAIN = (process.env.MAILGUN_DOMAIN ?? '').trim();
const RAW_KEY   = (process.env.MAILGUN_API_KEY ?? '').trim();
// ✅ If someone puts the old-style `key-...`, strip it so Mailgun accepts it
const MG_KEY    = RAW_KEY.replace(/^key-/, '');
const MAIL_FROM = process.env.MAIL_FROM || `Fleet Proto <postmaster@${MG_DOMAIN}>`;

type SendArgs = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  // overrides for testing so we don’t depend on env:
  domain?: string;
  from?: string;
};

export async function sendEmail({ to, subject, text, html, replyTo, domain, from }: SendArgs) {
  const useDomain = (domain || MG_DOMAIN).trim();
  const useFrom   = from || MAIL_FROM;

  const url = `${MG_BASE}/${encodeURIComponent(useDomain)}/messages`;

  const body = new URLSearchParams();
  body.set('from', useFrom);
  body.set('to', to);
  body.set('subject', subject);
  if (text) body.set('text', text);
  if (html) body.set('html', html);
  if (replyTo) body.set('h:Reply-To', replyTo);

  const authHeader = 'Basic ' + Buffer.from(`api:${MG_KEY}`).toString('base64');

  const resp = await axios.post(url, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': authHeader,
    },
    timeout: 15000,
    validateStatus: s => s < 500,
  });

  if (resp.status >= 200 && resp.status < 300) return resp.data;

  // include domain/base in the error so we can see what the app used
  throw new Error(
    `Mailgun send failed: ${resp.status} ${resp.statusText} — ${JSON.stringify(resp.data)} @domain=${useDomain} base=${MG_BASE}`
  );
}

export function verifyWebhook(sig: { timestamp: string; token: string; signature: string }) {
  const key = process.env.MAILGUN_SIGNING_KEY!;
  const digestHex = createHmac('sha256', key).update(sig.timestamp + sig.token).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(digestHex, 'hex'), Buffer.from(sig.signature, 'hex'));
  } catch {
    return false;
  }
}

export function mapWebhook(body: any) {
  const evt = body['event-data'] || body;
  const event = evt.event;
  const providerMessageId =
    evt?.message?.headers?.['message-id'] || evt?.['Message-Id'];

  let status: 'sent' | 'delivered' | 'opened' | 'clicked' | 'failed' = 'sent';
  if (event === 'delivered') status = 'delivered';
  else if (event === 'opened') status = 'opened';
  else if (event === 'clicked') status = 'clicked';
  else if (['failed', 'rejected', 'bounced', 'complained'].includes(event)) status = 'failed';

  return {
    status,
    providerMessageId,
    meta: {
      event,
      timestamp: evt.timestamp,
      reason: evt?.delivery_status?.message || evt?.reason || null,
      code: evt?.delivery_status?.code || null,
    },
  };
}