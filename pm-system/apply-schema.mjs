// Apply the Phase-1 PM schema + config to a Directus instance via its API.
// Idempotent: re-running deletes & recreates the 14 business collections + Designer role/policy/flow.
// Usage: DX_URL=https://pm.example.com DX_ADMIN_EMAIL=you@co DX_ADMIN_PASSWORD=*** node apply-schema.mjs
// IMPORTANT: after this finishes, RESTART Directus once so the event-triggered Flow registers.
const BASE = process.env.DX_URL || 'http://localhost:8055';
const ADMIN_EMAIL = process.env.DX_ADMIN_EMAIL || 'admin@popcre.com';
const ADMIN_PASSWORD = process.env.DX_ADMIN_PASSWORD || 'BuildPass123!';
let TOKEN = '';

async function api(method, path, body, token = TOKEN) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || text;
    throw new Error(`${method} ${path} -> ${res.status}: ${msg}`);
  }
  return json?.data ?? json;
}

const pk = () => ({ field: 'id', type: 'uuid', schema: { is_primary_key: true, has_auto_increment: false }, meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] } });
const f = (field, type, meta = {}, schema = {}) => ({ field, type, meta: { interface: meta.interface ?? null, options: meta.options ?? null, note: meta.note ?? null, special: meta.special ?? null, readonly: meta.readonly ?? false, ...meta }, schema });
const sel = (field, choices, note) => f(field, 'string', { interface: 'select-dropdown', options: { choices: choices.map(c => ({ text: c, value: c })) }, note });
const m2oField = (field, note) => f(field, 'uuid', { interface: 'select-dropdown-m2o', note });

