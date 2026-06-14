// CRM companion worker for Directus.
// Commands:
//   outlook-ingest  - poll Microsoft Graph and create/route crm_email_message rows
//   reroute         - re-evaluate unrouted crm_email_message rows
//   fireflies-server - receive Fireflies webhooks and create crm_meeting_note rows
//   contact-sync    - create missing retailer/buyer records from ingested email addresses
//   summarize       - refresh opportunity AI summaries from routed emails
//
// ClickUp sync is intentionally omitted.
//
// Env:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env
//   DX_URL, DX_ADMIN_EMAIL, DX_ADMIN_PASSWORD
//   MS_TENANT_ID/MS_CLIENT_ID/MS_CLIENT_SECRET or AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET
//   OUTLOOK_MAILBOX=adweck@popcre.com
//   OUTLOOK_GATED=true
//   FIREFLIES_API_KEY, FIREFLIES_WEBHOOK_SECRET, PORT=8787
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

const DX = process.env.DX_URL || 'https://data.designflow.app'
const EMAIL = process.env.DX_ADMIN_EMAIL
const PASSWORD = process.env.DX_ADMIN_PASSWORD
const INTERNAL_DOMAIN = 'popcre.com'
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const LOGIN_BASE = 'https://login.microsoftonline.com'
const PAGE_SIZE = 50
const LOOKBACK_MINUTES = Number(process.env.OUTLOOK_LOOKBACK_MINUTES || 20)
const FIREFLIES_BASE = 'https://api.fireflies.ai/graphql'
let TOKEN = ''

const NOISE_DOMAINS = new Set([
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'yahoo.com',
  'clickup.com',
  'teams.mail.microsoft.com',
  'fireflies.ai',
  'sharepointonline.com',
  'avanan-mail.net',
])
const NOISE_PREFIXES = ['notification.', 'news.', 'nl.']
const CONTACT_SYNC_NOISE_DOMAINS = new Set([
  ...NOISE_DOMAINS,
  'live.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'msn.com',
  'ymail.com',
  'googlemail.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'mail.com',
  'gmx.com',
  'fastmail.com',
])
const NOISE_SENDER_PATTERNS = ['no-reply@', 'noreply@', 'donotreply@', 'notifications@', 'support@', 'billing@']
const PO_PATTERN = /\b([DS]\d{4})\b/gi
const ROUTABLE_STATUSES = ['UNROUTED', 'COMPANY_ONLY', 'COMPANY_DEPT', 'CUSTOMER_EMAIL_NO_COMPANY']
const MODEL_VALUE_MAP = {
  GPT_5_4: 'openai/gpt-5.4',
  GPT_5_4_MINI: 'openai/gpt-5.4-mini',
  GPT_5_4_NANO: 'openai/gpt-5.4-nano',
  GEMINI_3_1_PRO: 'google/gemini-3.1-pro-preview',
  GEMINI_3_FLASH: 'google/gemini-3-flash-preview',
  GEMINI_3_1_FLASH_LITE: 'google/gemini-3.1-flash-lite-preview',
  GEMINI_3_1_FLASH_IMAGE: 'google/gemini-3.1-flash-image-preview',
  GEMINI_2_FLASH: 'google/gemini-2.0-flash-001',
  CLAUDE_SONNET_4_6: 'anthropic/claude-sonnet-4-6',
  CLAUDE_HAIKU_4_5: 'anthropic/claude-haiku-4-5',
}
const SHARED_DOMAIN_RULES = [
  {
    domain: 'ros.com',
    subsidiaries: [{ keywords: ['DDS', "DD'S", 'NYBO'], retailerNameFragments: ["DD's", 'DDs'] }],
  },
]
const COMPANY_NAME_STOPWORDS = new Set([
  'corp', 'inc', 'llc', 'ltd', 'company', 'group', 'holdings', 'enterprises', 'international',
  'global', 'national', 'american', 'retail', 'wholesale', 'trading', 'stores', 'store', 'brands',
  'outlet', 'outlets', 'factory',
])
const STATUS_PRIORITY = { UNROUTED: 0, CUSTOMER_EMAIL_NO_COMPANY: 0, COMPANY_ONLY: 1, COMPANY_DEPT: 2, ROUTED: 3, SKIPPED: -1 }

