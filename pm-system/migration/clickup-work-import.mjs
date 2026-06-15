// Import ClickUp task work data into active Poppim collections.
//
// This fills the live work areas added by add-clickup-work-model.mjs:
// product_file, product_update, product_tag, product_field, product_activity,
// plus ClickUp metadata fields on product. It is idempotent per product by
// replacing that product's ClickUp-origin rows before inserting fresh rows.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env \
//   DX_URL=https://data.designflow.app \
//   node pm-system/migration/clickup-work-import.mjs
//
// Optional:
//   LIMIT=100
//   CHECKPOINT_FILE=/tmp/clickup-work-import.checkpoint
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

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
const CU_TOKEN = process.env.CLICKUP_TOKEN
const WORKSPACE = process.env.CLICKUP_WORKSPACE_ID || '2298436'
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity
const PRODUCT_IDS = (process.env.PRODUCT_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)
const CHECKPOINT = process.env.CHECKPOINT_FILE || '/tmp/clickup-work-import.checkpoint'
const PAGE = 500
const CU_MIN_INTERVAL = Number(process.env.CU_MIN_INTERVAL || 800)
const TIME_DAYS = Number(process.env.TIME_DAYS || 3650)
const MAX_UPDATE_BODY = Number(process.env.MAX_UPDATE_BODY || 180000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let TOKEN = ''
let cuLast = 0

function stableId(...parts) {
  return createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex')
}

function msToIso(ms) {
  if (!ms) return null
  const n = Number(ms)
  if (!Number.isFinite(n)) return null
  return new Date(n).toISOString()
}

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
  if (!res.ok) return null
  return res.json()
}

async function cuV3(path) {
  const wait = CU_MIN_INTERVAL - (Date.now() - cuLast)
  if (wait > 0) await sleep(wait)
  cuLast = Date.now()
  const res = await fetch(`https://api.clickup.com/api/v3${path}`, { headers: { Authorization: CU_TOKEN } })
  if (res.status === 429) { await sleep(60000); return cuV3(path) }
  if (!res.ok) return null
  return res.json()
}

function priorityName(task) {
  const p = task.priority
  if (!p) return null
  return p.priority || p.name || String(p)
}