// ---- collection definitions (non-relational + FK uuid fields). Relations wired after. ----
const collections = [
  { collection: 'retailer', meta: { icon: 'store', note: 'A store / account (future CRM company)' }, fields: [pk(),
    f('name','string',{interface:'input'}), f('aliases','text',{interface:'input-multiline',note:'alt names'}),
    f('resale_restriction','boolean',{interface:'boolean'}), f('notes','text',{interface:'input-multiline'}) ] },
  { collection: 'buyer', meta: { icon: 'person', note: 'Named buyer at a retailer (future CRM contact)' }, fields: [pk(),
    f('name','string',{interface:'input'}), m2oField('retailer'),
    f('email','string',{interface:'input'}), f('samples_required','boolean',{interface:'boolean',note:'HobbyLobby=yes, Burlington=no'}) ] },
  { collection: 'licensor', meta: { icon: 'verified', note: 'POP IP owner' }, fields: [pk(),
    f('name','string',{interface:'input'}), f('turnaround_days_min','integer',{interface:'input'}), f('turnaround_days_max','integer',{interface:'input'}),
    f('requires_pi','boolean',{interface:'boolean'}), f('prohibits_resale','boolean',{interface:'boolean'}) ] },
  { collection: 'property', meta: { icon: 'category', note: 'Franchise within a licensor' }, fields: [pk(),
    f('name','string',{interface:'input'}), m2oField('licensor') ] },
  { collection: 'factory', meta: { icon: 'factory' }, fields: [pk(),
    f('name','string',{interface:'input'}), f('capabilities','text',{interface:'input-multiline'}), f('china_team_contact','string',{interface:'input'}) ] },
  { collection: 'product_type', meta: { icon: 'inventory_2', note: 'Carries SLA design-time targets (minutes)' }, fields: [pk(),
    f('name','string',{interface:'input'}),
    f('sla_brief','integer',{interface:'input'}), f('sla_design','integer',{interface:'input'}), f('sla_art_file','integer',{interface:'input'}),
    f('sla_licensing_sheet','integer',{interface:'input'}), f('sla_revisions','integer',{interface:'input'}), f('sla_techpack','integer',{interface:'input'}) ] },
  { collection: 'season', meta: { icon: 'calendar_month' }, fields: [pk(),
    f('name','string',{interface:'input'}), f('year','integer',{interface:'input'}), sel('business_unit',['POP Creations','Spruce Line']) ] },
  { collection: 'stage', meta: { icon: 'flag', note: 'Pipeline stage definitions (per line)' }, fields: [pk(),
    f('name','string',{interface:'input'}), sel('business_unit',['POP Creations','Spruce Line']),
    f('stage_order','integer',{interface:'input',note:'1..17 POP / 1..11 Spruce'}),
    sel('category',['ideation','design','review','submission','sampling','approved','cancelled']), f('is_gate','boolean',{interface:'boolean'}) ] },
  { collection: 'design_collection', meta: { icon: 'collections', note: 'Spruce trend/art theme (account-agnostic)' }, fields: [pk(),
    f('name','string',{interface:'input'}), f('format','string',{interface:'input'}), f('theme','string',{interface:'input'}),
    sel('business_unit',['Spruce Line']), f('version_date','date',{interface:'datetime'}), m2oField('account_specific_for') ] },
  { collection: 'project', meta: { icon: 'assignment', note: 'An offer (POP) / account project (Spruce)' }, fields: [pk(),
    f('title','string',{interface:'input'}), sel('business_unit',['POP Creations','Spruce Line']),
    m2oField('retailer'), m2oField('buyer'), m2oField('season'), m2oField('design_collection'),
    f('on_shelf_date','date',{interface:'datetime'}), f('pps_requested_date','date',{interface:'datetime'}),
    f('restrictions','text',{interface:'input-multiline'}), f('brief','text',{interface:'input-rich-text-md'}),
    sel('status',['active','won','lost','abandoned']) ] },
  { collection: 'design', meta: { icon: 'palette', note: 'THE DESIGN LIBRARY — every design, picked or not' }, fields: [pk(),
    f('name','string',{interface:'input'}), sel('business_unit',['POP Creations','Spruce Line']),
    m2oField('licensor'), m2oField('property'), f('theme','string',{interface:'input',note:'Spruce'}),
    m2oField('product_type'), m2oField('season'), m2oField('first_offered_to'), m2oField('originating_project'),
    sel('status',['unpicked','picked','offered_to_multiple']),
    f('nas_path','string',{interface:'input'}), f('thumbnail_url','string',{interface:'input'}) ] },
  { collection: 'product', meta: { icon: 'category', note: 'Executable item: SKU (POP) / Style# (Spruce)' }, fields: [pk(),
    f('code','string',{interface:'input',note:'SKU code / style number — immutable after create'},{is_unique:true}),
    f('name','string',{interface:'input'}), sel('business_unit',['POP Creations','Spruce Line']),
    m2oField('project'), m2oField('design'), m2oField('product_type'), m2oField('licensor'), m2oField('property'), m2oField('factory'), m2oField('stage'),
    f('put_up','string',{interface:'input'}), f('on_shelf_date','date',{interface:'datetime'}), f('pps_requested_date','date',{interface:'datetime'}),
    f('cost_target','decimal',{interface:'input',note:'PRICING — hidden from Designer role'},{numeric_precision:12,numeric_scale:2}),
    f('quoted_cost','decimal',{interface:'input',note:'PRICING — hidden from Designer role'},{numeric_precision:12,numeric_scale:2}),
    f('brand_assurance_number','string',{interface:'input',note:'POP'}),
    sel('pi_status',['Required','Not Required','Completed']),
    sel('closure_reason',['cost','licensing','sampling','buyer','abandoned','completed']) ] },
  { collection: 'order', meta: { icon: 'receipt_long', note: 'PO history (multi-buyer reuse)' }, fields: [pk(),
    m2oField('product'), m2oField('retailer'), m2oField('buyer'),
    f('order_number','string',{interface:'input'}), f('order_date','date',{interface:'datetime'}), f('quantity','integer',{interface:'input'}),
    f('value','decimal',{interface:'input',note:'PRICING — hidden from Designer role'},{numeric_precision:12,numeric_scale:2}) ] },
  { collection: 'stage_history', meta: { icon: 'history', note: 'Time-in-stage / SLA ledger (written by a Flow)' }, fields: [pk(),
    m2oField('product'), m2oField('from_stage'), m2oField('to_stage'),
    f('changed_at','timestamp',{interface:'datetime', special:['date-created'], readonly:true}) ] },
];

// M2O relations: [collection, field, related_collection]
const relations = [
  ['buyer','retailer','retailer'],
  ['property','licensor','licensor'],
  ['design_collection','account_specific_for','retailer'],
  ['project','retailer','retailer'], ['project','buyer','buyer'], ['project','season','season'], ['project','design_collection','design_collection'],
  ['design','licensor','licensor'], ['design','property','property'], ['design','product_type','product_type'], ['design','season','season'], ['design','first_offered_to','retailer'], ['design','originating_project','project'],
  ['product','project','project'], ['product','design','design'], ['product','product_type','product_type'], ['product','licensor','licensor'], ['product','property','property'], ['product','factory','factory'], ['product','stage','stage'],
  ['order','product','product'], ['order','retailer','retailer'], ['order','buyer','buyer'],
  ['stage_history','product','product'], ['stage_history','from_stage','stage'], ['stage_history','to_stage','stage'],
];

