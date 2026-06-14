import { randomUUID } from 'node:crypto'

const DEPARTMENT_CONTACT_TYPES = new Set(['BUYER', 'ASSISTANT_BUYER', 'PLANNER'])
const COMPANY_WIDE_CONTACT_TYPES = new Set(['CHINA_OFFICE', 'LOGISTICS', 'LEGAL', 'FINANCE'])

const NEW_OPPORTUNITY_TASKS = [
  'Confirm directive details',
  'Set up program record',
  'Identify and assign factory',
]

const STAGE_TASKS = {
  BUYER_REVIEW: ['Get factory pricing'],
  PRICING_AND_SAMPLING: ['Request sample', 'Schedule sample review'],
  IN_PRODUCTION: ['Send Production PO', 'Send art files'],
}

const APPROVAL_STAGE_TASKS = {
  SUBMITTED_TO_LICENSOR: 'Follow up with licensor on submission status',
  RESUBMIT_REQUIRED: 'Address licensor comments and resubmit artwork',
  FIRST_APPROVAL: 'Obtain final approval from licensor',
  APPROVED: 'Confirm licensor approval received and proceed to production',
  REJECTED: 'Review rejection with buyer and decide next steps',
  CONCEPT_REVISIONS: 'Review concept revisions',
  RESUBMIT: 'Resubmit to licensor',
  CONCEPT_APPROVED_WITH_COMMENTS: 'Address approval comments',
  PPS_SUBMIT: 'Prepare PPS submission',
}

function clean(value) {
  const s = String(value || '').trim()
  return s || null
}

function contactScope(payload) {
  if (payload.department) return 'DEPARTMENT'
  const role = payload.contact_type || payload.job_title
  if (DEPARTMENT_CONTACT_TYPES.has(role)) return 'DEPARTMENT'
  if (COMPANY_WIDE_CONTACT_TYPES.has(role)) return 'COMPANY_WIDE'
  if (role === 'OTHER' || role === 'FORMER_CONTACT') return 'IGNORED'
  if (payload.retailer) return 'COMPANY_WIDE'
  return 'IGNORED'
}

async function first(db, table, where) {
  return db(table).where(where).first()
}

async function createTask(db, opportunity, title, extra = {}) {
  if (!opportunity?.id || !title) return
  const existing = await first(db, 'crm_task', {
    opportunity: opportunity.id,
    title,
    external_source: 'crm-automation',
  })
  if (existing) return
  await db('crm_task').insert({
    id: randomUUID(),
    title,
    status: 'TODO',
    opportunity: opportunity.id,
    retailer: opportunity.retailer || null,
    department: opportunity.department || null,
    contact: opportunity.contact || null,
    external_source: 'crm-automation',
    external_id: `${opportunity.id}:${title}`.slice(0, 255),
    ...extra,
  })
}

async function createApprovalThread(db, opportunity) {
  if (!opportunity?.id || !opportunity.licensed) return
  const existing = await first(db, 'crm_licensor_approval_thread', {
    opportunity: opportunity.id,
    external_source: 'crm-automation',
  })
  if (existing) return
  await db('crm_licensor_approval_thread').insert({
    id: randomUUID(),
    name: `LAT - ${opportunity.name || 'Program'}`,
    property_name: opportunity.name || null,
    stage: 'CONCEPT_SUBMIT',
    submitted_date: new Date().toISOString().slice(0, 10),
    opportunity: opportunity.id,
    external_source: 'crm-automation',
    external_id: `lat:${opportunity.id}`,
  })
  await createTask(db, opportunity, 'Submit concept to licensor for approval')
}

async function linkPoppimProject(db, opportunity) {
  if (!opportunity?.id || opportunity.project) return

  const plm = clean(opportunity.plm_project_id)
  let project = null
  if (plm) {
    project = await db('project').where({ external_id: plm }).first()
    if (!project && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(plm)) {
      project = await db('project').where({ id: plm }).first()
    }
  }

  const orderNumbers = [opportunity.production_po_number, opportunity.sales_order_number, opportunity.import_po_number]
    .map(clean)
    .filter(Boolean)
  if (!project && orderNumbers.length) {
    const order = await db('order')
      .leftJoin('product', 'order.product', 'product.id')
      .select('order.project as order_project', 'product.project as product_project')
      .whereIn('order.order_number', orderNumbers)
      .first()
    const projectId = order?.order_project || order?.product_project
    if (projectId) project = await db('project').where({ id: projectId }).first()
  }

  if (!project) return
  await db('crm_opportunity').where({ id: opportunity.id }).update({ project: project.id })
}