function customFieldValue(field) {
  const value = field.value
  if (value === undefined || value === null || value === '') return null
  const options = field.type_config?.options || []
  const optionName = (id) => {
    const option = options.find((o) => String(o.id) === String(id) || String(o.orderindex) === String(id))
    return option?.name || option?.label || null
  }
  if (field.type === 'drop_down') return optionName(value) || String(value)
  if (field.type === 'labels' && Array.isArray(value)) return value.map(optionName).filter(Boolean).join(', ')
  if (Array.isArray(value)) return value.map((v) => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function customFieldJsonValue(field) {
  const value = field.value
  if (value === undefined || value === null || value === '') return null
  return JSON.stringify(value)
}

async function clearRows(collection, productId) {
  const rows = await dx('GET', `/items/${collection}?filter[product][_eq]=${productId}&filter[source_system][_eq]=clickup&fields=id&limit=-1`)
  for (const row of rows) await dx('DELETE', `/items/${collection}/${row.id}`)
}

async function insertMany(collection, rows) {
  for (const row of rows) await dx('POST', `/items/${collection}`, row)
}

async function comments(taskId) {
  const first = await cu(`/task/${taskId}/comment?start=0`)
  return first?.comments || []
}

async function history(taskId) {
  const v2 = await cu(`/task/${taskId}/history`)
  const v2Items = v2?.history || v2?.items || []
  if (v2Items.length) return v2Items
  const v3 = await cuV3(`/task/${taskId}/activity`)
  return v3?.data || v3?.activity || v3?.items || []
}

function activityText(item) {
  const field = item.field || item.type || item.action || 'activity'
  const before = item.before ?? item.from
  const after = item.after ?? item.to
  if (before !== undefined || after !== undefined) {
    const b = typeof before === 'object' ? (before?.status || before?.name || JSON.stringify(before)) : before
    const a = typeof after === 'object' ? (after?.status || after?.name || JSON.stringify(after)) : after
    return `${field}: ${b ?? '—'} -> ${a ?? '—'}`
  }
  return item.description || item.comment_text || item.text_content || field
}

function linkRows(product, task, productByExternal) {
  const rows = []
  const push = (link, relationType, direction) => {
    const linkedExternal = link.task_id || link.linked_task_id || link.depends_on || link.id || link.task?.id
    if (!linkedExternal) return
    const linked = productByExternal.get(String(linkedExternal))
    rows.push({
      product: product.id,
      linked_product: linked?.id || null,
      linked_external_id: String(linkedExternal),
      linked_title: link.name || link.task?.name || linked?.name || null,
      relation_type: relationType,
      direction,
      created_by: link.user?.username || link.user?.email || link.created_by || null,
      created_at: msToIso(link.date_created || link.created_at),
      source_id: link.id || stableId(product.external_id, relationType, direction, linkedExternal),
      source_system: 'clickup',
      raw: link,
    })
  }
  for (const link of task.linked_tasks || []) push(link, link.link_type || 'linked', link.link_direction || 'outbound')
  for (const link of task.dependencies || []) push(link, 'dependency', 'blocked_by')
  return rows
}

function timeRows(product, entries) {
  return (entries || []).map((entry) => {
    const user = entry.user || {}
    const tags = (entry.tags || []).map((tag) => tag.name).filter(Boolean)
    const duration = Number(entry.duration || 0)
    return {
      product: product.id,
      user_name: user.username || user.email || null,
      user_email: user.email || null,
      started_at: msToIso(entry.start),
      ended_at: msToIso(entry.end),
      duration_ms: Number.isFinite(duration) ? duration : null,
      duration_hours: Number.isFinite(duration) && duration ? String(Math.round((duration / 3600000) * 1000) / 1000) : null,
      billable: Boolean(entry.billable),
      description: entry.description || null,
      tags: tags.join(', ') || null,
      source_id: String(entry.id || stableId(product.external_id, entry.start, entry.duration)),
      source_system: 'clickup',
      raw: entry,
    }
  })
}

function splitText(value, size = MAX_UPDATE_BODY) {
  const text = String(value || '')
  if (text.length <= size) return [text]
  const parts = []
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size))
  return parts
}

function compactCommentRaw(comment) {
  return {
    id: comment.id || null,
    date: comment.date || null,
    user: comment.user || null,
    resolved: comment.resolved ?? null,
    assignee: comment.assignee || null,
    group_assignee: comment.group_assignee || null,
    reactions: comment.reactions || null,
  }
}

function updateRowsFromComments(product, taskComments) {
  const rows = []
  for (const comment of taskComments) {
    const body = comment.text_content || comment.comment_text || ''
    if (!body) continue
    const parts = splitText(body)
    const baseId = comment.id || stableId(product.external_id, comment.date, body)
    parts.forEach((part, index) => {
      rows.push({
        product: product.id,
        body: parts.length === 1 ? part : `[part ${index + 1}/${parts.length}]\n${part}`,
        author_name: comment.user?.username || comment.user?.email || null,
        author_email: comment.user?.email || null,
        happened_at: msToIso(comment.date),
        kind: parts.length === 1 ? 'comment' : 'comment_part',
        source_id: parts.length === 1 ? baseId : `${baseId}:part:${index + 1}`,
        source_system: 'clickup',
        raw: compactCommentRaw(comment),
      })
    })
  }
  return rows
}

