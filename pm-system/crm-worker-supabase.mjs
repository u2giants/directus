// CRM companion worker — Supabase port of crm-worker.mjs.
//
// Same commands and HTTP endpoints as the Directus worker, but persistence goes
// to the shared Supabase backend (see u2giants/shared-db) with the service-role
// key. The original Directus worker (crm-worker.mjs) is kept for rollback.
//
// Collection/field mapping (Directus -> shared Supabase):
//   retailer / ingested_domains -> core.customer       (customers = customer_status in ACTIVE/POTENTIAL)
//   buyer / ingested_contact    -> core.contact (+ core.contact_company for scope/type/department)
//   crm_department              -> crm.department      (retailer->company_id, primary_buyer->primary_contact_id)
//   crm_opportunity             -> crm.opportunity     (retailer->company_id, department->department_id, project->project_id)
//   crm_email_message           -> crm.email_message   (retailer->company_id, department->department_id, opportunity->opportunity_id)
//   crm_meeting_note            -> crm.meeting_note     (name->title, date->meeting_at, summary->body)
//   crm_ignore_rule             -> crm.ignore_rule
//   crm_ai_model_config         -> crm.ai_model_config
//   crm_meeting_note_attendee   -> (no shared table yet) stored as participants text + metadata
//
// Commands:
//   outlook-ingest | reroute | fireflies-server | contact-sync | summarize | apply-ignore-rules
//
// Env:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env
//   SUPABASE_URL=https://tcscehehgeiijilylezv.supabase.co   (preview first)
//   SUPABASE_SERVICE_ROLE_KEY=<server-only>                 (NEVER expose to the browser)
//   MS_TENANT_ID/MS_CLIENT_ID/MS_CLIENT_SECRET or AZURE_* ; OUTLOOK_MAILBOX ; OUTLOOK_GATED
//   FIREFLIES_API_KEY, FIREFLIES_WEBHOOK_SECRET, OPENROUTER_API_KEY, PORT=8787
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

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

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
})
const crm = (t) => sb.schema('crm').from(t)
const core = (t) => sb.schema('core').from(t)
const must = (res) => { if (res.error) throw new Error(res.error.message); return res.data }

const INTERNAL_DOMAIN = 'popcre.com'
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const LOGIN_BASE = 'https://login.microsoftonline.com'
const PAGE_SIZE = 50
const LOOKBACK_MINUTES = Number(process.env.OUTLOOK_LOOKBACK_MINUTES || 20)
const FIREFLIES_BASE = 'https://api.fireflies.ai/graphql'
const CUSTOMERS = ['ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER']

