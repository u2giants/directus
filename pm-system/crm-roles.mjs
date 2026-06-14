// Grant CRM collection access to the existing app roles.
// Idempotent: skips permissions that already exist.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env DX_URL=https://data.designflow.app node pm-system/crm-roles.mjs
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

const CRM_COLLECTIONS = [
  'retailer',
  'buyer',
  'factory',
  'crm_department',
  'crm_opportunity',
  'crm_meeting_note',
  'crm_meeting_note_attendee',
  'crm_licensor_approval_thread',
  'crm_email_message',
  'crm_ignore_rule',
  'crm_ai_model_config',
  'crm_note',
  'crm_task',
]

async function policyIdsForRoles(roleNames) {
  const roles = await api('GET', '/roles?fields=name,policies.policy.id&limit=-1')
  const out = []
  for (const name of roleNames) {
    const role = roles.find((r) => r.name === name)
    const policy = role?.policies?.[0]?.policy?.id
    if (policy) out.push([name, policy])
    else console.log(`! role/policy not found for ${name}`)
  }
  return out
}

async function run() {
  if (!EMAIL || !PASSWORD) throw new Error('DX_ADMIN_EMAIL and DX_ADMIN_PASSWORD are required')
  TOKEN = (await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).access_token
  const policies = await policyIdsForRoles(['Designer', 'Sales', 'Licensing', 'Viewer'])
  const existing = await api('GET', '/permissions?fields=id,policy,collection,action&limit=-1')
  const has = (policy, collection, action) => existing.some((p) => p.policy === policy && p.collection === collection && p.action === action)
  const grant = async (role, policy, collection, action, fields = ['*']) => {
    if (has(policy, collection, action)) return
    await api('POST', '/permissions', { policy, collection, action, fields, permissions: {}, validation: {} })
    existing.push({ policy, collection, action })
    console.log(`  ${role}: ${collection}.${action}`)
  }

  for (const [role, policy] of policies) {
    const canWrite = ['Designer', 'Sales', 'Licensing'].includes(role)
    for (const collection of CRM_COLLECTIONS) {
      await grant(role, policy, collection, 'read')
      if (canWrite && (collection !== 'retailer' || role === 'Sales')) {
        await grant(role, policy, collection, 'create')
        await grant(role, policy, collection, 'update')
      }
    }
    await grant(role, policy, 'directus_users', 'read', ['id', 'first_name', 'last_name', 'email', 'avatar'])
    await grant(role, policy, 'directus_comments', 'read')
    if (canWrite) {
      await grant(role, policy, 'directus_comments', 'create')
      await grant(role, policy, 'directus_comments', 'update')
      await grant(role, policy, 'directus_comments', 'delete')
    }
  }

  console.log('\nCRM roles complete.')
}

run().catch((error) => { console.error('✗', error.message); process.exit(1) })
