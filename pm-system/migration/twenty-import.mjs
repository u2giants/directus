// Twenty CRM -> shared Directus importer.
// Reads the local Twenty Postgres container via psql JSON and writes Directus via API.
// Idempotent: upserts by external_id + external_source='twenty'. DRY=1 prints counts only.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env DX_URL=https://data.designflow.app DRY=1 node pm-system/migration/twenty-import.mjs
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env DX_URL=https://data.designflow.app node pm-system/migration/twenty-import.mjs
import { execFileSync } from 'node:child_process'
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
const DRY = process.env.DRY === '1'
const TWENTY_CONTAINER = process.env.TWENTY_PG_CONTAINER || 'twenty-postgres'
const TWENTY_SCHEMA = process.env.TWENTY_SCHEMA || 'workspace_93r34ew9zc9644a9y5f1yeylz'
let TOKEN = ''

async function dx(method, path, body) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
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
      const message = json?.errors?.[0]?.message || text
      if (![429, 500, 502, 503, 504].includes(res.status) || attempt === 5) {
        throw new Error(`${method} ${path} -> ${res.status}: ${message}`)
      }
    } catch (error) {
      if (attempt === 5) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
  }
}

function qident(name) {
  return `"${String(name).replaceAll('"', '""')}"`
}

function pgJson(sql) {
  const wrapped = `select coalesce(json_agg(row_to_json(t)), '[]'::json) from (${sql}) t;`
  const out = execFileSync('docker', ['exec', '-i', TWENTY_CONTAINER, 'psql', '-U', 'twenty', '-d', 'twenty', '-t', '-A', '-c', wrapped], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }).trim()
  return JSON.parse(out || '[]')
}

const table = (name) => `${qident(TWENTY_SCHEMA)}.${qident(name)}`
const clean = (value) => value === undefined || value === null || value === '' ? null : value
const nameKey = (value) => String(value || '').trim().toLowerCase()
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))

async function preload(collection) {
  const byExternal = new Map()
  const byName = new Map()
  const byEmail = new Map()
  let page = 1
  while (true) {
    const rows = await dx('GET', `/items/${collection}?fields=*&limit=500&page=${page}`)
    for (const row of rows) {
      if (row.external_source === 'twenty' && row.external_id) byExternal.set(row.external_id, row.id)
      if (!row.external_source && row.name) byName.set(nameKey(row.name), row.id)
      if (!row.external_source && row.email) byEmail.set(nameKey(row.email), row.id)
    }
    if (rows.length < 500) break
    page += 1
  }
  return { byExternal, byName, byEmail }
}

async function upsert(collection, payload, maps, { matchName, matchEmail } = {}) {
  const externalId = payload.external_id
  let id = externalId ? maps[collection]?.byExternal.get(externalId) : null
  if (!id && matchEmail) id = maps[collection]?.byEmail.get(nameKey(matchEmail))
  if (!id && matchName) id = maps[collection]?.byName.get(nameKey(matchName))
  if (DRY) return id || `DRY:${collection}:${externalId || matchEmail || matchName || Math.random()}`
  let row
  if (id) row = await dx('PATCH', `/items/${collection}/${id}`, payload)
  else row = await dx('POST', `/items/${collection}`, payload)
  if (externalId) maps[collection].byExternal.set(externalId, row.id)
  if (!payload.external_source && (row.name || payload.name)) maps[collection].byName.set(nameKey(row.name || payload.name), row.id)
  if (!payload.external_source && (row.email || payload.email)) maps[collection].byEmail.set(nameKey(row.email || payload.email), row.id)
  return row.id
}

function fullName(person) {
  return [person.nameFirstName, person.nameLastName].filter(Boolean).join(' ').trim() || person.emailsPrimaryEmail || '(unnamed contact)'
}

