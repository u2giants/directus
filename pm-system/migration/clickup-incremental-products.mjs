// Incrementally create missing Directus products from current ClickUp list tasks.
//
// This is for live ClickUp board drift after the original bulk product import:
// if ClickUp has a current top-level task that Directus does not yet have,
// create the product row so the PM frontend can see it. Run the work importer
// afterward with PRODUCT_IDS=<created ids> to populate files/comments/etc.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env \
//   DX_URL=https://data.designflow.app \
//   node pm-system/migration/clickup-incremental-products.mjs
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
const EMAIL = process.env.DX_ADMIN_EMAIL, PASSWORD = process.env.DX_ADMIN_PASSWORD
const CU = process.env.CLICKUP_TOKEN
const LIST_ID = process.env.CLICKUP_LIST_ID || '13194624'
const LIST_NAME = process.env.CLICKUP_LIST_NAME || 'Licensing Management'
const BUSINESS_UNIT = process.env.BUSINESS_UNIT || 'POP Creations'
const INCLUDE_CLOSED = process.env.INCLUDE_CLOSED === '1'
const INCLUDE_SUBTASKS = process.env.INCLUDE_SUBTASKS === '1'
let TOKEN = ''

async function dx(method, path, body) {
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
  TOKEN = (await dx('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).access_token
}

async function cu(path) {
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, { headers: { Authorization: CU } })
  const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
  if (!res.ok) throw new Error(`ClickUp ${path} -> ${res.status}: ${text}`)
  return json
}

function msToIso(ms) {
  if (!ms) return null
  const n = Number(ms)
  return Number.isFinite(n) ? new Date(n).toISOString() : null
}

function lifecycleFromStatusType(type) {
  return type === 'closed' || type === 'done' ? 'complete' : 'active'
}

function firstImageUrl(task) {
  const image = (task.attachments || []).find((a) => (a.mimetype || '').startsWith('image/') && a.url)
  return image?.url || null
}

async function stageId(statusName) {
  const rows = await dx('GET', `/items/stage?filter[name][_eq]=${encodeURIComponent(statusName)}&filter[business_unit][_eq]=${encodeURIComponent(BUSINESS_UNIT)}&fields=id&limit=1`)
  if (rows[0]?.id) return rows[0].id
  const list = await cu(`/list/${LIST_ID}`)
  const statuses = list.statuses || []
  const index = statuses.findIndex((status) => status.status === statusName)
  const created = await dx('POST', '/items/stage', {
    name: statusName,
    business_unit: BUSINESS_UNIT,
    stage_order: index >= 0 ? index + 1 : null,
    category: 'design',
  })
  return created.id
}

async function existingExternalIds() {
  const ids = new Map()
  for (let offset = 0;; offset += 500) {
    const rows = await dx('GET', `/items/product?filter[external_source][_eq]=clickup&fields=id,external_id&limit=500&offset=${offset}`)
    for (const row of rows) if (row.external_id) ids.set(String(row.external_id), row.id)
    if (rows.length < 500) break
  }
  return ids
}

async function fetchTasks() {
  const tasks = []
  for (let page = 0;; page++) {
    const data = await cu(`/list/${LIST_ID}/task?archived=false&include_closed=${INCLUDE_CLOSED}&subtasks=${INCLUDE_SUBTASKS}&page=${page}`)
    const batch = data.tasks || []
    tasks.push(...batch)
    if (batch.length < 100) break
  }
  return tasks
}

function productPayload(task, stage) {
  return {
    code: task.custom_id || task.id,
    name: task.name || '(untitled)',
    description: task.description || task.text_content || null,
    business_unit: BUSINESS_UNIT,
    stage,
    lifecycle_state: lifecycleFromStatusType(task.status?.type),
    cover_url: firstImageUrl(task),
    external_id: task.id,
    external_source: 'clickup',
    clickup_url: task.url || null,
    clickup_list_id: task.list?.id || LIST_ID,
    clickup_list_name: task.list?.name || LIST_NAME,
    clickup_parent_id: task.parent || null,
    clickup_top_level_parent_id: task.top_level_parent || null,
    clickup_status: task.status?.status || null,
    clickup_status_type: task.status?.type || null,
    clickup_status_color: task.status?.color || null,
    clickup_status_order: task.status?.orderindex ?? null,
    clickup_created_at: msToIso(task.date_created),
    clickup_updated_at: msToIso(task.date_updated),
    clickup_closed_at: msToIso(task.date_closed),
    clickup_start_at: msToIso(task.start_date),
    clickup_due_at: msToIso(task.due_date),
    clickup_raw: task,
  }
}

await login()
const existing = await existingExternalIds()
const tasks = (await fetchTasks()).filter((task) => INCLUDE_SUBTASKS || !task.parent)
const created = []
let skipped = 0

for (const task of tasks) {
  if (existing.has(String(task.id))) { skipped++; continue }
  const stage = await stageId(task.status?.status || 'unknown')
  const row = await dx('POST', '/items/product', productPayload(task, stage))
  created.push(row)
  console.log(`+ ${row.id} ${task.id} ${task.name}`)
}

console.log(JSON.stringify({
  list: LIST_NAME,
  tasks: tasks.length,
  skipped,
  created: created.length,
  productIds: created.map((row) => row.id),
}, null, 2))
