// Import every non-archived ClickUp list task into Directus products.
//
// This is the broad-coverage pass for ClickUp lists that were outside the
// original product/project migration. It deliberately creates live product
// rows, not archive records, so the custom PM frontend can surface them under
// Licensed, Generic, or Software.
//
// Idempotent by product.external_id + external_source='clickup'. It creates
// missing stage rows from each task's ClickUp status and patches existing
// products with current ClickUp metadata.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env \
//   DX_URL=https://data.designflow.app \
//   node pm-system/migration/clickup-import-workspace-lists.mjs
//
// Optional:
//   ONLY_LISTS=13194624,901103525796
//   INCLUDE_CLOSED=0
//   INCLUDE_SUBTASKS=0
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
const CU_TOKEN = process.env.CLICKUP_TOKEN || process.env.CU_TOKEN
const WORKSPACE = process.env.CLICKUP_WORKSPACE_ID || '2298436'
const INCLUDE_CLOSED = process.env.INCLUDE_CLOSED !== '0'
const INCLUDE_SUBTASKS = process.env.INCLUDE_SUBTASKS !== '0'
const ONLY_LISTS = new Set((process.env.ONLY_LISTS || '').split(',').map((id) => id.trim()).filter(Boolean))
const CU_MIN_INTERVAL = Number(process.env.CU_MIN_INTERVAL || 250)
let TOKEN = ''
let cuLast = 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BUSINESS_UNITS = ['POP Creations', 'Spruce Line', 'Software']
const LIST_OVERRIDES = new Map([
  ['901110768081', { businessUnit: 'Spruce Line', role: 'product' }],
  ['15061838', { businessUnit: 'Spruce Line', role: 'product' }],
  ['901111985957', { businessUnit: 'Spruce Line', role: 'product' }],
  ['901113079677', { businessUnit: 'Spruce Line', role: 'product' }],
  ['192287164', { businessUnit: 'Spruce Line', role: 'product' }],
  ['901103489845', { businessUnit: 'Spruce Line', role: 'product' }],
  ['900500417603', { businessUnit: 'POP Creations', role: 'product' }],
  ['901111970161', { businessUnit: 'POP Creations', role: 'product' }],
  ['901103525796', { businessUnit: 'POP Creations', role: 'product' }],
  ['901104136630', { businessUnit: 'POP Creations', role: 'product' }],
  ['901113451000', { businessUnit: 'Software', role: 'product' }],
  ['901113666704', { businessUnit: 'Software', role: 'product' }],
  ['901113858205', { businessUnit: 'Software', role: 'product' }],
])

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
  const wait = CU_MIN_INTERVAL - (Date.now() - cuLast)
  if (wait > 0) await sleep(wait)
  cuLast = Date.now()
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, { headers: { Authorization: CU_TOKEN } })
  if (res.status === 429) { await sleep(60000); return cu(path) }
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

function priorityName(task) {
  const p = task.priority
  if (!p) return null
  return p.priority || p.name || String(p)
}

function firstImageUrl(task) {
  const image = (task.attachments || []).find((a) => (a.mimetype || '').startsWith('image/') && a.url)
  return image?.url || null
}

function defaultBusinessUnit(spaceName) {
  if (/spruce|edge/i.test(spaceName || '')) return 'Spruce Line'
  if (/designflow|software|development/i.test(spaceName || '')) return 'Software'
  return 'POP Creations'
}

async function ensureBusinessUnitChoice(collection) {
  let field
  try { field = await dx('GET', `/fields/${collection}/business_unit`) } catch { return }
  const choices = field.meta?.options?.choices || []
  const seen = new Set(choices.map((choice) => choice.value))
  const next = [...choices]
  for (const unit of BUSINESS_UNITS) {
    if (!seen.has(unit)) next.push({ text: unit, value: unit })
  }
  if (next.length === choices.length) return
  await dx('PATCH', `/fields/${collection}/business_unit`, {
    meta: {
      ...field.meta,
      options: { ...(field.meta?.options || {}), choices: next },
    },
  })
}

