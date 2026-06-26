// Read-only inventory for planning a Directus Postgres -> Supabase migration.
//
// Usage:
//   POPPIM_ENV_FILE=/home/ai/.directus-deploy.env \
//   DX_URL=https://data.designflow.app \
//   node pm-system/migration/supabase-readiness-audit.mjs
//
// DB connection resolution:
//   1. DATABASE_URL
//   2. DB_HOST/DB_PORT/DB_DATABASE/DB_USER/DB_PASSWORD
//   3. DB_PASSWORD + docker inspect of directus-db container
//
// Outputs JSON + Markdown under pm-system/migration/reports/ by default.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import pg from 'pg'

const { Client } = pg

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage:
  POPPIM_ENV_FILE=/home/ai/.directus-deploy.env node pm-system/migration/supabase-readiness-audit.mjs
  DATABASE_URL=postgres://... node pm-system/migration/supabase-readiness-audit.mjs

Options:
  OUT_DIR=pm-system/migration/reports  Output directory
  DB_CONTAINER=directus-db-...          Source container for local Docker discovery
`)
  process.exit(0)
}

function loadEnvFile(path) {
  if (!path) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#') || !s.includes('=')) continue
    const i = s.indexOf('=')
    const k = s.slice(0, i).trim()
    let v = s.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[k] === undefined) process.env[k] = v
  }
}

loadEnvFile(process.env.POPPIM_ENV_FILE)

const now = new Date()
const stamp = now.toISOString().replace(/[:.]/g, '-')
const outDir = resolve(process.env.OUT_DIR || 'pm-system/migration/reports')
const dbContainer = process.env.DB_CONTAINER || 'directus-db-nzli85mk3luzb6u7cnq5fidu'

function dockerDbHost() {
  try {
    const out = execFileSync('docker', ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', dbContainer], { encoding: 'utf8' }).trim()
    return out || null
  } catch {
    return null
  }
}

function dbConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL }
  const host = process.env.DB_HOST || dockerDbHost()
  const password = process.env.DB_PASSWORD || process.env.DX_DB_PASSWORD
  if (!host || !password) {
    throw new Error('Need DATABASE_URL, or DB_HOST + DB_PASSWORD, or DB_PASSWORD plus access to the Directus DB container')
  }
  return {
    host,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_DATABASE || 'directus',
    user: process.env.DB_USER || 'directus',
    password,
  }
}

async function q(client, text, params = []) {
  return (await client.query(text, params)).rows
}

async function tableExists(client, table) {
  const rows = await q(client, 'select to_regclass($1) as regclass', [`public.${table}`])
  return Boolean(rows[0]?.regclass)
}

async function counts(client, tables) {
  const out = []
  for (const table of tables) {
    const quoted = `"${table.table_name.replaceAll('"', '""')}"`
    const rows = await q(client, `select count(*)::bigint as n from public.${quoted}`)
    out.push({ table: table.table_name, rows: Number(rows[0].n) })
  }
  return out.sort((a, b) => b.rows - a.rows || a.table.localeCompare(b.table))
}

async function optionalCount(client, table, where = 'true') {
  if (!(await tableExists(client, table))) return null
  const rows = await q(client, `select count(*)::bigint as n from public."${table}" where ${where}`)
  return Number(rows[0].n)
}

function mdTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((v) => String(v ?? '').replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n')
}