async function dx(method, path, body) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fetch(DX + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await res.text()
      let json
      try { json = text ? JSON.parse(text) : null } catch { json = text }
      if (res.ok) return json?.data ?? json
      if (![429, 500, 502, 503, 504].includes(res.status) || attempt === 4) {
        throw new Error(`${method} ${path} -> ${res.status}: ${json?.errors?.[0]?.message || text}`)
      }
    } catch (error) {
      if (attempt === 4) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
  }
}

function domainOf(address) {
  return String(address || '').split('@')[1]?.toLowerCase() || ''
}

function domainCandidates(domain) {
  const parts = String(domain || '').toLowerCase().split('.').filter(Boolean)
  if (parts.length <= 2) return parts.length ? [parts.join('.')] : []
  return [parts.join('.'), parts.slice(-2).join('.')]
}

function isNoiseDomain(domain) {
  return NOISE_DOMAINS.has(domain) || NOISE_PREFIXES.some((prefix) => domain.startsWith(prefix))
}

function isNoiseSender(address, isCustomerDomain = false) {
  const lower = String(address || '').toLowerCase()
  if (lower.startsWith('info@') && !isCustomerDomain) return true
  return NOISE_SENDER_PATTERNS.some((pattern) => lower.startsWith(pattern))
}

function normalizeSubject(subject) {
  let s = subject || ''
  let prev
  do {
    prev = s
    s = s.replace(/^(回复:|回覆:|RE:|FW:|Fwd:)\s*/i, '').trim()
  } while (s !== prev)
  return s
}

function extractAddresses(text) {
  return [...new Set(String(text || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [])].map((x) => x.toLowerCase())
}

function extractPoNumbers(text) {
  return [...new Set((String(text || '').match(PO_PATTERN) || []).map((x) => x.toUpperCase()))]
}

function fuzzyScore(query, target) {
  const tokens = String(query || '').toLowerCase().split(/\W+/).filter((token) => token.length > 2)
  const targetLower = String(target || '').toLowerCase()
  if (!tokens.length) return 0
  return tokens.filter((token) => targetLower.includes(token)).length / tokens.length
}

function companyNameScore(subject, companyName) {
  const tokens = String(companyName || '').toLowerCase().split(/\W+/).filter((token) => token.length >= 4 && !COMPANY_NAME_STOPWORDS.has(token))
  const subjectLower = String(subject || '').toLowerCase()
  if (!tokens.length) return 0
  return tokens.filter((token) => subjectLower.includes(token)).length / tokens.length
}

function resolveModel(stored) {
  return MODEL_VALUE_MAP[stored] || stored
}

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
  const add = (emailAddress) => {
    if (emailAddress?.address && emailAddress?.name) map[emailAddress.address.toLowerCase()] = emailAddress.name
  }
  add(message.from?.emailAddress)
  for (const r of message.toRecipients || []) add(r.emailAddress)
  for (const r of message.ccRecipients || []) add(r.emailAddress)
  return map
}

