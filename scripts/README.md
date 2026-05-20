# Scripts

Python scripts for data capture, loading, and analysis. All scripts use the Cloudflare D1 REST API directly (no Wrangler dependency at runtime).

## Required environment variables

```bash
export CLOUDFLARE_ACCOUNT_ID=8303d11002766bf1cc36bf2f07ba6f20
export CLOUDFLARE_D1_DATABASE_ID=c37aeb36-e16e-416b-b699-c910f6f8dc10
export CLOUDFLARE_API_TOKEN=your_token_here
# Additional — only for clickup_snapshot.py and fetch_task_activity.py (with --fetch-history):
export CLICKUP_TOKEN=pk_4384255_...
export CLICKUP_WORKSPACE_ID=2298436
```

## Pipeline scripts (run via GitHub Actions)

| Script | Workflow | Schedule |
|--------|----------|----------|
| `clickup_snapshot.py` | `clickup-snapshot.yml` | Daily 02:00 UTC + manual |
| `load_snapshot_to_d1.py` | `load-snapshot-to-d1.yml` | Manual |
| `build_products_table.py` | `refresh-products.yml` | Daily 06:00 UTC + manual |
| `fetch_task_activity.py` | `backfill-transitions.yml` | Manual |

### clickup_snapshot.py

Calls the ClickUp REST API and downloads the full workspace: tasks (with subtasks, custom fields, checklists, linked tasks), lists, spaces, users, time entries, and comments (sampled — top 200 most-recently-updated tasks). Writes gzip-compressed JSON to `snapshot_output/`. Supports manifest-based resume on failure.

### load_snapshot_to_d1.py

Reads `snapshot_output/*.json.gz` and upserts rows into D1 (tasks, lists, spaces, users, task_tags, task_comments, task_checklists, checklist_items, task_links, task_custom_fields, task_assignments, time_entries). Uses batched `INSERT OR REPLACE` with `D1_MAX_PARAMS = 90` to stay within D1 API limits.

### build_products_table.py

Rebuilds the `products` materialized table and `product_checkpoints` fact table from current D1 data. Full delete + re-insert (not incremental). Classifies checklist items against `checkpoint_map` using `STEP_RULES` keyword matching. Run this after every snapshot load.

### fetch_task_activity.py

Backfills `status_transitions` from snapshot data (synthesized, no real from→to timestamps) or from the ClickUp `/task/{id}/history` API (`--fetch-history` flag; requires `CLICKUP_TOKEN`; slow — many API calls). Writes rows with `source = 'api_history'`.

## One-time / setup scripts

| Script | Workflow | Purpose |
|--------|----------|---------|
| `migrate_robust_schema.sql` | `migrate-database.yml` | Full D1 schema (idempotent — safe to re-run) |
| `populate_list_space_map.py` | `populate-list-space-map.yml` | Seeds `list_space_map` table (already populated) |
| `populate_list_space_map.sql` | `populate-list-space-map.yml` | SQL equivalent of the above |

## Analysis scripts (ad-hoc / reference)

These were used during the learning phase. Not part of the automated pipeline.

| Script | Purpose |
|--------|---------|
| `query_d1.py` | Simple D1 query helper |
| `analyze_snapshot.py` | Inspect snapshot output files |
| `analyze_data_flow.py` | Analyze webhook data flow patterns |
| `analyze_comments_full.py` | Deep analysis of comment content |
| `investigate_comments.py` | Investigate specific comment patterns |
| `deep_snapshot_analysis.py` | Detailed snapshot content analysis |
| `check_custom_fields.py` | Inspect custom field values |
| `find_relationships.py` | Find task relationship patterns |

## analysis/

Periodic behavioral analysis reports saved as Markdown. Generated during the learning phase (Mar–May 2026). Used as input for Plane design decisions.
