// lib/ghl.js
import axios from 'axios';

/* ================================
   Base config (v2 Services API)
   ================================ */
const SERVICES_BASE = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
const ACCESS_TOKEN  = process.env.GHL_ACCESS_TOKEN || '';

export const GHL_PRIMARY = axios.create({
  baseURL: SERVICES_BASE,
  headers: {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    // Calendars/Events default version
    Version: process.env.GHL_API_VERSION || '2021-04-15',
  },
  timeout: 15000,
});
GHL_PRIMARY.interceptors.request.use(cfg => {
  cfg.headers = cfg.headers || {};
  cfg.headers.Authorization = `Bearer ${process.env.GHL_ACCESS_TOKEN}`;
  return cfg;
});


GHL_PRIMARY.interceptors.response.use(
  (res) => res,
  (err) => {
    const cfg = err.config || {};
    if (cfg.url && cfg.url.includes('/calendars/events/appointments')) {
      console.error('[GHL ERROR]', {
        status: err.response?.status,
        data: err.response?.data,
      });
    }
    return Promise.reject(err);
  }
);


/* ================================
   Utilities
   ================================ */
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

export function normalizeContact(raw = {}, fallbacks = {}) {
  const first = raw.firstName || raw.first_name || fallbacks.firstName || '';
  const last  = raw.lastName  || raw.last_name  || fallbacks.lastName  || '';
  const name  = raw.name || [first, last].filter(Boolean).join(' ').trim() || fallbacks.name || '';

  const emails = Array.from(new Set(
    []
      .concat(raw.email || [], raw.emails || [], fallbacks.email || [], fallbacks.emails || [])
      .filter(Boolean)
  ));
  const phones = Array.from(new Set(
    []
      .concat(raw.phone || [], raw.phones || [], fallbacks.phone || [], fallbacks.phones || [])
      .filter(Boolean)
  ));

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

/* ================================
   Contacts (v2, Services host)
   ================================ */

// Create a contact (Contacts endpoints use a different Version)
export async function createContact({ firstName, lastName = '', email = '', phone }) {
  const payload = { firstName, lastName, email: email || '', phone };
  const { data } = await GHL_PRIMARY.post('/contacts/', payload, {
      headers: {
      Version: '2021-07-28',                 // Contacts API version
      LocationId: process.env.GHL_LOCATION_ID,
      'Location-Id': process.env.GHL_LOCATION_ID,
    },
  });
  return data?.contact || data?.data || data;
}

async function getContactById(id) {
  const { data } = await GHL_PRIMARY.get(`/contacts/${encodeURIComponent(id)}`, {
    headers: { Version: '2021-07-28' },
  });
  return data?.contact || data?.data || data;
}

export async function getContact(contactId, searchParams = {}) {
  const { email, phone } = searchParams || {};

  // 1) By id
  if (contactId) {
    try {
      const payload = await getContactById(contactId);
      return normalizeContact(payload, { id: contactId, email, phone });
    } catch (e) {
      // fall through to search
    }
  }

  // 2) By email
  if (email) {
    try {
      const { data } = await GHL_PRIMARY.get('/contacts/search', {
        params: { email },
        headers: { Version: '2021-07-28' },
      });
      const p = data?.contacts?.[0] || data?.data?.[0] || data;
      if (p) return normalizeContact(p, { email, phone });
    } catch {}
  }

  // 3) By phone
  if (phone) {
    try {
      const { data } = await GHL_PRIMARY.get('/contacts/search', {
        params: { phone },
        headers: { Version: '2021-07-28' },
      });
      const p = data?.contacts?.[0] || data?.data?.[0] || data;
      if (p) return normalizeContact(p, { email, phone });
    } catch {}
  }

  // 4) Minimal fallback
  return normalizeContact({}, { id: contactId || null, email, phone });
}

export async function updateContactCustomFields(contactId, kv = {}) {
  if (!contactId) throw new Error('contactId required');
  const customFields = Object.entries(kv).map(([id, value]) => ({ id, value }));
  await GHL_PRIMARY.put(`/contacts/${encodeURIComponent(contactId)}`, { customFields }, {
    headers: { Version: '2021-07-28' },
  });
  return { ok: true };
}

/* ================================
   Calendars (free-slots helper)
   ================================ */

export async function getCalendarFreeSlotsV2(calendarId, { startMs, endMs, timezone }) {
  if (!calendarId) throw new Error('calendarId required');
  const { data } = await GHL_PRIMARY.get(`/calendars/${encodeURIComponent(calendarId)}/free-slots`, {
    params: {
      startDate: String(startMs),
      endDate:   String(endMs),
      timezone,
    },
    // Version header already correct on client (2021-04-15)
  });

  const slots = (data?.timeSlots || data?.availableSlots || data?.slots || [])
    .map(s => {
      if (typeof s === 'string') {
        const start = new Date(s);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        return { start: start.toISOString(), end: end.toISOString() };
      }
      if (s?.start && s?.end) {
        return { start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() };
      }
      return null;
    })
    .filter(Boolean);

  return slots;
}

/* ================================
   Appointments (v2)
   ================================ */
export async function createAppointmentV2({
  calendarId,
  contactId,
  startTime,
  endTime,
  timezone,
  title = 'Service appointment',
  notes = '',
  address = 'Zoom',
  rrule = null,
  assignedUserId = process.env.GHL_USER_ID,
  locationId = process.env.GHL_LOCATION_ID,
}) {
  try {
    const payload = {
      title,
      meetingLocationType: 'custom',
      meetingLocationId: 'default',
      overrideLocationConfig: true,
      appointmentStatus: 'new',
      assignedUserId,
      address,
      ignoreDateRange: false,
      toNotify: false,
      ignoreFreeSlotValidation: true,
      calendarId,
      locationId,     // keep explicit in body (like your curl)
      contactId,
      startTime,
      endTime,
      timezone,
    };
    if (notes) payload.notes = notes;
    if (rrule) payload.rrule = rrule;

    const { data } = await GHL_PRIMARY.post(
      '/calendars/events/appointments',
      payload,
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Version: '2021-04-15', // <-- critical
          // no LocationId headers (to mirror your working curl)
        },
      }
    );

    return data;
  } catch (err) {
    const details = err?.response?.data || err.message || err;
    throw new Error(`[GHL create appt] ${JSON.stringify(details)}`);
  }
}

/* ================================
   Stubs you import elsewhere
   ================================ */
export async function updateAppointmentOwner(_appointmentId, _repUserId) { return { ok: true }; }
export async function rescheduleAppointment(_appointmentId, _startISO, _endISO) { return { ok: true }; }
export async function appendAppointmentNotes(_appointmentId, _text) { return { ok: true }; }