async function handleOpportunity(db, id, isCreate) {
  const opportunity = await db('crm_opportunity').where({ id }).first()
  if (!opportunity) return

  if (isCreate) {
    for (const title of NEW_OPPORTUNITY_TASKS) await createTask(db, opportunity, title)
    if (opportunity.sample_required) await createTask(db, opportunity, 'Arrange sample production and shipment')
    if (opportunity.licensed) await createTask(db, opportunity, 'Create LAT and submit artwork')
  }

  const tasks = [...(STAGE_TASKS[opportunity.stage] || [])]
  if (opportunity.stage === 'BUYER_REVIEW' && opportunity.licensed) await createApprovalThread(db, opportunity)
  if (opportunity.stage === 'BUYER_REVIEW' && !opportunity.requires_new_pricing) tasks.splice(tasks.indexOf('Get factory pricing'), 1)
  if (opportunity.stage === 'PRICING_AND_SAMPLING' && !opportunity.sample_required) tasks.length = 0
  if (opportunity.stage === 'IN_PRODUCTION' && opportunity.sample_required) tasks.push('Request sample with production PO')
  for (const title of tasks) await createTask(db, opportunity, title)

  await linkPoppimProject(db, opportunity)
}

async function handleApproval(db, id) {
  const approval = await db('crm_licensor_approval_thread').where({ id }).first()
  if (!approval?.opportunity) return
  const title = APPROVAL_STAGE_TASKS[approval.stage]
  if (!title) return
  const opportunity = await db('crm_opportunity').where({ id: approval.opportunity }).first()
  if (opportunity) await createTask(db, opportunity, title)
}

async function bulkSkipForRule(db, rule) {
  const pattern = clean(rule.pattern)?.toLowerCase()
  if (!pattern) return
  const matchType = rule.match_type || 'CONTAINS'
  const rows = await db('crm_email_message')
    .select('id', 'subject')
    .where({ routing_status: 'UNROUTED' })
    .limit(10000)
  const ids = rows
    .filter((row) => {
      const subject = clean(row.subject)?.replace(/^(re:\s*|fw:\s*|fwd:\s*)+/i, '').toLowerCase() || ''
      if (matchType === 'EXACT') return subject === pattern
      if (matchType === 'STARTS_WITH') return subject.startsWith(pattern)
      return subject.includes(pattern)
    })
    .map((row) => row.id)

  if (ids.length) {
    await db('crm_email_message').whereIn('id', ids).update({
      routing_status: 'SKIPPED',
      routing_method: 'AUTO_SKIP',
    })
  }
  await db('crm_ignore_rule').where({ id: rule.id }).update({
    emails_skipped: Number(rule.emails_skipped || 0) + ids.length,
  })
}

export default ({ filter, action }, { database, logger }) => {
  filter('items.create', async (payload, meta) => {
    if (meta.collection === 'buyer') {
      return { ...payload, scope: payload.scope || contactScope(payload) }
    }
    return payload
  })

  filter('items.update', async (payload, meta) => {
    if (meta.collection === 'buyer' && ('department' in payload || 'retailer' in payload || 'contact_type' in payload || 'job_title' in payload)) {
      const current = meta.keys?.length === 1 ? await database('buyer').where({ id: meta.keys[0] }).first() : {}
      return { ...payload, scope: contactScope({ ...current, ...payload }) }
    }
    return payload
  })

  action('items.create', async (meta) => {
    try {
      if (meta.collection === 'crm_opportunity') await handleOpportunity(database, meta.key, true)
      if (meta.collection === 'crm_licensor_approval_thread') await handleApproval(database, meta.key)
      if (meta.collection === 'crm_ignore_rule') {
        const rule = await database('crm_ignore_rule').where({ id: meta.key }).first()
        if (rule) await bulkSkipForRule(database, rule)
      }
    } catch (error) {
      logger.error(`POP CRM automation create failed: ${error.message}`)
    }
  })

  action('items.update', async (meta) => {
    try {
      if (meta.collection === 'crm_opportunity' && (meta.payload?.stage || meta.payload?.project === null || meta.payload?.plm_project_id)) {
        for (const id of meta.keys || []) await handleOpportunity(database, id, false)
      }
      if (meta.collection === 'crm_licensor_approval_thread' && meta.payload?.stage) {
        for (const id of meta.keys || []) await handleApproval(database, id)
      }
    } catch (error) {
      logger.error(`POP CRM automation update failed: ${error.message}`)
    }
  })
}
