// Entra role sync — Model B: Directus is the single writer; this reconciles
// each Directus user's role onto the matching Entra security group, so Entra
// stays the shared hub that the CRM/DAM read from.
//
// Direction: Directus role  ->  Entra group membership (one-way, Directus authoritative).
// Only Microsoft-provisioned Directus users (provider = 'microsoft') are managed;
// local/script users (e.g. svc@popcre.com, provider 'default') are ignored.
// The five "POP PIM ·" groups are OWNED by this sync: a member of one of those
// groups who has no matching Directus role is REMOVED.
//
// SAFETY: dry-run by default. It only writes to Entra when SYNC_APPLY=1.
//
// Usage:
//   set -a; source /home/ai/.poppim-deploy.env; set +a
//   DX_URL=https://pm.designflow.app node pm-system/sync/entra-role-sync.mjs           # dry run (prints plan)
//   DX_URL=https://pm.designflow.app SYNC_APPLY=1 node pm-system/sync/entra-role-sync.mjs   # apply
//
// Env required: DX_URL, DX_ADMIN_EMAIL, DX_ADMIN_PASSWORD (svc admin),
//               GRAPH_TENANT_ID, GRAPH_SYNC_CLIENT_ID, GRAPH_SYNC_CLIENT_SECRET.

const DX_URL = process.env.DX_URL || 'https://pm.designflow.app';
const DX_EMAIL = process.env.DX_ADMIN_EMAIL;
const DX_PASSWORD = process.env.DX_ADMIN_PASSWORD;
const TENANT = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_SYNC_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_SYNC_CLIENT_SECRET;
const APPLY = process.env.SYNC_APPLY === '1';

// Directus role name -> Entra security group object id. (group ids are not secret.)
const ROLE_TO_GROUP = {
  Administrator: '085a0511-5afa-4b01-b38e-ae06e61ea879',
  Sales: 'a4d4447a-2e8c-4594-9738-decadd5dc6c1',
  Licensing: 'df5f7693-1dbc-4b12-9dae-b18570d593bb',
  Designer: '9d977745-d86c-4950-866d-211e0dd3fac7',
  Viewer: '6ab28eb2-3c4b-4c81-b746-2ad63def306d',
};

for (const [k, v] of Object.entries({ DX_EMAIL, DX_PASSWORD, TENANT, CLIENT_ID, CLIENT_SECRET })) {
  if (!v) { console.error(`Missing required env: ${k}`); process.exit(1); }
}

async function dx(path, opts = {}, token) {
  const res = await fetch(DX_URL + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) } });
  const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`DX ${path} -> ${res.status}: ${json?.errors?.[0]?.message || text}`);
  return json?.data ?? json;
}

async function graphToken() {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: 'https://graph.microsoft.com/.default', client_secret: CLIENT_SECRET, grant_type: 'client_credentials' }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Graph token failed: ' + JSON.stringify(j));
  return j.access_token;
}

async function graph(method, path, token, body) {
  const res = await fetch('https://graph.microsoft.com/v1.0' + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`Graph ${method} ${path} -> ${res.status}: ${json?.error?.message || text}`);
  return json;
}

async function graphAll(path, token) { // follow @odata.nextLink
  const out = []; let url = path;
  while (url) { const j = await graph('GET', url, token); out.push(...(j.value || [])); url = j['@odata.nextLink'] ? j['@odata.nextLink'].replace('https://graph.microsoft.com/v1.0', '') : null; }
  return out;
}

(async () => {
  console.log(`Entra role sync — ${APPLY ? 'APPLY (writing to Entra)' : 'DRY RUN (no writes)'}`);
  const dxToken = (await dx('/auth/login', { method: 'POST', body: JSON.stringify({ email: DX_EMAIL, password: DX_PASSWORD }) })).access_token;
  const users = await dx('/users?fields=id,email,external_identifier,provider,status,role.name&limit=-1', {}, dxToken);
  const managed = users.filter(u => u.provider === 'microsoft' && u.status === 'active' && (u.role?.name in ROLE_TO_GROUP));
  console.log(`Directus: ${users.length} users, ${managed.length} Microsoft-provisioned with a mapped role.`);

  const gToken = await graphToken();
  // resolve each managed Directus user to an Entra user id (by UPN = external_identifier, fallback email)
  const desired = {}; // groupId -> Set(entraUserId)
  for (const gid of Object.values(ROLE_TO_GROUP)) desired[gid] = new Set();
  const unresolved = [];
  for (const u of managed) {
    const upn = u.external_identifier || u.email;
    let entra; try { entra = await graph('GET', `/users/${encodeURIComponent(upn)}?$select=id,userPrincipalName`, gToken); } catch { entra = null; }
    if (!entra?.id) { unresolved.push(upn); continue; }
    desired[ROLE_TO_GROUP[u.role.name]].add(entra.id);
  }
  if (unresolved.length) console.log(`! ${unresolved.length} Directus user(s) not found in Entra (skipped): ${unresolved.join(', ')}`);

  let adds = 0, removes = 0;
  for (const [roleName, gid] of Object.entries(ROLE_TO_GROUP)) {
    const current = new Set((await graphAll(`/groups/${gid}/members?$select=id`, gToken)).map(m => m.id));
    const want = desired[gid];
    const toAdd = [...want].filter(id => !current.has(id));
    const toRemove = [...current].filter(id => !want.has(id));
    if (toAdd.length || toRemove.length) console.log(`\n[${roleName}] (${gid})  +${toAdd.length} / -${toRemove.length}`);
    for (const id of toAdd) {
      adds++; console.log(`  + add ${id}`);
      if (APPLY) await graph('POST', `/groups/${gid}/members/$ref`, gToken, { '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${id}` });
    }
    for (const id of toRemove) {
      removes++; console.log(`  - remove ${id}`);
      if (APPLY) await graph('DELETE', `/groups/${gid}/members/${id}/$ref`, gToken);
    }
  }
  console.log(`\n${APPLY ? 'Applied' : 'Would apply'}: ${adds} add(s), ${removes} remove(s).`);
  if (!APPLY && (adds || removes)) console.log('Re-run with SYNC_APPLY=1 to write these changes to Entra.');
})().catch(e => { console.error(e); process.exit(1); });
