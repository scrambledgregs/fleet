// lib/ghl.js
import axios from 'axios';

/* -----------------------------
   Calendar IDs (hard-coded RR)
------------------------------*/
export const ROUND_ROBIN_CALENDAR_ID = 'WHNbgItyx80Dn4w8nut1';

/* -----------------------------------------
   Axios clients (v1 vs services auto-pick)
------------------------------------------*/
const useServices = process.env.GHL_USE_SERVICES === 'true';

export const GHL_PRIMARY = axios.create({
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

const GHL_V1 = axios.create({
  baseURL: 'https://rest.gohighlevel.com/v1',
  headers: {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

/* ----------------------------------------------------
   Time helper: UTC ISO -> "YYYY-MM-DDTHH:mm:ss-04:00"
   (DST-aware for a given IANA timezone)
-----------------------------------------------------*/
function toISOWithTZOffset(utcISO, timeZone = 'America/New_York') {
  const d = new Date(utcISO);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  const y = +parts.year, m = +parts.month, day = +parts.day;
  const hh = +parts.hour, mm = +parts.minute, ss = +parts.second;

  // Offset detection
  const wallAsUTC = Date.UTC(y, m - 1, day, hh, mm, ss);
  const offsetMs = wallAsUTC - d.getTime();
  const sign = offsetMs >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMs);
  const offH = String(Math.floor(abs / 3_600_000)).padStart(2, '0');
  const offM = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, '0');

  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}T` +
         `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` +
         `${sign}${offH}:${offM}`;
}

/* -----------------------------
   Contact helpers / normalizer
------------------------------*/
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

export async function createContact({ firstName, lastName = '', email = '', phone }) {
  try {
    const url = `https://rest.gohighlevel.com/v1/contacts/`;
    const payload = { firstName, lastName, email: email || '', phone };
    const { data } = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, 'Content-Type': 'application/json' },
    });
    return data?.contact ? data.contact : data; // ensure object with .id
  } catch (err) {
    console.error('[GHL createContact error]', err?.response?.data || err.message);
    throw err;
  }
}

export function normalizeContact(raw = {}, fallbacks = {}) {
  const first = raw.firstName || raw.first_name || fallbacks.firstName || '';
  const last = raw.lastName || raw.last_name || fallbacks.lastName || '';
  const name = raw.name || [first, last].filter(Boolean).join(' ').trim() || fallbacks.name || '';

  const emails = Array.from(
    new Set(
      []
        .concat(raw.email || [], raw.emails || [], fallbacks.email || [], fallbacks.emails || [])
        .filter(Boolean),
    ),
  );

  const phones = Array.from(
    new Set(
      []
        .concat(raw.phone || [], raw.phones || [], fallbacks.phone || [], fallbacks.phones || [])
        .filter(Boolean),
    ),
  );

  const addrObj = {
    fullAddress: raw.fullAddress || raw.full_address,
    address1: raw.address1 || raw.address,
    city: raw.city,
    state: raw.state,
    postalCode: raw.postalCode || raw.postal_code || raw.zip,
  };

  return {
    id: raw.id || fallbacks.id || null,
    name,
    firstName: first || undefined,
    lastName: last || undefined,
    company: raw.company || raw.companyName || fallbacks.company || undefined,
    emails,
    phones,
    address: toContactAddressString(addrObj),
    tags: raw.tags || fallbacks.tags || [],
    custom: fallbacks.custom || {},
    pipeline: fallbacks.pipeline || null,
  };
}

async function getContactById(client, id) {
  const { data } = await client.get(`/contacts/${encodeURIComponent(id)}`);
  return data?.contact || data?.data || data;
}

