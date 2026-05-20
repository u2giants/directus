# Development

## Prerequisites

| Tool | Purpose |
|------|---------|
| Node.js + npm | Wrangler CLI (`npm install -g wrangler`) |
| Python 3.12 | All scripts in `scripts/` |
| `gh` CLI | Triggering workflows, downloading artifacts |
| Cloudflare API token | D1 queries, Worker deploys |

---

## Running the Worker locally

```bash
cd integrations/worker
npm install -g wrangler   # if not already installed
wrangler dev
```

Local mode uses a local SQLite file for D1 (not the production database). To test against the production D1, use `wrangler dev --remote` — this reads and writes live data.

The Worker has no npm dependencies — `wrangler` bundles `src/index.js` directly as an ES module.

---

## Querying D1

### Via MCP (in Claude Code sessions)

The Cloudflare MCP is configured in this project. Use:
```
mcp__claude_ai_Cloudflare_Developer_Platform__d1_database_query
  database_id: c37aeb36-e16e-416b-b699-c910f6f8dc10
  sql: SELECT ...
```

### Via curl

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/8303d11002766bf1cc36bf2f07ba6f20/d1/database/c37aeb36-e16e-416b-b699-c910f6f8dc10/query" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT stage_name, COUNT(*) as cnt FROM products WHERE is_internal=0 AND is_active=1 GROUP BY stage_name ORDER BY stage_order"}'
```

Response shape: `{"result": [{"results": [...], "success": true}]}`

### Via Wrangler

```bash
cd integrations/worker
wrangler d1 execute clickup-events --remote --command "SELECT COUNT(*) FROM products WHERE is_internal=0"
```

### Via the /query endpoint (natural language)

```bash
curl -s -X POST https://plane-integrations.u2giants.workers.dev/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $QUERY_SECRET" \
  -d '{"question": "How many active POP Creations products are stuck waiting for concept approval?"}'
```

---

## Running scripts locally

All scripts read Cloudflare credentials from environment variables. Set them before running:

```bash
export CLOUDFLARE_ACCOUNT_ID=8303d11002766bf1cc36bf2f07ba6f20
export CLOUDFLARE_D1_DATABASE_ID=c37aeb36-e16e-416b-b699-c910f6f8dc10
export CLOUDFLARE_API_TOKEN=your_token_here
```

### Rebuild the products table

```bash
cd scripts
python build_products_table.py
```

Reads from all task/checklist/comment tables in D1. Rebuilds `products` and `product_checkpoints` from scratch. Takes 2–5 minutes depending on D1 latency.

### Load a snapshot into D1

```bash
cd scripts
# Download a snapshot artifact first:
gh run download <run_id> --repo u2giants/plane --dir snapshot_output/
# Then load it:
python load_snapshot_to_d1.py
```

The script reads `*.json.gz` files from `scripts/snapshot_output/`.

### Run the ClickUp snapshot locally

Not recommended for production use — run via GitHub Actions instead. But if needed:

```bash
export CLICKUP_TOKEN=pk_4384255_...
export CLICKUP_WORKSPACE_ID=2298436
export INCLUDE_CLOSED=true
cd scripts
python clickup_snapshot.py
```

Output goes to `snapshot_output/`. Note: local runs don't store artifacts and use local credentials rather than the Actions-managed token.

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
| `query_d1.py` | Ad-hoc local use | Simple D1 query helper for local analysis |
| `analyze_snapshot.py` | Ad-hoc | Analyze snapshot output files before loading |
| `analyze_data_flow.py` | Ad-hoc | Analyze webhook data flow patterns |
| `analyze_comments_full.py` | Ad-hoc | Deep analysis of comment content |
| `investigate_comments.py` | Ad-hoc | Investigate specific comment patterns |
| `deep_snapshot_analysis.py` | Ad-hoc | Detailed snapshot content analysis |
| `check_custom_fields.py` | Ad-hoc | Inspect custom field values in snapshot |
| `find_relationships.py` | Ad-hoc | Find task relationship patterns |

The `analysis/*.py` scripts and `scripts/analysis/*.md` reports are exploratory — they were used during the learning phase and are kept for reference.

---

## Single-branch policy

This repo enforces a single-branch policy via `.githooks/post-checkout`. If you `git checkout -b anything`, the hook deletes the branch and returns you to `main`. This is intentional — see [AI_OPERATING_RULES.md](../AI_OPERATING_RULES.md).

To register the hook after cloning:
```bash
git config core.hooksPath .githooks
```

---

## Common D1 queries for development

```sql
-- Active products by stage (exclude internal dev space)
SELECT stage_name, stage_category, COUNT(*) as cnt
FROM products WHERE is_internal=0 AND is_active=1
GROUP BY stage_name ORDER BY stage_order;

-- Most recently updated products
SELECT name, licensor, stage_name, days_since_last_update
FROM products WHERE is_internal=0
ORDER BY days_since_last_update ASC LIMIT 20;

-- Interview questions status
SELECT respondent, status, COUNT(*) as cnt
FROM interview_questions GROUP BY respondent, status ORDER BY respondent;

-- Recent webhook events
SELECT event_type, user_name, field_changed, from_value, to_value, received_at
FROM raw_events ORDER BY received_at DESC LIMIT 20;

-- Verify products table freshness
SELECT MIN(refreshed_at), MAX(refreshed_at), COUNT(*) FROM products;
```