async function ensureBusinessUnitChoices() {
  for (const collection of ['stage', 'product', 'project', 'design', 'season', 'product_submission', 'pm_saved_view']) {
    await ensureBusinessUnitChoice(collection)
  }
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

const stageCache = new Map()
async function stageId(statusName, businessUnit, listId) {
  const name = statusName || 'unknown'
  const key = `${businessUnit}|${name}`.toLowerCase()
  if (stageCache.has(key)) return stageCache.get(key)
  const found = await dx('GET', `/items/stage?filter[name][_eq]=${encodeURIComponent(name)}&filter[business_unit][_eq]=${encodeURIComponent(businessUnit)}&fields=id&limit=1`)
  if (found[0]?.id) {
    stageCache.set(key, found[0].id)
    return found[0].id
  }
  let order = null
  try {
    const list = await cu(`/list/${listId}`)
    const index = (list.statuses || []).findIndex((status) => status.status === name)
    if (index >= 0) order = index + 1
  } catch { /* best effort */ }
  const created = await dx('POST', '/items/stage', {
    name,
    business_unit: businessUnit,
    stage_order: order,
    category: 'design',
  })
  stageCache.set(key, created.id)
  return created.id
}

async function workspaceLists() {
  const spaces = (await cu(`/team/${WORKSPACE}/space?archived=false`)).spaces || []
  const lists = []
  for (const space of spaces) {
    const folders = (await cu(`/space/${space.id}/folder?archived=false`)).folders || []
    for (const folder of folders) {
      for (const list of folder.lists || []) lists.push({ id: String(list.id), name: list.name, space: space.name, folder: folder.name })
    }
    const folderless = (await cu(`/space/${space.id}/list?archived=false`)).lists || []
    for (const list of folderless) lists.push({ id: String(list.id), name: list.name, space: space.name, folder: null })
  }
  return lists.filter((list) => !ONLY_LISTS.size || ONLY_LISTS.has(list.id))
}

async function fetchTasks(listId) {
  const tasks = []
  for (let page = 0;; page++) {
    const data = await cu(`/list/${listId}/task?archived=false&include_closed=${INCLUDE_CLOSED}&subtasks=${INCLUDE_SUBTASKS}&page=${page}`)
    const batch = data.tasks || []
    tasks.push(...batch)
    if (batch.length < 100) break
  }
  return tasks
}

function payload(task, list, stage) {
  const override = LIST_OVERRIDES.get(list.id)
  const businessUnit = override?.businessUnit || defaultBusinessUnit(list.space)
  return {
    code: task.custom_id || task.id,
    name: task.name || '(untitled)',
    description: task.description || task.text_content || null,
    priority: priorityName(task),
    business_unit: businessUnit,
    stage,
    lifecycle_state: lifecycleFromStatusType(task.status?.type),
    cover_url: firstImageUrl(task),
    external_id: task.id,
    external_source: 'clickup',
    clickup_url: task.url || null,
    clickup_list_id: task.list?.id || list.id,
    clickup_list_name: task.list?.name || list.name,
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
await ensureBusinessUnitChoices()
const existing = await existingExternalIds()
const lists = await workspaceLists()
const created = []
const updated = []
let seen = 0

for (const list of lists) {
  const tasks = await fetchTasks(list.id)
  console.log(`${list.space}/${list.folder || '-'} / ${list.name}: ${tasks.length}`)
  for (const task of tasks) {
    seen++
    const businessUnit = LIST_OVERRIDES.get(list.id)?.businessUnit || defaultBusinessUnit(list.space)
    const stage = await stageId(task.status?.status || 'unknown', businessUnit, list.id)
    const body = payload(task, list, stage)
    const id = existing.get(String(task.id))
    if (id) {
      await dx('PATCH', `/items/product/${id}`, body)
      updated.push(id)
      continue
    }
    const row = await dx('POST', '/items/product', body)
    existing.set(String(task.id), row.id)
    created.push(row.id)
    console.log(`+ ${row.id} ${task.id} ${task.name}`)
  }
}

console.log(JSON.stringify({
  lists: lists.length,
  seen,
  created: created.length,
  updated: updated.length,
  productIds: created,
}, null, 2))
