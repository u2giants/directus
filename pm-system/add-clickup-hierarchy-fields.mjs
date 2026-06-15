// Add ClickUp hierarchy (space > folder > list) and extra task-metadata fields
// to the product collection. Additive/idempotent and safe to re-run.
//
// Fields added (all read-only — managed by the sync/backfill scripts, not users):
//   clickup_space_id, clickup_space_name, clickup_folder_id, clickup_folder_name,
//   clickup_list_id (already present from add-clickup-work-model — ensured here),
//   clickup_creator_id, clickup_creator_name,
//   clickup_time_estimate_ms (bigInteger), clickup_orderindex (string)
//
// Why clickup_orderindex is a string: ClickUp returns it as a 32-decimal-place
// string (e.g. "5.00000000000000000000000000000000") that exceeds float64
// precision. Stored as text; sort by casting to NUMERIC at query time.
// Why clickup_creator_* are two fields: ClickUp users are not necessarily
// Directus users, so we store id+name to preserve identity without a join.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env \
//   DX_URL=https://data.designflow.app \
//   node pm-system/add-clickup-hierarchy-fields.mjs
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

// read-only string/bigInteger field defs (managed by sync scripts)
const roString = { type: 'string', meta: { interface: 'input', readonly: true }, schema: {} }
const roBigInt = { type: 'bigInteger', meta: { interface: 'input', readonly: true }, schema: {} }

// Order matters only for newly-created fields (Directus appends them); kept in
// the spec's grouping order: hierarchy first, then task metadata.
const NEW_FIELDS = [
  ['clickup_space_id', roString],
  ['clickup_space_name', roString],
  ['clickup_folder_id', roString],
  ['clickup_folder_name', roString],
  ['clickup_list_id', roString], // already exists; ensured for completeness
  ['clickup_creator_id', roString],
  ['clickup_creator_name', roString],
  ['clickup_time_estimate_ms', roBigInt],
  ['clickup_orderindex', roString],
]

async function ensureField(collection, field, def) {
  const existing = new Set((await api('GET', `/fields/${collection}`)).map((f) => f.field))
  if (existing.has(field)) { console.log(`  = ${collection}.${field} (exists)`); return }
  await api('POST', `/fields/${collection}`, { field, ...def })
  console.log(`  + ${collection}.${field}`)
}

// Merge new fields into every explicit (non-wildcard) read permission so the
// app roles (Designer, etc.) can read them. Wildcard perms already cover them.
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
  console.log('Adding ClickUp hierarchy/metadata fields to product...')
  for (const [field, def] of NEW_FIELDS) await ensureField('product', field, def)
  await extendReadFields('product', NEW_FIELDS.map(([f]) => f))
  console.log('Done. Field additions are immediate; no Directus restart needed (no Flow changes).')
}

main().catch((e) => { console.error(e); process.exit(1) })
