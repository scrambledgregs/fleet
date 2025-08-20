// schema.js — plain JavaScript (ESM)

/**
 * @typedef {'hvac'|'plumbing'|'electrical'|'roofing'} Trade
 */

/**
 * @typedef {Object} IndustryPack
 * @property {string} id
 * @property {string} name
 * @property {number} version
 * @property {Trade} trade
 * @property {string} description
 *
 * @property {{ name:string, stages:string[] }[]} pipelines
 * @property {string[]} jobTypes
 * @property {{
 *   key:string,
 *   label:string,
 *   type:'text'|'number'|'money'|'bool'|'date'|'enum',
 *   options?:string[],
 *   scope:'contact'|'job',
 *   required?:boolean
 * }[]} customFields
 * @property {{
 *   id:string,
 *   name:string,
 *   scope:'lead'|'job'|'safety'|'completion',
 *   fields:string[]
 * }[]} forms
 * @property {{
 *   code:string,
 *   name:string,
 *   category:string,
 *   type:'material'|'labor'|'bundle',
 *   unit:string,
 *   unitCost:number,
 *   unitPrice:number
 * }[]} pricebook
 * @property {{
 *   sms:{ id:string, label:string, text:string }[],
 *   email:{ id:string, subject:string, html:string }[],
 *   estimate:{ terms:string, footer:string }
 * }} templates
 * @property {{
 *   id:string,
 *   name:string,
 *   trigger:
 *     | { type:'stage_changed', to:string }
 *     | { type:'appt_created' }
 *     | { type:'appt_scheduled' }
 *     | { type:'invoice_paid' },
 *   actions: (
 *     | { type:'send_sms',  templateId:string }
 *     | { type:'send_email', templateId:string }
 *     | { type:'tag_contact', tag:string }
 *     | { type:'create_task', title:string, dueOffsetMin:number }
 *   )[]
 * }[]} automations
 * @property {{
 *   defaultDurationMin:number,
 *   bufferMin:number,
 *   skills:{ jobType:string, requires:string[] }[],
 *   territories:string[]
 * }} dispatchRules
 * @property {{ id:string, name:string, permissions:string[] }[]} roles
 * @property {{ id:string, name:string, metrics:('closeRate'|'avgTicket'|'jobsPerTech'|'onTimeRate'|'revenueByType')[], dimensions:('day'|'week'|'month'|'tech'|'source')[] }[]} reports
 * @property {{
 *   eagleview?:{ enabled:boolean, apiKey?:string },
 *   spotio?:{ enabled:boolean, region?:string, apiKey?:string },
 *   jobNimbus?:{ enabled:boolean },
 *   acculynx?:{ enabled:boolean },
 *   serviceTitanLike?:{ enabled:boolean }
 * }} integrations
 */

// Simple enums you can reuse
export const TRADES = ['hvac', 'plumbing', 'electrical', 'roofing'];
export const CUSTOM_FIELD_TYPES = ['text','number','money','bool','date','enum'];
export const FORM_SCOPES = ['lead','job','safety','completion'];
export const TEMPLATE_ACTIONS = ['send_sms','send_email','tag_contact','create_task'];

