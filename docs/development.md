# Development

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | Any recent LTS | Required only to install Wrangler |
| Wrangler CLI | Latest | Local Worker dev, D1 queries, deploys |
| Python | 3.12 | All scripts in `scripts/` |
| `gh` CLI | Latest | Triggering workflows, downloading artifacts |
| Cloudflare API token | — | D1 queries and Worker deploys; must have D1 Edit + Workers Scripts Write permissions |

Install Wrangler globally:
```bash
npm install -g wrangler
```

The Worker itself has no npm dependencies. Wrangler bundles `src/index.js` directly as an ES module — there is no `package.json` to `npm install`.

---

## Running the Worker locally

```bash
cd integrations/worker
wrangler dev
```

`wrangler dev` runs against a local SQLite file for D1. The file is created automatically in `.wrangler/state/`. This is completely isolated from production — safe for any experimentation.

To run against the live production D1 (reads and writes real data):
```bash
cd integrations/worker
wrangler dev --remote
```

Worker secrets (`CLICKUP_WEBHOOK_SECRET`, `OPENROUTER_API_KEY`, `QUERY_SECRET`) are not available in local mode. If you need the `/query` endpoint to work locally, use `--remote`, or set them as plain env vars in `wrangler.toml` temporarily (never commit that).

The Worker exposes these routes locally at `http://localhost:8787`:

| Route | Method | Notes |
|-------|--------|-------|
| `/health` | GET | Always returns `{"status":"ok"}` |
| `/clickup/webhook` | POST | HMAC validation skipped if `CLICKUP_WEBHOOK_SECRET` not set |
| `/query` | POST | Returns 500 if `OPENROUTER_API_KEY` not set |
| `/interview` | GET | Requires D1 access; use `--remote` |
| `/interview/answer` | POST | Requires D1 access; use `--remote` |
| `/interview/responses` | GET | Requires D1 access; use `--remote` |

---

## Environment variables for local development

Scripts in `scripts/` read Cloudflare credentials from environment variables. Set these before running any script:

```bash
export CLOUDFLARE_ACCOUNT_ID=8303d11002766bf1cc36bf2f07ba6f20
export CLOUDFLARE_D1_DATABASE_ID=c37aeb36-e16e-416b-b699-c910f6f8dc10
export CLOUDFLARE_API_TOKEN=your_token_here
```

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_DATABASE_ID` have hardcoded fallback values in the scripts (see `build_products_table.py` lines 38–39), so only `CLOUDFLARE_API_TOKEN` is strictly required. However, set all three to match production exactly.

For the ClickUp snapshot script only:
```bash
export CLICKUP_TOKEN=pk_4384255_...      # ClickUp personal API token
export CLICKUP_WORKSPACE_ID=2298436
export INCLUDE_CLOSED=true               # optional; include closed tasks
```

---

## Querying D1

Three ways, depending on context:

### Via MCP (Claude Code sessions)

```
mcp__claude_ai_Cloudflare_Developer_Platform__d1_database_query
  database_id: c37aeb36-e16e-416b-b699-c910f6f8dc10
  sql: SELECT ...
```

### Via Wrangler (quickest for ad-hoc queries)

```bash
cd integrations/worker
wrangler d1 execute clickup-events --remote \
  --command "SELECT COUNT(*) FROM products WHERE is_internal=0"
```

### Via curl (scriptable; works anywhere with the API token)

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/8303d11002766bf1cc36bf2f07ba6f20/d1/database/c37aeb36-e16e-416b-b699-c910f6f8dc10/query" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT stage_name, COUNT(*) as cnt FROM products WHERE is_internal=0 AND is_active=1 GROUP BY stage_name ORDER BY stage_order"}'
```

Response shape: `{"result": [{"results": [...], "success": true}]}`

### Via the /query endpoint (natural language → SQL → plain English)

```bash
curl -s -X POST https://plane-integrations.u2giants.workers.dev/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $QUERY_SECRET" \
  -d '{"question": "How many active POP Creations products are stuck waiting for concept approval?"}'
```

Response includes `question`, `answer`, `sql`, `row_count`, and `rows` (capped at 50).

---

## Testing webhook events locally

There is no dedicated webhook testing script. To test the webhook handler locally:

