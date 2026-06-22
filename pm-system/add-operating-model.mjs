// Add the PM operating model used by the Poppim frontend:
// dependencies, decisions, reminders, and reusable workflow templates.
//
// Additive/idempotent: creates only missing collections, fields, relations,
// and permissions. It never deletes data.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env \
//   DX_URL=https://data.designflow.app \
//   node pm-system/add-operating-model.mjs
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

async function login() {
  TOKEN = (await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).access_token
}

const pk = () => ({
  field: 'id',
  type: 'uuid',
  schema: { is_primary_key: true, has_auto_increment: false },
  meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] },
})

const field = (type, iface, note, schema = {}, extra = {}) => ({
  type,
  meta: { interface: iface, note, ...extra },
  schema,
})
const string = (note) => field('string', 'input', note)
const text = (note) => field('text', 'input-multiline', note)
const richText = (note) => field('text', 'input-rich-text-md', note)
const timestamp = (note) => field('timestamp', 'datetime', note)
const bool = (note, defaultValue = false) => field('boolean', 'boolean', note, { default_value: defaultValue })
const json = (note) => field('json', 'input-code', note, {}, { options: { language: 'json' } })
const m2o = (note) => field('uuid', 'select-dropdown-m2o', note, {}, { special: ['m2o'] })
const select = (choices, note) => field('string', 'select-dropdown', note, {}, {
  options: { choices: choices.map((choice) => ({ text: choice, value: choice })) },
})

const BUSINESS_UNITS = ['All', 'POP Creations', 'Spruce Line', 'Software']
const DEPENDENCY_TYPES = ['blocked_by', 'blocks', 'related', 'duplicate', 'parent_child']
const DEPENDENCY_STATUSES = ['open', 'waiting', 'resolved', 'canceled']
const DECISION_TYPES = ['approved', 'rejected', 'changes_requested', 'parked', 'canceled', 'reusable', 'buyer_picked', 'buyer_passed', 'licensor_approved', 'sample_approved', 'order_received', 'custom']
const DECISION_STATUSES = ['proposed', 'decided', 'superseded', 'canceled']
const REMINDER_TYPES = ['follow_up', 'licensor_response', 'buyer_response', 'sample_due', 'factory_due', 'missing_evidence', 'stage_sla', 'custom']
const REMINDER_STATUSES = ['open', 'snoozed', 'done', 'canceled']
const TEMPLATE_OBJECT_TYPES = ['product', 'project', 'submission', 'sample', 'revision']
const TEMPLATE_TYPES = ['checklist', 'stage_gate', 'project', 'submission', 'sample']

let collectionSet
let relationSet
const fieldsByCollection = new Map()

async function refreshCollections() {
  collectionSet = new Set((await api('GET', '/collections?limit=-1')).map((c) => c.collection))
}

async function refreshRelations() {
  relationSet = new Set((await api('GET', '/relations?limit=-1')).map((r) => `${r.collection}.${r.field}`))
}

async function fieldsOf(collection) {
  if (!fieldsByCollection.has(collection)) {
    fieldsByCollection.set(collection, new Set((await api('GET', `/fields/${collection}`)).map((f) => f.field)))
  }
  return fieldsByCollection.get(collection)
}

