// Seed demo data and VERIFY the 3 core proofs (relational graph, field-level pricing hide, stage-history Flow).
// Usage: DX_URL=... DX_ADMIN_EMAIL=... DX_ADMIN_PASSWORD=... node seed-and-verify.mjs
const BASE = process.env.DX_URL || 'http://localhost:8055';
const ADMIN_EMAIL = process.env.DX_ADMIN_EMAIL || 'admin@popcre.com';
const ADMIN_PASSWORD = process.env.DX_ADMIN_PASSWORD || 'BuildPass123!';
let TOKEN = '';
async function api(method, path, body, token = TOKEN) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let j; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${j?.errors?.[0]?.message || t}`);
  return j?.data ?? j;
}
const create = (col, obj) => api('POST', '/items/' + col, obj);
const assert = (cond, msg) => { if (!cond) { console.error('✗ ASSERT FAILED:', msg); process.exit(1); } console.log('  ✓', msg); };

async function main() {
  TOKEN = (await api('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, '')).access_token;
  console.log('— seeding —');
  const burlington = (await create('retailer', { name: 'Burlington' })).id;
  const hobbylobby = (await create('retailer', { name: 'Hobby Lobby' })).id;
  await create('retailer', { name: 'Ollies' });
  const anna = (await create('buyer', { name: 'Anna', retailer: burlington, samples_required: false })).id;
  await create('buyer', { name: 'Kyle', retailer: hobbylobby, samples_required: true });
  const disney = (await create('licensor', { name: 'Disney', turnaround_days_min: 1, turnaround_days_max: 3, requires_pi: false })).id;
  const mickey = (await create('property', { name: 'Mickey Mouse', licensor: disney })).id;
  const factoryA = (await create('factory', { name: 'Factory A (Ningbo)' })).id;
  const stretched = (await create('product_type', { name: 'Stretched/Box', sla_brief: 10, sla_design: 30, sla_art_file: 30, sla_licensing_sheet: 75, sla_revisions: 30, sla_techpack: 24 })).id;
  await create('product_type', { name: 'Floor Coverings', sla_brief: 10, sla_design: 15, sla_art_file: 20, sla_licensing_sheet: 50, sla_revisions: 20, sla_techpack: 16 });
  const val2027 = (await create('season', { name: "Valentine's", year: 2027, business_unit: 'POP Creations' })).id;

  // stages: POP 17 + Spruce 11 (reference data the real system needs)
  const POP = ['Art files creation','Licensing sheet creation','Licensing sheet review','Ready to submit','Concept submitted','Revisions','Concept approved','Concept approved with changes','PO received','Sales requested sample','Sample requested','Sample received','Factory resample','Sample sent to licensor (PPS)','Sample revision','Pre-production approved','Production approved'];
  const SPR = ['Send Out Art for PO','Approved for Future Orders','Sample Received','Sample Requested','Price Requested/Buyer Approving','Initial Approval/Selections Made','With Buyer for Approval','Waiting for Factory','In Work','Upcoming Projects','On Hold'];
  const stageId = {};
  for (let i = 0; i < POP.length; i++) { const s = await create('stage', { name: POP[i], business_unit: 'POP Creations', stage_order: i + 1, category: i < 2 ? 'design' : i === 2 ? 'review' : i < 6 ? 'submission' : i < 15 ? 'sampling' : 'approved', is_gate: POP[i] === 'Licensing sheet review' }); stageId['POP:' + POP[i]] = s.id; }
  for (let i = 0; i < SPR.length; i++) { const s = await create('stage', { name: SPR[i], business_unit: 'Spruce Line', stage_order: i + 1, category: 'design' }); stageId['SPR:' + SPR[i]] = s.id; }

  const project = (await create('project', { title: 'Julie Greer @ Burlington — Valentines 2027', business_unit: 'POP Creations', retailer: burlington, buyer: anna, season: val2027, on_shelf_date: '2027-01-15', status: 'active', brief: 'Disney Mickey Valentines wall art' })).id;
  const designPicked = (await create('design', { name: 'Mickey hearts canvas', business_unit: 'POP Creations', licensor: disney, property: mickey, product_type: stretched, season: val2027, first_offered_to: burlington, originating_project: project, status: 'picked' })).id;
  await create('design', { name: 'Mickey balloons (not picked)', business_unit: 'POP Creations', licensor: disney, property: mickey, product_type: stretched, season: val2027, first_offered_to: burlington, originating_project: project, status: 'unpicked' });
  const product = (await create('product', { code: 'GFZ80DYMK01', name: 'Disney Mickey hearts canvas 8x10"', business_unit: 'POP Creations', project, design: designPicked, product_type: stretched, licensor: disney, property: mickey, factory: factoryA, stage: stageId['POP:Licensing sheet creation'], put_up: 'shrink', on_shelf_date: '2027-01-15', cost_target: 4.25, quoted_cost: 4.60, pi_status: 'Not Required' })).id;
  console.log('  seeded product', product);

  console.log('\n— VERIFY 1: relational graph resolves —');
  const graph = await api('GET', `/items/product/${product}?fields=code,project.title,project.buyer.name,project.buyer.retailer.name,design.name,licensor.name,property.name,factory.name,stage.name,product_type.sla_licensing_sheet`);
  console.log('  ', JSON.stringify(graph));
  assert(graph.project.title.includes('Burlington'), 'product → project resolves');
  assert(graph.project.buyer.retailer.name === 'Burlington', 'product → project → buyer → retailer (3 hops)');
  assert(graph.property.name === 'Mickey Mouse' && graph.licensor.name === 'Disney', 'product → licensor + property');
  assert(graph.product_type.sla_licensing_sheet === 75, 'product → product_type SLA target = 75 min');

  console.log('\n— VERIFY 2: field-level permission (Designer cannot see pricing) —');
  // ensure the test designer user exists (apply-schema no longer creates it by default — prod safety)
  const drole = (await api('GET', '/roles?filter[name][_eq]=Designer&fields=id'))[0];
  if (drole) { try { await api('POST', '/users', { email: 'designer@popcre.com', password: 'Designer123!', first_name: 'Demo', last_name: 'Designer', role: drole.id }); } catch {} }
  const dToken = (await api('POST', '/auth/login', { email: 'designer@popcre.com', password: 'Designer123!' }, '')).access_token;
  const asDesigner = await api('GET', `/items/product/${product}?fields=*`, null, dToken);
  console.log('   designer sees fields:', Object.keys(asDesigner).join(', '));
  assert(asDesigner.code === 'GFZ80DYMK01', 'designer CAN read specs (code)');
  assert(!('cost_target' in asDesigner) && !('quoted_cost' in asDesigner), 'designer CANNOT see cost_target/quoted_cost (pricing hidden)');
  let pricingBlocked = false;
  try { await api('GET', `/items/product/${product}?fields=cost_target`, null, dToken); } catch { pricingBlocked = true; }
  assert(pricingBlocked, 'explicitly requesting cost_target as designer is blocked');
  const asAdmin = await api('GET', `/items/product/${product}?fields=cost_target,quoted_cost`);
  assert(asAdmin.cost_target == 4.25, 'admin CAN see pricing (cost_target=4.25)');

  console.log('\n— VERIFY 3: Flow logs stage changes to stage_history —');
  const before = (await api('GET', `/items/stage_history?filter[product][_eq]=${product}&aggregate[count]=*`))[0].count;
  await api('PATCH', `/items/product/${product}`, { stage: stageId['POP:Licensing sheet review'] });
  await new Promise(r => setTimeout(r, 1500));
  await api('PATCH', `/items/product/${product}`, { name: 'name-only change (no stage)' }); // should NOT log
  await new Promise(r => setTimeout(r, 1500));
  const rows = await api('GET', `/items/stage_history?filter[product][_eq]=${product}&fields=to_stage.name,changed_at&sort=changed_at`);
  console.log('   stage_history rows:', JSON.stringify(rows));
  assert(rows.length === Number(before) + 1, `exactly one new history row after stage change (was ${before}, now ${rows.length})`);
  assert(rows[rows.length - 1].to_stage.name === 'Licensing sheet review', 'logged row points to the new stage');

  console.log('\n✅ ALL VERIFICATIONS PASSED');
}
main().catch(e => { console.error('✗ ERROR:', e.message); process.exit(1); });