const NOISE_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'clickup.com',
  'teams.mail.microsoft.com', 'fireflies.ai', 'sharepointonline.com', 'avanan-mail.net',
])
const NOISE_PREFIXES = ['notification.', 'news.', 'nl.']
const CONTACT_SYNC_NOISE_DOMAINS = new Set([
  ...NOISE_DOMAINS, 'live.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'msn.com',
  'ymail.com', 'googlemail.com', 'protonmail.com', 'proton.me', 'zoho.com', 'mail.com',
  'gmx.com', 'fastmail.com',
])
const NOISE_SENDER_PATTERNS = ['no-reply@', 'noreply@', 'donotreply@', 'notifications@', 'support@', 'billing@']
const PO_PATTERN = /\b([DS]\d{4})\b/gi
const DEFAULT_SO_PATTERNS = [
  /\bSO[\s#\-]?(\d{5,12})\b/gi,
  /\bSales\s+Order[\s:#\-]*(\d{5,12})\b/gi,
  /\bOrder\s*[:#]?\s*(\d{6,12})\b/gi,
]
const DEFAULT_PO_PATTERNS = [
  /\bPO[\s#\-]?(\d{5,12})\b/gi,
  /\bPurchase\s+Order[\s:#\-]*(\d{5,12})\b/gi,
  PO_PATTERN,
]
const ROUTABLE_STATUSES = ['UNROUTED', 'COMPANY_ONLY', 'COMPANY_DEPT', 'CUSTOMER_EMAIL_NO_COMPANY']
const MODEL_VALUE_MAP = {
  GPT_5_4: 'openai/gpt-5.4', GPT_5_4_MINI: 'openai/gpt-5.4-mini', GPT_5_4_NANO: 'openai/gpt-5.4-nano',
  GEMINI_3_1_PRO: 'google/gemini-3.1-pro-preview', GEMINI_3_FLASH: 'google/gemini-3-flash-preview',
  GEMINI_3_1_FLASH_LITE: 'google/gemini-3.1-flash-lite-preview', GEMINI_3_1_FLASH_IMAGE: 'google/gemini-3.1-flash-image-preview',
  GEMINI_2_FLASH: 'google/gemini-2.0-flash-001', CLAUDE_SONNET_4_6: 'anthropic/claude-sonnet-4-6', CLAUDE_HAIKU_4_5: 'anthropic/claude-haiku-4-5',
}
const SHARED_DOMAIN_RULES = [
  { domain: 'ros.com', subsidiaries: [{ keywords: ['DDS', "DD'S", 'NYBO'], retailerNameFragments: ["DD's", 'DDs'] }] },
]
const COMPANY_NAME_STOPWORDS = new Set([
  'corp', 'inc', 'llc', 'ltd', 'company', 'group', 'holdings', 'enterprises', 'international',
  'global', 'national', 'american', 'retail', 'wholesale', 'trading', 'stores', 'store', 'brands',
  'outlet', 'outlets', 'factory',
])
const STATUS_PRIORITY = { UNROUTED: 0, CUSTOMER_EMAIL_NO_COMPANY: 0, COMPANY_ONLY: 1, COMPANY_DEPT: 2, ROUTED: 3, SKIPPED: -1 }

// --- Pure helpers (identical to the Directus worker; no backend coupling) -----
function domainOf(address) { return String(address || '').split('@')[1]?.toLowerCase() || '' }
function domainCandidates(domain) {
  const parts = String(domain || '').toLowerCase().split('.').filter(Boolean)
  if (parts.length <= 2) return parts.length ? [parts.join('.')] : []
  return [parts.join('.'), parts.slice(-2).join('.')]
}
function isNoiseDomain(domain) { return NOISE_DOMAINS.has(domain) || NOISE_PREFIXES.some((p) => domain.startsWith(p)) }
function isNoiseSender(address, isCustomerDomain = false) {
  const lower = String(address || '').toLowerCase()
  if (lower.startsWith('info@') && !isCustomerDomain) return true
  return NOISE_SENDER_PATTERNS.some((p) => lower.startsWith(p))
}
function normalizeSubject(subject) {
  let s = subject || ''
  let prev
  do { prev = s; s = s.replace(/^(回复:|回覆:|RE:|FW:|Fwd:)\s*/i, '').trim() } while (s !== prev)
  return s
}
function extractAddresses(text) {
  return [...new Set(String(text || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [])].map((x) => x.toLowerCase())
}
function compiledRetailerPatterns(patternText) {
  const out = []
  for (const line of String(patternText || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    try { out.push(new RegExp(trimmed, 'gi')) } catch (error) { console.warn(`Invalid retailer S.O. pattern "${trimmed}": ${error.message}`) }
  }
  return out
}
function runNumberPatterns(text, patterns) {
  const found = new Set()
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(String(text || ''))) !== null) {
      const value = String(match[1] || match[0] || '').trim().toUpperCase()
      if (value) found.add(value)
      if (match[0] === '') pattern.lastIndex += 1
    }
  }
  return [...found]
}
function extractOrderNumbers(text, retailerPatterns = '') {
  const custom = compiledRetailerPatterns(retailerPatterns)
  return {
    soNumbers: runNumberPatterns(text, [...DEFAULT_SO_PATTERNS, ...custom]),
    poNumbers: runNumberPatterns(text, [...DEFAULT_PO_PATTERNS, ...custom]),
  }
}
function fuzzyScore(query, target) {
  const tokens = String(query || '').toLowerCase().split(/\W+/).filter((t) => t.length > 2)
  const targetLower = String(target || '').toLowerCase()
  if (!tokens.length) return 0
  return tokens.filter((t) => targetLower.includes(t)).length / tokens.length
}
function companyNameScore(subject, companyName) {
  const tokens = String(companyName || '').toLowerCase().split(/\W+/).filter((t) => t.length >= 4 && !COMPANY_NAME_STOPWORDS.has(t))
  const subjectLower = String(subject || '').toLowerCase()
  if (!tokens.length) return 0
  return tokens.filter((t) => subjectLower.includes(t)).length / tokens.length
}
function resolveModel(stored) { return MODEL_VALUE_MAP[stored] || stored }
function routingImproves(currentStatus, next, currentRetailer) {
  const currentPriority = STATUS_PRIORITY[currentStatus] ?? 0
  const nextPriority = STATUS_PRIORITY[next.routing_status] ?? 0
  if (nextPriority > currentPriority) return true
  return nextPriority === currentPriority && nextPriority > 0 && next.retailer && next.retailer !== currentRetailer
}
function participantAddresses(message) {
  return [
    message.from?.emailAddress?.address,
    ...(message.toRecipients || []).map((r) => r.emailAddress?.address),
    ...(message.ccRecipients || []).map((r) => r.emailAddress?.address),
  ].filter(Boolean).map((x) => x.toLowerCase())
}
function displayNameMap(message) {
  const map = {}
  const add = (e) => { if (e?.address && e?.name) map[e.address.toLowerCase()] = e.name }
  add(message.from?.emailAddress)
  for (const r of message.toRecipients || []) add(r.emailAddress)
  for (const r of message.ccRecipients || []) add(r.emailAddress)
  return map
}
function splitAliases(value) { return String(value || '').split(/[,\n;]/).map((x) => x.trim()).filter(Boolean) }
function aliasMatchesSubject(alias, normalizedSubject) {
  const a = String(alias || '').trim().toLowerCase()
  if (!a || a.includes('@') || a.includes('.')) return false
  return new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(normalizedSubject)
}
function domainToCompanyName(domain) {
  const stem = String(domain || '').split('.')[0] || domain
  return stem.split(/[-_]/).map((p) => p[0]?.toUpperCase() + p.slice(1)).join(' ')
}
function personNameFromEmail(email) {
  return String(email || '').split('@')[0].split(/[._-]/).filter(Boolean).map((p) => p[0]?.toUpperCase() + p.slice(1)).join(' ') || email
}
function applySharedDomainRule(domain, candidateRows, displayNames) {
  const rule = SHARED_DOMAIN_RULES.find((r) => r.domain === domain)
  if (!rule || candidateRows.length < 2) return null
  const names = Object.values(displayNames || {}).join(' ').toUpperCase()
  for (const subsidiary of rule.subsidiaries) {
    if (!subsidiary.keywords.some((k) => names.includes(k.toUpperCase()))) continue
    const row = candidateRows.find((r) => subsidiary.retailerNameFragments.some((f) => String(r.name || '').toLowerCase().includes(f.toLowerCase())))
    if (row) return row
  }
  return null
}
function pickUniqueBest(scoredRows, threshold) {
  const sorted = scoredRows.filter((r) => r.score >= threshold).sort((a, b) => b.score - a.score)
  if (!sorted.length) return null
  if (sorted.length > 1 && sorted[0].score === sorted[1].score) return null
  return sorted[0].row
}

// --- Supabase query helpers ---------------------------------------------------
// PostgREST `or` clause escapes commas/parens poorly, so candidates are simple
// domain fragments; ilike uses * as the wildcard.
function domainOrClause(candidates) {
  return candidates.flatMap((c) => [`domain.ilike.*${c}*`, `routing_aliases.ilike.*${c}*`]).join(',')
}

async function matchingRetailersByDomain(domain, displayNames = {}) {
  const candidates = domainCandidates(domain)
  if (!candidates.length) return null
  const rows = must(await core('customer')
    .select('id,name,domain,routing_aliases,customer_status')
    .in('customer_status', CUSTOMERS)
    .or(domainOrClause(candidates))
    .limit(20))
  if (rows.length === 1) return rows[0]
  return candidates.map((c) => applySharedDomainRule(c, rows, displayNames)).find(Boolean) || null
}

async function matchRetailerByAlias(normalizedSubject) {
  const rows = must(await core('customer')
    .select('id,name,routing_aliases')
    .in('customer_status', CUSTOMERS)
    .not('routing_aliases', 'is', null)
    .limit(5000))
  const matches = rows.filter((r) => splitAliases(r.routing_aliases).some((a) => aliasMatchesSubject(a, normalizedSubject)))
  return matches.length === 1 ? matches[0] : null
}

async function matchRetailerByCompanyName(subject) {
  const rows = must(await core('customer').select('id,name').in('customer_status', CUSTOMERS).limit(5000))
  return pickUniqueBest(rows.map((r) => ({ row: r, score: companyNameScore(subject, r.name) })), 0.7)
}

async function matchRetailerBySubjectHistory(normalizedSubject) {
  if (!normalizedSubject || normalizedSubject.length < 8) return null
  const probe = normalizedSubject.slice(0, 80)
  const rows = must(await crm('email_message')
    .select('id,subject,company_id')
    .in('routing_status', ['ROUTED', 'COMPANY_ONLY', 'COMPANY_DEPT'])
    .not('company_id', 'is', null)
    .ilike('subject', `%${probe}%`)
    .limit(50))
  const ids = [...new Set(rows.filter((r) => normalizeSubject(r.subject).toLowerCase() === normalizedSubject).map((r) => r.company_id).filter(Boolean))]
  return ids.length === 1 ? { id: ids[0] } : null
}

async function findDepartment(retailer, addresses) {
  if (!retailer || !addresses.length) return null
  const contacts = must(await core('contact').select('id').in('email', addresses).limit(500))
  const contactIds = contacts.map((c) => c.id)
  if (!contactIds.length) return null
  const ccs = must(await core('contact_company')
    .select('crm_department_id,scope')
    .eq('company_id', retailer)
    .eq('scope', 'DEPARTMENT')
    .in('contact_id', contactIds)
    .not('crm_department_id', 'is', null)
    .limit(100))
  const deptIds = [...new Set(ccs.map((c) => c.crm_department_id))]
  return deptIds.length === 1 ? deptIds[0] : null
}

async function matchOpportunity({ retailer, department, searchText }) {
  let retailerPatterns = ''
  if (retailer) {
    const rows = must(await core('customer').select('so_patterns').eq('id', retailer).limit(1))
    retailerPatterns = rows[0]?.so_patterns || ''
  }
  const { soNumbers, poNumbers } = extractOrderNumbers(searchText, retailerPatterns)
  for (const po of poNumbers) {
    let q = crm('opportunity').select('id,company_id,department_id').or(`production_po_number.eq.${po},import_po_number.eq.${po}`).limit(2)
    if (retailer) q = q.eq('company_id', retailer)
    const rows = must(await q)
    if (rows.length === 1) return { method: 'PO_NUMBER', row: { id: rows[0].id, retailer: rows[0].company_id, department: rows[0].department_id } }
  }

  let q = crm('opportunity').select('id,name,company_id,department_id,sales_order_number,production_po_number').not('stage', 'in', '(CLOSED,SHIPPED)').limit(1000)
  if (retailer) q = q.eq('company_id', retailer)
  const activeRows = must(await q)
  const lowerNumbers = soNumbers.map((x) => x.toLowerCase())
  const so = activeRows.find((r) => r.sales_order_number && lowerNumbers.includes(String(r.sales_order_number).toLowerCase()))
  if (so) return { method: 'SALES_ORDER_NUMBER', row: { id: so.id, retailer: so.company_id, department: so.department_id } }

  const fuzzy = pickUniqueBest(activeRows.map((r) => ({ row: r, score: Math.max(fuzzyScore(searchText, r.name), fuzzyScore(searchText, r.production_po_number)) })), 0.72)
  if (fuzzy) return { method: department ? 'OPPORTUNITY_FUZZY_DEPARTMENT' : 'OPPORTUNITY_FUZZY', row: { id: fuzzy.id, retailer: fuzzy.company_id, department: fuzzy.department_id } }
  return null
}

async function routingModel(task = 'email_routing_model') {
  const rows = must(await crm('ai_model_config').select(`id,${task}`).limit(1))
  return resolveModel(rows[0]?.[task] || 'GEMINI_2_FLASH')
}

// Convert a route result's relation keys to crm.* column names.
function routeColumns(route) {
  const out = {}
  if ('routing_status' in route) out.routing_status = route.routing_status
  if ('routing_method' in route) out.routing_method = route.routing_method
  if ('retailer' in route) out.company_id = route.retailer || null
  if ('department' in route) out.department_id = route.department || null
  if ('opportunity' in route) out.opportunity_id = route.opportunity || null
  return out
}

async function aiRouteFallback({ subject, bodyText, addresses, task = 'email_routing_model' }) {
  if (!process.env.OPENROUTER_API_KEY) return null
  const [retailers, opportunities] = await Promise.all([
    core('customer').select('id,name,domain').in('customer_status', CUSTOMERS).order('name').limit(120).then(must),
    crm('opportunity').select('id,name,company_id,department_id,production_po_number,sales_order_number').not('stage', 'in', '(CLOSED,SHIPPED)').order('created_at', { ascending: false }).limit(120).then(must),
  ])
  const model = await routingModel(task)
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'HTTP-Referer': SUPABASE_URL, 'X-Title': 'POP CRM Supabase Router' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Route one CRM email. Return strict JSON only with retailerId, departmentId, opportunityId, confidence, and reason. Use null when uncertain.' },
        { role: 'user', content: JSON.stringify({ subject, bodyPreview: String(bodyText || '').slice(0, 3000), addresses, retailers, opportunities }) },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) return null
  const json = await res.json()
  const content = json.choices?.[0]?.message?.content
  if (!content) return null
  let parsed
  try { parsed = JSON.parse(content) } catch { return null }
  if (Number(parsed.confidence || 0) < 0.72) return null
  return {
    routing_status: parsed.opportunityId ? 'ROUTED' : parsed.departmentId ? 'COMPANY_DEPT' : parsed.retailerId ? 'COMPANY_ONLY' : 'UNROUTED',
    routing_method: 'AI_ROUTER',
    retailer: parsed.retailerId || null,
    department: parsed.departmentId || null,
    opportunity: parsed.opportunityId || null,
  }
}

async function summarizeOpportunity(opportunityId) {
  if (!opportunityId || !process.env.OPENROUTER_API_KEY) return false
  const [opportunity] = must(await crm('opportunity').select('id,name,stage,company_id,department_id,production_po_number,sales_order_number,project_id').eq('id', opportunityId).limit(1))
  if (!opportunity) return false
  const emails = must(await crm('email_message').select('subject,sender,received_at,body_preview,routing_method').eq('opportunity_id', opportunityId).order('received_at', { ascending: false }).limit(60))
  if (!emails.length) return false
  const model = await routingModel('opportunity_summary_model')
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'HTTP-Referer': SUPABASE_URL, 'X-Title': 'POP CRM Opportunity Summary' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: ['Summarize this CRM opportunity for an account manager.', 'Return strict JSON with: summary, nextStep, risk, status, people, actionItems, blockers, decisions, timeline, updatedAt.', 'Preserve active facts from the email history. Keep summary human-readable and concise.'].join(' ') },
        { role: 'user', content: JSON.stringify({ opportunity, emails }) },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) return false
  const json = await res.json()
  const content = json.choices?.[0]?.message?.content
  if (!content) return false
  let parsed
  try { parsed = JSON.parse(content) } catch { parsed = { summary: content } }
  must(await crm('opportunity').update({ ai_summary: parsed.summary || content, ai_state: JSON.stringify({ ...parsed, updatedAt: new Date().toISOString() }) }).eq('id', opportunityId))
  return true
}

async function chatOpportunity(opportunityId, question) {
  if (!opportunityId || !question || !process.env.OPENROUTER_API_KEY) return ''
  const [opportunity] = must(await crm('opportunity').select('id,name,stage,ai_summary,ai_state,company_id,department_id,project_id,production_po_number,sales_order_number').eq('id', opportunityId).limit(1))
  if (!opportunity) return ''
  // Resolve display names (cross-schema, so fetched separately).
  const [company] = opportunity.company_id ? must(await core('customer').select('name').eq('id', opportunity.company_id).limit(1)) : [null]
  const [department] = opportunity.department_id ? must(await crm('department').select('name').eq('id', opportunity.department_id).limit(1)) : [null]
  const context = { ...opportunity, retailer_name: company?.name || null, department_name: department?.name || null }
  const [emails, notes, tasks] = await Promise.all([
    crm('email_message').select('subject,sender,received_at,body_preview,routing_method').eq('opportunity_id', opportunityId).order('received_at', { ascending: false }).limit(40).then(must),
    crm('note').select('title,body,action_items,source').eq('opportunity_id', opportunityId).order('created_at', { ascending: false }).limit(25).then(must),
    crm('task').select('title,body,status,due_at').eq('opportunity_id', opportunityId).order('status').order('due_at').limit(25).then(must),
  ])
  const model = await routingModel('opportunity_summary_model')
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'HTTP-Referer': SUPABASE_URL, 'X-Title': 'POP CRM Opportunity Chat' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Answer as a CRM assistant using only the provided CRM context. If the context is insufficient, say what is missing. Keep the answer concise and action-oriented.' },
        { role: 'user', content: JSON.stringify({ question, opportunity: context, emails, notes, tasks }) },
      ],
      temperature: 0.2,
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter chat failed: ${res.status} ${await res.text()}`)
  const json = await res.json()
  return String(json.choices?.[0]?.message?.content || '').trim()
}

async function updateOpportunitySummary(opportunityId) {
  try { await summarizeOpportunity(opportunityId) } catch (error) { console.warn(`summary skipped for ${opportunityId}: ${error.message}`) }
}

async function routeEmail({ subject, bodyText, addresses, displayNames = {}, task = 'email_routing_model', allowAi = true }) {
  const searchText = `${subject || ''} ${bodyText || ''}`
  const normalizedSubject = normalizeSubject(subject).toLowerCase()
  const domains = [...new Set(addresses.map(domainOf).filter((d) => d && d !== INTERNAL_DOMAIN))]
  const nonNoiseDomains = domains.filter((d) => !isNoiseDomain(d))
  const bodyAddresses = extractAddresses(bodyText)
  const allAddresses = [...new Set([...addresses, ...bodyAddresses])].map((x) => x.toLowerCase())

  const ignoreRules = must(await crm('ignore_rule').select('id,pattern,match_type').limit(5000))
  for (const rule of ignoreRules) {
    const pattern = String(rule.pattern || '').toLowerCase()
    if (!pattern) continue
    const matchType = rule.match_type || 'CONTAINS'
    if (
      (matchType === 'EXACT' && normalizedSubject === pattern) ||
      (matchType === 'STARTS_WITH' && normalizedSubject.startsWith(pattern)) ||
      (matchType === 'CONTAINS' && normalizedSubject.includes(pattern))
    ) return { routing_status: 'SKIPPED', routing_method: 'AUTO_SKIP' }
  }

  let retailer = null
  let routingMethod = 'EMAIL_DOMAIN'

  const aliasRetailer = await matchRetailerByAlias(normalizedSubject)
  if (aliasRetailer) { retailer = aliasRetailer.id; routingMethod = 'SUBJECT_ALIAS' }

  for (const domain of nonNoiseDomains) {
    if (retailer) break
    const row = await matchingRetailersByDomain(domain, displayNames)
    if (row) { retailer = row.id; routingMethod = 'EMAIL_DOMAIN'; break }
  }

  if (!retailer && bodyText) {
    const threadDomains = [...new Set(extractAddresses(bodyText).map(domainOf).filter((d) => d && d !== INTERNAL_DOMAIN && !isNoiseDomain(d)))]
    const matches = []
    for (const domain of threadDomains) {
      const row = await matchingRetailersByDomain(domain, displayNames)
      if (row && !matches.includes(row.id)) matches.push(row.id)
    }
    if (matches.length === 1) { retailer = matches[0]; routingMethod = 'THREAD_EMAIL_DOMAIN' }
  }

  if (!retailer) {
    const subjectHistory = await matchRetailerBySubjectHistory(normalizedSubject)
    if (subjectHistory) { retailer = subjectHistory.id; routingMethod = 'SUBJECT_HISTORY' }
  }

  if (!retailer) {
    const companyName = await matchRetailerByCompanyName(subject)
    if (companyName) { retailer = companyName.id; routingMethod = 'COMPANY_NAME_FUZZY' }
  }

  const department = await findDepartment(retailer, allAddresses)
  const opportunity = await matchOpportunity({ retailer, department, searchText })
  if (opportunity) {
    return {
      routing_status: 'ROUTED',
      routing_method: opportunity.method,
      opportunity: opportunity.row.id,
      retailer: opportunity.row.retailer || retailer || null,
      department: opportunity.row.department || null,
    }
  }

  const customerDomain = retailer && domains.some((d) => !isNoiseDomain(d))
  if (!retailer && addresses.some((a) => isNoiseSender(a, customerDomain))) return { routing_status: 'SKIPPED', routing_method: 'AUTO_SKIP' }
  if (!retailer && !nonNoiseDomains.length) return { routing_status: 'SKIPPED', routing_method: 'AUTO_SKIP' }

  if (retailer && department) return { routing_status: 'COMPANY_DEPT', routing_method: routingMethod, retailer, department }
  if (retailer) return { routing_status: 'COMPANY_ONLY', routing_method: routingMethod, retailer }

  const aiRoute = allowAi ? await aiRouteFallback({ subject, bodyText, addresses: allAddresses, task }) : null
  if (aiRoute?.routing_status && aiRoute.routing_status !== 'UNROUTED') return aiRoute

  return { routing_status: 'UNROUTED' }
}

// --- Microsoft Graph (unchanged) ----------------------------------------------
async function graphToken() {
  const tenant = process.env.AZURE_TENANT_ID || process.env.MS_TENANT_ID
  const client = process.env.AZURE_CLIENT_ID || process.env.MS_CLIENT_ID
  const secret = process.env.AZURE_CLIENT_SECRET || process.env.MS_CLIENT_SECRET
  if (!tenant || !client || !secret) throw new Error('Missing Microsoft Graph credentials')
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: client, client_secret: secret, scope: 'https://graph.microsoft.com/.default' })
  const res = await fetch(`${LOGIN_BASE}/${tenant}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  if (!res.ok) throw new Error(`Graph token failed: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}
async function fetchRecentEmails(accessToken, mailbox) {
  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString()
  const selectFields = ['id', 'subject', 'receivedDateTime', 'bodyPreview', 'body', 'from', 'toRecipients', 'ccRecipients', 'isRead'].join(',')
  const filterParam = `receivedDateTime ge ${since}`
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages?$filter=${encodeURIComponent(filterParam)}&$select=${selectFields}&$top=${PAGE_SIZE}&$orderby=${encodeURIComponent('receivedDateTime desc')}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } })
  if (!res.ok) throw new Error(`Graph messages failed: ${res.status} ${await res.text()}`)
  return (await res.json()).value || []
}

async function outlookIngest() {
  const mailbox = process.env.OUTLOOK_MAILBOX || 'adweck@popcre.com'
  const gated = process.env.OUTLOOK_GATED === 'true'
  const token = await graphToken()
  const messages = await fetchRecentEmails(token, mailbox)
  let created = 0
  for (const message of messages) {
    const existing = must(await crm('email_message').select('id').eq('outlook_message_id', message.id).limit(1))
    if (existing.length) continue
    const addresses = participantAddresses(message)
    if (gated && !addresses.some((addr) => !addr.endsWith(`@${INTERNAL_DOMAIN}`))) continue
    const bodyText = message.body?.content || message.bodyPreview || ''
    const route = await routeEmail({ subject: message.subject || '', bodyText, addresses, displayNames: displayNameMap(message) })
    let retailerPatterns = ''
    if (route.retailer) {
      const rows = must(await core('customer').select('so_patterns').eq('id', route.retailer).limit(1))
      retailerPatterns = rows[0]?.so_patterns || ''
    }
    const detected = extractOrderNumbers(bodyText, retailerPatterns)
    must(await crm('email_message').insert({
      subject: message.subject || '(no subject)',
      sender: message.from?.emailAddress?.address || '',
      recipients: [...(message.toRecipients || []), ...(message.ccRecipients || [])].map((r) => r.emailAddress?.address).filter(Boolean).join(', '),
      received_at: message.receivedDateTime || null,
      body_preview: message.bodyPreview || '',
      outlook_message_id: message.id,
      detected_so_numbers: detected.soNumbers.join(', '),
      detected_po_numbers: detected.poNumbers.join(', '),
      external_id: message.id,
      external_source: 'outlook',
      ...routeColumns(route),
    }))
    if (route.opportunity) await updateOpportunitySummary(route.opportunity)
    created += 1
  }
  console.log(`outlook-ingest: ${created} created, ${messages.length} fetched`)
}

async function reroute() {
  const rows = must(await crm('email_message').select('id,subject,body_preview,sender,recipients,routing_status,company_id').in('routing_status', ROUTABLE_STATUSES).limit(100000))
  let updated = 0
  let evaluated = 0
  for (const row of rows) {
    const addresses = extractAddresses(`${row.sender || ''} ${row.recipients || ''}`)
    const route = await routeEmail({ subject: row.subject || '', bodyText: row.body_preview || '', addresses, allowAi: process.env.CRM_REROUTE_AI === 'true' })
    evaluated += 1
    if (routingImproves(row.routing_status, route, row.company_id)) {
      must(await crm('email_message').update(routeColumns(route)).eq('id', row.id))
      if (route.opportunity) await updateOpportunitySummary(route.opportunity)
      updated += 1
    }
    if (evaluated % 500 === 0) console.log(`reroute: ${evaluated}/${rows.length} evaluated, ${updated} improved`)
  }
  console.log(`reroute: ${evaluated} messages evaluated, ${updated} improved`)
}

async function recordIngestedDomain(domain, sender = null, subject = null, displayName = null) {
  must(await sb.schema('crm').rpc('record_ingested_domain', {
    p_domain: domain,
    p_sender: sender,
    p_subject: subject,
    p_display_name: displayName,
  }))
}

async function customerForDomain(domain) {
  const candidates = domainCandidates(domain)
  const existing = must(await core('customer')
    .select('id,name,domain,routing_aliases,customer_status')
    .in('customer_status', CUSTOMERS)
    .or(domainOrClause(candidates))
    .limit(2))
  return existing[0]?.id || null
}

async function contactSync() {
  const rows = must(await crm('email_message').select('id,subject,sender,recipients').limit(100000))
  const subjectByDomain = new Map()
  const senderByDomain = new Map()
  for (const row of rows) {
    for (const address of extractAddresses(`${row.sender || ''} ${row.recipients || ''}`)) {
      const domain = domainOf(address)
      if (!domain) continue
      if (!subjectByDomain.has(domain) && row.subject) subjectByDomain.set(domain, row.subject)
      if (!senderByDomain.has(domain)) senderByDomain.set(domain, address)
    }
  }
  const addresses = [...new Set(rows.flatMap((row) => extractAddresses(`${row.sender || ''} ${row.recipients || ''}`)))]
    .filter((address) => {
      const domain = domainOf(address)
      return domain && domain !== INTERNAL_DOMAIN && !CONTACT_SYNC_NOISE_DOMAINS.has(domain) && !isNoiseDomain(domain) && !isNoiseSender(address)
    })
  let retailersCreated = 0
  let buyersCreated = 0
  const retailerByDomain = new Map()
  for (const address of addresses) {
    const domain = domainOf(address)
    if (!retailerByDomain.has(domain)) {
      const customerId = await customerForDomain(domain)
      if (!customerId) {
        await recordIngestedDomain(domain, senderByDomain.get(domain) || address, subjectByDomain.get(domain) || null, domainToCompanyName(domain))
        retailersCreated += 1
      }
      retailerByDomain.set(domain, customerId)
    }
    const customerId = retailerByDomain.get(domain)
    if (!customerId) continue
    const existing = must(await core('contact').select('id').eq('email', address).limit(1))
    if (existing.length) continue
    const contact = must(await core('contact').insert({
      full_name: personNameFromEmail(address),
      email: address,
    }).select('id').single())
    must(await core('contact_company').insert({
      contact_id: contact.id,
      company_id: customerId,
      relationship_type: 'buyer',
      scope: 'COMPANY_WIDE',
      contact_type: 'OTHER',
    }))
    buyersCreated += 1
  }
  console.log(`contact-sync: ${retailersCreated} ingested domains recorded, ${buyersCreated} customer contacts created, ${addresses.length} addresses evaluated`)
}

async function recordUnknownDomainsFromAddresses(addresses, subject = null, displayNameByDomain = new Map()) {
  const domains = [...new Set(addresses.map(domainOf))]
    .filter((domain) => domain && domain !== INTERNAL_DOMAIN && !CONTACT_SYNC_NOISE_DOMAINS.has(domain) && !isNoiseDomain(domain))
  let recorded = 0
  for (const domain of domains) {
    if (await customerForDomain(domain)) continue
    await recordIngestedDomain(domain, null, subject, displayNameByDomain.get(domain) || domainToCompanyName(domain))
    recorded += 1
  }
  return recorded
}

async function summarize() {
  const rows = must(await crm('email_message').select('opportunity_id').not('opportunity_id', 'is', null).limit(100000))
  const ids = [...new Set(rows.map((r) => r.opportunity_id).filter(Boolean))]
  let updated = 0
  for (const id of ids) if (await summarizeOpportunity(id)) updated += 1
  console.log(`summarize: ${updated}/${ids.length} opportunities refreshed`)
}

function subjectMatchesRule(subject, rule) {
  const pattern = String(rule.pattern || '').trim().toLowerCase()
  if (!pattern) return false
  const normalized = normalizeSubject(subject).toLowerCase()
  const matchType = rule.match_type || 'CONTAINS'
  return (
    (matchType === 'EXACT' && normalized === pattern) ||
    (matchType === 'STARTS_WITH' && normalized.startsWith(pattern)) ||
    (matchType === 'CONTAINS' && normalized.includes(pattern))
  )
}

async function applyIgnoreRules() {
  const [rules, emails] = await Promise.all([
    crm('ignore_rule').select('id,pattern,match_type,emails_skipped').limit(5000).then(must),
    crm('email_message').select('id,subject').eq('routing_status', 'UNROUTED').limit(100000).then(must),
  ])
  let skipped = 0
  const counts = new Map()
  for (const email of emails) {
    const rule = rules.find((r) => subjectMatchesRule(email.subject, r))
    if (!rule) continue
    must(await crm('email_message').update({ routing_status: 'SKIPPED', routing_method: 'AUTO_SKIP' }).eq('id', email.id))
    counts.set(rule.id, (counts.get(rule.id) || 0) + 1)
    skipped += 1
  }
  for (const rule of rules) {
    const count = counts.get(rule.id) || 0
    if (count) must(await crm('ignore_rule').update({ emails_skipped: Number(rule.emails_skipped || 0) + count }).eq('id', rule.id))
  }
  console.log(`apply-ignore-rules: ${skipped} emails skipped by ${counts.size} rules`)
}

// --- Fireflies (HTTP unchanged; persistence -> crm.meeting_note) ---------------
function isValidFirefliesSignature(rawBody, signature) {
  const secret = process.env.FIREFLIES_WEBHOOK_SECRET
  if (!secret) return true
  if (!signature) return false
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then((key) => crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)))
    .then((buf) => {
      const expected = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
      return signature === `sha256=${expected}` || signature === expected
    })
}
async function firefliesTranscript(meetingId) {
  if (!process.env.FIREFLIES_API_KEY) throw new Error('FIREFLIES_API_KEY is required')
  const query = `
    query GetTranscript($transcriptId: String!) {
      transcript(id: $transcriptId) {
        id title date duration participants organizer_email
        summary { action_items overview keywords topics_discussed meeting_type }
        transcript_url audio_url video_url meeting_link
      }
    }
  `
  const res = await fetch(FIREFLIES_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.FIREFLIES_API_KEY}` },
    body: JSON.stringify({ query, variables: { transcriptId: meetingId } }),
  })
  if (!res.ok) throw new Error(`Fireflies API failed: ${res.status} ${await res.text()}`)
  const json = await res.json()
  if (json.errors?.length) throw new Error(`Fireflies GraphQL failed: ${json.errors[0].message}`)
  const t = json.data?.transcript
  if (!t) throw new Error(`Fireflies transcript not found: ${meetingId}`)
  return t
}
function firefliesParticipants(transcript) {
  const participants = []
  for (const raw of Array.isArray(transcript.participants) ? transcript.participants : []) {
    const text = String(raw)
    const email = text.match(/<([^>]+)>/)?.[1] || (text.includes('@') ? text : '')
    const name = email && text.includes('<') ? text.slice(0, text.indexOf('<')).trim() : text.replace(email, '').trim()
    if (email && !participants.some((p) => p.email.toLowerCase() === email.toLowerCase())) participants.push({ name: name || email, email: email.toLowerCase() })
  }
  if (transcript.organizer_email && !participants.some((p) => p.email.toLowerCase() === transcript.organizer_email.toLowerCase())) {
    participants.push({ name: 'Meeting Organizer', email: transcript.organizer_email.toLowerCase() })
  }
  return participants
}

