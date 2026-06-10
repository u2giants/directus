// Phase-1 role taxonomy + admin-notification Flow for the PM system.
// Idempotent: re-running skips roles that already exist and recreates the notify Flow.
// Usage: DX_URL=https://pm.designflow.app DX_ADMIN_EMAIL=you@co DX_ADMIN_PASSWORD=*** node setup-roles-and-flows.mjs
// IMPORTANT: after this finishes, RESTART Directus once so the event-triggered Flow registers.
//
// Role model (all non-admin except Administrator):
//   Designer   - auto-provision default for new M365 SSO users; no pricing fields. (created by apply-schema.mjs)
//   Sales      - sees pricing; can create/update project, product, design.
//   Licensing  - sees pricing; manages licensor submissions (Brand Assurance / PI) on product.
//   Viewer     - read-only, no pricing.
//   Administrator - full admin (Directus built-in).
const BASE = process.env.DX_URL || 'http://localhost:8055';
const ADMIN_EMAIL = process.env.DX_ADMIN_EMAIL || 'admin@popcre.com';
const ADMIN_PASSWORD = process.env.DX_ADMIN_PASSWORD || 'BuildPass123!';
const NOTIFY_EMAIL = process.env.DX_NOTIFY_EMAIL || ADMIN_EMAIL; // who gets "new user" alerts
let TOKEN = '';

async function api(method, path, body, token = TOKEN) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json?.errors?.[0]?.message || text}`);
  return json?.data ?? json;
}

// Reference collections every role may read in full.
const REF = ['retailer', 'buyer', 'licensor', 'property', 'factory', 'product_type', 'season', 'stage', 'design_collection', 'project', 'design', 'stage_history', 'order'];
// product fields visible to non-pricing roles (omits cost_target / quoted_cost / value).
const PRODUCT_NO_PRICING = ['id', 'code', 'name', 'business_unit', 'project', 'design', 'product_type', 'licensor', 'property', 'factory', 'stage', 'retailer', 'buyer', 'put_up', 'on_shelf_date', 'pps_requested_date', 'brand_assurance_number', 'pi_status', 'closure_reason', 'external_id', 'external_source'];

async function makeRole(name, desc, { pricing, write, products = true }) {
  const ex = await api('GET', `/roles?filter[name][_eq]=${encodeURIComponent(name)}&fields=id&limit=1`);
  if (ex.length) { console.log(`role ${name} already exists — skipping`); return ex[0].id; }
  const role = await api('POST', '/roles', { name, icon: 'badge', description: desc });
  const policy = await api('POST', '/policies', { name: name + ' Policy', icon: 'badge', description: desc, admin_access: false, app_access: true });
  const perms = [];
  for (const c of REF) perms.push({ policy: policy.id, collection: c, action: 'read', fields: ['*'], permissions: {}, validation: {} });
  if (products) {  // Vendor gets no product/order visibility until per-vendor row scoping exists
    perms.push({ policy: policy.id, collection: 'product', action: 'read', fields: pricing ? ['*'] : PRODUCT_NO_PRICING, permissions: {}, validation: {} });
    perms.push({ policy: policy.id, collection: 'order', action: 'read', fields: pricing ? ['*'] : ['id', 'product', 'retailer', 'buyer', 'order_number', 'order_date', 'quantity'], permissions: {}, validation: {} });
  }
  if (write) for (const c of write) perms.push(
    { policy: policy.id, collection: c, action: 'create', fields: ['*'], permissions: {}, validation: {} },
    { policy: policy.id, collection: c, action: 'update', fields: ['*'], permissions: {}, validation: {} },
  );
  for (const p of perms) await api('POST', '/permissions', p);
  await api('POST', '/access', { role: role.id, policy: policy.id });
  console.log(`✓ created role ${name}`);
  return role.id;
}

async function setupNotifyFlow() {
  const notifyUser = (await api('GET', `/users?filter[email][_eq]=${encodeURIComponent(NOTIFY_EMAIL)}&fields=id&limit=1`))[0];
  if (!notifyUser) { console.log(`! notify user ${NOTIFY_EMAIL} not found — skipping Flow`); return; }
  for (const fl of await api('GET', '/flows?filter[name][_eq]=New user role reminder&fields=id')) await api('DELETE', '/flows/' + fl.id);
  const flow = await api('POST', '/flows', { name: 'New user role reminder', icon: 'badge', status: 'active', trigger: 'event', accountability: 'all', options: { type: 'action', scope: ['items.create'], collections: ['directus_users'] } });
  const notify = await api('POST', '/operations', { flow: flow.id, type: 'item-create', key: 'notify', name: 'Notify admin', position_x: 40, position_y: 1,
    options: { collection: 'directus_notifications', emitEvents: false, payload: { recipient: notifyUser.id, subject: 'New PM user — set their role', message: 'A new user ({{$trigger.payload.email}}) signed in via Microsoft and was given the default Designer role. Assign their real role in Settings → Users.', collection: 'directus_users', item: '{{$trigger.key}}' } } });
  const cond = await api('POST', '/operations', { flow: flow.id, type: 'condition', key: 'is_sso', name: 'SSO user?', position_x: 20, position_y: 1, options: { filter: { $trigger: { payload: { provider: { _eq: 'microsoft' } } } } }, resolve: notify.id });
  await api('PATCH', '/flows/' + flow.id, { operation: cond.id });
  console.log('✓ Flow created: new Microsoft user -> notify ' + NOTIFY_EMAIL);
}

TOKEN = (await api('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).access_token;
await makeRole('Sales', 'Sees pricing; manages offers & products', { pricing: true, write: ['project', 'product', 'design'] });
await makeRole('Licensing', 'Manages licensor submissions (Brand Assurance, PI)', { pricing: true, write: ['product'] });
await makeRole('Viewer', 'Read-only, no pricing', { pricing: false, write: null });
await makeRole('Vendor', 'External vendor/manufacturer: no product access yet (per-vendor row scoping TBD)', { pricing: false, write: null, products: false });
await setupNotifyFlow();
const roles = await api('GET', '/roles?fields=name&limit=20');
console.log('ROLES:', roles.map(r => r.name).join(', '));
console.log('Done. Restart Directus so the event Flow registers.');
