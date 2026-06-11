// Backfill product cover images from ClickUp attachments.
// For each product with an external_id (ClickUp task id) and no cover_url yet,
// fetch the ClickUp task, take the first image attachment's (public) URL, and
// store it on product.cover_url. Resumable (skips products that already have one),
// rate-limited for ClickUp's ~100 req/min.
//
// NOTE: cover_url points at ClickUp's CDN (public). Durable long-term storage =
// copy these into the DAM / R2 later; for now this just surfaces the images.
//
// Usage: POPPIM_ENV_FILE=/home/ai/.directus-deploy.env DX_URL=https://data.designflow.app node pm-system/migration/clickup-images.mjs
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
const IMG = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let TOKEN = ''

async function dx(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json?.errors?.[0]?.message || text}`)
  return json?.data ?? json
}
async function login() {
  TOKEN = '' // clear any stale/expired token so the login request isn't rejected with its own old bearer
  TOKEN = (await dx('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).access_token
}

async function clickupImage(taskId) {
  const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}?include_subtasks=false`, { headers: { Authorization: CU } })
  if (res.status === 429) { await sleep(60000); return clickupImage(taskId) } // rate limited — wait a minute
  if (!res.ok) return null
  const d = await res.json()
  const img = (d.attachments || []).find((a) => IMG.has((a.extension || '').toLowerCase()) && a.url)
  // prefer a thumbnail (full-size attachments are multi-MB and bad for board cards)
  return img ? img.thumbnail_large || img.thumbnail_small || img.url : ''
}

async function run() {
  await login()
  let processed = 0, withImage = 0, page = 0
  const PAGE = 100
  for (;;) {
    // refresh token each page (tokens expire ~15min); resilient to transient failures
    let batch
    try {
      await login()
      batch = await dx('GET', `/items/product?filter[external_id][_nnull]=true&filter[cover_url][_null]=true&fields=id,external_id&limit=${PAGE}`)
    } catch (e) {
      console.log(`[${new Date().toISOString()}] batch fetch failed (${e.message}); retrying in 30s`)
      await sleep(30000)
      continue
    }
    if (!batch.length) break
    for (const p of batch) {
      let url
      try { url = await clickupImage(p.external_id) } catch { url = '' }
      // store '' (no image) too, so we don't re-check it next run
      try { await dx('PATCH', `/items/product/${p.id}`, { cover_url: url || '' }) } catch { /* skip */ }
      if (url) withImage++
      processed++
      if (processed % 100 === 0) console.log(`[${new Date().toISOString()}] processed ${processed}, with image ${withImage}`)
      await sleep(700) // ~85 req/min, under ClickUp's limit
    }
    page++
    if (batch.length < PAGE) break
  }
  console.log(`DONE: processed ${processed}, with image ${withImage}`)
}
run().catch((e) => { console.error(e); process.exit(1) })
