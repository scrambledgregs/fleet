// presets.js — plain JavaScript (ESM), no TypeScript

// ---- shared helper ----
const baseTrade = (trade) => ({
  pipelines: [
    {
      name: `${trade.toUpperCase()} Pipeline`,
      stages: ['New', 'Scheduled', 'En Route', 'In Progress', 'Completed', 'Invoiced', 'Paid'],
    },
  ],
  jobTypes: ['Estimate', 'Repair', 'Install', 'Maintenance', 'Emergency'],
  customFields: [
    { key: 'source',   label: 'Lead Source',   type: 'enum',  options: ['Google', 'Referral', 'Door Hanger', 'Facebook'], scope: 'contact' },
    { key: 'po',       label: 'PO #',          type: 'text',  scope: 'job' },
    { key: 'priority', label: 'Priority',      type: 'enum',  options: ['Low', 'Normal', 'High'], scope: 'job' },
  ],
  forms: [
    { id: 'lead-intake', name: 'Lead Intake',          scope: 'lead',       fields: ['source'] },
    { id: 'completion',  name: 'Completion Checklist', scope: 'completion', fields: ['po', 'priority'] },
  ],
  pricebook: [
    { code: 'LAB-STD',  name: 'Standard Labor Hour', category: 'Labor',     type: 'labor',    unit: 'hr', unitCost: 45, unitPrice: 120 },
    { code: 'MAT-MISC', name: 'Misc Materials',      category: 'Materials', type: 'material', unit: 'ea', unitCost: 10, unitPrice: 25 },
  ],
  templates: {
    sms: [
      { id: 'eta',      label: 'ETA',       text: 'Your tech is on the way. ETA ~30 minutes.' },
      { id: 'followup', label: 'Follow-Up', text: 'How did we do today? Reply 1-5 or text us any feedback.' },
    ],
    email: [
      { id: 'estimate',    subject: 'Your Estimate from X-Fleet', html: '<p>Hi {{name}}, your estimate is attached.</p>' },
      { id: 'invoicePaid', subject: 'Payment Received',           html: '<p>Thanks for your business!</p>' },
    ],
    estimate: { terms: 'All estimates valid for 30 days.', footer: 'Licensed • Bonded • Insured' },
  },
  automations: [
    { id: 'stage-scheduled-sms', name: 'Confirm appt (SMS)', trigger: { type: 'appt_scheduled' }, actions: [{ type: 'send_sms',  templateId: 'eta' }] },
    { id: 'paid-email',          name: 'Thanks on payment',  trigger: { type: 'invoice_paid' },  actions: [{ type: 'send_email', templateId: 'invoicePaid' }] },
  ],
  dispatchRules: { defaultDurationMin: 60, bufferMin: 15, skills: [], territories: ['NORTH', 'SOUTH', 'EAST', 'WEST'] },
  roles: [
    { id: 'owner',      name: 'Owner',      permissions: ['*'] },
    { id: 'dispatcher', name: 'Dispatcher', permissions: ['jobs.read', 'jobs.assign', 'jobs.edit'] },
    { id: 'tech',       name: 'Technician', permissions: ['jobs.read', 'jobs.update_notes'] },
  ],
  reports: [
    { id: 'daily-ops', name: 'Daily Ops',        metrics: ['jobsPerTech', 'onTimeRate'],   dimensions: ['day', 'tech'] },
    { id: 'revenue',   name: 'Revenue by Type',  metrics: ['revenueByType', 'avgTicket'],  dimensions: ['month', 'tech'] },
  ],
  // keep integrations optional by default; packs can extend
  integrations: {},
});

// Precompute bases so we can reuse arrays without writing TS non-null operators
const HVAC_BASE        = baseTrade('hvac');
const PLUMBING_BASE    = baseTrade('plumbing');
const ELECTRICAL_BASE  = baseTrade('electrical');
const ROOFING_BASE     = baseTrade('roofing');

// ---- Packs ----
export const HVAC_PACK = {
  id: 'hvac-pro',
  name: 'HVAC Pro Pack',
  version: 1,
  trade: 'hvac',
  description: 'Scheduling presets, dispatch rules, maintenance plans, SMS/email templates.',
  ...HVAC_BASE,
  customFields: [
    ...(HVAC_BASE.customFields || []),
    { key: 'systemType',     label: 'System Type',     type: 'enum', options: ['Split','Packaged','Mini-Split','Heat Pump'], scope: 'job' },
    { key: 'filterSize',     label: 'Filter Size',     type: 'text', scope: 'job' },
    { key: 'maintenancePlan',label: 'Maintenance Plan',type: 'bool', scope: 'contact' },
  ],
};

export const PLUMBING_PACK = {
  id: 'plumbing-pro',
  name: 'Plumbing Pro Pack',
  version: 1,
  trade: 'plumbing',
  description: 'Drain cleaning, emergency workflows, estimate templates, tags.',
  ...PLUMBING_BASE,
};

export const ELECTRICAL_PACK = {
  id: 'electrical-pro',
  name: 'Electrical Pro Pack',
  version: 1,
  trade: 'electrical',
  description: 'Service calls, panel upgrades, safety checklists.',
  ...ELECTRICAL_BASE,
  customFields: [
    ...(ELECTRICAL_BASE.customFields || []),
    { key: 'permitRequired', label: 'Permit Required', type: 'bool', scope: 'job' },
  ],
};

export const ROOFING_PACK = {
  id: 'roofing-pro',
  name: 'Roofing Pro Pack',
  version: 1,
  trade: 'roofing',
  description: 'Leak triage, inspections, EagleView & Spotio ready.',
  ...ROOFING_BASE,
  jobTypes: ['Inspection', 'Repair', 'Tear-off & Install', 'Emergency Tarp'],
  integrations: {
    ...ROOFING_BASE.integrations,
    eagleview:       { enabled: true },
    spotio:          { enabled: true, region: 'US' },
    jobNimbus:       { enabled: true },
    acculynx:        { enabled: true },
    serviceTitanLike:{ enabled: false },
  },
  customFields: [
    ...(ROOFING_BASE.customFields || []),
    { key: 'roofType',    label: 'Roof Type',            type: 'enum', options: ['Asphalt','Tile','Metal','Flat'], scope: 'job' },
    { key: 'pitch',       label: 'Pitch',                type: 'enum', options: ['Low','Medium','Steep'],         scope: 'job' },
    { key: 'eagleviewId', label: 'EagleView Order ID',   type: 'text',                                           scope: 'job' },
  ],
};