async function importProduct(product, { productByExternal, timeByTask, spaceNameMap }) {
  const task = await cu(`/task/${product.external_id}?include_subtasks=false`)
  if (!task) return { failed: true }

  await dx('PATCH', `/items/product/${product.id}`, {
    description: task.description || task.text_content || null,
    priority: priorityName(task),
    clickup_url: task.url || null,
    clickup_list_id: task.list?.id || product.clickup_list_id || null,
    clickup_list_name: task.list?.name || product.clickup_list_name || null,
    clickup_folder_id: (task.folder && !task.folder.hidden) ? String(task.folder.id) : null,
    clickup_folder_name: (task.folder && !task.folder.hidden) ? task.folder.name : null,
    clickup_space_id: task.space?.id ? String(task.space.id) : null,
    clickup_space_name: spaceNameMap?.get(String(task.space?.id)) || null,
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
    clickup_creator_id: String(task.creator?.id ?? '') || null,
    clickup_creator_name: task.creator?.username ?? null,
    clickup_time_estimate_ms: task.time_estimate ?? null,
    clickup_orderindex: task.orderindex ?? null,
    clickup_raw: task,
  })

  for (const collection of ['product_file', 'product_update', 'product_tag', 'product_field', 'product_activity', 'product_link', 'product_time_entry', 'checklist_item']) {
    await clearRows(collection, product.id)
  }

  await insertMany('product_file', (task.attachments || []).map((a) => ({
    product: product.id,
    title: a.title || a.name || a.filename || 'Untitled file',
    file_type: a.extension || null,
    mime_type: a.mimetype || null,
    size: a.size || a.filesize || null,
    source_url: a.url || null,
    thumbnail_url: a.thumbnail_large || a.thumbnail_small || null,
    uploaded_at: msToIso(a.date || a.date_uploaded),
    source_id: a.id || stableId(product.external_id, a.url, a.title),
    source_system: 'clickup',
    raw: a,
  })))

  await insertMany('product_tag', (task.tags || []).map((tag) => ({
    product: product.id,
    name: tag.name || null,
    color: tag.tag_bg || tag.tag_fg || null,
    source_id: tag.name || stableId(product.external_id, tag.name),
    source_system: 'clickup',
  })))

  await insertMany('product_field', (task.custom_fields || [])
    .filter((field) => field.value !== undefined && field.value !== null && field.value !== '')
    .map((field) => ({
      product: product.id,
      name: field.name || field.id || 'Custom field',
      field_type: field.type || null,
      value_text: customFieldValue(field),
      value_json: customFieldJsonValue(field),
      source_id: field.id || stableId(product.external_id, field.name),
      source_system: 'clickup',
      raw: field,
    })))

  const checklistRows = []
  for (const checklist of task.checklists || []) {
    for (const item of checklist.items || []) {
      checklistRows.push({
        product: product.id,
        label: item.name || item.title || '',
        done: Boolean(item.resolved),
        sort: Number(item.orderindex || 0),
        group_name: checklist.name || null,
        source_id: item.id || stableId(product.external_id, checklist.id, item.name),
        source_system: 'clickup',
      })
    }
  }
  await insertMany('checklist_item', checklistRows)

  const taskComments = await comments(product.external_id)
  await insertMany('product_update', updateRowsFromComments(product, taskComments))

  const taskHistory = await history(product.external_id)
  const activityRows = (taskHistory || []).map((item) => ({
    product: product.id,
    action: item.field || item.type || item.action || 'ClickUp activity',
    detail: activityText(item),
    actor_name: item.user?.username || item.user?.email || null,
    happened_at: msToIso(item.date || item.timestamp),
    source_id: item.id || stableId(product.external_id, item.date || item.timestamp, activityText(item)),
    source_system: 'clickup',
    raw: item,
  }))
  await insertMany('product_activity', activityRows)

  const links = linkRows(product, task, productByExternal)
  await insertMany('product_link', links)

  const times = timeRows(product, timeByTask.get(product.external_id))
  await insertMany('product_time_entry', times)

  return {
    files: task.attachments?.length || 0,
    tags: task.tags?.length || 0,
    fields: (task.custom_fields || []).filter((f) => f.value !== undefined && f.value !== null && f.value !== '').length,
    checklist: checklistRows.length,
    comments: taskComments.length,
    activity: activityRows.length,
    links: links.length,
    time: times.length,
  }
}