// Optional JSON-Schema-style object (no external lib required)
export const IndustryPackSchema = {
  type: 'object',
  required: ['id','name','version','trade','description','pipelines','jobTypes','customFields','forms','pricebook','templates','automations','dispatchRules','roles','reports','integrations'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'number' },
    trade: { enum: TRADES },
    description: { type: 'string' },

    pipelines: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name','stages'],
        properties: {
          name: { type: 'string' },
          stages: { type: 'array', items: { type: 'string' } },
        },
      },
    },

    jobTypes: { type: 'array', items: { type: 'string' } },

    customFields: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key','label','type','scope'],
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          type: { enum: CUSTOM_FIELD_TYPES },
          options: { type: 'array', items: { type: 'string' } },
          scope: { enum: ['contact','job'] },
          required: { type: 'boolean' },
        },
      },
    },

    forms: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id','name','scope','fields'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          scope: { enum: FORM_SCOPES },
          fields: { type: 'array', items: { type: 'string' } },
        },
      },
    },

    pricebook: {
      type: 'array',
      items: {
        type: 'object',
        required: ['code','name','category','type','unit','unitCost','unitPrice'],
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
          category: { type: 'string' },
          type: { enum: ['material','labor','bundle'] },
          unit: { type: 'string' },
          unitCost: { type: 'number' },
          unitPrice: { type: 'number' },
        },
      },
    },

    templates: {
      type: 'object',
      required: ['sms','email','estimate'],
      properties: {
        sms: { type: 'array', items: { type: 'object', required: ['id','label','text'], properties: {
          id: { type: 'string' }, label: { type: 'string' }, text: { type: 'string' },
        } } },
        email: { type: 'array', items: { type: 'object', required: ['id','subject','html'], properties: {
          id: { type: 'string' }, subject: { type: 'string' }, html: { type: 'string' },
        } } },
        estimate: { type: 'object', required: ['terms','footer'], properties: {
          terms: { type: 'string' }, footer: { type: 'string' },
        } },
      },
    },

    automations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id','name','trigger','actions'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          trigger: {
            anyOf: [
              { type: 'object', required: ['type','to'], properties: { type: { const: 'stage_changed' }, to: { type: 'string' } } },
              { type: 'object', required: ['type'], properties: { type: { enum: ['appt_created','appt_scheduled','invoice_paid'] } } },
            ],
          },
          actions: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'object', required: ['type','templateId'], properties: { type: { const: 'send_sms' }, templateId: { type: 'string' } } },
                { type: 'object', required: ['type','templateId'], properties: { type: { const: 'send_email' }, templateId: { type: 'string' } } },
                { type: 'object', required: ['type','tag'],        properties: { type: { const: 'tag_contact' }, tag: { type: 'string' } } },
                { type: 'object', required: ['type','title','dueOffsetMin'], properties: { type: { const: 'create_task' }, title: { type: 'string' }, dueOffsetMin: { type: 'number' } } },
              ],
            },
          },
        },
      },
    },

    dispatchRules: {
      type: 'object',
      required: ['defaultDurationMin','bufferMin','skills','territories'],
      properties: {
        defaultDurationMin: { type: 'number' },
        bufferMin: { type: 'number' },
        skills: {
          type: 'array',
          items: { type: 'object', required: ['jobType','requires'], properties: {
            jobType: { type: 'string' }, requires: { type: 'array', items: { type: 'string' } },
          } },
        },
        territories: { type: 'array', items: { type: 'string' } },
      },
    },

    roles: {
      type: 'array',
      items: { type: 'object', required: ['id','name','permissions'], properties: {
        id: { type: 'string' }, name: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } },
      } },
    },

    reports: {
      type: 'array',
      items: { type: 'object', required: ['id','name','metrics','dimensions'], properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        metrics: { type: 'array', items: { enum: ['closeRate','avgTicket','jobsPerTech','onTimeRate','revenueByType'] } },
        dimensions: { type: 'array', items: { enum: ['day','week','month','tech','source'] } },
      } },
    },

    integrations: {
      type: 'object',
      properties: {
        eagleview:       { type: 'object', properties: { enabled: { type: 'boolean' }, apiKey: { type: 'string' } } },
        spotio:          { type: 'object', properties: { enabled: { type: 'boolean' }, region: { type: 'string' }, apiKey: { type: 'string' } } },
        jobNimbus:       { type: 'object', properties: { enabled: { type: 'boolean' } } },
        acculynx:        { type: 'object', properties: { enabled: { type: 'boolean' } } },
        serviceTitanLike:{ type: 'object', properties: { enabled: { type: 'boolean' } } },
      },
      additionalProperties: true,
    },
  },
};

// Minimal runtime validator (no dependencies)
export function validateIndustryPack(pack) {
  /** @type {string[]} */
  const errors = [];

  const req = (cond, msg) => { if (!cond) errors.push(msg); };

  req(pack && typeof pack === 'object', 'pack must be an object');
  if (!pack || typeof pack !== 'object') return errors;

  req(typeof pack.id === 'string' && pack.id, 'id required');
  req(typeof pack.name === 'string' && pack.name, 'name required');
  req(typeof pack.version === 'number', 'version must be number');
  req(TRADES.includes(pack.trade), `trade must be one of ${TRADES.join(', ')}`);
  req(typeof pack.description === 'string', 'description required');

  const arrReq = (v, name) => req(Array.isArray(v), `${name} must be an array`);
  arrReq(pack.pipelines, 'pipelines');
  arrReq(pack.jobTypes, 'jobTypes');
  arrReq(pack.customFields, 'customFields');
  arrReq(pack.forms, 'forms');
  arrReq(pack.pricebook, 'pricebook');
  req(pack.templates && typeof pack.templates === 'object', 'templates required');
  arrReq(pack.automations, 'automations');
  req(pack.dispatchRules && typeof pack.dispatchRules === 'object', 'dispatchRules required');
  arrReq(pack.roles, 'roles');
  arrReq(pack.reports, 'reports');
  req(pack.integrations && typeof pack.integrations === 'object', 'integrations required');

  // spot checks to catch obvious shape issues without being exhaustive
  if (Array.isArray(pack.pipelines)) {
    pack.pipelines.forEach((p, i) => {
      req(typeof p?.name === 'string', `pipelines[${i}].name must be string`);
      req(Array.isArray(p?.stages), `pipelines[${i}].stages must be array`);
    });
  }

  if (Array.isArray(pack.customFields)) {
    pack.customFields.forEach((f, i) => {
      req(typeof f?.key === 'string', `customFields[${i}].key must be string`);
      req(typeof f?.label === 'string', `customFields[${i}].label must be string`);
      req(CUSTOM_FIELD_TYPES.includes(f?.type), `customFields[${i}].type invalid`);
      req(['contact','job'].includes(f?.scope), `customFields[${i}].scope invalid`);
      if (f.type === 'enum') req(Array.isArray(f.options), `customFields[${i}].options required for enum`);
    });
  }

  if (Array.isArray(pack.pricebook)) {
    pack.pricebook.forEach((it, i) => {
      req(typeof it?.code === 'string', `pricebook[${i}].code must be string`);
      req(['material','labor','bundle'].includes(it?.type), `pricebook[${i}].type invalid`);
      req(typeof it?.unitCost === 'number', `pricebook[${i}].unitCost must be number`);
      req(typeof it?.unitPrice === 'number', `pricebook[${i}].unitPrice must be number`);
    });
  }

  return errors;
}