function buildMarkdown(report) {
  const largeTables = report.row_counts.filter((r) => r.rows > 0).slice(0, 30)
  const directusTables = report.row_counts.filter((r) => r.table.startsWith('directus_') && r.rows > 0)
  const appTables = report.row_counts.filter((r) => !r.table.startsWith('directus_') && r.rows > 0)
  const fkNoAction = report.foreign_keys.filter((fk) => fk.delete_rule !== 'NO ACTION' || fk.update_rule !== 'NO ACTION')
  const rls = report.rls.tables.filter((t) => t.relrowsecurity || t.relforcerowsecurity)

  return `# Supabase Migration Readiness Audit

Generated: ${report.generated_at}

Source: ${report.source.database} on ${report.source.server_version}

## Summary

${mdTable(['Metric', 'Value'], [
  ['Public tables', report.tables.length],
  ['Application tables', appTables.length],
  ['Directus system tables', report.row_counts.filter((r) => r.table.startsWith('directus_')).length],
  ['Foreign keys', report.foreign_keys.length],
  ['Indexes', report.indexes.length],
  ['Directus collections', report.directus.collections],
  ['Directus roles', report.directus.roles.length],
  ['Directus policies', report.directus.policies],
  ['Directus permissions', report.directus.permissions],
  ['Directus flows', report.directus.flows.length],
  ['Directus files', report.files.directus_files?.total ?? 'n/a'],
  ['Product files', report.files.product_file?.total ?? 'n/a'],
])}

## Largest Tables

${mdTable(['Table', 'Rows'], largeTables.map((r) => [r.table, r.rows.toLocaleString()]))}

## Application Tables With Data

${mdTable(['Table', 'Rows'], appTables.map((r) => [r.table, r.rows.toLocaleString()]))}

## Directus System Tables With Data

${mdTable(['Table', 'Rows'], directusTables.map((r) => [r.table, r.rows.toLocaleString()]))}

## Supabase Decision Notes

- Keep the migration at the Postgres layer first: export schema/data from the Directus DB, restore into Supabase, then rebuild API/auth/storage behavior around it.
- Supabase Cloud is quickest if the dump size, extension set, and network import path fit the plan tier.
- Self-hosted Supabase gives more control over restore windows, local volumes, and extensions, but it adds operational ownership for Kong, Auth, Realtime, Storage, backups, upgrades, and SMTP.
- Directus metadata tables can be copied for rollback/reference, but Supabase will not use Directus roles, policies, Flows, presets, or extensions. Those need explicit replacements.

## Objects Requiring Deliberate Replacement

${mdTable(['Object', 'Count / State', 'Migration concern'], [
  ['Directus roles', report.directus.roles.map((r) => r.name).join(', ') || 'none', 'Map to Supabase Auth claims and Postgres RLS policies.'],
  ['Directus flows', report.directus.flows.map((f) => f.name).join(', ') || 'none', 'Rebuild as Postgres triggers, Edge Functions, pg_cron jobs, or app code.'],
  ['Directus extensions', report.directus.extensions.length || 'none seen in DB metadata', 'Rebuild UI/API behavior outside Supabase or in app code.'],
  ['Directus presets', report.directus.presets, 'Replace with frontend saved-view tables/settings.'],
  ['RLS enabled now', rls.map((t) => t.table).join(', ') || 'none', 'Supabase requires a new RLS design before exposing APIs.'],
  ['Foreign keys with actions', fkNoAction.length, 'Verify CASCADE/SET NULL survives restore and matches app expectations.'],
])}

## File And Asset References

${mdTable(['Area', 'Metric', 'Value'], [
  ['directus_files', 'rows', report.files.directus_files?.total ?? 'n/a'],
  ['directus_files', 'total bytes', report.files.directus_files?.total_bytes ?? 'n/a'],
  ['directus_files', 'storage backends', JSON.stringify(report.files.directus_files?.storage ?? {})],
  ['product.cover_url', 'Spaces URLs', report.files.product_cover_urls?.spaces ?? 'n/a'],
  ['product.cover_url', 'non-empty non-Spaces URLs', report.files.product_cover_urls?.external_non_spaces ?? 'n/a'],
  ['product_file', 'rows', report.files.product_file?.total ?? 'n/a'],
  ['product_file', 'stored_url rows', report.files.product_file?.stored ?? 'n/a'],
  ['product_file', 'thumbnail_url rows', report.files.product_file?.thumbnails ?? 'n/a'],
  ['product_file', 'unstored source_url rows', report.files.product_file?.unstored_source_urls ?? 'n/a'],
])}

## Next Concrete Steps

1. Take a fresh compressed custom-format dump with blobs excluded unless Directus local file blobs are discovered.
2. Restore into a disposable Supabase target and run this audit against the target.
3. Design the Supabase Auth/RLS mapping for Administrator, Sales, Licensing, Designer, Viewer, and Vendor before pointing any frontend at Supabase APIs.
4. Rebuild current Directus Flows/host timers as Supabase-compatible jobs.
5. Decide whether DigitalOcean Spaces remains canonical for product images/attachments or whether Supabase Storage will mirror/import those objects.

JSON companion: ${report.files_written?.json || '(written next to this file)'}
`
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const client = new Client(dbConfig())
  await client.connect()

  const sourceRows = await q(client, `
    select current_database() as database,
           current_user as user_name,
           version() as server_version,
           inet_server_addr()::text as server_addr
  `)

  const tables = await q(client, `
    select table_name, table_type
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `)

  const report = {
    generated_at: now.toISOString(),
    source: sourceRows[0],
    extensions: await q(client, `select extname, extversion from pg_extension order by extname`),
    tables,
    columns: await q(client, `
      select table_name, column_name, ordinal_position, data_type, udt_name,
             is_nullable, column_default, character_maximum_length,
             numeric_precision, numeric_scale, datetime_precision
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position
    `),
    row_counts: await counts(client, tables.filter((t) => t.table_type === 'BASE TABLE')),
    primary_keys: await q(client, `
      select tc.table_name, kc.column_name, kc.ordinal_position, tc.constraint_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kc
        on kc.constraint_schema = tc.constraint_schema
       and kc.constraint_name = tc.constraint_name
      where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
      order by tc.table_name, kc.ordinal_position
    `),
    foreign_keys: await q(client, `
      select tc.table_name, kcu.column_name, ccu.table_name as foreign_table,
             ccu.column_name as foreign_column, rc.update_rule, rc.delete_rule,
             tc.constraint_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema = kcu.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
       and ccu.table_schema = tc.table_schema
      join information_schema.referential_constraints rc
        on rc.constraint_name = tc.constraint_name
       and rc.constraint_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
      order by tc.table_name, kcu.column_name
    `),
    indexes: await q(client, `
      select tablename as table_name, indexname as index_name, indexdef
      from pg_indexes
      where schemaname = 'public'
      order by tablename, indexname
    `),
    triggers: await q(client, `
      select event_object_table as table_name, trigger_name, event_manipulation, action_timing, action_statement
      from information_schema.triggers
      where trigger_schema = 'public'
      order by event_object_table, trigger_name
    `),
    functions: await q(client, `
      select p.proname as name, pg_get_function_identity_arguments(p.oid) as arguments,
             l.lanname as language
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
      where n.nspname = 'public'
      order by p.proname
    `),
    rls: {
      tables: await q(client, `
        select relname as table, relrowsecurity, relforcerowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by relname
      `),
      policies: await q(client, `
        select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
        from pg_policies
        where schemaname = 'public'
        order by tablename, policyname
      `),
    },
    directus: {
      collections: await optionalCount(client, 'directus_collections'),
      fields: await optionalCount(client, 'directus_fields'),
      relations: await optionalCount(client, 'directus_relations'),
      permissions: await optionalCount(client, 'directus_permissions'),
      policies: await optionalCount(client, 'directus_policies'),
      presets: await optionalCount(client, 'directus_presets'),
      roles: await (async () => {
        if (!(await tableExists(client, 'directus_roles'))) return []
        return q(client, 'select id, name from directus_roles order by name')
      })(),
      flows: await (async () => {
        if (!(await tableExists(client, 'directus_flows'))) return []
        return q(client, 'select id, name, status, trigger, accountability from directus_flows order by name')
      })(),
      operations: await optionalCount(client, 'directus_operations'),
      users: await optionalCount(client, 'directus_users'),
      extensions: await (async () => {
        if (!(await tableExists(client, 'directus_extensions'))) return []
        return q(client, 'select id, folder, source, bundle, enabled from directus_extensions order by folder')
      })(),
    },
    files: {
      directus_files: await (async () => {
        if (!(await tableExists(client, 'directus_files'))) return null
        const totals = await q(client, `
          select count(*)::bigint as total,
                 coalesce(sum(filesize), 0)::bigint as total_bytes
          from directus_files
        `)
        const storageRows = await q(client, `
          select storage, count(*)::bigint as n
          from directus_files
          group by storage
          order by n desc
        `)
        return {
          total: Number(totals[0].total),
          total_bytes: Number(totals[0].total_bytes),
          storage: Object.fromEntries(storageRows.map((r) => [r.storage || '(null)', Number(r.n)])),
        }
      })(),
      product_cover_urls: await (async () => {
        if (!(await tableExists(client, 'product'))) return null
        const rows = await q(client, `
          select
            count(*) filter (where cover_url is not null and cover_url <> '')::bigint as non_empty,
            count(*) filter (where cover_url ilike '%digitaloceanspaces.com%')::bigint as spaces,
            count(*) filter (where cover_url is not null and cover_url <> '' and cover_url not ilike '%digitaloceanspaces.com%')::bigint as external_non_spaces
          from product
        `)
        return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]))
      })(),
      product_file: await (async () => {
        if (!(await tableExists(client, 'product_file'))) return null
        const rows = await q(client, `
          select
            count(*)::bigint as total,
            count(*) filter (where stored_url is not null and stored_url <> '')::bigint as stored,
            count(*) filter (where thumbnail_url is not null and thumbnail_url <> '')::bigint as thumbnails,
            count(*) filter (
              where (stored_url is null or stored_url = '')
                and source_url is not null
                and source_url <> ''
            )::bigint as unstored_source_urls
          from product_file
        `)
        return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]))
      })(),
    },
  }

  const jsonPath = resolve(outDir, `supabase-readiness-${stamp}.json`)
  const mdPath = resolve(outDir, `supabase-readiness-${stamp}.md`)
  report.files_written = { json: jsonPath, markdown: mdPath }
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(mdPath, buildMarkdown(report))

  await client.end()
  console.log(`wrote ${jsonPath}`)
  console.log(`wrote ${mdPath}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
