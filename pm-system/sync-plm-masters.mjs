// Sync authoritative master data from Designflow PLM into Directus.
//
//   licensors / properties / characters   (item_master/lib/getLicensorsWithProperties)
//   customers -> retailer cross-ref        (core/customers/getCustomers)
//
// PLM is authoritative but NOT exhaustive: one-way, create/link-only. Never renames existing
// licensors/retailers, never deletes, never unlinks local-only rows, never downgrades status.
//
// Master tiers (licensor -> property -> character): PLM exposes 2 nesting levels and duplicates
// each entry per division (codes 1 & 8); we collapse divisions by mg_code. A few PLM "licensors"
// are really brand-level PROPERTIES — see RECLASS — so their children drop to the character tier.
//
// Customers: each PLM customer (customers_id) maps to one curated retailer via the
// retailer_plm_customer table. Mapping is many-to-one (TJX corp + HomeGoods -> one retailer).
// First-time links promote a POTENTIAL retailer to ACTIVE (PLM is the customer-status authority);
// re-runs never change status. CUST_SKIP ids are intentionally not represented (out of business /
// dup / placeholder). CUST_LINK / CUST_CREATE pin the curated decisions; unknown future customers
// fall back to normalized-name match, else create a new ACTIVE retailer.
//
// Env:
//   PLM_API_KEY    required — sent as `x-api-key: <key>` (was a 30-day user JWT; now a df_live_ key)
//   PLM_MASTERS_URL  default …/item_master/lib/getLicensorsWithProperties
//   PLM_CUSTOMERS_URL default …/core/customers/getCustomers
//   DATABASE_URL   required — Postgres connection string for the Directus DB
//
// Run:  PLM_API_KEY=… DATABASE_URL=… node pm-system/sync-plm-masters.mjs
// Schema is created once by migration/plm-masters-schema.sql + migration/plm-customers-schema.sql.

import pg from 'pg'

const MASTERS_URL = process.env.PLM_MASTERS_URL || 'https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties'
const CUSTOMERS_URL = process.env.PLM_CUSTOMERS_URL || 'https://api.designflow.app/api/core/customers/getCustomers'
const KEY = process.env.PLM_API_KEY || process.env.PLM_TOKEN
const DB = process.env.DATABASE_URL
if (!KEY || !DB) { console.error('PLM_API_KEY and DATABASE_URL are required'); process.exit(1) }

