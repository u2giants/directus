// ClickUp -> Directus migration importer.
// Idempotent (upsert by external_id). Product references are matched/created by
// name, except retailer/customer. Retailers are owned by CRM/Twenty data and
// must already exist; this importer must not create customer placeholders.
// Classification: a task is a `project` ONLY if it is a top-level task (no parent) in an
// offer-level list; every other task (subtasks, and all tasks in SKU-level lists) is a `product`.
// Env: DX_URL, DX_ADMIN_EMAIL, DX_ADMIN_PASSWORD, CU_TOKEN, [ONLY_LIST=<id>], [DRY=1]
const DX = process.env.DX_URL || 'http://localhost:8055';
const ADMIN_EMAIL = process.env.DX_ADMIN_EMAIL, ADMIN_PASSWORD = process.env.DX_ADMIN_PASSWORD;
const CU = 'https://api.clickup.com/api/v2', CUT = process.env.CU_TOKEN;
const DRY = process.env.DRY === '1', ONLY = process.env.ONLY_LIST || null;
let T = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function dx(m, p, b, t = T) {
  const r = await fetch(DX + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const x = await r.text(); let j; try { j = x ? JSON.parse(x) : null; } catch { j = x; }
  if (!r.ok) throw new Error(`${m} ${p} ${r.status}: ${j?.errors?.[0]?.message || x}`);
  return j?.data ?? j;
}
async function cu(p) {
  for (let a = 0; a < 6; a++) {
    const r = await fetch(CU + p, { headers: { Authorization: CUT } });
    if (r.status === 429) { await sleep(2000 * (a + 1)); continue; }
    const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; }
    if (!r.ok) throw new Error(`CU ${p} ${r.status}: ${String(x).slice(0, 160)}`);
    return j;
  }
  throw new Error('CU rate-limit retries exhausted: ' + p);
}

// lists: [id, name, role(project|product), business_unit]
const LISTS = [
  ['901103451229', 'Customer Refresh', 'project', 'POP Creations'],
  ['901103451267', 'Customer Category Expansion', 'project', 'POP Creations'],
  ['901103451188', 'New Prod Development', 'project', 'POP Creations'],
  ['901104141567', 'Sourcing/Sampling Projects', 'project', 'POP Creations'],
  ['901103514425', "Licensor's projects", 'project', 'POP Creations'],
  ['901109204835', 'General Presentations', 'project', 'Spruce Line'],
  ['13194624', 'Licensing Management', 'product', 'POP Creations'],
  ['900500326811', 'Freelancers Licensed', 'product', 'POP Creations'],
  ['15061776', 'Edge Generic', 'product', 'Spruce Line'],
  ['901107307251', 'Freelancers Generic', 'product', 'Spruce Line'],
];
const FIELD_MAP = { '🧑‍✈ Customer / Retailer': 'retailer', 'customer': 'retailer', '🏭 Factory': 'factory', '📚 Category': 'product_type', '👤 Buyer': 'buyer' };
const KNOWN_LICENSORS = ['disney','marvel','star wars','warner','wb','dc','nbcu','nickelodeon','nick','peanuts','sega','strawberry shortcake','wwe','one piece','care bears','coca cola','sesame street','universal','paramount'];