1. Start the Worker locally: `cd integrations/worker && wrangler dev`
2. Send a POST to `http://localhost:8787/clickup/webhook` with a ClickUp-shaped payload:

```bash
curl -s -X POST http://localhost:8787/clickup/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "taskStatusUpdated",
    "task_id": "test123",
    "team_id": "2298436",
    "history_items": [{
      "field": "status",
      "before": {"status": "in progress", "type": "open"},
      "after": {"status": "complete", "type": "done"},
      "user": {"id": "1", "username": "testuser"}
    }]
  }'
```

Without `CLICKUP_WEBHOOK_SECRET` set, HMAC validation is skipped and every POST is accepted. For testing with signature validation, the HMAC-SHA256 signature of the raw body must be passed in the `x-signature` header.

In local (non-`--remote`) mode, writes go to the local SQLite file at `.wrangler/state/v3/d1/`. Inspect it directly with any SQLite browser if needed.

---

## Adding a D1 migration

The schema is defined in `scripts/migrate_robust_schema.sql`. All statements use `CREATE TABLE IF NOT EXISTS`, `CREATE VIEW IF NOT EXISTS`, and `INSERT OR IGNORE` — the file is safe to re-run against a live database.

**To add a new table or column:**

1. Add the DDL to `scripts/migrate_robust_schema.sql`. For new columns on existing tables, use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (SQLite supports this since 3.37).
2. Apply via GitHub Actions (recommended):
   ```bash
   gh workflow run migrate-database.yml --repo u2giants/plane
   ```
   The workflow runs `wrangler d1 execute clickup-events --file ../../scripts/migrate_robust_schema.sql --remote` and then prints all tables and views to confirm.

3. To apply locally (requires Wrangler and a Cloudflare API token):
   ```bash
   cd integrations/worker
   wrangler d1 execute clickup-events \
     --file ../../scripts/migrate_robust_schema.sql \
     --remote
   ```

After applying a schema change, redeploy the Worker if the change affects columns that `src/index.js` writes to.

---

## Deploying the Worker

### Via GitHub Actions (standard path)

Any push to `main` that touches `integrations/worker/**` or `.github/workflows/deploy-worker.yml` triggers `deploy-worker.yml` automatically. The workflow:

1. Installs Wrangler
2. Runs `wrangler deploy` from `integrations/worker/`
3. Pushes three Worker secrets from GitHub repository secrets: `CLICKUP_WEBHOOK_SECRET`, `OPENROUTER_API_KEY`, `QUERY_SECRET`
4. Runs a health check against the live Worker URL

Secret steps are skipped (not failed) if the corresponding GitHub secret is not set. If `/query` returns 500 after deploy, verify `OPENROUTER_API_KEY` is set in the repository secrets.

To trigger manually without a code push:
```bash
gh workflow run deploy-worker.yml --repo u2giants/plane
```

### From local (when you need it immediately)

```bash
cd integrations/worker
export CLOUDFLARE_API_TOKEN=your_token_here
wrangler deploy
```

This deploys the code but does NOT push secrets. Secrets already set on the Worker in Cloudflare are preserved. Only use this for code-only changes where the existing secrets are correct.

---

## Common development tasks

### Add or modify Worker routes

Edit `integrations/worker/src/index.js`. The route dispatch is in the `fetch()` export at the top of the file. Add a new `if (url.pathname === '/your-path' ...)` block and a handler function. Deploy to see changes live.

### Rebuild the products table locally

```bash
export CLOUDFLARE_API_TOKEN=your_token_here
cd scripts
python build_products_table.py
```

Reads from all task/checklist/comment tables in D1. Rebuilds `products` and `product_checkpoints` from scratch. Takes 2–5 minutes. Normally runs nightly via `refresh-products.yml`.

### Load a snapshot into D1

```bash
# Download a specific snapshot artifact:
gh run download <run_id> --repo u2giants/plane --dir scripts/snapshot_output/
# Load it:
cd scripts
python load_snapshot_to_d1.py
```

The script reads `*.json.gz` files from `scripts/snapshot_output/`.

### Run the ClickUp snapshot locally

Not recommended — use GitHub Actions instead. The Actions token has broader API access and artifacts are retained 30 days. If you must run locally:

