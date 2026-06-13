// Migrate product cover images to DigitalOcean Spaces as ORIGINAL files (no
// resizing / re-encoding) and repoint product.cover_url at the Spaces URL.
//
// One unified pass that supersedes clickup-images-recover.mjs +
// spaces-cover-upload.mjs. For each product with a ClickUp external_id:
//
//   - cover_url already a Spaces ORIGINAL (non-.webp) URL  -> done, skip
//   - cover_url a working ClickUp URL (clickup-attachments.com, not _large)
//        -> download that original directly (no ClickUp API call)
//   - otherwise (a resized _.webp we wrote earlier, a dead _large thumbnail,
//     or empty) -> ask the ClickUp API (via external_id) for the first image
//     attachment's full public `url`, then download that original
//
// The original bytes are uploaded verbatim to the public `poppim` Space at
// covers/<product-id>.<ext>; cover_url becomes the Spaces URL. A small webp
// thumbnail is ALSO generated (sharp, <=400px) and uploaded to
// covers/<product-id>_thumb.webp for the kanban cards — the board shows the
// thumbnail, the opened card shows the full original. Any stale
// covers/<id>.webp from a prior pass is deleted.
//
// Resumable via an offset checkpoint. ClickUp API calls are rate-limited to
// ~85/min; direct CDN downloads + Spaces uploads run concurrently per page.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env \
//   DX_URL=https://data.designflow.app \
//   node pm-system/migration/clickup-to-spaces.mjs
import { createHash, createHmac } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'

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
const REGION = process.env.DO_SPACES_REGION, BUCKET = process.env.DO_SPACES_NAME
const SP_KEY = process.env.DO_SPACES_KEY, SP_SECRET = process.env.DO_SPACES_SECRET
const SP_HOST = `${BUCKET}.${REGION}.digitaloceanspaces.com`
const PUBLIC_BASE = `https://${SP_HOST}`
const CHECKPOINT = process.env.CHECKPOINT_FILE || '/tmp/clickup-to-spaces.checkpoint'
const PAGE = 100
const CONCURRENCY = 4
const CU_MIN_INTERVAL = 700 // ms between ClickUp API calls (~85/min, under the ~100/min cap)
const THUMB_DIM = 400 // kanban-card thumbnail longest side (cards are ~280px; 400 gives retina headroom)
const THUMB_QUALITY = 80
const IMG = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
async function login() { TOKEN = ''; TOKEN = (await dx('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).access_token }

// --- ClickUp API, serialized + rate-limited via a shared gate ---
let cuChain = Promise.resolve()
let cuLast = 0
function cuGate() {
  // chain calls so they run one-at-a-time, each at least CU_MIN_INTERVAL apart
  const p = cuChain.then(async () => {
    const wait = CU_MIN_INTERVAL - (Date.now() - cuLast)
    if (wait > 0) await sleep(wait)
    cuLast = Date.now()
  })
  cuChain = p.catch(() => {})
  return p
}
async function clickupImageUrl(taskId) {
  await cuGate()
  const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}?include_subtasks=false`, { headers: { Authorization: CU } })
  if (res.status === 429) { await sleep(60000); return clickupImageUrl(taskId) }
  if (!res.ok) return null // task fetch failed -> retry on a later run
  const d = await res.json()
  const img = (d.attachments || []).find((a) => IMG.has((a.extension || '').toLowerCase()) && a.url)
  return img ? (img.url || '') : '' // '' = no image attachment
}

// --- DigitalOcean Spaces (S3) via a dependency-free SigV4 signer ---
function sigv4(method, key, payloadHash, extraHeaders) {
  const now = new Date()
  const amzdate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const datestamp = amzdate.slice(0, 8)
  const headers = { host: SP_HOST, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzdate, ...extraHeaders }
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort()
  const canonHeaders = names.map((n) => `${n}:${headers[Object.keys(headers).find((k) => k.toLowerCase() === n)]}`).join('\n') + '\n'
  const signedHeaders = names.join(';')
  const canonReq = `${method}\n/${key}\n\n${canonHeaders}\n${signedHeaders}\n${payloadHash}`
  const scope = `${datestamp}/${REGION}/s3/aws4_request`
  const strToSign = `AWS4-HMAC-SHA256\n${amzdate}\n${scope}\n${createHash('sha256').update(canonReq).digest('hex')}`
  const hmac = (k, d) => createHmac('sha256', k).update(d).digest()
  let s = hmac('AWS4' + SP_SECRET, datestamp); s = hmac(s, REGION); s = hmac(s, 's3'); s = hmac(s, 'aws4_request')
  const sig = createHmac('sha256', s).update(strToSign).digest('hex')
  return { Authorization: `AWS4-HMAC-SHA256 Credential=${SP_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`, 'x-amz-date': amzdate, 'x-amz-content-sha256': payloadHash, ...extraHeaders }
}
async function s3Put(key, body, contentType) {
  const payloadHash = createHash('sha256').update(body).digest('hex')
  const headers = sigv4('PUT', key, payloadHash, { 'x-amz-acl': 'public-read' })
  const res = await fetch(`${PUBLIC_BASE}/${key}`, { method: 'PUT', headers: { ...headers, 'Content-Type': contentType }, body })
  if (!res.ok) throw new Error(`S3 PUT ${key} -> ${res.status}: ${await res.text()}`)
}
async function s3Delete(key) {
  const payloadHash = createHash('sha256').update('').digest('hex')
  const headers = sigv4('DELETE', key, payloadHash, {})
  await fetch(`${PUBLIC_BASE}/${key}`, { method: 'DELETE', headers }) // best-effort
}
// Public objects are readable without signing — a plain HEAD is enough.
async function s3Exists(key) {
  try { const r = await fetch(`${PUBLIC_BASE}/${key}`, { method: 'HEAD' }); return r.ok } catch { return false }
}

// Generate + upload the kanban-card thumbnail from the original image bytes.
async function putThumb(id, buf) {
  const thumb = await sharp(buf, { failOn: 'none' })
    .rotate()
    .resize({ width: THUMB_DIM, height: THUMB_DIM, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer()
  if (thumb?.length) await s3Put(`covers/${id}_thumb.webp`, thumb, 'image/webp')
}

function extFrom(contentType, url) {
  const ct = (contentType || '').split(';')[0].trim().toLowerCase()
  if (EXT_BY_TYPE[ct]) return EXT_BY_TYPE[ct]
  const m = (url || '').split('?')[0].match(/\.(png|jpe?g|webp|gif)$/i)
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : null
}

function isSpacesOriginal(url) { return !!url && url.includes('digitaloceanspaces.com') && !url.endsWith('.webp') }
function isWorkingClickup(url) { return !!url && url.includes('clickup-attachments.com') && !url.includes('_large') }
function isStaleWebp(url) { return !!url && url.includes('digitaloceanspaces.com') && url.endsWith('.webp') }

function loadCheckpoint() {
  if (existsSync(CHECKPOINT)) { try { return JSON.parse(readFileSync(CHECKPOINT, 'utf8')) } catch { /* ignore */ } }
  return { offset: 0, processed: 0, uploaded: 0, done: 0, thumbOnly: 0, noImage: 0, failed: 0 }
}
function saveCheckpoint(c) { writeFileSync(CHECKPOINT, JSON.stringify(c)) }

// Resolve the ClickUp original URL to download for a product (or a sentinel).
async function resolveSource(p) {
  if (isWorkingClickup(p.cover_url)) return p.cover_url // direct, no API
  return clickupImageUrl(p.external_id) // API: full url, '' (no image), or null (failed)
}

async function migrateOne(p, c) {
  // Already a Spaces original: nothing to re-fetch — just make sure the
  // kanban thumbnail exists (backfills covers written before thumbs were added).
  if (isSpacesOriginal(p.cover_url)) {
    if (await s3Exists(`covers/${p.id}_thumb.webp`)) { c.done++; return }
    try {
      const r = await fetch(p.cover_url); if (!r.ok) return
      await putThumb(p.id, Buffer.from(await r.arrayBuffer()))
      c.thumbOnly = (c.thumbOnly || 0) + 1
    } catch (e) { console.log(`  ~ thumb-backfill ${p.id}: ${e.message}`) }
    return
  }

  const src = await resolveSource(p)
  if (src === null) return // fetch failed; leave as-is, retry next run
  if (src === '') {
    if (p.cover_url !== '') { try { await dx('PATCH', `/items/product/${p.id}`, { cover_url: '' }) } catch { /* skip */ } }
    c.noImage++; return
  }
  let res
  try { res = await fetch(src) } catch { c.failed++; return }
  if (!res.ok) { c.failed++; return }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) { c.failed++; return }
  const ext = extFrom(res.headers.get('content-type'), src)
  if (!ext) { c.failed++; return }

  const key = `covers/${p.id}.${ext}`
  try { await s3Put(key, buf, res.headers.get('content-type') || `image/${ext === 'jpg' ? 'jpeg' : ext}`) }
  catch (e) { console.log(`  ! put ${p.id}: ${e.message}`); c.failed++; return }

  // Thumbnail for the kanban cards (the opened card uses the full original above).
  try { await putThumb(p.id, buf) }
  catch (e) { console.log(`  ~ thumb ${p.id}: ${e.message}`) } // non-fatal: card falls back to original

  if (isStaleWebp(p.cover_url) && ext !== 'webp') { try { await s3Delete(`covers/${p.id}.webp`) } catch { /* ignore */ } }

  try { await dx('PATCH', `/items/product/${p.id}`, { cover_url: `${PUBLIC_BASE}/${key}` }); c.uploaded++ }
  catch (e) { console.log(`  ! patch ${p.id}: ${e.message}`); c.failed++ }
}

async function pmap(items, limit, fn) {
  let idx = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const i = idx++; if (i >= items.length) break; await fn(items[i], i) }
  }))
}

async function run() {
  await login()
  const c = loadCheckpoint()
  console.log(`[${new Date().toISOString()}] start offset ${c.offset} (uploaded=${c.uploaded} done=${c.done} noImage=${c.noImage} failed=${c.failed})`)

  // SKIP_EMPTY=1 limits the run to products that already have a cover_url —
  // useful for fixing the handful left non-migrated by transient Directus 502s
  // without re-crawling the ~12.8k empties through the ClickUp API again.
  const emptyFilter = process.env.SKIP_EMPTY ? '&filter[cover_url][_nempty]=true' : ''
  for (;;) {
    let batch
    try {
      await login()
      batch = await dx('GET', `/items/product?filter[external_id][_nnull]=true${emptyFilter}&fields=id,external_id,cover_url&sort=id&limit=${PAGE}&offset=${c.offset}`)
    } catch (e) {
      console.log(`[${new Date().toISOString()}] batch fetch failed (${e.message}); retry in 30s`); await sleep(30000); continue
    }
    if (!batch.length) break

    await pmap(batch, CONCURRENCY, async (p) => { await migrateOne(p, c); c.processed++ })

    c.offset += batch.length
    saveCheckpoint(c)
    console.log(`[${new Date().toISOString()}] offset ${c.offset} | uploaded ${c.uploaded} done ${c.done} thumbOnly ${c.thumbOnly||0} noImage ${c.noImage} failed ${c.failed}`)
    if (batch.length < PAGE) break
  }

  saveCheckpoint(c)
  console.log(`[${new Date().toISOString()}] DONE: uploaded ${c.uploaded} done ${c.done} thumbOnly ${c.thumbOnly||0} noImage ${c.noImage} failed ${c.failed}`)
}
run().catch((e) => { console.error(e); process.exit(1) })
