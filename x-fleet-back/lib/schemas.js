// lib/schemas.js
import { z } from 'zod';

// ----- Primitives -----
export const IsoDatetime = z.string().refine(
  s => !Number.isNaN(new Date(s).getTime()),
  'Invalid ISO datetime'
);

// Money: accepts number or string ("250", "$1,200", "", null, undefined)
// Always returns a non-negative number (invalid -> 0)
export const Money = z.preprocess((v) => {
  if (v == null) return 0;                            // null/undefined -> 0
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : 0;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^\d.-]/g, '').trim(); // strip $, commas, spaces
    const n = Number(cleaned);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return 0;
}, z.number().nonnegative());

// Keep phone cleaning in chatter.js; here we just allow E.164-ish
export const PhoneE164 = z.string().regex(/^\+?[1-9]\d{9,14}$/, 'Invalid phone');

// ----- Address -----
export const AddressSchema = z.object({
  fullAddress: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
}).partial();

// ----- Contact -----
export const ContactSchema = z.object({
  id: z.string().nullable().optional(),
  name: z.string().min(1).default('—'),
  company: z.string().nullable().optional(),
  phones: z.array(PhoneE164).default([]),
  emails: z.array(z.string().email()).default([]),
  address: AddressSchema.nullable().optional(),
  tags: z.array(z.string()).default([]),
  custom: z.record(z.any()).default({}),
  pipeline: z.string().nullable().optional(),
});

// ----- Message (for SMS/Email/Chat) -----
export const MessageSchema = z.object({
  id: z.string().optional(),
  direction: z.enum(['inbound', 'outbound']),
  channel: z.enum(['sms', 'email', 'chat', 'voice']).default('sms'),
  text: z.string().default(''),
  at: IsoDatetime.optional(),
  to: z.string().optional(),   // phone or email; validated upstream
  from: z.string().optional(), // phone or email; validated upstream
  attachments: z.array(z.any()).default([]),
});

// ----- Appointment / Job -----
export const AppointmentSchema = z.object({
  appointmentId: z.string(),
  contact: ContactSchema,
  address: z.union([z.string(), AddressSchema]),
  lat: z.number().default(0),
  lng: z.number().default(0),
  startTime: IsoDatetime,
  endTime: IsoDatetime,
  jobType: z.string().default('Repair'),
  estValue: Money,
  territory: z.string().default('EAST'),
  day: z.string().nullable().optional(),
  time: z.string().nullable().optional(),
  assignedUserId: z.string().optional(),
});

// ----- Requests -----
export const SuggestTimesRequestSchema = z.object({
  clientId: z.string().default('default'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  timezone: z.string().default('America/New_York'),
  address: z.string().optional(),
  jobType: z.string().default('Repair'),
  estValue: Money,
  territory: z.string().default('EAST'),
  durationMin: z.number().int().positive().default(60),
  bufferMin: z.number().int().nonnegative().default(15),
  maxDetourMin: z.number().int().nonnegative().default(60),
});

export const CreateAppointmentReqSchema = z.object({
  contactId: z.string().optional(),
  contact: z.object({
    name: z.string(),
    phone: z.string(),        // normalize with your phoneE164() before use
    email: z.string().email().optional(),
  }).optional(),
  address: z.string(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  jobType: z.string().default('Repair'),
  estValue: Money,
  territory: z.string().default('EAST'),
  startTime: IsoDatetime,
  endTime: IsoDatetime.optional(),
  timezone: z.string().default('America/New_York'),
  title: z.string().default('Service appointment'),
  notes: z.string().default('Booked by Dispatch Board'),
  rrule: z.string().optional(),
  assignedUserId: z.string().optional(),
  clientId: z.string().default('default'),
}).refine(
  d => d.contactId || d.contact,
  { message: 'Provide either contactId or contact{name,phone}' }
);

// ----- Client settings -----
export const ClientSettingsSchema = z.object({
  paydayThreshold: Money,
});

// Tech + upsert payload
export const TechSchema = z.object({
  id: z.string(),
  name: z.string(),
  skills: z.array(z.string()).default([]),
  territory: z.string().default('EAST'),
  route: z.array(z.object({ lat: z.number(), lng: z.number() })).default([]),
});

export const UpsertTechsRequestSchema = z.object({
  clientId: z.string().default('default'),
  techs: z.array(TechSchema),
});