async function login() {
  if (!EMAIL || !PASSWORD) throw new Error('DX_ADMIN_EMAIL and DX_ADMIN_PASSWORD are required')
  TOKEN = (await dx('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).access_token
}

async function readAll(collection, params = '') {
  const out = []
  let page = 1
  while (true) {
    const joiner = params ? '&' : ''
    const rows = await dx('GET', `/items/${collection}?${params}${joiner}limit=500&page=${page}`)
    out.push(...rows)
    if (rows.length < 500) break
    page += 1
  }
  return out
}

function relationId(value) {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

async function queryItems(collection, { filter, fields, limit = 500, sort } = {}) {
  const params = new URLSearchParams()
  if (filter) params.set('filter', JSON.stringify(filter))
  if (fields) params.set('fields', Array.isArray(fields) ? fields.join(',') : fields)
  if (limit !== undefined) params.set('limit', String(limit))
  if (sort) params.set('sort', Array.isArray(sort) ? sort.join(',') : sort)
  return dx('GET', `/items/${collection}?${params.toString()}`)
}

function splitAliases(value) {
  return String(value || '').split(/[,\n;]/).map((x) => x.trim()).filter(Boolean)
}

function aliasMatchesSubject(alias, normalizedSubject) {
  const a = String(alias || '').trim().toLowerCase()
  if (!a || a.includes('@') || a.includes('.')) return false
  return new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(normalizedSubject)
}

function domainToCompanyName(domain) {
  const stem = String(domain || '').split('.')[0] || domain
  return stem.split(/[-_]/).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ')
}

function personNameFromEmail(email) {
  return String(email || '').split('@')[0].split(/[._-]/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') || email
}

function applySharedDomainRule(domain, candidateRows, displayNames) {
  const rule = SHARED_DOMAIN_RULES.find((r) => r.domain === domain)
  if (!rule || candidateRows.length < 2) return null
  const names = Object.values(displayNames || {}).join(' ').toUpperCase()
  for (const subsidiary of rule.subsidiaries) {
    if (!subsidiary.keywords.some((keyword) => names.includes(keyword.toUpperCase()))) continue
    const row = candidateRows.find((retailer) => subsidiary.retailerNameFragments.some((fragment) => String(retailer.name || '').toLowerCase().includes(fragment.toLowerCase())))
    if (row) return row
  }
  return null
}

function pickUniqueBest(scoredRows, threshold) {
  const sorted = scoredRows.filter((row) => row.score >= threshold).sort((a, b) => b.score - a.score)
  if (!sorted.length) return null
  if (sorted.length > 1 && sorted[0].score === sorted[1].score) return null
  return sorted[0].row
}

async function matchingRetailersByDomain(domain, displayNames = {}) {
  const candidates = domainCandidates(domain)
  const rows = await queryItems('retailer', {
    filter: {
      _and: [
        { customer_status: { _in: ['ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER'] } },
        {
          _or: candidates.flatMap((candidate) => [
            { domain: { _contains: candidate } },
            { routing_aliases: { _contains: candidate } },
          ]),
        },
      ],
    },
    fields: ['id', 'name', 'domain', 'routing_aliases', 'customer_status'],
    limit: 20,
  })
  if (rows.length === 1) return rows[0]
  return candidates.map((candidate) => applySharedDomainRule(candidate, rows, displayNames)).find(Boolean) || null
}

async function matchRetailerByAlias(normalizedSubject) {
  const rows = await queryItems('retailer', {
    filter: { customer_status: { _in: ['ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER'] }, routing_aliases: { _nnull: true } },
    fields: ['id', 'name', 'routing_aliases'],
    limit: 5000,
  })
  const matches = rows.filter((row) => splitAliases(row.routing_aliases).some((alias) => aliasMatchesSubject(alias, normalizedSubject)))
  return matches.length === 1 ? matches[0] : null
}

async function matchRetailerByCompanyName(subject) {
  const rows = await queryItems('retailer', {
    filter: { customer_status: { _in: ['ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER'] } },
    fields: ['id', 'name'],
    limit: 5000,
  })
  return pickUniqueBest(rows.map((row) => ({ row, score: companyNameScore(subject, row.name) })), 0.7)
}

async function matchRetailerBySubjectHistory(normalizedSubject) {
  if (!normalizedSubject || normalizedSubject.length < 8) return null
  const probe = normalizedSubject.slice(0, 80)
  const rows = await queryItems('crm_email_message', {
    filter: {
      _and: [
        { routing_status: { _in: ['ROUTED', 'COMPANY_ONLY', 'COMPANY_DEPT'] } },
        { retailer: { _nnull: true } },
        { subject: { _contains: probe } },
      ],
    },
    fields: ['id', 'subject', 'retailer'],
    limit: 50,
  })
  const ids = [...new Set(rows.filter((row) => normalizeSubject(row.subject).toLowerCase() === normalizedSubject).map((row) => relationId(row.retailer)).filter(Boolean))]
  return ids.length === 1 ? { id: ids[0] } : null
}

async function findDepartment(retailer, addresses) {
  if (!retailer || !addresses.length) return null
  const rows = await queryItems('buyer', {
    filter: { retailer: { _eq: retailer }, email: { _in: addresses } },
    fields: ['id', 'department', 'scope'],
    limit: 100,
  })
  const deptIds = [...new Set(rows.filter((p) => p.scope === 'DEPARTMENT' && p.department).map((p) => relationId(p.department)))]
  return deptIds.length === 1 ? deptIds[0] : null
}

async function matchOpportunity({ retailer, department, searchText }) {
  const poNumbers = extractPoNumbers(searchText)
  for (const po of poNumbers) {
    const rows = await queryItems('crm_opportunity', {
      filter: { production_po_number: { _eq: po }, ...(retailer ? { retailer: { _eq: retailer } } : {}) },
      fields: ['id', 'retailer', 'department'],
      limit: 2,
    })
    if (rows.length === 1) return { method: 'PO_NUMBER', row: rows[0] }
  }

  const activeFilter = { stage: { _nin: ['CLOSED', 'SHIPPED'] }, ...(retailer ? { retailer: { _eq: retailer } } : {}) }
  const activeRows = await queryItems('crm_opportunity', {
    filter: activeFilter,
    fields: ['id', 'name', 'retailer', 'department', 'sales_order_number', 'production_po_number'],
    limit: 1000,
  })
  const lower = String(searchText || '').toLowerCase()
  const so = activeRows.find((row) => row.sales_order_number && lower.includes(String(row.sales_order_number).toLowerCase()))
  if (so) return { method: 'SALES_ORDER_NUMBER', row: so }

  const fuzzy = pickUniqueBest(activeRows.map((row) => ({ row, score: Math.max(fuzzyScore(searchText, row.name), fuzzyScore(searchText, row.production_po_number)) })), 0.72)
  if (fuzzy) return { method: department ? 'OPPORTUNITY_FUZZY_DEPARTMENT' : 'OPPORTUNITY_FUZZY', row: fuzzy }
  return null
}

async function routingModel(task = 'email_routing_model') {
  const rows = await queryItems('crm_ai_model_config', { fields: ['id', task], limit: 1 })
  return resolveModel(rows[0]?.[task] || 'GEMINI_2_FLASH')
}

async function aiRouteFallback({ subject, bodyText, addresses, task = 'email_routing_model' }) {
  if (!process.env.OPENROUTER_API_KEY) return null
  const [retailers, opportunities] = await Promise.all([
    queryItems('retailer', {
      filter: { customer_status: { _in: ['ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER'] } },
      fields: ['id', 'name', 'domain'],
      limit: 120,
      sort: ['name'],
    }),
    queryItems('crm_opportunity', {
      filter: { stage: { _nin: ['CLOSED', 'SHIPPED'] } },
      fields: ['id', 'name', 'retailer', 'department', 'production_po_number', 'sales_order_number'],
      limit: 120,
      sort: ['-date_created'],
    }),
  ])
  const model = await routingModel(task)
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': DX,
      'X-Title': 'POP CRM Directus Router',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Route one CRM email. Return strict JSON only with retailerId, departmentId, opportunityId, confidence, and reason. Use null when uncertain.' },
        {
          role: 'user',
          content: JSON.stringify({
            subject,
            bodyPreview: String(bodyText || '').slice(0, 3000),
            addresses,
            retailers,
            opportunities,
          }),
        },
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
  const [opportunity] = await queryItems('crm_opportunity', {
    filter: { id: { _eq: opportunityId } },
    fields: ['id', 'name', 'stage', 'retailer', 'department', 'production_po_number', 'sales_order_number'],
    limit: 1,
  })
  if (!opportunity) return false
  const emails = await queryItems('crm_email_message', {
    filter: { opportunity: { _eq: opportunityId } },
    fields: ['subject', 'sender', 'received_at', 'body_preview'],
    limit: 40,
    sort: ['-received_at'],
  })
  if (!emails.length) return false
  const model = await routingModel('opportunity_summary_model')
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': DX,
      'X-Title': 'POP CRM Opportunity Summary',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Summarize this CRM opportunity for an account manager. Return JSON with summary, nextStep, risk, and updatedAt.' },
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
  await dx('PATCH', `/items/crm_opportunity/${opportunityId}`, {
    ai_summary: parsed.summary || content,
    ai_state: JSON.stringify({ ...parsed, updatedAt: new Date().toISOString() }),
  })
  return true
}

async function updateOpportunitySummary(opportunityId) {
  try {
    await summarizeOpportunity(opportunityId)
  } catch (error) {
    console.warn(`summary skipped for ${opportunityId}: ${error.message}`)
  }
}

async function routeEmail({ subject, bodyText, addresses, displayNames = {}, task = 'email_routing_model', allowAi = true }) {
  const searchText = `${subject || ''} ${bodyText || ''}`
  const normalizedSubject = normalizeSubject(subject).toLowerCase()
  const domains = [...new Set(addresses.map(domainOf).filter((d) => d && d !== INTERNAL_DOMAIN))]
  const nonNoiseDomains = domains.filter((d) => !isNoiseDomain(d))
  const bodyAddresses = extractAddresses(bodyText)
  const allAddresses = [...new Set([...addresses, ...bodyAddresses])].map((x) => x.toLowerCase())

  const ignoreRules = await readAll('crm_ignore_rule', 'fields=id,pattern,match_type')
  for (const rule of ignoreRules) {
    const pattern = String(rule.pattern || '').toLowerCase()
    if (!pattern) continue
    const matchType = rule.match_type || 'CONTAINS'
    if (
      (matchType === 'EXACT' && normalizedSubject === pattern) ||
      (matchType === 'STARTS_WITH' && normalizedSubject.startsWith(pattern)) ||
      (matchType === 'CONTAINS' && normalizedSubject.includes(pattern))
    ) {
      return { routing_status: 'SKIPPED', routing_method: 'AUTO_SKIP' }
    }
  }

  let retailer = null
  let routingMethod = 'EMAIL_DOMAIN'

  const aliasRetailer = await matchRetailerByAlias(normalizedSubject)
  if (aliasRetailer) {
    retailer = aliasRetailer.id
    routingMethod = 'SUBJECT_ALIAS'
  }

  for (const domain of nonNoiseDomains) {
    if (retailer) break
    const row = await matchingRetailersByDomain(domain, displayNames)
    if (row) {
      retailer = row.id
      routingMethod = 'EMAIL_DOMAIN'
      break
    }
  }

  if (!retailer && bodyText) {
    const threadDomains = [...new Set(extractAddresses(bodyText).map(domainOf).filter((d) => d && d !== INTERNAL_DOMAIN && !isNoiseDomain(d)))]
    const matches = []
    for (const domain of threadDomains) {
      const row = await matchingRetailersByDomain(domain, displayNames)
      if (row && !matches.includes(row.id)) matches.push(row.id)
    }
    if (matches.length === 1) {
      retailer = matches[0]
      routingMethod = 'THREAD_EMAIL_DOMAIN'
    }
  }

  if (!retailer) {
    const subjectHistory = await matchRetailerBySubjectHistory(normalizedSubject)
    if (subjectHistory) {
      retailer = subjectHistory.id
      routingMethod = 'SUBJECT_HISTORY'
    }
  }

  if (!retailer) {
    const companyName = await matchRetailerByCompanyName(subject)
    if (companyName) {
      retailer = companyName.id
      routingMethod = 'COMPANY_NAME_FUZZY'
    }
  }

  const department = await findDepartment(retailer, allAddresses)
  const opportunity = await matchOpportunity({ retailer, department, searchText })
  if (opportunity) {
    const oppRetailer = relationId(opportunity.row.retailer)
    const oppDepartment = relationId(opportunity.row.department)
    return {
      routing_status: 'ROUTED',
      routing_method: opportunity.method,
      opportunity: opportunity.row.id,
      retailer: oppRetailer || retailer || null,
      department: oppDepartment || null,
    }
  }

  const customerDomain = retailer && domains.some((domain) => !isNoiseDomain(domain))
  if (!retailer && addresses.some((address) => isNoiseSender(address, customerDomain))) return { routing_status: 'SKIPPED', routing_method: 'AUTO_SKIP' }
  if (!retailer && !nonNoiseDomains.length) return { routing_status: 'SKIPPED', routing_method: 'AUTO_SKIP' }

  if (retailer && department) return { routing_status: 'COMPANY_DEPT', routing_method: routingMethod, retailer, department }
  if (retailer) return { routing_status: 'COMPANY_ONLY', routing_method: routingMethod, retailer }

  const aiRoute = allowAi ? await aiRouteFallback({ subject, bodyText, addresses: allAddresses, task }) : null
  if (aiRoute?.routing_status && aiRoute.routing_status !== 'UNROUTED') return aiRoute

  return { routing_status: 'UNROUTED' }
}

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
    const existing = await dx('GET', `/items/crm_email_message?filter[outlook_message_id][_eq]=${encodeURIComponent(message.id)}&fields=id&limit=1`)
    if (existing.length) continue
    const addresses = participantAddresses(message)
    if (gated && !addresses.some((addr) => !addr.endsWith(`@${INTERNAL_DOMAIN}`))) continue
    const bodyText = message.body?.content || message.bodyPreview || ''
    const route = await routeEmail({ subject: message.subject || '', bodyText, addresses, displayNames: displayNameMap(message) })
    await dx('POST', '/items/crm_email_message', {
      name: message.subject || '(no subject)',
      subject: message.subject || '(no subject)',
      sender: message.from?.emailAddress?.address || '',
      recipients: [...(message.toRecipients || []), ...(message.ccRecipients || [])].map((r) => r.emailAddress?.address).filter(Boolean).join(', '),
      received_at: message.receivedDateTime?.slice(0, 10),
      body_preview: message.bodyPreview || '',
      outlook_message_id: message.id,
      detected_po_numbers: extractPoNumbers(bodyText).join(', '),
      external_id: message.id,
      external_source: 'outlook',
      ...route,
    })
    if (route.opportunity) await updateOpportunitySummary(route.opportunity)
    created += 1
  }
  console.log(`outlook-ingest: ${created} created, ${messages.length} fetched`)
}

async function reroute() {
  const rows = await readAll('crm_email_message', 'filter[routing_status][_in]=UNROUTED,COMPANY_ONLY,COMPANY_DEPT,CUSTOMER_EMAIL_NO_COMPANY&fields=id,subject,body_preview,sender,recipients,routing_status,retailer')
  let updated = 0
  let evaluated = 0
  for (const row of rows) {
    const addresses = extractAddresses(`${row.sender || ''} ${row.recipients || ''}`)
    const route = await routeEmail({ subject: row.subject || '', bodyText: row.body_preview || '', addresses, allowAi: process.env.CRM_REROUTE_AI === 'true' })
    evaluated += 1
    if (routingImproves(row.routing_status, route, relationId(row.retailer))) {
      await dx('PATCH', `/items/crm_email_message/${row.id}`, route)
      if (route.opportunity) await updateOpportunitySummary(route.opportunity)
      updated += 1
    }
    if (evaluated % 500 === 0) console.log(`reroute: ${evaluated}/${rows.length} evaluated, ${updated} improved`)
  }
  console.log(`reroute: ${evaluated} messages evaluated, ${updated} improved`)
}

async function ensureRetailerForDomain(domain) {
  const candidates = domainCandidates(domain)
  const existing = await queryItems('retailer', {
    filter: {
      _or: candidates.flatMap((candidate) => [
        { domain: { _contains: candidate } },
        { routing_aliases: { _contains: candidate } },
      ]),
    },
    fields: ['id', 'name', 'domain', 'routing_aliases'],
    limit: 2,
  })
  if (existing[0]) return existing[0].id
  const row = await dx('POST', '/items/retailer', {
    name: domainToCompanyName(domain),
    domain,
    customer_status: 'UNASSIGNED',
    external_source: 'email-contact-sync',
    external_id: domain,
  })
  return row.id
}

async function contactSync() {
  const rows = await readAll('crm_email_message', 'fields=id,sender,recipients')
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
      const candidates = domainCandidates(domain)
      const before = await queryItems('retailer', {
        filter: {
          _or: candidates.flatMap((candidate) => [
            { domain: { _contains: candidate } },
            { routing_aliases: { _contains: candidate } },
          ]),
        },
        fields: ['id'],
        limit: 1,
      })
      const retailer = await ensureRetailerForDomain(domain)
      if (!before.length) retailersCreated += 1
      retailerByDomain.set(domain, retailer)
    }
    const existing = await queryItems('buyer', { filter: { email: { _eq: address } }, fields: ['id'], limit: 1 })
    if (existing.length) continue
    await dx('POST', '/items/buyer', {
      name: personNameFromEmail(address),
      email: address,
      retailer: retailerByDomain.get(domain),
      scope: 'COMPANY_WIDE',
      contact_type: 'OTHER',
      external_source: 'email-contact-sync',
      external_id: address,
    })
    buyersCreated += 1
  }
  console.log(`contact-sync: ${retailersCreated} retailers created, ${buyersCreated} contacts created, ${addresses.length} addresses evaluated`)
}

