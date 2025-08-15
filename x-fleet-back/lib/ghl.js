// lib/ghl.js
import axios from 'axios';

/**
 * Modes:
 * - API key (Subaccount/Location): use v1 base (rest.gohighlevel.com) — NO Version header
 * - OAuth access token (LeadConnector): use services base + Version header
 *
 * Toggle with:
 *   GHL_USE_SERVICES=true            // only if you're using an OAuth token
 * Optional:
 *   GHL_API_BASE=<override base>     // rarely needed
 *   GHL_API_VERSION=2021-07-28       // only relevant in services mode
 */

const useServices = process.env.GHL_USE_SERVICES === 'true';

// Primary client (auto-picks base/headers by mode)
const GHL_PRIMARY = axios.create({
  baseURL:
    process.env.GHL_API_BASE ||
    (useServices ? 'https://services.leadconnectorhq.com' : 'https://rest.gohighlevel.com/v1'),
  headers: {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(useServices ? { Version: process.env.GHL_API_VERSION || '2021-07-28' } : {}),
  },
  timeout: 15000,
});

// Fallback v1 client (used when services returns 401 Invalid JWT with an API key)
const GHL_V1 = axios.create({
  baseURL: 'https://rest.gohighlevel.com/v1',
  headers: {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

// -----------------------------
// Contact helpers
// -----------------------------

function toContactAddressString(a = {}) {
  if (typeof a === 'string') return a;
  const parts = [
    a.fullAddress || a.full_address,
    [a.address1 || a.address, a.city, a.state, a.postalCode || a.postal_code || a.zip]
      .filter(Boolean)
      .join(', '),
  ].filter(Boolean);
  return parts[0] || '';
}

// Normalize GHL -> UI shape
export function normalizeContact(raw = {}, fallbacks = {}) {
  const first = raw.firstName || raw.first_name || fallbacks.firstName || '';
  const last  = raw.lastName  || raw.last_name  || fallbacks.lastName  || '';
  const name  = raw.name || [first, last].filter(Boolean).join(' ').trim() || fallbacks.name || '';

  const emails = Array.from(
    new Set([].concat(raw.email || [], raw.emails || [], fallbacks.email || [], fallbacks.emails || []).filter(Boolean))
  );

  const phones = Array.from(
    new Set([].concat(raw.phone || [], raw.phones || [], fallbacks.phone || [], fallbacks.phones || []).filter(Boolean))
  );

  const addrObj = {
    fullAddress: raw.fullAddress || raw.full_address,
    address1:    raw.address1 || raw.address,
    city:        raw.city,
    state:       raw.state,
    postalCode:  raw.postalCode || raw.postal_code || raw.zip,
  };

  return {
    id: raw.id || fallbacks.id || null,
    name,
    firstName: first || undefined,
    lastName:  last  || undefined,
    company: raw.company || raw.companyName || fallbacks.company || undefined,
    emails,
    phones,
    address: toContactAddressString(addrObj), // CONTACT profile address (job/service address is separate)
    tags: raw.tags || fallbacks.tags || [],
    custom: fallbacks.custom || {},
    pipeline: fallbacks.pipeline || null,
  };
}

async function getContactById(client, id) {
  const { data } = await client.get(`/contacts/${encodeURIComponent(id)}`);
  return data?.contact || data?.data || data;
}

export async function getContact(contactId, { email, phone } = {}) {
  // 1) Try primary client first
  try {
    if (contactId) {
      const payload = await getContactById(GHL_PRIMARY, contactId);
      return normalizeContact(payload, { id: contactId, email, phone });
    }
  } catch (e) {
    const status = e?.response?.status;
    console.warn('[GHL] contacts/{id} primary failed:', status, e?.message);

    // If we're in services mode but actually using an API key, 401 Invalid JWT → fall back to v1
    if (useServices && status === 401 && contactId) {
      try {
        const payload = await getContactById(GHL_V1, contactId);
        return normalizeContact(payload, { id: contactId, email, phone });
      } catch (e2) {
        console.warn('[GHL] v1 fallback failed:', e2?.response?.status, e2?.message);
      }
    }
  }

  // 2) Search by email/phone (works on v1; many tenants also support on services)
  // Try primary first; if it errors, try v1.
  if (email) {
    try {
      const { data } = await GHL_PRIMARY.get(`/contacts/search?email=${encodeURIComponent(email)}`);
      const p = data?.contacts?.[0] || data?.data?.[0] || data;
      if (p) return normalizeContact(p, { email, phone });
    } catch (e) {
      try {
        const { data } = await GHL_V1.get(`/contacts/search?email=${encodeURIComponent(email)}`);
        const p = data?.contacts?.[0] || data?.data?.[0] || data;
        if (p) return normalizeContact(p, { email, phone });
      } catch {}
    }
  }

  if (phone) {
    try {
      const { data } = await GHL_PRIMARY.get(`/contacts/search?phone=${encodeURIComponent(phone)}`);
      const p = data?.contacts?.[0] || data?.data?.[0] || data;
      if (p) return normalizeContact(p, { email, phone });
    } catch (e) {
      try {
        const { data } = await GHL_V1.get(`/contacts/search?phone=${encodeURIComponent(phone)}`);
        const p = data?.contacts?.[0] || data?.data?.[0] || data;
        if (p) return normalizeContact(p, { email, phone });
      } catch {}
    }
  }

  // 3) Minimal fallback
  return normalizeContact({}, { id: contactId || null, email, phone });
}

// -----------------------------
// Appointment updates (stubs)
// -----------------------------
export async function updateAppointmentOwner(appointmentId, repUserId) { return { ok: true }; }
export async function rescheduleAppointment(appointmentId, startISO, endISO) { return { ok: true }; }
export async function appendAppointmentNotes(appointmentId, text) { return { ok: true }; }