async function main() {
  // 1. auth
  const login = await api('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, '');
  TOKEN = login.access_token; console.log('✓ auth');

  // cleanup any prior (folder) collections so this is re-runnable
  for (const c of [...collections].reverse()) {
    try { await api('DELETE', '/collections/' + c.collection); } catch {}
  }
  // 2. collections (schema:{} makes them REAL TABLES, not folders)
  for (const c of collections) {
    await api('POST', '/collections', { ...c, schema: {} });
    console.log('✓ collection', c.collection);
  }
  // 3. relations
  for (const [collection, field, related] of relations) {
    await api('POST', '/relations', { collection, field, related_collection: related, schema: { on_delete: 'SET NULL' }, meta: {} });
  }
  console.log('✓ relations:', relations.length);

  // cleanup prior config objects so this is re-runnable
  const delBy = async (col, field, val) => { try { const items = await api('GET', `/${col}?filter[${field}][_eq]=${encodeURIComponent(val)}&fields=id`); for (const it of items) { try { await api('DELETE', `/${col}/${it.id}`); } catch {} } } catch {} };
  await delBy('users', 'email', 'designer@popcre.com');
  await delBy('flows', 'name', 'Stage history ledger');
  await delBy('roles', 'name', 'Designer');
  await delBy('policies', 'name', 'Designer Policy');

  // 4. Designer role + policy + field-level perms (hide pricing)
  const role = await api('POST', '/roles', { name: 'Designer', icon: 'brush', description: 'Sees specs, NOT pricing' });
  const policy = await api('POST', '/policies', { name: 'Designer Policy', icon: 'brush', description: 'Read specs; pricing fields hidden', admin_access: false, app_access: true });
  const productFieldsNoPricing = ['id','code','name','business_unit','project','design','product_type','licensor','property','factory','stage','put_up','on_shelf_date','pps_requested_date','brand_assurance_number','pi_status','closure_reason'];
  const orderFieldsNoValue = ['id','product','retailer','buyer','order_number','order_date','quantity'];
  const readAll = ['retailer','buyer','licensor','property','factory','product_type','season','stage','design_collection','project','design','stage_history'];
  const perms = [
    { policy: policy.id, collection: 'product', action: 'read', fields: productFieldsNoPricing, permissions: {}, validation: {} },
    { policy: policy.id, collection: 'order', action: 'read', fields: orderFieldsNoValue, permissions: {}, validation: {} },
    { policy: policy.id, collection: 'design', action: 'create', fields: ['*'], permissions: {}, validation: {} },
    { policy: policy.id, collection: 'design', action: 'update', fields: ['*'], permissions: {}, validation: {} },
    ...readAll.map(col => ({ policy: policy.id, collection: col, action: 'read', fields: ['*'], permissions: {}, validation: {} })),
  ];
  for (const p of perms) await api('POST', '/permissions', p);
  await api('POST', '/access', { role: role.id, policy: policy.id });
  // PROD SAFETY: do NOT create a known-password test user by default. seed-and-verify sets this flag.
  if (process.env.CREATE_TEST_DESIGNER === '1') {
    await api('POST', '/users', { email: 'designer@popcre.com', password: 'Designer123!', first_name: 'Demo', last_name: 'Designer', role: role.id });
    console.log('✓ Designer role/policy (pricing hidden) + TEST designer user');
  } else {
    console.log('✓ Designer role/policy (pricing hidden) — no test user (set CREATE_TEST_DESIGNER=1 to add one)');
  }

  // 5. Flow: on product.stage change -> create stage_history row
  const flow = await api('POST', '/flows', { name: 'Stage history ledger', icon: 'history', status: 'active', trigger: 'event', accountability: 'all', options: { type: 'action', scope: ['items.update'], collections: ['product'] } });
  const createOp = await api('POST', '/operations', { flow: flow.id, type: 'item-create', key: 'log_stage', name: 'Log stage change', position_x: 40, position_y: 1,
    options: { collection: 'stage_history', emitEvents: false, payload: { product: '{{$trigger.keys[0]}}', to_stage: '{{$trigger.payload.stage}}' } } });
  const condOp = await api('POST', '/operations', { flow: flow.id, type: 'condition', key: 'stage_changed', name: 'Stage changed?', position_x: 20, position_y: 1,
    options: { filter: { $trigger: { payload: { stage: { _nnull: true } } } } }, resolve: createOp.id });
  await api('PATCH', '/flows/' + flow.id, { operation: condOp.id });
  console.log('✓ Flow: stage change -> stage_history');

  console.log('\nSCHEMA BUILD COMPLETE');
}
main().catch(e => { console.error('✗ BUILD ERROR:', e.message); process.exit(1); });