const plmGet = async (url) => {
  const res = await fetch(url, { headers: { 'x-api-key': KEY } })
  if (!res.ok) throw new Error(`PLM ${url} -> ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

// ---- masters maps ----
// Existing Directus licensor name -> PLM mg_code. nick -> VM (Viacom Multi) per owner.
const ALIAS = {
  'care bears':'CB','coca cola':'CC','disney':'DY','marvel':'MV','nbcu':'NB','nick':'VM',
  'one piece':'1P','peanuts':'PN','sega':'SE','sesame street':'SM','star wars':'SW',
  'strawberry shortcake':'SS','wb':'WB','wwe':'WW',
}
// PLM top-level entries that are really brand PROPERTIES, mapped to their true licensor mg_code.
const RECLASS = { DC:'WB', FR:'WB', HP:'WB', PP:'VM' }

// ---- customers maps (curated; pin the owner's decisions so re-runs are stable) ----
// PLM customers_id -> exact existing retailer name to link.
const CUST_LINK = {
  23:'Four Seasons General Merchandise',34:'AAFES Shopette',32:'ALDI USA',44:'Amazon',2:'At Home Group Inc.',
  19:'Books A Million',35:'Bn',41:'Bealls, Inc.',52:'Big Lots',25:'BoxLunch',4:'Burlington Stores, Inc.',
  51:'Danawares',20:"DD's Discounts",53:'Dollarama L.P.',43:'Dollar General',22:'Dollar Tree Stores',
  5:'Family Dollar',16:'Five Below',30:'Forman Mills',21:'FYE - For Your Entertainment',33:'Gabes',
  3:'Hobby Lobby',1:'Hot Topic',42:'Kohl’s',14:'Kroger',27:'Lidl',24:'Menard Inc',54:'Miniso-us',
  49:'Osjl',15:"Ollie's Bargain Outlet",31:'pOpshelf',40:'Regent Products Corp.',29:'Rooms To Go',
  9:'Ross Stores',48:'Shopperworld',37:'Spencer Gifts',50:'Spirit Halloween',10:'Target',
  6:'The TJX Companies, Inc.',45:'United Pacific Designs Inc.',46:'Urban Outfitters Europe',47:'Vwhlsl',
  13:'Walmart',39:'Yankee Toy Box',7:'The TJX Companies, Inc.',/* HomeGoods banner -> TJX */
}
// PLM customers_id -> create a new retailer at this status (owner override vs PLM ACTIVE).
const CUST_CREATE = { 17:'POTENTIAL_CUSTOMER',38:'POTENTIAL_CUSTOMER',11:'POTENTIAL_CUSTOMER' }
// PLM customers_id -> never represent (out of business / dup / placeholder).
const CUST_SKIP = { 26:'out of business',8:'out of business',12:'out of business',36:'out of business',
  18:'dup of Barnes & Noble (#35)',28:'placeholder',55:'placeholder' }

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(inc|llc|stores?|the)$/, '')

async function syncMasters(client, plm) {
  // collapse divisions: mg -> { title, props: Map(mg -> title) }
  const tops = new Map()
  for (const l of plm) {
    if (!tops.has(l.mg_code)) tops.set(l.mg_code, { title: l.title, props: new Map() })
    for (const p of l.properties || []) if (!tops.get(l.mg_code).props.has(p.mg_code)) tops.get(l.mg_code).props.set(p.mg_code, p.title)
  }
  const targeted = new Set(Object.values(ALIAS))
  let licLinked = 0, licNew = 0, props = 0, chars = 0
  // Tier 1 — link our existing licensors by name
  for (const [name, mg] of Object.entries(ALIAS)) {
    const r = await client.query('UPDATE licensor SET plm_mg_code=$1, plm_synced_at=now() WHERE name=$2 AND plm_mg_code IS NULL', [mg, name])
    licLinked += r.rowCount
  }
  // Tier 1 — create licensors PLM has that we don't (and that aren't reclassified)
  for (const [mg, t] of tops) {
    if (RECLASS[mg] || targeted.has(mg)) continue
    const r = await client.query(
      'INSERT INTO licensor (id,name,plm_mg_code,plm_synced_at) SELECT gen_random_uuid(),$1,$2::text,now() WHERE NOT EXISTS (SELECT 1 FROM licensor WHERE plm_mg_code=$2::text)', [t.title, mg])
    licNew += r.rowCount
  }
  // Tier 2 — properties (children of real licensors + the reclassified brands themselves)
  const upProp = async (title, licmg, mg) => {
    const r = await client.query(
      `INSERT INTO property (id,name,licensor,plm_mg_code,plm_synced_at)
       SELECT gen_random_uuid(),$1,l.id,$2::text,now() FROM licensor l
       WHERE l.plm_mg_code=$3::text AND NOT EXISTS (SELECT 1 FROM property p WHERE p.licensor=l.id AND p.plm_mg_code=$2::text)`,
      [title, mg, licmg])
    props += r.rowCount
  }
  for (const [mg, t] of tops) if (!RECLASS[mg]) for (const [pmg, ptitle] of t.props) await upProp(ptitle, mg, pmg)
  for (const b of Object.keys(RECLASS)) await upProp(tops.get(b).title, RECLASS[b], b)
  // Tier 3 — characters (children of the reclassified brands)
  for (const b of Object.keys(RECLASS)) for (const [cmg, ctitle] of tops.get(b).props) {
    const r = await client.query(
      `INSERT INTO "character" (id,name,property,plm_mg_code,plm_synced_at)
       SELECT gen_random_uuid(),$1,p.id,$2::text,now() FROM property p JOIN licensor l ON l.id=p.licensor
       WHERE l.plm_mg_code=$3::text AND p.plm_mg_code=$4::text
       AND NOT EXISTS (SELECT 1 FROM "character" c WHERE c.property=p.id AND c.plm_mg_code=$2::text)`,
      [ctitle, cmg, RECLASS[b], b])
    chars += r.rowCount
  }
  console.log(`PLM masters: licensors linked=${licLinked} new=${licNew}, properties +${props}, characters +${chars}`)
}

async function syncCustomers(client, customers) {
  let linked = 0, created = 0, promoted = 0, skipped = 0, unresolved = 0
  // resolve retailer id by exact name; fall back to normalized-name match
  const findRetailer = async (name) => {
    let r = await client.query('SELECT id FROM retailer WHERE name=$1', [name])
    if (r.rows[0]) return r.rows[0].id
    r = await client.query('SELECT id, name FROM retailer')
    const hit = r.rows.find((x) => norm(x.name) === norm(name))
    return hit ? hit.id : null
  }
  // link a PLM customer to a retailer id; promote POTENTIAL->ACTIVE only on first link
  const link = async (c, retailerId, { promote }) => {
    const ins = await client.query(
      `INSERT INTO retailer_plm_customer (plm_customer_id,plm_customer_code,plm_customer_name,retailer,plm_synced_at)
       VALUES ($1,$2,$3,$4,now()) ON CONFLICT (plm_customer_id) DO NOTHING`,
      [c.customers_id, c.customers_code, c.customers_name, retailerId])
    linked += ins.rowCount
    if (ins.rowCount && promote) {
      const up = await client.query(
        `UPDATE retailer SET customer_status='ACTIVE_CUSTOMER' WHERE id=$1 AND customer_status<>'ACTIVE_CUSTOMER'`, [retailerId])
      promoted += up.rowCount
    }
  }
  for (const c of customers) {
    const id = c.customers_id
    if (CUST_SKIP[id]) { skipped++; continue }
    if (CUST_LINK[id]) {
      const rid = await findRetailer(CUST_LINK[id])
      if (!rid) { console.warn(`  unresolved link: #${id} ${c.customers_name} -> "${CUST_LINK[id]}"`); unresolved++; continue }
      await link(c, rid, { promote: true })
      continue
    }
    if (CUST_CREATE[id]) {
      const status = CUST_CREATE[id]
      const ins = await client.query(
        `INSERT INTO retailer (id,name,customer_status) SELECT gen_random_uuid(),$1::text,$2
         WHERE NOT EXISTS (SELECT 1 FROM retailer WHERE name=$1::text) RETURNING id`, [c.customers_name, status])
      created += ins.rowCount
      const rid = ins.rows[0]?.id || (await findRetailer(c.customers_name))
      await link(c, rid, { promote: false }) // owner-set status; do not auto-promote
      continue
    }
    // Unknown future PLM customer: match by name, else create as ACTIVE (PLM default).
    let rid = await findRetailer(c.customers_name)
    if (rid) {
      await link(c, rid, { promote: true })
    } else {
      const ins = await client.query(
        `INSERT INTO retailer (id,name,customer_status) VALUES (gen_random_uuid(),$1,'ACTIVE_CUSTOMER') RETURNING id`, [c.customers_name])
      created += ins.rowCount
      await link(c, ins.rows[0].id, { promote: false })
      console.log(`  new PLM customer created ACTIVE: #${id} ${c.customers_name} — review/alias if it should link to an existing retailer`)
    }
  }
  console.log(`PLM customers: linked +${linked}, created +${created}, promoted ${promoted}, skipped ${skipped}, unresolved ${unresolved}`)
}

async function main() {
  const [masters, customers] = await Promise.all([plmGet(MASTERS_URL), plmGet(CUSTOMERS_URL)])
  const client = new pg.Client({ connectionString: DB })
  await client.connect()
  try {
    await client.query('BEGIN')
    await syncMasters(client, masters)
    await syncCustomers(client, customers)
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK'); throw e }
  finally { await client.end() }
}

main().catch((e) => { console.error(e); process.exit(1) })