const ref = { retailer: {}, factory: {}, buyer: {}, product_type: {}, licensor: {}, stage: {} };
async function getOrCreateRef(col, name) {
  if (!name) return null; const key = String(name).trim(); if (!key) return null;
  const ck = key.toLowerCase(); if (ref[col][ck]) return ref[col][ck]; if (DRY) return (ref[col][ck] = 'DRY');
  const found = await dx('GET', `/items/${col}?filter[name][_eq]=${encodeURIComponent(key)}&fields=id&limit=1`);
  const id = found?.[0]?.id || (await dx('POST', `/items/${col}`, { name: key })).id;
  return (ref[col][ck] = id);
}
async function getExistingRef(col, name) {
  if (!name) return null; const key = String(name).trim(); if (!key) return null;
  const ck = key.toLowerCase(); if (ref[col][ck]) return ref[col][ck]; if (DRY) return (ref[col][ck] = 'DRY');
  const found = await dx('GET', `/items/${col}?filter[name][_eq]=${encodeURIComponent(key)}&fields=id&limit=1`);
  if (found?.[0]?.id) return (ref[col][ck] = found[0].id);
  throw new Error(`Missing ${col} "${key}" — create/select it in CRM first`);
}
async function ensureFields() {
  for (const col of ['project', 'product', 'design']) {
    const ex = (await dx('GET', `/fields/${col}`)).map(f => f.field);
    for (const fld of ['external_id', 'external_source']) if (!ex.includes(fld)) { await dx('POST', `/fields/${col}`, { field: fld, type: 'string', meta: { interface: 'input', readonly: true, note: 'migration provenance' }, schema: {} }); console.log(`  + ${col}.${fld}`); }
  }
  const pf = (await dx('GET', '/fields/product')).map(f => f.field);
  for (const [fld, rel] of [['retailer', 'retailer'], ['buyer', 'buyer']]) if (!pf.includes(fld)) {
    await dx('POST', '/fields/product', { field: fld, type: 'uuid', meta: { interface: 'select-dropdown-m2o', note: 'from ClickUp' }, schema: {} });
    await dx('POST', '/relations', { collection: 'product', field: fld, related_collection: rel, schema: { on_delete: 'SET NULL' }, meta: {} });
    console.log(`  + product.${fld} (M2O)`);
  }
}
async function seedStages() {
  for (const [lid, bu] of [['13194624', 'POP Creations'], ['15061776', 'Spruce Line']]) {
    const statuses = (await cu(`/list/${lid}`)).statuses || [];
    for (let i = 0; i < statuses.length; i++) {
      const name = statuses[i].status, ck = (bu + '|' + name).toLowerCase();
      if (DRY) { ref.stage[ck] = 'DRY'; continue; }
      const found = await dx('GET', `/items/stage?filter[name][_eq]=${encodeURIComponent(name)}&filter[business_unit][_eq]=${encodeURIComponent(bu)}&fields=id&limit=1`);
      ref.stage[ck] = found?.[0]?.id || (await dx('POST', '/items/stage', { name, business_unit: bu, stage_order: i + 1, category: 'design' })).id;
    }
  }
  console.log(`  stages: ${Object.keys(ref.stage).length}`);
}
function resolveCustomFields(task) {
  const out = {};
  for (const f of task.custom_fields || []) {
    const target = FIELD_MAP[f.name]; if (!target || f.value === undefined || f.value === null || f.value === '') continue;
    const opts = f.type_config?.options || [];
    const nameOf = id => { const o = opts.find(o => String(o.id) === String(id) || String(o.orderindex) === String(id)); return o ? (o.name || o.label) : null; };
    if (f.type === 'drop_down') out[target] = nameOf(f.value) || (typeof f.value === 'string' ? f.value : null);
    else if (f.type === 'labels' && Array.isArray(f.value)) out[target] = f.value.map(nameOf).filter(Boolean)[0];
  }
  return out;
}
function licensorFromTags(task) { for (const t of task.tags || []) { const n = (t.name || '').toLowerCase(); if (KNOWN_LICENSORS.find(k => n.includes(k))) return t.name; } return null; }
async function fetchAllTasks(lid) {
  const all = []; let page = 0;
  while (true) { const t = (await cu(`/list/${lid}/task?include_closed=true&subtasks=true&page=${page}`)).tasks || []; all.push(...t); if (t.length < 100) break; page++; await sleep(120); }
  return all;
}
async function preloadExternalIds(col) {
  const map = {}; let page = 0;
  while (true) { const rows = await dx('GET', `/items/${col}?filter[external_source][_eq]=clickup&fields=id,external_id&limit=500&page=${page}`); for (const r of rows) if (r.external_id) map[r.external_id] = r.id; if (rows.length < 500) break; page++; }
  return map;
}