async function summarize() {
  const rows = await queryItems('crm_email_message', {
    filter: { opportunity: { _nnull: true } },
    fields: ['opportunity'],
    limit: 5000,
  })
  const ids = [...new Set(rows.map((row) => relationId(row.opportunity)).filter(Boolean))]
  let updated = 0
  for (const id of ids) {
    if (await summarizeOpportunity(id)) updated += 1
  }
  console.log(`summarize: ${updated}/${ids.length} opportunities refreshed`)
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 2_000_000) {
        req.destroy()
        reject(new Error('request body too large'))
      }
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

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
        id
        title
        date
        duration
        participants
        organizer_email
        summary {
          action_items
          overview
          keywords
          topics_discussed
          meeting_type
        }
        transcript_url
        audio_url
        video_url
        meeting_link
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
    if (email && !participants.some((p) => p.email.toLowerCase() === email.toLowerCase())) {
      participants.push({ name: name || email, email: email.toLowerCase() })
    }
  }
  if (transcript.organizer_email && !participants.some((p) => p.email.toLowerCase() === transcript.organizer_email.toLowerCase())) {
    participants.push({ name: 'Meeting Organizer', email: transcript.organizer_email.toLowerCase() })
  }
  return participants
}

async function handleFirefliesPayload(payload) {
  const meetingId = payload?.meetingId || payload?.meeting_id || payload?.transcript?.id
  if (!meetingId) return { success: false, errors: ['missing meetingId'] }

  const existing = await dx('GET', `/items/crm_meeting_note?filter[fireflies_transcript_id][_eq]=${encodeURIComponent(meetingId)}&fields=id&limit=1`)
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

  let contact = null
  const matchedContacts = []
  for (const p of participants) {
    const rows = await dx('GET', `/items/buyer?filter[email][_eq]=${encodeURIComponent(p.email)}&fields=id,email&limit=1`)
    if (rows[0]) {
      matchedContacts.push({ id: rows[0].id, name: p.name })
      if (!contact && !p.email.endsWith(`@${INTERNAL_DOMAIN}`)) contact = rows[0].id
    }
  }

  const dateValue = transcript.date ? new Date(Number(transcript.date) || transcript.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  const note = await dx('POST', '/items/crm_meeting_note', {
    name: transcript.title || `Meeting - ${dateValue}`,
    date: dateValue,
    participants: participantText,
    summary: summary.overview || '',
    action_items: actionItems,
    source: 'FIREFLIES_AUTO_IMPORT',
    fireflies_transcript_id: meetingId,
    retailer: route.retailer || null,
    department: route.department || null,
    opportunity: route.opportunity || null,
    contact,
    external_id: meetingId,
    external_source: 'fireflies',
  })

  for (const p of matchedContacts) {
    await dx('POST', '/items/crm_meeting_note_attendee', {
      name: p.name,
      meeting_note: note.id,
      contact: p.id,
      external_id: `${meetingId}:${p.id}`,
      external_source: 'fireflies',
    })
  }

  if (route.opportunity) await updateOpportunitySummary(route.opportunity)

  return { success: true, meetingId, noteIds: [note.id], actionItemsCount: Array.isArray(summary.action_items) ? summary.action_items.length : 0 }
}

async function firefliesServer() {
  const { createServer } = await import('node:http')
  const port = Number(process.env.PORT || 8787)
  const server = createServer(async (req, res) => {
    const jsonHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-hub-signature,x-fireflies-signature' }
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, jsonHeaders)
        res.end()
        return
      }
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, jsonHeaders)
        res.end(JSON.stringify({ ok: true }))
        return
      }
      if (req.method !== 'POST' || !['/s/fireflies-webhook', '/webhooks/fireflies'].includes(req.url || '')) {
        res.writeHead(404, jsonHeaders)
        res.end(JSON.stringify({ error: 'not_found' }))
        return
      }
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      await new Promise((resolve, reject) => {
        req.on('end', resolve)
        req.on('error', reject)
      })
      const raw = Buffer.concat(chunks).toString('utf8')
      const ok = await isValidFirefliesSignature(raw, req.headers['x-hub-signature'] || req.headers['x-fireflies-signature'])
      if (!ok) {
        res.writeHead(401, jsonHeaders)
        res.end(JSON.stringify({ success: false, errors: ['invalid signature'] }))
        return
      }
      const payload = raw ? JSON.parse(raw) : {}
      await login()
      const result = await handleFirefliesPayload(payload)
      res.writeHead(result.success ? 200 : 400, jsonHeaders)
      res.end(JSON.stringify(result))
    } catch (error) {
      res.writeHead(500, jsonHeaders)
      res.end(JSON.stringify({ success: false, errors: [error.message] }))
    }
  })
  server.listen(port, '0.0.0.0', () => console.log(`fireflies-server listening on ${port}`))
}

await login()
const command = process.argv[2] || 'help'
if (command === 'outlook-ingest') await outlookIngest()
else if (command === 'reroute') await reroute()
else if (command === 'fireflies-server') await firefliesServer()
else if (command === 'contact-sync') await contactSync()
else if (command === 'summarize') await summarize()
else {
  console.log('Usage: node pm-system/crm-worker.mjs <outlook-ingest|reroute|fireflies-server|contact-sync|summarize>')
}