async function handleFirefliesPayload(payload) {
  const meetingId = payload?.meetingId || payload?.meeting_id || payload?.transcript?.id
  if (!meetingId) return { success: false, errors: ['missing meetingId'] }

  const existing = must(await crm('meeting_note').select('id').eq('fireflies_transcript_id', meetingId).limit(1))
  if (existing.length) return { success: true, meetingId, noteIds: [existing[0].id], skipped: 'duplicate' }

  const transcript = payload?.transcript?.id ? payload.transcript : await firefliesTranscript(meetingId)
  const participants = firefliesParticipants(transcript)
  const participantText = participants.map((p) => `${p.name} <${p.email}>`).join(', ')
  const summary = transcript.summary || {}
  const actionItems = Array.isArray(summary.action_items) ? summary.action_items.join('\n') : (summary.action_items || '')
  const route = await routeEmail({
    subject: transcript.title || '',
    bodyText: [summary.overview || '', actionItems, (summary.keywords || []).join(' ')].join(' '),
    addresses: participants.map((p) => p.email),
    task: 'fireflies_routing_model',
  })
  const displayNameByDomain = new Map()
  for (const participant of participants) {
    const domain = domainOf(participant.email)
    if (domain && participant.name && !displayNameByDomain.has(domain)) displayNameByDomain.set(domain, participant.name)
  }
  await recordUnknownDomainsFromAddresses(participants.map((p) => p.email), transcript.title || null, displayNameByDomain)

  // Matched contacts (no shared meeting_note_attendee table yet -> kept in metadata).
  let contact = null
  const matchedContacts = []
  for (const p of participants) {
    const rows = must(await core('contact').select('id,email').eq('email', p.email).limit(1))
    if (rows[0]) {
      matchedContacts.push({ id: rows[0].id, name: p.name })
      if (!contact && !p.email.endsWith(`@${INTERNAL_DOMAIN}`)) contact = rows[0].id
    }
  }

  const dateValue = transcript.date ? new Date(Number(transcript.date) || transcript.date).toISOString() : new Date().toISOString()
  const note = must(await crm('meeting_note').insert({
    title: transcript.title || `Meeting - ${dateValue.slice(0, 10)}`,
    meeting_at: dateValue,
    participants: participantText,
    body: summary.overview || '',
    action_items: actionItems,
    source: 'FIREFLIES_AUTO_IMPORT',
    fireflies_transcript_id: meetingId,
    company_id: route.retailer || null,
    department_id: route.department || null,
    opportunity_id: route.opportunity || null,
    contact_id: contact,
    external_id: meetingId,
    external_source: 'fireflies',
    metadata: { attendees: matchedContacts },
  }).select('id').single())

  if (route.opportunity) await updateOpportunitySummary(route.opportunity)

  return { success: true, meetingId, noteIds: [note.id], actionItemsCount: Array.isArray(summary.action_items) ? summary.action_items.length : 0 }
}