```bash
export CLICKUP_TOKEN=pk_4384255_...
export CLICKUP_WORKSPACE_ID=2298436
export INCLUDE_CLOSED=true
cd scripts
python clickup_snapshot.py
```

Output goes to `scripts/snapshot_output/`. Local runs don't upload artifacts.

### Add an interview question

Insert directly into D1:
```sql
INSERT INTO interview_questions (question, context, topic, respondent, status)
VALUES ('Your question here', 'Optional context', 'topic_slug', 'jessica', 'pending');
```

Valid respondent values: `jessica`, `liz`, `jen` (must match keys in `RESPONDENTS` in `src/index.js`).

### Add a new interview respondent

1. Add an entry to the `RESPONDENTS` object in `integrations/worker/src/index.js`:
   ```js
   newperson: { name: 'New Person', color: '#hex', light: '#lighthex' },
   ```
2. Deploy the Worker.
3. Insert questions into `interview_questions` with `respondent = 'newperson'`.

---

## Script inventory

| Script | When to run | Purpose |
|--------|-------------|---------|
| `clickup_snapshot.py` | Via GH Actions (`clickup-snapshot.yml`) | Full ClickUp workspace snapshot → gzip JSON files |
| `load_snapshot_to_d1.py` | Via GH Actions (`load-snapshot-to-d1.yml`) | Load snapshot JSON files into D1 tables |
| `build_products_table.py` | After snapshot load; nightly via `refresh-products.yml` | Rebuild `products` + `product_checkpoints` |
| `fetch_task_activity.py` | Via GH Actions (`backfill-transitions.yml`) | Backfill `status_transitions` from snapshot or ClickUp history API |
| `populate_list_space_map.py` | One-time; via `populate-list-space-map.yml` | Seed `list_space_map` from snapshot data |
| `migrate_robust_schema.sql` | One-time or when schema changes; via `migrate-database.yml` | Apply full D1 schema (idempotent) |
| `query_d1.py` | Ad-hoc local use | Simple D1 query helper; API token is hardcoded — update before use |
| `analyze_snapshot.py` | Ad-hoc | Analyze snapshot output files before loading |
| `analyze_data_flow.py` | Ad-hoc | Analyze webhook data flow patterns |
| `analyze_comments_full.py` | Ad-hoc | Deep analysis of comment content |
| `investigate_comments.py` | Ad-hoc | Investigate specific comment patterns |
| `deep_snapshot_analysis.py` | Ad-hoc | Detailed snapshot content analysis |
| `check_custom_fields.py` | Ad-hoc | Inspect custom field values in snapshot |
| `find_relationships.py` | Ad-hoc | Find task relationship patterns |

The `analysis/` scripts and `scripts/analysis/*.md` reports are exploratory — used during the data learning phase, kept for reference.

---

## Single-branch policy

This repo enforces a single-branch policy via `.githooks/post-checkout`. If you `git checkout -b anything`, the hook deletes the new branch and returns you to `main`. All work happens on `main`.

Register the hook after cloning:
```bash
git config core.hooksPath .githooks
```

---

## Common D1 queries for development

```sql
-- Active products by stage (exclude internal dev space)
SELECT stage_name, stage_category, COUNT(*) AS cnt
FROM products WHERE is_internal=0 AND is_active=1
GROUP BY stage_name ORDER BY stage_order;

-- Most recently updated products
SELECT name, licensor, stage_name, days_since_last_update
FROM products WHERE is_internal=0
ORDER BY days_since_last_update ASC LIMIT 20;

-- Stalled products (no movement in 30+ days)
SELECT name, licensor, stage_name, days_since_last_update
FROM stalled_products LIMIT 20;

-- Interview questions status
SELECT respondent, status, COUNT(*) AS cnt
FROM interview_questions
GROUP BY respondent, status ORDER BY respondent;

-- Recent webhook events
SELECT event_type, user_name, field_changed, from_value, to_value, received_at
FROM raw_events ORDER BY received_at DESC LIMIT 20;

-- Verify products table freshness
SELECT MIN(refreshed_at), MAX(refreshed_at), COUNT(*) FROM products;

-- All tables and views in the database
SELECT name, type FROM sqlite_master
WHERE type IN ('table','view') ORDER BY type, name;
```