async function run() {
  if (!EMAIL || !PASSWORD) throw new Error('DX_ADMIN_EMAIL and DX_ADMIN_PASSWORD are required')
  TOKEN = (await dx('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).access_token
  console.log(`Twenty -> Directus CRM import (${DRY ? 'DRY' : 'LIVE'})`)

  const maps = {
    // Full Twenty-CRM company/contact sets import into the raw registries; the
    // promote_customer trigger copies any customer_status=ACTIVE/POTENTIAL company
    // into the curated `retailer` table. See migration/split-customers-from-ingested.sql.
    ingested_domains: await preload('ingested_domains'),
    ingested_contact: await preload('ingested_contact'),
    factory: await preload('factory'),
    crm_department: await preload('crm_department'),
    crm_opportunity: await preload('crm_opportunity'),
    crm_meeting_note: await preload('crm_meeting_note'),
    crm_meeting_note_attendee: await preload('crm_meeting_note_attendee'),
    crm_licensor_approval_thread: await preload('crm_licensor_approval_thread'),
    crm_email_message: await preload('crm_email_message'),
    crm_ignore_rule: await preload('crm_ignore_rule'),
    crm_ai_model_config: await preload('crm_ai_model_config'),
    crm_note: await preload('crm_note'),
    crm_task: await preload('crm_task'),
  }

  const companies = pgJson(`
    select id, name, "domainNamePrimaryLinkUrl", "domainNamePrimaryLinkLabel", "routingDomain", "routingAliases",
           "customerStatus"::text, "chainType"::text,
           "addressAddressStreet1", "addressAddressStreet2", "addressAddressCity", "addressAddressState", "addressAddressPostcode", "addressAddressCountry"
    from ${table('company')} where "deletedAt" is null order by name nulls last
  `)
  const companyIdToRetailer = new Map()
  for (const company of companies) {
    const address = [company.addressAddressStreet1, company.addressAddressStreet2, company.addressAddressCity, company.addressAddressState, company.addressAddressPostcode, company.addressAddressCountry].filter(Boolean).join(', ')
    const payload = compact({
      name: company.name || '(unnamed company)',
      domain: clean(company.routingDomain || company.domainNamePrimaryLinkUrl || company.domainNamePrimaryLinkLabel),
      routing_aliases: clean(company.routingAliases),
      aliases: clean(company.routingAliases),
      notes: address || undefined,
      customer_status: clean(company.customerStatus),
      chain_type: clean(company.chainType),
      external_id: company.id,
      external_source: 'twenty',
    })
    companyIdToRetailer.set(company.id, await upsert('ingested_domains', payload, maps, { matchName: company.name }))
  }
  console.log(`  retailers/companies: ${companies.length}`)

  const factories = pgJson(`
    select id, name, location, "contactName", "contactEmailPrimaryEmail", capabilities, notes
    from ${table('_factory')} where "deletedAt" is null order by name nulls last
  `)
  const factoryIdToFactory = new Map()
  for (const factory of factories) {
    const payload = compact({
      name: factory.name || '(unnamed factory)',
      location: clean(factory.location),
      contact_name: clean(factory.contactName),
      contact_email: clean(factory.contactEmailPrimaryEmail),
      capabilities: clean(factory.capabilities),
      notes: clean(factory.notes),
      external_id: factory.id,
      external_source: 'twenty',
    })
    factoryIdToFactory.set(factory.id, await upsert('factory', payload, maps, { matchName: factory.name }))
  }
  console.log(`  factories: ${factories.length}`)

  const people = pgJson(`
    select id, "nameFirstName", "nameLastName", "emailsPrimaryEmail", "phonesPrimaryPhoneNumber",
           "jobTitle"::text, "contactType"::text, "scope"::text, "companyId", "departmentId"
    from ${table('person')} where "deletedAt" is null order by "emailsPrimaryEmail" nulls last
  `)
  const personIdToBuyer = new Map()
  for (const person of people) {
    const retailer = person.companyId ? companyIdToRetailer.get(person.companyId) : null
    const payload = compact({
      name: fullName(person),
      first_name: clean(person.nameFirstName),
      last_name: clean(person.nameLastName),
      email: clean(person.emailsPrimaryEmail),
      phone: clean(person.phonesPrimaryPhoneNumber),
      job_title: clean(person.jobTitle),
      contact_type: clean(person.contactType),
      scope: clean(person.scope),
      retailer,
      external_id: person.id,
      external_source: 'twenty',
    })
    personIdToBuyer.set(person.id, await upsert('ingested_contact', payload, maps, { matchEmail: person.emailsPrimaryEmail, matchName: fullName(person) }))
  }
  console.log(`  buyers/contacts: ${people.length}`)

  const departments = pgJson(`
    select id, name, "category"::text, "division"::text, active, position, "companyId", "primaryBuyerId"
    from ${table('_department')} where "deletedAt" is null order by name nulls last
  `)
  const deptIdToDept = new Map()
  for (const dept of departments) {
    const payload = compact({
      name: dept.name || '(unnamed department)',
      category: clean(dept.category),
      division: clean(dept.division),
      active: dept.active,
      sort: Number.isFinite(dept.position) ? Math.round(dept.position) : undefined,
      retailer: dept.companyId ? companyIdToRetailer.get(dept.companyId) : null,
      primary_buyer: dept.primaryBuyerId ? personIdToBuyer.get(dept.primaryBuyerId) : null,
      external_id: dept.id,
      external_source: 'twenty',
    })
    deptIdToDept.set(dept.id, await upsert('crm_department', payload, maps, { matchName: `${payload.retailer || ''}:${payload.name}` }))
  }
  for (const person of people) {
    const buyer = personIdToBuyer.get(person.id)
    const department = person.departmentId ? deptIdToDept.get(person.departmentId) : null
    if (!DRY && buyer && department) await dx('PATCH', `/items/buyer/${buyer}`, { department })
  }
  console.log(`  departments: ${departments.length}`)

  const opportunities = pgJson(`
    select id, name, "amountAmountMicros", "closeDate", "stage"::text, "programType"::text, "seasonYear"::text,
           "directiveSource"::text, "division"::text, "originCountry"::text, licensed, "productionPoNumber",
           "salesOrderNumber", "importPoNumber", "customerIncoterms"::text, "factoryIncoterms"::text,
           "hardDeliveryDate", "sampleRequired", "sampleApprovalMethod"::text, "requiresNewPricing",
           "plmProjectId", "companyId", "pointOfContactId", "departmentId", "factoryId"
    from ${table('opportunity')} where "deletedAt" is null order by name nulls last
  `)
  const opportunityIdToOpportunity = new Map()
  for (const opp of opportunities) {
    const payload = compact({
      name: opp.name || '(unnamed opportunity)',
      amount: opp.amountAmountMicros ? Number(opp.amountAmountMicros) / 1000000 : undefined,
      close_date: clean(opp.closeDate),
      stage: clean(opp.stage),
      program_type: clean(opp.programType),
      season_year: clean(opp.seasonYear),
      directive_source: clean(opp.directiveSource),
      division: clean(opp.division),
      origin_country: clean(opp.originCountry),
      licensed: opp.licensed,
      production_po_number: clean(opp.productionPoNumber),
      sales_order_number: clean(opp.salesOrderNumber),
      import_po_number: clean(opp.importPoNumber),
      customer_incoterms: clean(opp.customerIncoterms),
      factory_incoterms: clean(opp.factoryIncoterms),
      hard_delivery_date: clean(opp.hardDeliveryDate),
      sample_required: opp.sampleRequired,
      sample_approval_method: clean(opp.sampleApprovalMethod),
      requires_new_pricing: opp.requiresNewPricing,
      plm_project_id: clean(opp.plmProjectId),
      retailer: opp.companyId ? companyIdToRetailer.get(opp.companyId) : null,
      contact: opp.pointOfContactId ? personIdToBuyer.get(opp.pointOfContactId) : null,
      department: opp.departmentId ? deptIdToDept.get(opp.departmentId) : null,
      factory: opp.factoryId ? factoryIdToFactory.get(opp.factoryId) : null,
      external_id: opp.id,
      external_source: 'twenty',
    })
    opportunityIdToOpportunity.set(opp.id, await upsert('crm_opportunity', payload, maps, { matchName: opp.name }))
  }
  console.log(`  opportunities: ${opportunities.length}`)

  const aiConfigs = pgJson(`
    select id, name, "emailRoutingModel"::text, "firefliesRoutingModel"::text, "transcriptSplitModel"::text
    from ${table('_aiModelConfig')} where "deletedAt" is null order by name nulls last
  `)
  for (const cfg of aiConfigs) {
    await upsert('crm_ai_model_config', compact({
      name: cfg.name || 'Default',
      email_routing_model: clean(cfg.emailRoutingModel),
      fireflies_routing_model: clean(cfg.firefliesRoutingModel),
      transcript_split_model: clean(cfg.transcriptSplitModel),
      external_id: cfg.id,
      external_source: 'twenty',
    }), maps, { matchName: cfg.name })
  }
  console.log(`  ai model configs: ${aiConfigs.length}`)

  const ignoreRules = pgJson(`
    select id, name, pattern, "matchType"::text, "emailsSkipped"
    from ${table('_ignoreRule')} where "deletedAt" is null order by name nulls last
  `)
  for (const rule of ignoreRules) {
    await upsert('crm_ignore_rule', compact({
      name: rule.name || rule.pattern || '(unnamed rule)',
      pattern: clean(rule.pattern),
      match_type: clean(rule.matchType),
      emails_skipped: rule.emailsSkipped === null ? undefined : Math.round(Number(rule.emailsSkipped)),
      external_id: rule.id,
      external_source: 'twenty',
    }), maps, { matchName: rule.name || rule.pattern })
  }
  console.log(`  ignore rules: ${ignoreRules.length}`)

  const meetingNotes = pgJson(`
    select id, name, date, participants, summary, "actionItems", "source"::text, "firefliesTranscriptId",
           "companyId", "departmentId", "programId", "personId"
    from ${table('_meetingNote')} where "deletedAt" is null order by date nulls last
  `)
  const meetingIdToMeeting = new Map()
  for (const note of meetingNotes) {
    const payload = compact({
      name: note.name || '(meeting note)',
      date: clean(note.date),
      participants: clean(note.participants),
      summary: clean(note.summary),
      action_items: clean(note.actionItems),
      source: clean(note.source),
      fireflies_transcript_id: clean(note.firefliesTranscriptId),
      retailer: note.companyId ? companyIdToRetailer.get(note.companyId) : null,
      department: note.departmentId ? deptIdToDept.get(note.departmentId) : null,
      opportunity: note.programId ? opportunityIdToOpportunity.get(note.programId) : null,
      contact: note.personId ? personIdToBuyer.get(note.personId) : null,
      external_id: note.id,
      external_source: 'twenty',
    })
    meetingIdToMeeting.set(note.id, await upsert('crm_meeting_note', payload, maps, { matchName: `${payload.fireflies_transcript_id || ''}:${payload.name}` }))
  }
  console.log(`  meeting notes: ${meetingNotes.length}`)

  const attendees = pgJson(`
    select id, name, "meetingNoteId", "personId"
    from ${table('_meetingNoteAttendee')} where "deletedAt" is null order by name nulls last
  `)
  for (const attendee of attendees) {
    await upsert('crm_meeting_note_attendee', compact({
      name: attendee.name || '(attendee)',
      meeting_note: attendee.meetingNoteId ? meetingIdToMeeting.get(attendee.meetingNoteId) : null,
      contact: attendee.personId ? personIdToBuyer.get(attendee.personId) : null,
      external_id: attendee.id,
      external_source: 'twenty',
    }), maps)
  }
  console.log(`  meeting attendees: ${attendees.length}`)

  const emails = pgJson(`
    select id, name, subject, sender, recipients, "receivedAt", "bodyPreview", "outlookMessageId",
           "routingStatus"::text, "routingMethod"::text, "detectedSoNumbers", "detectedPoNumbers",
           "companyId", "departmentId", "programId"
    from ${table('_emailMessage')} where "deletedAt" is null order by "receivedAt" nulls last
  `)
  let emailCount = 0
  for (const email of emails) {
    await upsert('crm_email_message', compact({
      name: clean(email.name || email.subject),
      subject: clean(email.subject),
      sender: clean(email.sender),
      recipients: clean(email.recipients),
      received_at: clean(email.receivedAt),
      body_preview: clean(email.bodyPreview),
      outlook_message_id: clean(email.outlookMessageId),
      routing_status: clean(email.routingStatus),
      routing_method: clean(email.routingMethod),
      detected_so_numbers: clean(email.detectedSoNumbers),
      detected_po_numbers: clean(email.detectedPoNumbers),
      retailer: email.companyId ? companyIdToRetailer.get(email.companyId) : null,
      department: email.departmentId ? deptIdToDept.get(email.departmentId) : null,
      opportunity: email.programId ? opportunityIdToOpportunity.get(email.programId) : null,
      external_id: email.id,
      external_source: 'twenty',
    }), maps)
    emailCount += 1
    if (emailCount % 1000 === 0) process.stdout.write(`\r  email messages: ${emailCount}/${emails.length}`)
  }
  if (emails.length) process.stdout.write('\n')
  console.log(`  email messages: ${emails.length}`)

  const notes = pgJson(`
    select n.id, n.title, n."bodyV2Markdown", n."actionItems", n."source"::text, n."firefliesTranscriptId",
           nt."targetCompanyId", nt."targetPersonId", nt."targetOpportunityId", nt."targetDepartmentId"
    from ${table('note')} n
    left join ${table('noteTarget')} nt on nt."noteId" = n.id and nt."deletedAt" is null
    where n."deletedAt" is null order by n."createdAt"
  `)
  for (const note of notes) {
    await upsert('crm_note', compact({
      title: note.title || '(note)',
      body: clean(note.bodyV2Markdown),
      action_items: clean(note.actionItems),
      source: clean(note.source),
      fireflies_transcript_id: clean(note.firefliesTranscriptId),
      retailer: note.targetCompanyId ? companyIdToRetailer.get(note.targetCompanyId) : null,
      contact: note.targetPersonId ? personIdToBuyer.get(note.targetPersonId) : null,
      opportunity: note.targetOpportunityId ? opportunityIdToOpportunity.get(note.targetOpportunityId) : null,
      department: note.targetDepartmentId ? deptIdToDept.get(note.targetDepartmentId) : null,
      external_id: note.id,
      external_source: 'twenty',
    }), maps)
  }
  console.log(`  notes: ${notes.length}`)

  const tasks = pgJson(`
    select t.id, t.title, t."bodyV2Markdown", t."dueAt", t."status"::text,
           tt."targetCompanyId", tt."targetPersonId", tt."targetOpportunityId", tt."targetDepartmentId"
    from ${table('task')} t
    left join ${table('taskTarget')} tt on tt."taskId" = t.id and tt."deletedAt" is null
    where t."deletedAt" is null order by t."createdAt"
  `)
  for (const task of tasks) {
    await upsert('crm_task', compact({
      title: task.title || '(task)',
      body: clean(task.bodyV2Markdown),
      due_at: clean(task.dueAt),
      status: clean(task.status),
      retailer: task.targetCompanyId ? companyIdToRetailer.get(task.targetCompanyId) : null,
      contact: task.targetPersonId ? personIdToBuyer.get(task.targetPersonId) : null,
      opportunity: task.targetOpportunityId ? opportunityIdToOpportunity.get(task.targetOpportunityId) : null,
      department: task.targetDepartmentId ? deptIdToDept.get(task.targetDepartmentId) : null,
      external_id: task.id,
      external_source: 'twenty',
    }), maps)
  }
  console.log(`  tasks: ${tasks.length}`)

  console.log('\nImport complete.')
}

run().catch((error) => { console.error('✗', error.message); process.exit(1) })