export async function getContact(contactId, searchParams = {}) {
  const { email, phone } = searchParams || {};
  // 1) Try by ID on primary
  try {
    if (contactId) {
      const payload = await getContactById(GHL_PRIMARY, contactId);
      return normalizeContact(payload, { id: contactId, email, phone });
    }
  } catch (e) {
    const status = e?.response?.status;
    console.warn('[GHL] contacts/{id} primary failed:', status, e?.message);
    // If misconfigured services+API key → fallback to v1
    if (useServices && status === 401 && contactId) {
      try {
        const payload = await getContactById(GHL_V1, contactId);
        return normalizeContact(payload, { id: contactId, email, phone });
      } catch (e2) {
        console.warn('[GHL] v1 fallback failed:', e2?.response?.status, e2?.message);
      }
    }
  }

  // 2) Search by email
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

  // 3) Search by phone
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

  // 4) Minimal fallback
  return normalizeContact({}, { id: contactId || null, email, phone });
}

/* -----------------------------
   Custom field updates
------------------------------*/
export async function updateContactCustomFields(contactId, kv = {}) {
  if (!contactId) throw new Error('contactId required');
  const pairs = Object.entries(kv).map(([id, value]) => ({ id, value }));

  try {
    await GHL_PRIMARY.put(`/contacts/${encodeURIComponent(contactId)}`, { customFields: pairs });
    return { ok: true };
  } catch (e) {
    const status = e?.response?.status;
    const msg = e?.response?.data || e?.message;
    if (useServices && status === 401) {
      try {
        await GHL_V1.put(`/contacts/${encodeURIComponent(contactId)}`, { customFields: pairs });
        return { ok: true, via: 'v1-fallback' };
      } catch (e2) {
        throw new Error(`[GHL v1 fallback] ${e2?.response?.status || ''} ${e2?.message || e2}`);
      }
    }
    throw new Error(`[GHL primary] ${status || ''} ${msg}`);
  }
}

/* -----------------------------
   Appointment updates (stubs)
------------------------------*/
export async function updateAppointmentOwner(_appointmentId, _repUserId) { return { ok: true }; }
export async function rescheduleAppointment(_appointmentId, _startISO, _endISO) { return { ok: true }; }
export async function appendAppointmentNotes(_appointmentId, _text) { return { ok: true }; }

/* ------------------------------------------------
   Availability (v1): GET /calendars/{id}/availability
-------------------------------------------------*/
export async function getCalendarAvailability(calendarId, date /* YYYY-MM-DD */) {
  if (!calendarId) throw new Error('calendarId required');
  if (!date) throw new Error('date (YYYY-MM-DD) required');

  try {
    const { data } = await GHL_PRIMARY.get(
      `/calendars/${encodeURIComponent(calendarId)}/availability`,
      { params: { date } },
    );
    return data; // typically { availability: [ "2025-08-19T10:00:00-04:00", ... ] }
  } catch (e) {
    console.error('[availability error]', e?.response?.status, e?.response?.data || e.message);
    throw e;
  }
}

/* ----------------------------------------------------------
   Appointment creation (v1 round-robin, NOT personal calendar)
   Payload must include selectedSlot + selectedTimezone
-----------------------------------------------------------*/
export async function createAppointment({
  contactId,
  selectedSlot,        // "YYYY-MM-DDTHH:mm:ss-04:00" (ideally from availability API)
  selectedTimezone,    // "America/New_York"
  startTime,           // optional UTC fallback → converted to selectedSlot
  timezone = 'America/New_York',
}) {
  if (!contactId) throw new Error('Missing contactId');

  const calendarId = ROUND_ROBIN_CALENDAR_ID; // fixed RR calendar
  const slot = selectedSlot ?? toISOWithTZOffset(startTime, timezone);
  const tz = selectedTimezone ?? timezone;

  const payload = {
    calendarId,
    contactId,
    selectedSlot: slot,
    selectedTimezone: tz,
  };

  console.log('[DEBUG v1 rr payload]', payload);

  try {
    const { data } = await GHL_PRIMARY.post('/appointments/', payload);
    return data;
  } catch (e) {
    console.error('[createAppointment primary error]', e?.response?.status, e?.response?.data || e.message);
    throw e;
  }
}