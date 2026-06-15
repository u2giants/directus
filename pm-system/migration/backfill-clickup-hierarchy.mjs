// Backfill ClickUp hierarchy (space/folder/list) and extra task metadata
// (creator, time_estimate, orderindex) onto existing Directus product rows.
//
// Two passes:
//   Phase A  — build the space>folder>list tree from ClickUp (3-5 API calls).
//   Phase B/C (hierarchy) — resolve each product by clickup_list_name, then
//              batch-update products grouped by list_id (one PATCH per list).
//              Ambiguous list names are disambiguated via the task endpoint.
//   Phase D  (metadata) — for each list, page through its tasks and write
//              clickup_creator_id/name, clickup_time_estimate_ms, clickup_orderindex
//              per product (orderindex is unique, so these are per-task writes).
//
// DRY RUN BY DEFAULT. Set APPLY=1 to write. The metadata pass checkpoints by
// list so it is resumable.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env \
//   DX_URL=https://data.designflow.app \
//   APPLY=1 node pm-system/migration/backfill-clickup-hierarchy.mjs
//
// Optional:
//   SKIP_HIERARCHY=1   only run the metadata pass
//   SKIP_METADATA=1    only run the hierarchy pass
//   CU_MIN_INTERVAL=650  ClickUp request spacing (ms; ~92 req/min)
//   WRITE_CONCURRENCY=8  parallel Directus PATCHes in the metadata pass
//   CHECKPOINT_FILE=/tmp/backfill-clickup-hierarchy.checkpoint
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
const CU_TOKEN = process.env.CLICKUP_TOKEN || process.env.CU_TOKEN
const WORKSPACE = process.env.CLICKUP_WORKSPACE_ID || '2298436'
const APPLY = process.env.APPLY === '1'
const SKIP_HIERARCHY = process.env.SKIP_HIERARCHY === '1'
const SKIP_METADATA = process.env.SKIP_METADATA === '1'
const INCLUDE_CLOSED = process.env.INCLUDE_CLOSED !== '0'
const INCLUDE_SUBTASKS = process.env.INCLUDE_SUBTASKS !== '0'
const CU_MIN_INTERVAL = Number(process.env.CU_MIN_INTERVAL || 650)
const WRITE_CONCURRENCY = Number(process.env.WRITE_CONCURRENCY || 8)
const CHECKPOINT = process.env.CHECKPOINT_FILE || '/tmp/backfill-clickup-hierarchy.checkpoint'
const PAGE = 500
const BATCH = 500
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let TOKEN = ''
let cuLast = 0

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

// ClickUp task URL → task id (last path segment). external_id is preferred
// when available since it already IS the task id.
function extractTaskId(url) {
  if (!url) return null
  const parts = String(url).split('/').filter(Boolean)
  return parts[parts.length - 1]
}

// ---- Phase A: build the hierarchy tree -------------------------------------
async function buildTree() {
  const byListId = new Map()
  const byListName = new Map()
  const spaceNameMap = new Map()
  const addList = (loc) => {
    byListId.set(loc.list_id, loc)
    if (!byListName.has(loc.list_name)) byListName.set(loc.list_name, new Set())
    byListName.get(loc.list_name).add(loc.list_id)
  }
  const spaces = (await cu(`/team/${WORKSPACE}/space?archived=false`)).spaces || []
  for (const space of spaces) {
    spaceNameMap.set(String(space.id), space.name)
    const folders = (await cu(`/space/${space.id}/folder?archived=false`)).folders || []
    for (const folder of folders) {
      for (const list of folder.lists || []) {
        addList({
          list_id: String(list.id), list_name: list.name,
          folder_id: String(folder.id), folder_name: folder.name,
          space_id: String(space.id), space_name: space.name,
        })
      }
    }
    const folderless = (await cu(`/space/${space.id}/list?archived=false`)).lists || []
    for (const list of folderless) {
      addList({
        list_id: String(list.id), list_name: list.name,
        folder_id: null, folder_name: null,
        space_id: String(space.id), space_name: space.name,
      })
    }
  }
  console.log(`Phase A: ${spaces.length} spaces, ${byListId.size} lists`)
  return { byListId, byListName, spaceNameMap }
}