async function ensureCollection(collection, icon, note) {
  if (collectionSet.has(collection)) return
  await api('POST', '/collections', {
    collection,
    schema: {},
    meta: { icon, note, hidden: false, sort: null },
    fields: [pk()],
  })
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

async function ensureRelation(collection, name, related, onDelete = 'SET NULL') {
  const key = `${collection}.${name}`
  if (relationSet.has(key)) return
  await api('POST', '/relations', {
    collection,
    field: name,
    related_collection: related,
    schema: { on_delete: onDelete },
    meta: {},
  })
  relationSet.add(key)
  console.log(`  ~ ${collection}.${name} -> ${related}`)
}

async function ensureM2O(collection, name, related, note, onDelete = 'SET NULL') {
  await ensureField(collection, name, m2o(note))
  await ensureRelation(collection, name, related, onDelete)
}

async function ensureDependency() {
  await ensureCollection('pm_dependency', 'account_tree', 'Cross-item dependencies, blockers, and related-work links')
  await ensureM2O('pm_dependency', 'product', 'product', 'Product this dependency is tracked from', 'CASCADE')
  await ensureM2O('pm_dependency', 'depends_on_product', 'product', 'Product this item depends on or is related to', 'SET NULL')
  await ensureM2O('pm_dependency', 'project', 'project', 'Project/offer context', 'SET NULL')
  await ensureField('pm_dependency', 'title', string('Short dependency title'))
  await ensureField('pm_dependency', 'dependency_type', select(DEPENDENCY_TYPES, 'Dependency relationship type'))
  await ensureField('pm_dependency', 'status', select(DEPENDENCY_STATUSES, 'Dependency status'))
  await ensureField('pm_dependency', 'waiting_on', string('Person, team, vendor, licensor, or buyer blocking progress'))
  await ensureField('pm_dependency', 'due_at', timestamp('Expected unblock or follow-up date'))
  await ensureField('pm_dependency', 'resolved_at', timestamp('When this dependency was resolved'))
  await ensureField('pm_dependency', 'notes', richText('Dependency notes'))
  await ensureField('pm_dependency', 'source_system', string('Source system for imported/synced dependency'))
  await ensureField('pm_dependency', 'source_id', string('Source id for imported/synced dependency'))
}

async function ensureDecision() {
  await ensureCollection('pm_decision', 'fact_check', 'Structured decision records and approval evidence')
  await ensureM2O('pm_decision', 'product', 'product', 'Product decision context', 'CASCADE')
  await ensureM2O('pm_decision', 'project', 'project', 'Project/offer context', 'SET NULL')
  await ensureField('pm_decision', 'object_collection', string('Collection this decision applies to'))
  await ensureField('pm_decision', 'object_id', string('Item id in object_collection'))
  await ensureField('pm_decision', 'decision_type', select(DECISION_TYPES, 'Decision type'))
  await ensureField('pm_decision', 'status', select(DECISION_STATUSES, 'Decision status'))
  await ensureM2O('pm_decision', 'decided_by', 'directus_users', 'User who made or recorded the decision', 'SET NULL')
  await ensureField('pm_decision', 'decided_at', timestamp('When the decision was made'))
  await ensureField('pm_decision', 'reason', text('Short reason or rationale'))
  await ensureField('pm_decision', 'notes', richText('Decision notes and approval evidence'))
  await ensureField('pm_decision', 'evidence_url', string('URL to proof, portal record, or source evidence'))
  await ensureField('pm_decision', 'source_system', string('Source system for imported/synced decision'))
  await ensureField('pm_decision', 'source_id', string('Source id for imported/synced decision'))
}

async function ensureReminder() {
  await ensureCollection('pm_reminder', 'notifications_active', 'Follow-up reminders and due operational nudges')
  await ensureM2O('pm_reminder', 'product', 'product', 'Product reminder context', 'CASCADE')
  await ensureM2O('pm_reminder', 'project', 'project', 'Project/offer context', 'SET NULL')
  await ensureField('pm_reminder', 'object_collection', string('Collection this reminder applies to'))
  await ensureField('pm_reminder', 'object_id', string('Item id in object_collection'))
  await ensureField('pm_reminder', 'title', string('Reminder title'))
  await ensureField('pm_reminder', 'due_at', timestamp('Reminder due date/time'))
  await ensureM2O('pm_reminder', 'assigned_to', 'directus_users', 'User responsible for the follow-up', 'SET NULL')
  await ensureField('pm_reminder', 'status', select(REMINDER_STATUSES, 'Reminder status'))
  await ensureField('pm_reminder', 'reminder_type', select(REMINDER_TYPES, 'Reminder type'))
  await ensureField('pm_reminder', 'snoozed_until', timestamp('When a snoozed reminder should reappear'))
  await ensureField('pm_reminder', 'completed_at', timestamp('When the reminder was completed'))
  await ensureField('pm_reminder', 'notes', richText('Reminder notes'))
}

async function ensureWorkflowTemplate() {
  await ensureCollection('pm_workflow_template', 'dynamic_form', 'Reusable PM workflow, evidence, and checklist templates')
  await ensureField('pm_workflow_template', 'name', string('Template name'))
  await ensureField('pm_workflow_template', 'business_unit', select(BUSINESS_UNITS, 'Business unit this template applies to'))
  await ensureField('pm_workflow_template', 'object_type', select(TEMPLATE_OBJECT_TYPES, 'Object type this template applies to'))
  await ensureField('pm_workflow_template', 'template_type', select(TEMPLATE_TYPES, 'Workflow template type'))
  await ensureField('pm_workflow_template', 'active', bool('Whether this template is available', true))
  await ensureField('pm_workflow_template', 'description', text('Template description'))
  await ensureField('pm_workflow_template', 'checklist_json', json('Checklist items/groups as JSON'))
  await ensureField('pm_workflow_template', 'required_evidence_json', json('Required evidence/gate checks as JSON'))
  await ensureField('pm_workflow_template', 'default_next_action', text('Default next action when applying the template'))
  await ensureM2O('pm_workflow_template', 'default_owner_role', 'directus_roles', 'Role/team that usually owns the next action', 'SET NULL')
}

async function grantCollectionPermissions(collections) {
  const roles = await api('GET', '/roles?fields=name,policies.policy.id&limit=-1')
  const rolePolicies = roles
    .map((role) => ({ name: role.name, policy: role.policies?.[0]?.policy?.id }))
    .filter((role) => role.policy)
  const existing = await api('GET', '/permissions?fields=id,policy,collection,action&limit=-1')
  const allowedActions = {
    Administrator: ['create', 'read', 'update', 'delete'],
    Designer: ['create', 'read', 'update', 'delete'],
    Sales: ['create', 'read', 'update', 'delete'],
    Licensing: ['create', 'read', 'update', 'delete'],
    Viewer: ['read'],
    Vendor: [],
  }

  async function grant(policy, collection, action, fields = ['*']) {
    if (existing.some((p) => p.policy === policy && p.collection === collection && p.action === action)) return
    await api('POST', '/permissions', { policy, collection, action, fields, permissions: {}, validation: {} })
    existing.push({ policy, collection, action })
    console.log(`  perm ${collection}.${action} -> policy ${String(policy).slice(0, 8)}`)
  }

  for (const { name, policy } of rolePolicies) {
    for (const collection of collections) {
      const actions = allowedActions[name] ?? ['read']
      for (const perm of existing.filter((p) => p.policy === policy && p.collection === collection)) {
        if (actions.includes(perm.action)) continue
        await api('DELETE', `/permissions/${perm.id}`)
        console.log(`  - perm ${collection}.${perm.action} from ${name}`)
      }
      for (const action of actions) await grant(policy, collection, action)
    }
  }
}

async function verify() {
  const collections = await api('GET', '/collections?limit=-1')
  const present = new Set(collections.map((c) => c.collection))
  for (const collection of ['pm_dependency', 'pm_decision', 'pm_reminder', 'pm_workflow_template']) {
    if (!present.has(collection)) throw new Error(`verification failed: missing ${collection}`)
  }
}

async function main() {
  await login()
  await refreshCollections()
  await refreshRelations()

  await ensureDependency()
  await ensureDecision()
  await ensureReminder()
  await ensureWorkflowTemplate()
  await grantCollectionPermissions(['pm_dependency', 'pm_decision', 'pm_reminder', 'pm_workflow_template'])

  await verify()
  console.log('\nPM operating model complete.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
