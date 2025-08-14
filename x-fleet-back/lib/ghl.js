import axios from 'axios'

const GHL = axios.create({
  baseURL: process.env.GHL_API_BASE || 'https://rest.gohighlevel.com/v1',
  headers: { Authorization: `Bearer ${process.env.GHL_API_KEY||''}` },
  timeout: 15000
})

// ---- Contact helpers ----
export async function getContact(contactId, { email, phone } = {}){
  // NOTE: Replace with real GHL endpoints as needed
  // Try by contactId, otherwise best-effort by email/phone.
  try{
    if(contactId){
      // const { data } = await GHL.get(`/contacts/${contactId}`)
      // return normalizeContact(data)
      return mockContact(contactId, email, phone) // stub
    }
  }catch(e){}
  if(email){
    // const { data } = await GHL.get(`/contacts/search?email=${encodeURIComponent(email)}`)
    return mockContact('by-email', email, phone)
  }
  if(phone){
    // const { data } = await GHL.get(`/contacts/search?phone=${encodeURIComponent(phone)}`)
    return mockContact('by-phone', email, phone)
  }
  return null
}

function mockContact(id, email, phone){
  return normalizeContact({
    id, firstName:'Jane', lastName:'Doe',
    companyName:'Doe Roofing LLC',
    emails:[email || 'jane@example.com'],
    phones:[phone || '+1 (555) 010-2000'],
    address1:'123 Palm Ln', city:'Phoenix', state:'AZ', postalCode:'85004',
    tags:['Reroof', 'VIP'],
    customFields:{ roofType:'Tile', insuranceCarrier:'ACME Mutual', leadSource:'Web' },
    pipeline:{ name:'Roofing Sales', stage:'Proposal Sent' }
  })
}

export function normalizeContact(raw){
  return {
    id: raw.id,
    name: [raw.firstName, raw.lastName].filter(Boolean).join(' ') || raw.name || '',
    firstName: raw.firstName || '',
    lastName: raw.lastName || '',
    company: raw.companyName || '',
    emails: raw.emails || (raw.email ? [raw.email] : []),
    phones: raw.phones || (raw.phone ? [raw.phone] : []),
    address: [raw.address1, raw.city, raw.state, raw.postalCode].filter(Boolean).join(', '),
    tags: raw.tags || [],
    custom: raw.customFields || {},
    pipeline: raw.pipeline || null
  }
}

// ---- Appointment updates (stubs to be implemented against real GHL API) ----
export async function updateAppointmentOwner(appointmentId, repUserId){ return { ok:true } }
export async function rescheduleAppointment(appointmentId, startISO, endISO){ return { ok:true } }
export async function appendAppointmentNotes(appointmentId, text){ return { ok:true } }
