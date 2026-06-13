// Add active Poppim homes for the ClickUp work data that does not fit the
// first-pass product/project fields: files, imported comments/updates, tags,
// custom fields, and activity. This is additive/idempotent and safe to re-run.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env \
//   DX_URL=https://data.designflow.app \
//   node pm-system/add-clickup-work-model.mjs
import { readFileSync } from 'node:fs'

if (process.env.POPPIM_ENV_FILE) {
  for (const line of readFileSync(process.env.POPPIM_ENV_FILE, 'utf8').split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#') || !s.includes('=')) continue
    const i = s.indexOf('='); const k = s.slice(0, i).trim(); let v = s.slice(i + 1).trim()
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
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json?.errors?.[0]?.message || text}`)
  return json?.data ?? json
}

async function login() {
  TOKEN = ''
  TOKEN = (await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).access_token
}

const pk = () => ({
  field: 'id',
  type: 'uuid',
  schema: { is_primary_key: true, has_auto_increment: false },
  meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] },
})
const string = { type: 'string', meta: { interface: 'input' }, schema: {} }
const text = { type: 'text', meta: { interface: 'input-multiline' }, schema: {} }
const integer = { type: 'integer', meta: { interface: 'input' }, schema: {} }
const timestamp = { type: 'timestamp', meta: { interface: 'datetime' }, schema: {} }
const json = { type: 'json', meta: { interface: 'input-code', options: { language: 'json' } }, schema: {} }
const m2o = { type: 'uuid', meta: { interface: 'select-dropdown-m2o' }, schema: {} }

async function fields(collection) {
  return new Set((await api('GET', `/fields/${collection}`)).map((f) => f.field))
}

async function ensureField(collection, field, def) {
  const existing = await fields(collection)
  if (existing.has(field)) return
  await api('POST', `/fields/${collection}`, { field, ...def })
  console.log(`  + ${collection}.${field}`)
}

async function ensureCollection(collection, icon, collectionFields) {
  const existing = new Set((await api('GET', '/collections')).map((c) => c.collection))
  if (!existing.has(collection)) {
    await api('POST', '/collections', {
      collection,
      schema: {},
      meta: { icon, hidden: false, sort: null },
      fields: [pk()],
    })
    console.log(`✓ collection ${collection}`)
  }
  for (const [field, def] of collectionFields) await ensureField(collection, field, def)
}

async function ensureRelation(collection, field, related, onDelete = 'CASCADE') {
  const rels = await api('GET', '/relations?limit=-1')
  if (rels.some((r) => r.collection === collection && r.field === field)) return
  await api('POST', '/relations', {
    collection,
    field,
    related_collection: related,
    schema: { on_delete: onDelete },
    meta: {},
  })
  console.log(`  ~ relation ${collection}.${field} -> ${related}`)
}

async function grantAppPolicy(collection, action, fields = ['*']) {
  const roles = await api('GET', '/roles?fields=name,policies.policy.id&limit=-1')
  const policies = roles
    .flatMap((r) => r.policies || [])
    .map((r) => r?.policy?.id)
    .filter(Boolean)
  const existing = await api('GET', '/permissions?limit=-1&fields=id,policy,collection,action')
  for (const policy of new Set(policies)) {
    if (existing.some((p) => p.policy === policy && p.collection === collection && p.action === action)) continue
    await api('POST', '/permissions', { policy, collection, action, fields, permissions: {}, validation: {} })
    console.log(`  perm ${collection}.${action} -> policy ${String(policy).slice(0, 8)}`)
  }
}

async function extendReadFields(collection, newFields) {
  const perms = await api('GET', `/permissions?filter[collection][_eq]=${collection}&filter[action][_eq]=read&limit=-1&fields=id,fields`)
  for (const perm of perms) {
    if (!Array.isArray(perm.fields) || perm.fields.includes('*')) continue
    const merged = [...new Set([...perm.fields, ...newFields])]
    if (merged.length === perm.fields.length) continue
    await api('PATCH', `/permissions/${perm.id}`, { fields: merged })
    console.log(`  perm ${collection}.read fields +${merged.length - perm.fields.length}`)
  }
}

async function main() {
  await login()

  for (const collection of ['product', 'project']) {
    await ensureField(collection, 'description', text)
    await ensureField(collection, 'priority', string)
    await ensureField(collection, 'clickup_url', string)
    await ensureField(collection, 'clickup_list_id', string)
    await ensureField(collection, 'clickup_list_name', string)
    await ensureField(collection, 'clickup_created_at', timestamp)
    await ensureField(collection, 'clickup_updated_at', timestamp)
    await ensureField(collection, 'clickup_closed_at', timestamp)
    await ensureField(collection, 'clickup_start_at', timestamp)
    await ensureField(collection, 'clickup_due_at', timestamp)
    await ensureField(collection, 'clickup_raw', json)
  }

  await extendReadFields('product', [
    'description',
    'priority',
    'clickup_url',
    'clickup_list_id',
    'clickup_list_name',
    'clickup_created_at',
    'clickup_updated_at',
    'clickup_closed_at',
    'clickup_start_at',
    'clickup_due_at',
  ])
  await extendReadFields('project', [
    'description',
    'priority',
    'clickup_url',
    'clickup_list_id',
    'clickup_list_name',
    'clickup_created_at',
    'clickup_updated_at',
    'clickup_closed_at',
    'clickup_start_at',
    'clickup_due_at',
  ])

  await ensureField('checklist_item', 'group_name', string)
  await ensureField('checklist_item', 'source_id', string)
  await ensureField('checklist_item', 'source_system', string)

  await ensureCollection('product_file', 'attach_file', [
    ['product', m2o],
    ['title', string],
    ['file_type', string],
    ['mime_type', string],
    ['size', integer],
    ['source_url', text],
    ['thumbnail_url', text],
    ['stored_url', text],
    ['uploaded_at', timestamp],
    ['source_id', string],
    ['source_system', string],
    ['raw', json],
  ])
  await ensureRelation('product_file', 'product', 'product')

  await ensureCollection('product_update', 'forum', [
    ['product', m2o],
    ['body', text],
    ['author_name', string],
    ['author_email', string],
    ['happened_at', timestamp],
    ['kind', string],
    ['source_id', string],
    ['source_system', string],
    ['raw', json],
  ])
  await ensureRelation('product_update', 'product', 'product')

  await ensureCollection('product_tag', 'sell', [
    ['product', m2o],
    ['name', string],
    ['color', string],
    ['source_id', string],
    ['source_system', string],
  ])
  await ensureRelation('product_tag', 'product', 'product')

  await ensureCollection('product_field', 'fact_check', [
    ['product', m2o],
    ['name', string],
    ['field_type', string],
    ['value_text', text],
    ['value_json', json],
    ['source_id', string],
    ['source_system', string],
    ['raw', json],
  ])
  await ensureRelation('product_field', 'product', 'product')

  await ensureCollection('product_activity', 'history', [
    ['product', m2o],
    ['action', string],
    ['detail', text],
    ['actor_name', string],
    ['happened_at', timestamp],
    ['source_id', string],
    ['source_system', string],
    ['raw', json],
  ])
  await ensureRelation('product_activity', 'product', 'product')

  await ensureCollection('product_link', 'account_tree', [
    ['product', m2o],
    ['linked_product', m2o],
    ['linked_external_id', string],
    ['linked_title', text],
    ['relation_type', string],
    ['direction', string],
    ['created_by', string],
    ['created_at', timestamp],
    ['source_id', string],
    ['source_system', string],
    ['raw', json],
  ])
  await ensureRelation('product_link', 'product', 'product')
  await ensureRelation('product_link', 'linked_product', 'product', 'SET NULL')

  await ensureCollection('product_time_entry', 'timer', [
    ['product', m2o],
    ['user_name', string],
    ['user_email', string],
    ['started_at', timestamp],
    ['ended_at', timestamp],
    ['duration_ms', integer],
    ['duration_hours', string],
    ['billable', { type: 'boolean', meta: { interface: 'boolean' }, schema: { default_value: false } }],
    ['description', text],
    ['tags', text],
    ['source_id', string],
    ['source_system', string],
    ['raw', json],
  ])
  await ensureRelation('product_time_entry', 'product', 'product')

  for (const collection of ['product_file', 'product_update', 'product_tag', 'product_field', 'product_activity', 'product_link', 'product_time_entry']) {
    await grantAppPolicy(collection, 'read')
  }
  for (const collection of ['product_file', 'product_update', 'product_tag', 'product_field', 'product_link', 'product_time_entry']) {
    await grantAppPolicy(collection, 'create')
    await grantAppPolicy(collection, 'update')
    await grantAppPolicy(collection, 'delete')
  }

  console.log('Done. Restart Directus if Data Studio does not show the new collections immediately.')
}

main().catch((e) => { console.error(e); process.exit(1) })