async function main() {
  T = (await dx('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, '')).access_token;
  console.log(`Directus ${DX} (${DRY ? 'DRY' : 'LIVE'})${ONLY ? ' ONLY=' + ONLY : ''}`);
  if (!DRY) { await ensureFields(); }
  await seedStages();
  const existing = { project: await preloadExternalIds('project'), product: await preloadExternalIds('product') };
  const projectByCuId = { ...existing.project };
  console.log(`existing: ${Object.keys(existing.project).length} projects, ${Object.keys(existing.product).length} products`);

  // fetch all tasks once
  const items = [];
  for (const [lid, lname, role, bu] of LISTS) {
    if (ONLY && lid !== ONLY) continue;
    const tasks = await fetchAllTasks(lid);
    for (const task of tasks) items.push({ task, role, bu });
    console.log(`  fetched ${tasks.length} from ${lname}`);
  }
  const isProject = it => it.role === 'project' && !it.task.parent;

  async function upProject(task, bu) {
    const cf = resolveCustomFields(task);
    const p = { title: task.name || '(untitled)', business_unit: bu, external_id: task.id, external_source: 'clickup', status: /complete|done|prod apprv/i.test(task.status?.status || '') ? 'won' : 'active' };
    if (cf.retailer) p.retailer = await getExistingRef('retailer', cf.retailer);
    if (cf.buyer) p.buyer = await getOrCreateRef('buyer', cf.buyer);
    if (DRY) return;
    const ex = existing.project[task.id];
    if (ex) await dx('PATCH', `/items/project/${ex}`, p);
    else { const r = await dx('POST', '/items/project', p); existing.project[task.id] = r.id; projectByCuId[task.id] = r.id; }
  }
  async function upProduct(task, bu) {
    const cf = resolveCustomFields(task);
    const p = { name: task.name || '(untitled)', business_unit: bu, external_id: task.id, external_source: 'clickup', code: task.custom_id || task.id };
    const st = ref.stage[(bu + '|' + (task.status?.status || '')).toLowerCase()]; if (st) p.stage = st;
    if (cf.retailer) p.retailer = await getExistingRef('retailer', cf.retailer);
    if (cf.buyer) p.buyer = await getOrCreateRef('buyer', cf.buyer);
    if (cf.factory) p.factory = await getOrCreateRef('factory', cf.factory);
    if (cf.product_type) p.product_type = await getOrCreateRef('product_type', cf.product_type);
    const lic = licensorFromTags(task); if (lic) p.licensor = await getOrCreateRef('licensor', lic);
    if (task.parent && projectByCuId[task.parent]) p.project = projectByCuId[task.parent];
    if (DRY) return;
    const ex = existing.product[task.id];
    if (ex) await dx('PATCH', `/items/product/${ex}`, p);
    else { const r = await dx('POST', '/items/product', p); existing.product[task.id] = r.id; }
  }

  let np = 0, nq = 0; const fails = [];
  for (const it of items) if (isProject(it)) { try { await upProject(it.task, it.bu); np++; } catch (e) { fails.push(['project', it.task.id, e.message]); } if (np % 250 === 0) process.stdout.write(`\r  projects ${np}`); }
  console.log(`\nprojects upserted: ${np}`);
  for (const it of items) if (!isProject(it)) { try { await upProduct(it.task, it.bu); nq++; } catch (e) { fails.push(['product', it.task.id, e.message]); } if (nq % 500 === 0) process.stdout.write(`\r  products ${nq}`); }
  console.log(`\nproducts upserted: ${nq}`);
  if (fails.length) { console.log(`FAILURES (${fails.length}):`); for (const f of fails.slice(0, 8)) console.log('  ', f.join(' | ')); }
  console.log(`reference: retailers ${Object.keys(ref.retailer).length}, factories ${Object.keys(ref.factory).length}, buyers ${Object.keys(ref.buyer).length}, product_types ${Object.keys(ref.product_type).length}, licensors ${Object.keys(ref.licensor).length}`);
}
main().catch(e => { console.error('✗', e.message); process.exit(1); });