async function allProducts(fields) {
  const rows = []
  for (let offset = 0;; offset += PAGE) {
    await login()
    const batch = await dx('GET', `/items/product?filter[external_id][_nnull]=true&fields=${fields}&sort=id&limit=${PAGE}&offset=${offset}`)
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows
}

// ---- Phase B/C: hierarchy ---------------------------------------------------
async function backfillHierarchy({ byListId, byListName }) {
  const products = (await allProducts('id,clickup_list_name,clickup_url,external_id'))
    .filter((p) => p.clickup_list_name)
  console.log(`Phase B: ${products.length} products with a clickup_list_name`)

  const groups = new Map() // list_id -> { loc, ids[] }
  let unmatched = 0, ambiguous = 0
  for (const product of products) {
    const nameIds = byListName.get(product.clickup_list_name)
    let loc = null
    if (nameIds?.size === 1) {
      loc = byListId.get([...nameIds][0])
    } else if (nameIds?.size > 1) {
      ambiguous++
      const taskId = product.external_id || extractTaskId(product.clickup_url)
      try {
        const task = await cu(`/task/${taskId}`)
        loc = byListId.get(String(task.list?.id))
      } catch { /* fall through to unmatched */ }
    }
    if (!loc) { unmatched++; continue }
    if (!groups.has(loc.list_id)) groups.set(loc.list_id, { loc, ids: [] })
    groups.get(loc.list_id).ids.push(product.id)
  }
  console.log(`Phase C: ${groups.size} list groups; ambiguous resolved ${ambiguous}; unmatched ${unmatched}`)

  let written = 0
  for (const { loc, ids } of groups.values()) {
    const data = {
      clickup_list_id: loc.list_id,
      clickup_folder_id: loc.folder_id,
      clickup_folder_name: loc.folder_name,
      clickup_space_id: loc.space_id,
      clickup_space_name: loc.space_name,
    }
    for (let i = 0; i < ids.length; i += BATCH) {
      const keys = ids.slice(i, i + BATCH)
      if (APPLY) { await login(); await dx('PATCH', '/items/product', { keys, data }) }
      written += keys.length
    }
    console.log(`  ${APPLY ? 'updated' : 'would update'} ${ids.length} -> ${loc.space_name} / ${loc.folder_name ?? '(no folder)'} / ${loc.list_name}`)
  }
  console.log(`Phase C ${APPLY ? 'wrote' : 'would write'} hierarchy for ${written} products`)
}

// ---- Phase D: per-task metadata --------------------------------------------
async function pool(items, size, worker) {
  let i = 0
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx], idx) }
  })
  await Promise.all(runners)
}

function loadCheckpoint() {
  if (existsSync(CHECKPOINT)) { try { return JSON.parse(readFileSync(CHECKPOINT, 'utf8')) } catch { /* ignore */ } }
  return { doneLists: [], written: 0, matched: 0, unmatched: 0 }
}
function saveCheckpoint(c) { writeFileSync(CHECKPOINT, JSON.stringify(c)) }

async function backfillMetadata({ byListId }) {
  // external_id -> product.id (only ClickUp-sourced products)
  const productByExternal = new Map(
    (await allProducts('id,external_id')).map((p) => [String(p.external_id), p.id])
  )
  console.log(`Phase D: ${productByExternal.size} products indexed by external_id`)

  const c = loadCheckpoint()
  const done = new Set(c.doneLists)
  const lists = [...byListId.values()]
  for (const loc of lists) {
    if (done.has(loc.list_id)) continue
    const updates = []
    for (let page = 0;; page++) {
      const data = await cu(`/list/${loc.list_id}/task?archived=false&include_closed=${INCLUDE_CLOSED}&subtasks=${INCLUDE_SUBTASKS}&page=${page}`)
      const tasks = data.tasks || []
      for (const task of tasks) {
        const productId = productByExternal.get(String(task.id))
        if (!productId) { c.unmatched++; continue }
        c.matched++
        updates.push({
          id: productId,
          data: {
            clickup_creator_id: String(task.creator?.id ?? '') || null,
            clickup_creator_name: task.creator?.username ?? null,
            clickup_time_estimate_ms: task.time_estimate ?? null,
            clickup_orderindex: task.orderindex ?? null,
          },
        })
      }
      if (tasks.length < 100) break
    }
    if (APPLY && updates.length) {
      await login()
      await pool(updates, WRITE_CONCURRENCY, async (u) => { await dx('PATCH', `/items/product/${u.id}`, u.data) })
    }
    c.written += updates.length
    done.add(loc.list_id); c.doneLists = [...done]
    saveCheckpoint(c)
    console.log(`  ${loc.space_name} / ${loc.list_name}: ${APPLY ? 'wrote' : 'would write'} ${updates.length} (cum ${c.written}, unmatched ${c.unmatched})`)
  }
  console.log(`Phase D ${APPLY ? 'wrote' : 'would write'} metadata for ${c.written} products; matched ${c.matched}, unmatched ${c.unmatched}`)
}

async function main() {
  if (!CU_TOKEN) throw new Error('CLICKUP_TOKEN missing')
  await login()
  console.log(APPLY ? '*** APPLY mode — writing to Directus ***' : '*** DRY RUN — no writes (set APPLY=1) ***')
  const tree = await buildTree()
  if (!SKIP_HIERARCHY) await backfillHierarchy(tree)
  if (!SKIP_METADATA) await backfillMetadata(tree)
  console.log('DONE')
}

main().catch((e) => { console.error(e); process.exit(1) })
