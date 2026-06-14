// Store imported ClickUp product_file attachments in DigitalOcean Spaces.
//
// The work importer records every ClickUp attachment in product_file, but the
// original URL is still ClickUp-owned. This pass downloads the original
// attachment bytes, uploads them unchanged to Spaces, creates a thumbnail for
// images, and patches product_file.stored_url / thumbnail_url.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env \
//   DX_URL=https://data.designflow.app \
//   node pm-system/migration/clickup-files-to-spaces.mjs
//
// Optional:
//   PRODUCT_IDS=<directus product ids>
//   LIMIT=500
//   CHECKPOINT_FILE=/tmp/clickup-files-to-spaces.checkpoint
import { createHash, createHmac } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
const REGION = process.env.DO_SPACES_REGION, BUCKET = process.env.DO_SPACES_NAME
const SP_KEY = process.env.DO_SPACES_KEY, SP_SECRET = process.env.DO_SPACES_SECRET
const SP_HOST = `${BUCKET}.${REGION}.digitaloceanspaces.com`
const PUBLIC_BASE = `https://${SP_HOST}`
const CHECKPOINT = process.env.CHECKPOINT_FILE || '/tmp/clickup-files-to-spaces.checkpoint'
const PRODUCT_IDS = (process.env.PRODUCT_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity
const PAGE = 100
const CONCURRENCY = Number(process.env.CONCURRENCY || 4)
const THUMB_DIM = 400
const THUMB_QUALITY = 80
const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}
let TOKEN = ''

async function dx(method, path, body, retried = false) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
  if ((res.status === 401 || res.status === 403) && !retried) {
    await login()
    return dx(method, path, body, true)
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json?.errors?.[0]?.message || text}`)
  return json?.data ?? json
}

async function login() {
  TOKEN = ''
  TOKEN = (await dx('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).access_token
}

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

function loadCheckpoint() {
  if (existsSync(CHECKPOINT)) { try { return JSON.parse(readFileSync(CHECKPOINT, 'utf8')) } catch { /* ignore */ } }
  return { processed: 0, uploaded: 0, thumb: 0, skipped: 0, failed: 0 }
}
function saveCheckpoint(c) { writeFileSync(CHECKPOINT, JSON.stringify(c)) }

function extFrom(contentType, url, fileType) {
  const ct = (contentType || '').split(';')[0].trim().toLowerCase()
  if (EXT_BY_TYPE[ct]) return EXT_BY_TYPE[ct]
  const ft = (fileType || '').toLowerCase().replace(/^\./, '')
  if (ft) return ft.replace('jpeg', 'jpg')
  const m = (url || '').split('?')[0].match(/\.([a-z0-9]{2,8})$/i)
  return m?.[1]?.toLowerCase().replace('jpeg', 'jpg') || 'bin'
}

function isImage(mimeType, ext) {
  return (mimeType || '').startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes((ext || '').toLowerCase())
}

async function putThumb(file, buf) {
  const thumb = await sharp(buf, { failOn: 'none' })
    .rotate()
    .resize({ width: THUMB_DIM, height: THUMB_DIM, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer()
  if (!thumb?.length) return null
  const key = `product-files/${file.product}/${file.id}_thumb.webp`
  await s3Put(key, thumb, 'image/webp')
  return `${PUBLIC_BASE}/${key}`
}

async function migrateOne(file, c) {
  if (file.stored_url) { c.skipped++; return }
  if (!file.source_url) { c.skipped++; return }
  let res
  try { res = await fetch(file.source_url) } catch { c.failed++; return }
  if (!res.ok) { c.failed++; return }
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length) { c.failed++; return }
  const contentType = res.headers.get('content-type') || file.mime_type || 'application/octet-stream'
  const ext = extFrom(contentType, file.source_url, file.file_type)
  const key = `product-files/${file.product}/${file.id}.${ext}`
  try { await s3Put(key, buf, contentType) } catch (e) { console.log(`  ! put ${file.id}: ${e.message}`); c.failed++; return }
  let thumbnail_url = file.thumbnail_url || null
  if (isImage(contentType, ext)) {
    try {
      thumbnail_url = await putThumb(file, buf) || thumbnail_url
      if (thumbnail_url?.includes('digitaloceanspaces.com')) c.thumb++
    } catch (e) { console.log(`  ~ thumb ${file.id}: ${e.message}`) }
  }
  try {
    await dx('PATCH', `/items/product_file/${file.id}`, {
      stored_url: `${PUBLIC_BASE}/${key}`,
      thumbnail_url,
    })
    c.uploaded++
  } catch (e) {
    console.log(`  ! patch ${file.id}: ${e.message}`)
    c.failed++
  }
}

async function pmap(items, limit, fn) {
  let idx = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const i = idx++; if (i >= items.length) break; await fn(items[i], i) }
  }))
}

async function fetchBatch() {
  const filters = ['filter[source_url][_nempty]=true', 'filter[stored_url][_empty]=true']
  if (PRODUCT_IDS.length) filters.push(`filter[product][_in]=${PRODUCT_IDS.map(encodeURIComponent).join(',')}`)
  return dx('GET', `/items/product_file?${filters.join('&')}&fields=id,product,title,file_type,mime_type,source_url,thumbnail_url,stored_url&sort=id&limit=${PAGE}`)
}

async function run() {
  await login()
  const c = loadCheckpoint()
  console.log(`[${new Date().toISOString()}] start uploaded=${c.uploaded} failed=${c.failed}`)
  for (;;) {
    const batch = await fetchBatch()
    if (!batch.length) break
    await pmap(batch, CONCURRENCY, (file) => migrateOne(file, c))
    c.processed += batch.length
    saveCheckpoint(c)
    console.log(`[${new Date().toISOString()}] processed ${c.processed} uploaded ${c.uploaded} thumb ${c.thumb} skipped ${c.skipped} failed ${c.failed}`)
    if (batch.length < PAGE || c.processed >= LIMIT) break
  }
  saveCheckpoint(c)
  console.log(`[${new Date().toISOString()}] DONE uploaded ${c.uploaded} thumb ${c.thumb} skipped ${c.skipped} failed ${c.failed}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