function loadCheckpoint() {
  if (existsSync(CHECKPOINT)) { try { return JSON.parse(readFileSync(CHECKPOINT, 'utf8')) } catch { /* ignore */ } }
  return { index: 0, processed: 0, failed: 0, files: 0, tags: 0, fields: 0, checklist: 0, comments: 0, activity: 0, links: 0, time: 0 }
}
function saveCheckpoint(c) { writeFileSync(CHECKPOINT, JSON.stringify(c)) }

async function fetchProducts() {
  if (PRODUCT_IDS.length) {
    const filter = encodeURIComponent(JSON.stringify({ id: { _in: PRODUCT_IDS } }))
    return dx('GET', `/items/product?filter=${filter}&fields=id,external_id,name,clickup_list_id,clickup_list_name&limit=-1`)
  }
  const rows = []
  for (let offset = 0;; offset += PAGE) {
    await login()
    const batch = await dx('GET', `/items/product?filter[external_id][_nnull]=true&fields=id,external_id,name,clickup_list_id,clickup_list_name&sort=id&limit=${PAGE}&offset=${offset}`)
    rows.push(...batch)
    if (batch.length < PAGE || rows.length >= LIMIT) break
  }
  return rows.slice(0, LIMIT)
}

async function buildSpaceNameMap() {
  const map = new Map()
  try {
    const spaces = (await cu(`/team/${WORKSPACE}/space?archived=false`))?.spaces || []
    for (const s of spaces) map.set(String(s.id), s.name)
  } catch { /* best effort */ }
  return map
}

async function fetchTimeEntries() {
  const now = Date.now()
  const start = now - TIME_DAYS * 86400000
  const entries = []
  for (let page = 0;; page++) {
    const data = await cu(`/team/${WORKSPACE}/time_entries?start_date=${start}&end_date=${now}&page=${page}`)
    const batch = data?.data || []
    entries.push(...batch)
    if (batch.length < 100) break
  }
  const byTask = new Map()
  for (const entry of entries) {
    const taskId = entry.task?.id
    if (!taskId) continue
    const list = byTask.get(String(taskId)) || []
    list.push(entry)
    byTask.set(String(taskId), list)
  }
  console.log(`[${new Date().toISOString()}] time entries ${entries.length}; matched tasks ${byTask.size}`)
  return byTask
}

async function run() {
  await login()
  const products = await fetchProducts()
  const productByExternal = new Map(products.map((p) => [String(p.external_id), p]))
  const timeByTask = await fetchTimeEntries()
  const spaceNameMap = await buildSpaceNameMap()
  console.log(`[${new Date().toISOString()}] space-name map ${spaceNameMap.size}`)
  const c = loadCheckpoint()
  console.log(`[${new Date().toISOString()}] products ${products.length}; start index ${c.index}`)
  for (; c.index < products.length; c.index++) {
    await login()
    try {
      const result = await importProduct(products[c.index], { productByExternal, timeByTask, spaceNameMap })
      if (result.failed) c.failed++
      else {
        c.files += result.files
        c.tags += result.tags
        c.fields += result.fields
        c.checklist += result.checklist
        c.comments += result.comments
        c.activity += result.activity
        c.links += result.links
        c.time += result.time
      }
    } catch (e) {
      c.failed++
      console.log(`  ! ${products[c.index].id}: ${e.message}`)
    }
    c.processed++
    if (c.processed % 25 === 0) {
      saveCheckpoint(c)
      console.log(`[${new Date().toISOString()}] index ${c.index + 1}/${products.length} | files ${c.files} tags ${c.tags} fields ${c.fields} checklist ${c.checklist} comments ${c.comments} activity ${c.activity} links ${c.links} time ${c.time} failed ${c.failed}`)
    }
  }
  saveCheckpoint(c)
  console.log(`[${new Date().toISOString()}] DONE | files ${c.files} tags ${c.tags} fields ${c.fields} checklist ${c.checklist} comments ${c.comments} activity ${c.activity} links ${c.links} time ${c.time} failed ${c.failed}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
