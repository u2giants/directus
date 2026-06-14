// Add the CRM model to the shared Directus backend.
// Additive/idempotent: extends existing PIM retailer/buyer/factory collections and
// creates missing crm_* collections. It never deletes or rebuilds PIM data.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env DX_URL=https://data.designflow.app node pm-system/crm-schema.mjs
// Restart Directus after running if event Flows are added later.
import { readFileSync } from 'node:fs'

if (process.env.POPPIM_ENV_FILE) {
  for (const line of readFileSync(process.env.POPPIM_ENV_FILE, 'utf8').split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#') || !s.includes('=')) continue
    const i = s.indexOf('=')
    const k = s.slice(0, i).trim()
    let v = s.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[k] === undefined) process.env[k] = v
  }
}

const BASE = process.env.DX_URL || 'https://data.designflow.app'
const EMAIL = process.env.DX_ADMIN_EMAIL
const PASSWORD = process.env.DX_ADMIN_PASSWORD
let TOKEN = ''

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json?.errors?.[0]?.message || text}`)
  return json?.data ?? json
}

const pk = () => ({ field: 'id', type: 'uuid', schema: { is_primary_key: true, has_auto_increment: false }, meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] } })
const field = (type, iface, note, schema = {}, extra = {}) => ({ type, meta: { interface: iface, note, ...extra }, schema })
const string = (note) => field('string', 'input', note)
const text = (note) => field('text', 'input-multiline', note)
const logo = (note) => field('string', 'pop-company-logo', note, {}, { readonly: true })
const bool = (note) => field('boolean', 'boolean', note)
const date = (note) => field('date', 'datetime', note)
const timestamp = (note) => field('timestamp', 'datetime', note)
const integer = (note) => field('integer', 'input', note)
const decimal = (note) => field('decimal', 'input', note, { numeric_precision: 12, numeric_scale: 2 })
const m2o = (note) => field('uuid', 'select-dropdown-m2o', note, {}, { special: ['m2o'] })
const select = (choices, note) => field('string', 'select-dropdown', note, {}, { options: { choices: choices.map((c) => typeof c === 'string' ? { text: c, value: c } : c) } })

const choices = {
  customerStatus: [
    ['Active Customer', 'ACTIVE_CUSTOMER', '#22c55e'],
    ['Potential Customer', 'POTENTIAL_CUSTOMER', '#eab308'],
    ['Not a Customer', 'OTHER', '#94a3b8'],
    ['New Company', 'UNASSIGNED', '#3b82f6'],
  ],
  chainType: [
    ['Off-Price', 'OFF_PRICE', '#f97316'],
    ['Specialty', 'SPECIALTY', '#d946ef'],
    ['Value', 'VALUE', '#22c55e'],
    ['Mass Market', 'MASS_MARKET', '#6366f1'],
    ['Grocery/Drug', 'GROCERY_DRUG', '#84cc16'],
    ['eCom', 'ECOM', '#06b6d4'],
    ['Club', 'CLUB', '#ec4899'],
    ['Other', 'OTHER', '#94a3b8'],
  ],
  contactType: [
    ['Buyer', 'BUYER'],
    ['Assistant Buyer', 'ASSISTANT_BUYER'],
    ['Planner', 'PLANNER'],
    ['China Office', 'CHINA_OFFICE'],
    ['Logistics', 'LOGISTICS'],
    ['Legal', 'LEGAL'],
    ['Finance', 'FINANCE'],
    ['Other', 'OTHER'],
    ['Former Contact', 'FORMER_CONTACT'],
  ],
  scope: [
    ['Department', 'DEPARTMENT'],
    ['Company-Wide', 'COMPANY_WIDE'],
    ['Ignored', 'IGNORED'],
  ],
  departmentCategory: [
    ['Seasonal', 'SEASONAL'],
    ['Everyday', 'EVERYDAY'],
    ['Soft Home', 'SOFT_HOME'],
    ['Outdoor', 'OUTDOOR'],
    ['Holiday', 'HOLIDAY'],
    ['Other', 'OTHER'],
  ],
  division: [
    ['POP', 'POP'],
    ['Spruce', 'SPRUCE'],
    ['Both', 'BOTH'],
  ],
  opportunityStage: [
    ['Directive Received', 'DIRECTIVE_RECEIVED'],
    ['Design in Progress', 'DESIGN_IN_PROGRESS'],
    ['Buyer Review', 'BUYER_REVIEW'],
    ['Pricing & Sampling', 'PRICING_AND_SAMPLING'],
    ['Awaiting Sales Order', 'AWAITING_SALES_ORDER'],
    ['In Production', 'IN_PRODUCTION'],
    ['Shipped', 'SHIPPED'],
    ['Closed', 'CLOSED'],
  ],
  programType: [
    ['Licensed Program', 'LICENSED_PROGRAM'],
    ['Regular Order', 'REGULAR_ORDER'],
    ['Floor Reset', 'FLOOR_RESET'],
    ['Reorder', 'REORDER'],
  ],
  directiveSource: [
    ['Buyer Initiated', 'BUYER_INITIATED'],
    ['Internal', 'INTERNAL'],
  ],
  originCountry: [
    ['China', 'CHINA'],
    ['India', 'INDIA'],
    ['Other', 'OTHER'],
  ],
  customerIncoterms: [
    ['FOB China', 'FOB_CHINA'],
    ['FOB India', 'FOB_INDIA'],
    ['POE LA', 'POE_LA'],
    ['POE NJ', 'POE_NJ'],
    ['DDP China', 'DDP_CHINA'],
    ['Whse LA', 'WHSE_LA'],
    ['Whse NJ', 'WHSE_NJ'],
    ['Whse Spirit', 'WHSE_SPIRIT'],
  ],
  factoryIncoterms: [
    ['FOB China', 'FOB_CHINA'],
    ['FOB India', 'FOB_INDIA'],
    ['LDP LA', 'LDP_LA'],
    ['LDP NJ', 'LDP_NJ'],
  ],
  sampleApprovalMethod: [
    ['In-Person', 'IN_PERSON'],
    ['Photo', 'PHOTO'],
    ['N/A', 'NA'],
  ],
  seasonYear: [
    ['Spring 2026', 'SPRING_2026'],
    ['Back to School 2026', 'BACK_TO_SCHOOL_2026'],
    ['Holiday 2026', 'HOLIDAY_2026'],
    ['Spring 2027', 'SPRING_2027'],
    ['Back to School 2027', 'BACK_TO_SCHOOL_2027'],
    ['Holiday 2027', 'HOLIDAY_2027'],
  ],
  routingStatus: [
    ['Routed', 'ROUTED'],
    ['Needs Review', 'UNROUTED'],
    ['Skipped', 'SKIPPED'],
    ['Company Only', 'COMPANY_ONLY'],
    ['Company + Dept', 'COMPANY_DEPT'],
    ['Orphaned Customer Email', 'CUSTOMER_EMAIL_NO_COMPANY'],
  ],
  routingMethod: [
    ['PO Number', 'PO_NUMBER'],
    ['SO Number', 'SO_NUMBER'],
    ['Retailer Domain', 'EMAIL_DOMAIN'],
    ['Subject Match', 'SUBJECT_MATCH'],
    ['Fuzzy Match', 'FUZZY_NAME'],
    ['AI Matched', 'AI'],
    ['Manual', 'MANUAL'],
    ['Auto Skip', 'AUTO_SKIP'],
  ],
  matchType: [
    ['Contains', 'CONTAINS'],
    ['Domain', 'DOMAIN'],
    ['Exact', 'EXACT'],
    ['Regex', 'REGEX'],
  ],
  meetingSource: [
    ['Fireflies Auto-Import', 'FIREFLIES_AUTO_IMPORT'],
    ['Manual', 'MANUAL'],
  ],
  taskStatus: [
    ['To do', 'TODO'],
    ['In progress', 'IN_PROGRESS'],
    ['Done', 'DONE'],
  ],
  aiModel: [
    ['gpt 5.4 $2.50/$15', 'GPT_5_4'],
    ['gpt 5.4 mini $0.75/$4.50', 'GPT_5_4_MINI'],
    ['gpt 5.4 nano $0.20/$1.25', 'GPT_5_4_NANO'],
    ['gem 3.2 pro $2/$12', 'GEMINI_3_1_PRO'],
    ['gem 3 flash $0.50/$3', 'GEMINI_3_FLASH'],
    ['gem 3.1 flash lite $0.25/$1.50', 'GEMINI_3_1_FLASH_LITE'],
    ['gem 3.1 flash image $0.50/$60', 'GEMINI_3_1_FLASH_IMAGE'],
    ['sonnet 4.6 $3/$15', 'CLAUDE_SONNET_4_6'],
    ['haiku 4.5 $1/$5', 'CLAUDE_HAIKU_4_5'],
  ],
}
for (const [k, v] of Object.entries(choices)) choices[k] = v.map(([text, value, color]) => ({ text, value, ...(color ? { color } : {}) }))

let collectionSet, fieldsByCollection, relationSet

async function loadState() {
  collectionSet = new Set((await api('GET', '/collections')).map((c) => c.collection))
  fieldsByCollection = new Map()
  relationSet = new Set((await api('GET', '/relations')).map((r) => `${r.collection}.${r.field}`))
}

async function fieldsOf(collection) {
  if (!fieldsByCollection.has(collection)) {
    fieldsByCollection.set(collection, new Set((await api('GET', `/fields/${collection}`)).map((f) => f.field)))
  }
  return fieldsByCollection.get(collection)
}

async function ensureCollection(collection, icon, note) {
  if (collectionSet.has(collection)) return
  await api('POST', '/collections', { collection, schema: {}, meta: { icon, note }, fields: [pk()] })
  collectionSet.add(collection)
  fieldsByCollection.set(collection, new Set(['id']))
  console.log(`✓ collection ${collection}`)
}

async function ensureField(collection, name, def) {
  const fields = await fieldsOf(collection)
  if (fields.has(name)) return
  await api('POST', `/fields/${collection}`, { field: name, ...def })
  fields.add(name)
  console.log(`  + ${collection}.${name}`)
}

async function updateFieldMeta(collection, name, meta) {
  const fields = await fieldsOf(collection)
  if (!fields.has(name)) return
  await api('PATCH', `/fields/${collection}/${name}`, { meta })
  console.log(`  · ${collection}.${name} meta`)
}

async function ensureRelation(collection, name, related, onDelete = 'SET NULL') {
  const key = `${collection}.${name}`
  if (relationSet.has(key)) return
  await api('POST', '/relations', { collection, field: name, related_collection: related, schema: { on_delete: onDelete }, meta: {} })
  relationSet.add(key)
  console.log(`  ~ ${collection}.${name} -> ${related}`)
}

async function ensureM2O(collection, name, related, note, onDelete) {
  await ensureField(collection, name, m2o(note))
  await ensureRelation(collection, name, related, onDelete)
}

async function ensureProvenance(collection) {
  await ensureField(collection, 'external_id', string('Source-system id for migrations/sync'))
  await ensureField(collection, 'external_source', string('Source system for external_id'))
}

async function configureRetailerLayout() {
  const fields = [
    ['logo_url', { sort: 1, width: 'half', readonly: true, translations: [{ language: 'en-US', translation: 'Logo' }] }],
    ['name', { sort: 2, width: 'half' }],
    ['customer_status', { sort: 3, width: 'half', options: { choices: choices.customerStatus } }],
    ['chain_type', { sort: 4, width: 'half', options: { choices: choices.chainType } }],
    ['domain', { sort: 5, width: 'half' }],
    ['routing_aliases', { sort: 6, width: 'half' }],
    ['so_patterns', { sort: 7, width: 'half', note: 'S.O. patterns used by email routing', translations: [{ language: 'en-US', translation: 'S.O. Patterns' }] }],
    ['primary_salesperson', { sort: 8, width: 'half' }],
    ['account_owner', { sort: 9, width: 'half' }],
    ['aliases', { sort: 20, width: 'half' }],
    ['resale_restriction', { sort: 21, width: 'half' }],
    ['notes', { sort: 22, width: 'full' }],
    ['external_source', { sort: 90, width: 'half', hidden: true }],
    ['external_id', { sort: 91, width: 'half', hidden: true }],
  ]

  for (const [name, meta] of fields) {
    await updateFieldMeta('retailer', name, meta)
  }
}

async function configureDepartmentLayout() {
  const fields = [
    ['retailer', { sort: 1, width: 'half', required: true, note: 'Required customer/account. Departments cannot exist outside a customer.' }],
    ['name', { sort: 2, width: 'half', required: true }],
    ['category', { sort: 3, width: 'half', options: { choices: choices.departmentCategory } }],
    ['division', { sort: 4, width: 'half', options: { choices: choices.division } }],
    ['primary_buyer', { sort: 5, width: 'half' }],
    ['active', { sort: 6, width: 'half' }],
    ['sort', { sort: 7, width: 'half', hidden: true }],
    ['external_source', { sort: 90, width: 'half', hidden: true }],
    ['external_id', { sort: 91, width: 'half', hidden: true }],
  ]

  for (const [name, meta] of fields) {
    await updateFieldMeta('crm_department', name, meta)
  }
}

async function run() {
  if (!EMAIL || !PASSWORD) throw new Error('DX_ADMIN_EMAIL and DX_ADMIN_PASSWORD are required')
  TOKEN = (await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).access_token
  await loadState()

  for (const collection of ['retailer', 'buyer', 'factory']) await ensureProvenance(collection)

  await ensureField('retailer', 'domain', string('CRM routing domain / primary domain'))
  await ensureField('retailer', 'logo_url', logo('Company logo preview derived from domain'))
  await ensureField('retailer', 'routing_aliases', text('CRM email-routing aliases'))
  await ensureField('retailer', 'so_patterns', text('Sales-order patterns used by email routing'))
  await ensureField('retailer', 'customer_status', select(choices.customerStatus, 'CRM customer status'))
  await ensureField('retailer', 'chain_type', select(choices.chainType, 'CRM chain type'))
  await ensureM2O('retailer', 'primary_salesperson', 'directus_users', 'Primary CRM salesperson')
  await ensureM2O('retailer', 'account_owner', 'directus_users', 'CRM account owner')
  await configureRetailerLayout()

  await ensureField('buyer', 'first_name', string('CRM contact first name'))
  await ensureField('buyer', 'last_name', string('CRM contact last name'))
  await ensureField('buyer', 'phone', string('CRM contact phone'))
  await ensureField('buyer', 'job_title', select(choices.contactType, 'CRM job title / role'))
  await ensureField('buyer', 'contact_type', select(choices.contactType, 'CRM contact type'))
  await ensureField('buyer', 'scope', select(choices.scope, 'Email-routing scope'))

  await ensureField('factory', 'location', string('CRM factory location'))
  await ensureField('factory', 'contact_name', string('CRM factory contact name'))
  await ensureField('factory', 'contact_email', string('CRM factory contact email'))
  await ensureField('factory', 'notes', text('CRM factory notes'))

  await ensureCollection('crm_department', 'apartment', 'CRM departments under a retailer')
  await ensureProvenance('crm_department')
  await ensureField('crm_department', 'name', string())
  await ensureField('crm_department', 'category', select(choices.departmentCategory))
  await ensureField('crm_department', 'division', select(choices.division))
  await ensureField('crm_department', 'active', bool())
  await ensureField('crm_department', 'sort', integer())
  await ensureM2O('crm_department', 'retailer', 'retailer', 'Company/account')
  await ensureM2O('crm_department', 'primary_buyer', 'buyer', 'Primary buyer/contact')
  await ensureM2O('buyer', 'department', 'crm_department', 'CRM department')
  await configureDepartmentLayout()

  await ensureCollection('crm_opportunity', 'paid', 'CRM opportunity / program')
  await ensureProvenance('crm_opportunity')
  for (const [name, def] of [
    ['name', text()], ['amount', decimal()], ['close_date', timestamp()], ['stage', select(choices.opportunityStage)],
    ['probability', integer()], ['program_type', select(choices.programType)], ['season_year', select(choices.seasonYear)],
    ['directive_source', select(choices.directiveSource)], ['division', select(choices.division)], ['origin_country', select(choices.originCountry)],
    ['licensed', bool()], ['production_po_number', string()], ['sales_order_number', string()], ['import_po_number', string()],
    ['customer_incoterms', select(choices.customerIncoterms)], ['factory_incoterms', select(choices.factoryIncoterms)],
    ['hard_delivery_date', date()], ['sample_required', bool()], ['sample_approval_method', select(choices.sampleApprovalMethod)],
    ['requires_new_pricing', bool()], ['plm_project_id', string()], ['ai_summary', text()], ['ai_state', text()],
  ]) await ensureField('crm_opportunity', name, def)
  await ensureM2O('crm_opportunity', 'retailer', 'retailer')
  await ensureM2O('crm_opportunity', 'contact', 'buyer')
  await ensureM2O('crm_opportunity', 'department', 'crm_department')
  await ensureM2O('crm_opportunity', 'factory', 'factory')
  await ensureM2O('crm_opportunity', 'owner', 'directus_users')
  await ensureM2O('crm_opportunity', 'project', 'project', 'Linked PIM project')

  await ensureCollection('crm_meeting_note', 'event_note', 'CRM meeting note')
  await ensureProvenance('crm_meeting_note')
  for (const [name, def] of [
    ['name', text()], ['date', date()], ['participants', text()], ['summary', text()], ['action_items', text()],
    ['source', select(choices.meetingSource)], ['fireflies_transcript_id', string()],
  ]) await ensureField('crm_meeting_note', name, def)
  await ensureM2O('crm_meeting_note', 'retailer', 'retailer')
  await ensureM2O('crm_meeting_note', 'department', 'crm_department')
  await ensureM2O('crm_meeting_note', 'opportunity', 'crm_opportunity')
  await ensureM2O('crm_meeting_note', 'contact', 'buyer')

  await ensureCollection('crm_meeting_note_attendee', 'groups', 'CRM meeting note attendee')
  await ensureProvenance('crm_meeting_note_attendee')
  await ensureField('crm_meeting_note_attendee', 'name', string())
  await ensureM2O('crm_meeting_note_attendee', 'meeting_note', 'crm_meeting_note', undefined, 'CASCADE')
  await ensureM2O('crm_meeting_note_attendee', 'contact', 'buyer')

  await ensureCollection('crm_licensor_approval_thread', 'approval', 'CRM licensor approval thread')
  await ensureProvenance('crm_licensor_approval_thread')
  for (const [name, def] of [
    ['name', text()], ['property_name', string()], ['stage', string()], ['submitted_date', date()], ['response_date', date()],
    ['due_date', date()], ['licensor_comments', text()],
  ]) await ensureField('crm_licensor_approval_thread', name, def)
  await ensureM2O('crm_licensor_approval_thread', 'opportunity', 'crm_opportunity')

  await ensureCollection('crm_email_message', 'mail', 'CRM email message and routing result')
  await ensureProvenance('crm_email_message')
  for (const [name, def] of [
    ['name', text()], ['subject', text()], ['sender', text()], ['recipients', text()], ['received_at', date()],
    ['body_preview', text()], ['outlook_message_id', string()], ['routing_status', select(choices.routingStatus)],
    ['routing_method', select(choices.routingMethod)], ['detected_so_numbers', text()], ['detected_po_numbers', text()],
  ]) await ensureField('crm_email_message', name, def)
  await ensureM2O('crm_email_message', 'retailer', 'retailer')
  await ensureM2O('crm_email_message', 'department', 'crm_department')
  await ensureM2O('crm_email_message', 'opportunity', 'crm_opportunity')
  await ensureM2O('crm_email_message', 'mailbox_owner', 'directus_users')

  await ensureCollection('crm_ignore_rule', 'block', 'CRM email ignore rule')
  await ensureProvenance('crm_ignore_rule')
  await ensureField('crm_ignore_rule', 'name', string())
  await ensureField('crm_ignore_rule', 'pattern', text())
  await ensureField('crm_ignore_rule', 'match_type', select(choices.matchType))
  await ensureField('crm_ignore_rule', 'emails_skipped', integer())

  await ensureCollection('crm_ai_model_config', 'smart_toy', 'CRM AI model selection')
  await ensureProvenance('crm_ai_model_config')
  await ensureField('crm_ai_model_config', 'name', string())
  await ensureField('crm_ai_model_config', 'email_routing_model', select(choices.aiModel))
  await ensureField('crm_ai_model_config', 'fireflies_routing_model', select(choices.aiModel))
  await ensureField('crm_ai_model_config', 'transcript_split_model', select(choices.aiModel))
  await ensureField('crm_ai_model_config', 'opportunity_summary_model', select(choices.aiModel))

  await ensureCollection('crm_note', 'notes', 'CRM note')
  await ensureProvenance('crm_note')
  for (const [name, def] of [['title', text()], ['body', text()], ['action_items', text()], ['source', string()], ['fireflies_transcript_id', string()]]) await ensureField('crm_note', name, def)
  await ensureM2O('crm_note', 'retailer', 'retailer')
  await ensureM2O('crm_note', 'contact', 'buyer')
  await ensureM2O('crm_note', 'opportunity', 'crm_opportunity')
  await ensureM2O('crm_note', 'department', 'crm_department')

  await ensureCollection('crm_task', 'task_alt', 'CRM task')
  await ensureProvenance('crm_task')
  for (const [name, def] of [['title', text()], ['body', text()], ['status', select(choices.taskStatus)], ['due_at', timestamp()]]) await ensureField('crm_task', name, def)
  await ensureM2O('crm_task', 'assignee', 'directus_users')
  await ensureM2O('crm_task', 'retailer', 'retailer')
  await ensureM2O('crm_task', 'contact', 'buyer')
  await ensureM2O('crm_task', 'opportunity', 'crm_opportunity')
  await ensureM2O('crm_task', 'department', 'crm_department')

  console.log('\nCRM schema complete (additive).')
}

run().catch((error) => { console.error('✗', error.message); process.exit(1) })