async function verifySupabaseUser(token) {
  if (!token) return null
  const { data, error } = await sb.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

async function firefliesServer() {
  const { createServer } = await import('node:http')
  const port = Number(process.env.PORT || 8787)
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin || ''
    const allowedOrigin = /^https:\/\/crm(-dev)?\.designflow\.app$/.test(origin) ? origin : 'https://crm.designflow.app'
    const jsonHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'content-type,authorization,x-hub-signature,x-fireflies-signature',
    }
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, jsonHeaders); res.end(); return }
      if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, jsonHeaders); res.end(JSON.stringify({ ok: true })); return }
      if (req.method === 'POST' && req.url === '/s/opportunity-chat') {
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        await new Promise((resolve, reject) => { req.on('end', resolve); req.on('error', reject) })
        const authz = req.headers.authorization || ''
        const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
        const user = await verifySupabaseUser(token)
        if (!user) { res.writeHead(401, jsonHeaders); res.end(JSON.stringify({ error: 'unauthorized' })); return }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const answer = await chatOpportunity(payload.opportunityId, payload.question)
        res.writeHead(200, jsonHeaders)
        res.end(JSON.stringify({ answer }))
        return
      }
      if (req.method !== 'POST' || !['/s/fireflies-webhook', '/webhooks/fireflies'].includes(req.url || '')) {
        res.writeHead(404, jsonHeaders)
        res.end(JSON.stringify({ error: 'not_found' }))
        return
      }
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      await new Promise((resolve, reject) => { req.on('end', resolve); req.on('error', reject) })
      const raw = Buffer.concat(chunks).toString('utf8')
      const ok = await isValidFirefliesSignature(raw, req.headers['x-hub-signature'] || req.headers['x-fireflies-signature'])
      if (!ok) { res.writeHead(401, jsonHeaders); res.end(JSON.stringify({ success: false, errors: ['invalid signature'] })); return }
      const payload = raw ? JSON.parse(raw) : {}
      const result = await handleFirefliesPayload(payload)
      res.writeHead(result.success ? 200 : 400, jsonHeaders)
      res.end(JSON.stringify(result))
    } catch (error) {
      res.writeHead(500, jsonHeaders)
      res.end(JSON.stringify({ success: false, errors: [error.message] }))
    }
  })
  server.listen(port, '0.0.0.0', () => console.log(`fireflies-server (supabase) listening on ${port}`))
}

const command = process.argv[2] || 'help'
if (command === 'outlook-ingest') await outlookIngest()
else if (command === 'reroute') await reroute()
else if (command === 'fireflies-server') await firefliesServer()
else if (command === 'contact-sync') await contactSync()
else if (command === 'summarize') await summarize()
else if (command === 'apply-ignore-rules') await applyIgnoreRules()
else console.log('Usage: node pm-system/crm-worker-supabase.mjs <outlook-ingest|reroute|fireflies-server|contact-sync|summarize|apply-ignore-rules>')
