// Sync authoritative licensors / properties / characters from Designflow PLM into Directus.
//
//   Tier 1  licensor   (e.g. WARNER BROS)              key: plm_mg_code (global unique)
//   Tier 2  property   (e.g. DC, FRIENDS TV, FROZEN)   key: plm_mg_code unique WITHIN licensor
//   Tier 3  character  (e.g. BATMAN, HOGWARTS)         key: plm_mg_code unique WITHIN property
//
// PLM is authoritative but NOT exhaustive: this is one-way, create/link-only. It never
// renames existing licensors, never deletes, never unlinks local-only rows.
// PLM exposes 2 nesting levels and duplicates each entry per division (codes 1 & 8); we
// collapse divisions by mg_code (union of children). A few PLM "licensors" are really
// brand-level PROPERTIES — see RECLASS — so their children drop to the character tier.
//
// Env:
//   PLM_API_URL   default https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties
//   PLM_TOKEN     required — sent as `X-User-Authorization: <token>`
//   DATABASE_URL  required — Postgres connection string for the Directus DB
//
// Run:  PLM_TOKEN=… DATABASE_URL=… node pm-system/sync-plm-masters.mjs
// Schema (collection + FKs + indexes) is created once by migration/plm-masters-schema.sql.

import pg from 'pg'

const API = process.env.PLM_API_URL || 'https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties'
const TOKEN = process.env.PLM_TOKEN
const DB = process.env.DATABASE_URL
if (!TOKEN || !DB) { console.error('PLM_TOKEN and DATABASE_URL are required'); process.exit(1) }

// Existing Directus licensor name -> PLM mg_code. nick -> VM (Viacom Multi) per owner.
const ALIAS = {
  'care bears':'CB','coca cola':'CC','disney':'DY','marvel':'MV','nbcu':'NB','nick':'VM',
  'one piece':'1P','peanuts':'PN','sega':'SE','sesame street':'SM','star wars':'SW',
  'strawberry shortcake':'SS','wb':'WB','wwe':'WW',
}
// PLM top-level entries that are really brand PROPERTIES, mapped to their true licensor mg_code.
const RECLASS = { DC:'WB', FR:'WB', HP:'WB', PP:'VM' }

async function main() {
  const res = await fetch(API, { headers: { 'X-User-Authorization': TOKEN } })
  if (!res.ok) throw new Error(`PLM API ${res.status}: ${await res.text().catch(()=> '')}`)
  const plm = await res.json()

  // collapse divisions: mg -> { title, props: Map(mg -> title) }
  const tops = new Map()
  for (const l of plm) {
    if (!tops.has(l.mg_code)) tops.set(l.mg_code, { title: l.title, props: new Map() })
    for (const p of l.properties || []) if (!tops.get(l.mg_code).props.has(p.mg_code)) tops.get(l.mg_code).props.set(p.mg_code, p.title)
  }
  const targeted = new Set(Object.values(ALIAS))

  const client = new pg.Client({ connectionString: DB })
  await client.connect()
  let licLinked = 0, licNew = 0, props = 0, chars = 0
  try {
    await client.query('BEGIN')
    // Tier 1 — link our existing licensors by name
    for (const [name, mg] of Object.entries(ALIAS)) {
      const r = await client.query('UPDATE licensor SET plm_mg_code=$1, plm_synced_at=now() WHERE name=$2 AND plm_mg_code IS NULL', [mg, name])
      licLinked += r.rowCount
    }
    // Tier 1 — create licensors PLM has that we don't (and that aren't reclassified)
    for (const [mg, t] of tops) {
      if (RECLASS[mg] || targeted.has(mg)) continue
      const r = await client.query(
        'INSERT INTO licensor (id,name,plm_mg_code,plm_synced_at) SELECT gen_random_uuid(),$1,$2,now() WHERE NOT EXISTS (SELECT 1 FROM licensor WHERE plm_mg_code=$2)', [t.title, mg])
      licNew += r.rowCount
    }
    // Tier 2 — properties (children of real licensors + the reclassified brands themselves)
    const upProp = async (title, licmg, mg) => {
      const r = await client.query(
        `INSERT INTO property (id,name,licensor,plm_mg_code,plm_synced_at)
         SELECT gen_random_uuid(),$1,l.id,$2,now() FROM licensor l
         WHERE l.plm_mg_code=$3 AND NOT EXISTS (SELECT 1 FROM property p WHERE p.licensor=l.id AND p.plm_mg_code=$2)`,
        [title, mg, licmg])
      props += r.rowCount
    }
    for (const [mg, t] of tops) if (!RECLASS[mg]) for (const [pmg, ptitle] of t.props) await upProp(ptitle, mg, pmg)
    for (const b of Object.keys(RECLASS)) await upProp(tops.get(b).title, RECLASS[b], b)
    // Tier 3 — characters (children of the reclassified brands)
    for (const b of Object.keys(RECLASS)) for (const [cmg, ctitle] of tops.get(b).props) {
      const r = await client.query(
        `INSERT INTO "character" (id,name,property,plm_mg_code,plm_synced_at)
         SELECT gen_random_uuid(),$1,p.id,$2,now() FROM property p JOIN licensor l ON l.id=p.licensor
         WHERE l.plm_mg_code=$3 AND p.plm_mg_code=$4
         AND NOT EXISTS (SELECT 1 FROM "character" c WHERE c.property=p.id AND c.plm_mg_code=$2)`,
        [ctitle, cmg, RECLASS[b], b])
      chars += r.rowCount
    }
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK'); throw e }
  finally { await client.end() }
  console.log(`PLM sync: licensors linked=${licLinked} new=${licNew}, properties +${props}, characters +${chars}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
