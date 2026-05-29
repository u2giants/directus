# Architecture

## What this system is

This is a business intelligence and workflow management system for a consumer goods licensing company (POP Creations / Spruce Line) that designs and sells licensed products (plush toys, apparel, accessories) for IP licensors such as Disney, Marvel, and Warner Bros, sold through mass-market retailers like Target and Walmart.

The system has two layers:

**Layer 1 — Data collection and analytics (live).** Captures ClickUp workspace activity in real time via webhooks, augments it with nightly full snapshots, and exposes a natural language query interface backed by a denormalized product database. This layer is fully operational.

**Layer 2 — Custom PM application (planned, not yet built).** A Plane-based project management application, customized around a two-tier Project + SKU data model, with design inventory search, bulk operations, and timeline tracking. Configuration decisions are being finalized based on interview data collected through Layer 1.

---

## Component diagram

```
┌─────────────────────────────────────────────────────────────┐
│  ClickUp workspace (team 2298436)                           │
│  22 subscribed event types — HMAC-signed webhooks           │
└────────────────────────┬────────────────────────────────────┘
                         │ POST /clickup/webhook
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Worker: plane-integrations                      │
│  plane-integrations.u2giants.workers.dev                    │
│                                                             │
│  GET  /health              liveness                         │
│  POST /clickup/webhook     → D1 (raw_events + specialized)  │
│  POST /query               NL → SQL → plain English         │
│  GET  /interview           per-respondent Q&A UI            │
│  POST /interview/answer    stores answer → D1               │
│  GET  /interview/responses admin view of all answers        │
└────────────────────────┬────────────────────────────────────┘
                         │ D1 binding: DB
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare D1: clickup-events                              │
│  c37aeb36-e16e-416b-b699-c910f6f8dc10                      │
│                                                             │
│  raw_events           append-only webhook log               │
│  tasks / lists / spaces / users / workspaces                │
│  status_transitions   from→to with timestamps               │
│  task_assignments     who was assigned, when                │
│  task_comments        comment text + driver classification  │
│  task_tags / task_links / task_attachments                  │
│  task_custom_fields / custom_field_definitions              │
│  task_checklists / checklist_items / time_entries           │
│  products             MATERIALIZED — rebuilt nightly        │
│  product_checkpoints  checklist items → process steps       │
│  checkpoint_map       27 canonical process milestones       │
│  workflow_stages      ClickUp status → pipeline stage       │
│  retailers / licensors reference entities                   │
│  list_space_map       list_id → space_name lookup           │
│  interview_questions  Q&A for employee interviews           │
└─────────────────────────────────────────────────────────────┘
         ▲                          ▲
         │ webhook (real-time)      │ rebuilt by
         │                         ▼
         │            ┌────────────────────────────────────────┐
         │            │  GitHub Actions (nightly scheduled)    │
         │            │  02:00 UTC  clickup-snapshot.yml       │
         │            │    → clickup_snapshot.py               │
         │            │    → gzip JSON artifacts (30-day TTL)  │
         │            │  06:00 UTC  refresh-products.yml       │
         │            │    → build_products_table.py           │
         │            │    → products + product_checkpoints    │
         │            └────────────────────────────────────────┘
         │
  ClickUp REST API (snapshot only — not real-time)
```

---

## Data flow — webhook path

Each ClickUp event follows this path:

1. ClickUp sends a signed POST to `/clickup/webhook`.
2. Worker validates HMAC-SHA256 signature using `crypto.subtle`. Rejects 401 if invalid and `CLICKUP_WEBHOOK_SECRET` is set. If the secret is unset, all webhooks are accepted.
3. Fields extracted from `history_items[0]`: `user`, `field`, `before`, `after`, `parent_id` (used as `list_id`).
4. Full payload + extracted fields written to `raw_events` (primary write). Falls back to legacy `events` table if `raw_events` doesn't exist — this fallback is intentional and should remain.
5. Depending on `event_type`, a secondary specialized write fires (best-effort; errors are logged but do not affect the 200 response):

   | Event type | Secondary write |
   |-----------|----------------|
   | `taskStatusUpdated` | `status_transitions` with `from_status_type` / `to_status_type` |
   | `taskAssigneeUpdated` | `task_assignments` with `is_current = 1` (add) or `0` + `unassigned_at` (remove) |
   | `taskCommentPosted` | `task_comments` with file path extraction and `comment_driver` classification |
   | `taskCreated` | `tasks` stub via `INSERT OR IGNORE` |
   | `taskCustomFieldUpdated` | `task_custom_fields` — value typed as text / number / date / boolean |
   | `taskChecklistUpdated` | `checklist_items` with resolved state and timestamp |

6. Worker returns `200 ok` immediately. ClickUp retries on any other status.

**`space_id` is always NULL in webhook events.** ClickUp does not include it in webhook payloads. Derive space context via `JOIN list_space_map ON list_id` or from the `space_name` column on `products`. The `space_id` column on `raw_events` exists but is intentionally never populated.

**`taskUpdated` fires alongside every specific event.** One status change produces two `raw_events` rows. Use `WHERE event_type != 'taskUpdated'` for unique-action counts.

---

## Data flow — snapshot path

The nightly snapshot pipeline runs in sequential stages:

```
Stage 1 — clickup-snapshot.yml (02:00 UTC daily)
  clickup_snapshot.py
    → ClickUp REST API: all tasks, lists, spaces, users, comments, time entries
    → writes gzip-compressed JSON files to snapshot_output/
    → uploads as GitHub Actions artifact (30-day retention)
    → manifest-based resume: restarts from last completed list on failure

Stage 2 — load-snapshot-to-d1.yml (manual trigger)
  load_snapshot_to_d1.py
    → downloads latest (or specified) snapshot artifact from GitHub
    → upserts all rows into D1 tables (tasks, lists, spaces, users, etc.)
    → also runs build_products_table.py after load

Stage 3 — refresh-products.yml (06:00 UTC daily)
  build_products_table.py
    → reads tasks, task_custom_fields, task_checklists, checklist_items,
      task_comments, task_assignments, workflow_stages from D1
    → rebuilds products table (DELETE + INSERT, full refresh)
    → rebuilds product_checkpoints table
    → classifies checklist items against checkpoint_map using keyword rules
```

The `products` table is a fully denormalized materialized table rebuilt from scratch nightly — not a view. It is not updated incrementally.

---

## Data flow — AI query path

`POST /query` with `{ "question": "..." }`:

1. Optional bearer token check against `QUERY_SECRET`. If `QUERY_SECRET` is not set, the endpoint is open.
2. Question sent to OpenRouter API (`deepseek/deepseek-v3.2`) with a system prompt containing the full D1 schema.
3. Model returns a SELECT statement. Worker validates it starts with `SELECT`.
4. Query executed against D1 via the `DB` binding.
5. Up to 30 rows passed back to the LLM with a formatting prompt.
6. Model returns a 1–3 sentence plain English answer.
7. Response JSON: `{ question, answer, sql, row_count, rows (capped at 50), sql_error? }`.

The LLM is routed through OpenRouter, not Anthropic's API directly. This allows model substitution without code changes. The model constant (`OPENROUTER_MODEL`) is hardcoded in `src/index.js`.

---

## Worker endpoints

| Method | Path | Purpose | Key behavior |
|--------|------|---------|-------------|
| GET | `/health` | Liveness probe | Returns `{ status: "ok", ts: <ISO timestamp> }` |
| POST | `/clickup/webhook` | ClickUp event receiver | HMAC validation → raw_events → specialized writes |
| POST | `/query` | Natural language → SQL → answer | Optional bearer auth; 2-call LLM pipeline |
| GET | `/interview` | Per-respondent Q&A form | `?who=jessica\|liz\|jen`; unknown `who` shows landing page |
| POST | `/interview/answer` | Submit answer | Form POST; updates `interview_questions`, redirects back |
| GET | `/interview/responses` | Admin view of all answers | Shows all respondents' Q&A in one HTML page |

---

## D1 schema — tables

### Core entity tables (populated by snapshot)

| Table | Purpose |
|-------|---------|
| `workspaces` | ClickUp workspace record (id, name) |
| `spaces` | ClickUp spaces — POP Creations, Spruce Line, designflow |
| `lists` | ClickUp lists within spaces (21 total) |
| `users` | Workspace members (64 rows; username often NULL, use raw_events for display names) |
| `tasks` | Raw ClickUp tasks — one row per task/subtask. Columns: id, list_id, parent_task_id, name, description, status, status_type, priority, due_date, start_date, creator_id, created_at, updated_at, closed_at, space_id, workspace_id, licensor |

### Event / audit tables

| Table | Purpose |
|-------|---------|
| `raw_events` | Append-only webhook log. Full `raw_payload` TEXT stored. Extracted columns: event_type, task_id, list_id, workspace_id, user_id, user_name, field_changed, from_value, to_value. `space_id` always NULL. |
| `status_transitions` | Every status change. Columns: task_id, from_status, to_status, from_status_type, to_status_type, user_id, user_name, transitioned_at, source. `source = 'webhook'` has real from→to; `source = 'snapshot'` has `from_status = NULL`; `source = 'api_history'` has full history from backfill. |
| `task_assignments` | Assignment history. Columns: task_id, user_id, assigned_at, assigned_by, unassigned_at, is_current (1=current, 0=removed), source. |
| `task_comments` | Comment text with classification. Columns: id, task_id, user_id, user_name, content, mention_count, attachment_count, created_at, file_paths (JSON array of NAS paths), licensor_hint (extracted from NAS paths), comment_driver ('licensor' \| 'factory' \| 'retailer' \| NULL). |
| `task_attachments` | File attachments — schema exists; empty because `taskAttachmentUpdated` is not subscribed. |
| `task_checklists` | Checklist groups on tasks (id, task_id, name, position). |
| `checklist_items` | Individual checklist items (id, checklist_id, name, resolved, resolved_by, resolved_at). |
| `task_links` | Task relationships (task_id, linked_task_id, link_direction, link_type: 'linked' \| 'dependency'). |
| `task_tags` | Tags on tasks (task_id, tag_id, tag_name). Primary signal for licensor, channel, routing. |
| `task_custom_fields` | Custom field values (task_id, field_id, field_name, value_text, value_number, value_date, value_boolean). |
| `custom_field_definitions` | Field schema metadata per list (field_id, list_id, name, type, options as JSON array). |
| `time_entries` | Time logged against tasks. Empty — the team does not use time tracking in ClickUp. |

### Reference / lookup tables

| Table | Purpose |
|-------|---------|
| `workflow_stages` | Maps raw ClickUp status strings to ordered pipeline stages. Columns: status_raw (PK), stage_order, stage_name, stage_category. |
| `checkpoint_map` | 27 canonical process milestones used to classify checklist items. Columns: step_id (PK), step_name, step_order, step_category. Seeded from the SQL migration. |
| `retailers` | Reference rows seeded from products data (26 rows). |
| `licensors` | Reference rows seeded from products data (34 rows). |
| `list_space_map` | Lookup: list_id → space_name. Populated by `populate-list-space-map.yml`. Used to derive space context that ClickUp omits from webhook payloads. |

### Materialized product tables (rebuilt nightly)

| Table | Purpose |
|-------|---------|
| `products` | One row per parent product task. ~9,069 rows total; ~300 active. Fully denormalized — no joins needed for product queries. Always filter `WHERE is_internal = 0`. Rebuilt from scratch nightly by `build_products_table.py`. |
| `product_checkpoints` | Checklist items linked to their parent product with `step_id` classification from `checkpoint_map`. ~32,534 rows. |

**Key `products` columns:**

| Column | Type | Description |
|--------|------|-------------|
| id, name | TEXT | Product ID and display name |
| licensor, retailer | TEXT | IP rights holder and selling store |
| product_category, put_up | TEXT | Product type and packaging format |
| factory, buyer | TEXT | Manufacturing partner and retail buyer contact |
| space_name | TEXT | Business unit: "POP Creations" or "Spruce Line" |
| stage_name, stage_category, stage_order | TEXT / INT | Current pipeline position (stage_order 1–7) |
| status, status_type | TEXT | status_type: "open" \| "closed" \| "done" |
| priority | TEXT | "urgent" \| "high" \| "normal" \| "low" \| NULL |
| days_since_last_update | REAL | Days since updated_at |
| days_in_pipeline | REAL | Days since created_at |
| days_overdue | REAL | Days past due date (NULL if not overdue) |
| is_active | INT | 1 if touched within last 180 days |
| is_overdue | INT | 1 if past due date and not closed |
| is_internal | INT | 1 for non-product spaces (designflow); always filter = 0 |
| assignee_ids | TEXT | JSON array of user ID strings |
| milestone_concept_approved | INT | 1 if concept was formally approved |
| milestone_sample_approved | INT | 1 if sample was approved |
| milestone_art_complete | INT | 1 if art/design is complete |
| milestone_pi_approved | INT | 1 if product integrity approved |
| milestone_tech_pack_checked | INT | 1 if tech pack reviewed |
| concept_revisions | INT | Count of concept revision cycles |
| packaging_revisions | INT | Count of packaging revision cycles |
| sample_rounds | INT | Count of sample submission rounds |
| comment_approvals / comment_revisions / comment_rejections | INT | Comment-keyword signal counts |

### Interview table

| Table | Purpose |
|-------|---------|
| `interview_questions` | Q&A for employee interviews. Columns: id, question, context, topic, respondent, status ('pending' \| 'answered'), answer, answered_at, answered_by. 55 rows across 3 rounds for respondents: jessica, liz, jen. |

---

## D1 schema — views

All views filter `is_internal = 0` except `task_details`, `pipeline_health`, `licensor_activity`, `stage_durations`, `task_completion_times`, `workflow_efficiency`, and `user_activity`.

| View | What it answers |
|------|----------------|
| `overdue_products` | Open products past their due date, ordered by `days_overdue` |
| `stalled_products` | Active products with no movement in 30+ days (`days_since_last_update > 30`) |
| `comment_signals` | Products with non-zero comment approval/revision/rejection counts |
| `comment_drivers` | Per-product breakdown: licensor_comments, factory_comments, retailer_comments |
| `tag_usage` | tag_name, product_count, pct_of_products |
| `task_dependency_map` | Tasks with blocking dependencies (task_name, depends_on_name, depends_on_status) |
| `licensor_activity` | Per-licensor: product_count, active_product_count, avg_days_in_pipeline |
| `product_journey` | Resolved checkpoints per product in chronological order with dates |
| `checkpoint_velocity` | Avg days from product creation to each checkpoint step |
| `task_details` | Denormalized task view joining custom fields, stages, spaces. Prefer `products` for product queries. |
| `pipeline_health` | Active task count per stage with avg/max days in stage |
| `stage_durations` | Avg time per stage from `status_transitions` (only meaningful for `source = 'api_history'` rows) |
| `task_effort` | Time logged per product — all zeros because time tracking is unused |
| `task_completion_times` | Status transition durations using LAG window function |
| `workflow_efficiency` | Avg days per from→to transition pair |
| `user_activity` | Transitions, comments, and assignments per user |

---

## Checkpoint map — 27 canonical milestones

Seeded in the SQL migration. Used by `build_products_table.py` to classify checklist item text against named process steps:

| step_order | step_id | step_category |
|-----------|---------|--------------|
| 10 | group_concept_approved | Concept |
| 12 | concept_approved | Concept |
| 14 | concept_revision_submitted | Concept |
| 16 | pkg_concept_revision | Concept |
| 18 | packaging_concept_approved | Concept |
| 20 | concept_submitted | Concept |
| 30 | designs_complete | Art / Design |
| 32 | art_complete | Art / Design |
| 40 | tech_packs_complete | Tech Pack |
| 42 | tech_pack_check | Tech Pack |
| 50 | sampling_request | Sampling |
| 52 | sample_requested | Sampling |
| 54 | sample_submitted | Sampling |
| 56 | sample_approved | Sampling |
| 72 | pps_submitted | Sampling |
| 74 | pps_revision | Sampling |
| 76 | pps_approval | Sampling |
| 80 | factory_qc_china | QC / Production |
| 82 | production_approved | QC / Production |
| 84 | pi_approved | QC / Production |
| 88 | contractual_submitted | Contractual / Compliance |
| 89 | contractual_approved | Contractual / Compliance |
| 90 | brand_assurance | Contractual / Compliance |
| 91 | licensor_approval | Approvals |
| 92 | sarbani_approval | Approvals |
| 94 | buyer_picks | Approvals |
| 96 | buyer_presentation | Approvals |

---

## GitHub Actions workflows

| Workflow | Trigger | What it reads | What it writes |
|---------|---------|--------------|----------------|
| `deploy-worker.yml` | Push to `main` touching `integrations/worker/**`; manual | `integrations/worker/src/index.js`, `wrangler.toml` | Cloudflare Worker + 3 Worker secrets |
| `clickup-snapshot.yml` | Daily 02:00 UTC; manual (optional `include_closed` flag) | ClickUp REST API | Gzip JSON artifacts in `snapshot_output/`; manifest cache for resume |
| `load-snapshot-to-d1.yml` | Manual (optional `run_id` input) | Latest or specified snapshot artifact | D1 task/list/space/user tables; then rebuilds `products` |
| `refresh-products.yml` | Daily 06:00 UTC; manual | D1 task/checklist/comment tables | `products` + `product_checkpoints` tables |
| `migrate-database.yml` | Manual | `scripts/migrate_robust_schema.sql` | D1 schema via `CREATE IF NOT EXISTS` (idempotent) |
| `backfill-transitions.yml` | Manual (`fetch_history` flag; optional `list_id`, `run_id`) | Snapshot artifact; optionally ClickUp `/task/{id}/history` API | `status_transitions` rows with `source = 'api_history'` |
| `create-webhook.yml` | Manual | — | New ClickUp webhook; prints secret to run logs |
| `update-webhook.yml` | Manual | — | Re-enables webhook ID `b114d599-aa9a-4069-b08f-a4bf0ac4fe20` |
| `update-webhook-events.yml` | Manual | — | Updates event subscription list on existing webhook |
| `list-webhook.yml` | Manual | ClickUp webhook API | — (output to run logs only) |
| `populate-list-space-map.yml` | Manual (one-time) | `scripts/populate_list_space_map.sql` | `list_space_map` table in D1 |

---

## External dependencies and fixed identifiers

| Item | Value |
|------|-------|
| Cloudflare account ID | `8303d11002766bf1cc36bf2f07ba6f20` |
| D1 database ID | `c37aeb36-e16e-416b-b699-c910f6f8dc10` |
| D1 database name | `clickup-events` |
| Worker name | `plane-integrations` |
| Worker URL | `https://plane-integrations.u2giants.workers.dev` |
| ClickUp workspace / team ID | `2298436` |
| ClickUp webhook ID | `b114d599-aa9a-4069-b08f-a4bf0ac4fe20` |
| OpenRouter model | `deepseek/deepseek-v3.2` |
| OpenRouter endpoint | `https://openrouter.ai/api/v1/chat/completions` |
| GitHub repo | `u2giants/plane` |
| Coolify base URL | `http://178.156.180.212:8000/api/v1` |
| Coolify server UUID | `onwp0kd7w1w74w9yeotnoihp` |

### Worker secrets

Set via `wrangler secret put` or automatically by `deploy-worker.yml` on each deploy.

| Secret | Required | Effect if absent |
|--------|----------|-----------------|
| `CLICKUP_WEBHOOK_SECRET` | Recommended | Webhooks accepted without HMAC validation |
| `OPENROUTER_API_KEY` | Required for `/query` | `/query` returns HTTP 500 |
| `QUERY_SECRET` | Optional | `/query` endpoint is open to anyone with the URL |

### GitHub Actions secrets

| Secret | Used by |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | All workflows touching Cloudflare |
| `CLOUDFLARE_ACCOUNT_ID` | Snapshot, load, refresh, backfill |
| `CLOUDFLARE_D1_DATABASE_ID` | Snapshot, load, refresh, backfill |
| `CLICKUP_TOKEN` | `clickup-snapshot.yml`, backfill with `fetch_history=true` |
| `CLICKUP_WORKSPACE_ID` | `clickup-snapshot.yml`, webhook workflows |
| `CLICKUP_WEBHOOK_SECRET` | `deploy-worker.yml` (pushed to Worker) |
| `OPENROUTER_API_KEY` | `deploy-worker.yml` (pushed to Worker) |
| `QUERY_SECRET` | `deploy-worker.yml` (pushed to Worker) |

---

## Infrastructure constraints

### Current: Cloudflare D1 (SQLite)

All data lives in a single Cloudflare D1 database (SQLite). Constraints that affect query and schema design:

- No `ILIKE` — use `LIKE` (case-sensitivity controlled via `LOWER()`)
- No native array type — JSON arrays stored as TEXT, queried with `json_each()`
- No incremental materialized views — `products` is rebuilt by full DELETE + INSERT nightly
- D1 REST API has a conservative bound-parameter limit of ~90 per call (handled in scripts with batching)
- `products` has ~9,069 rows; ~300 are active at any time
- No real-time update to `products` — webhook events land in `raw_events` and specialized tables immediately, but `products` is stale until the 06:00 UTC rebuild

### Planned: Coolify-hosted PostgreSQL

When the Plane PM application is deployed on Coolify, it will use a PostgreSQL database managed by Plane's bundled stack. The D1 database and Cloudflare Worker are expected to remain for analytics and the `/query` endpoint alongside Plane.

Planned Plane deployment configuration:

| Component | Decision |
|-----------|----------|
| File storage | Cloudflare R2 (replacing Plane's default MinIO) |
| PostgreSQL / Redis / RabbitMQ | Plane bundled defaults |
| Gunicorn workers | `GUNICORN_WORKERS=2` (shared server) |
| Reverse proxy | Coolify-managed Caddy (automatic SSL) |

R2 environment variables for Plane:
```
AWS_S3_ENDPOINT_URL=https://8303d11002766bf1cc36bf2f07ba6f20.r2.cloudflarestorage.com
AWS_S3_BUCKET_NAME=plane-uploads
AWS_ACCESS_KEY_ID={r2_access_key}
AWS_SECRET_ACCESS_KEY={r2_secret_key}
```

Remove the `plane-minio` service from `docker-compose.yml` before deploying. Plane uses `django-storages` with boto3 and picks up S3-compatible config automatically.

---

## What is not yet built

The entire Layer 2 PM application is planned but not started. Based on the interview synthesis in `docs/interview-synthesis.md`, the following capabilities are required:

**Must-have (system is broken without these):**

1. **Two-tier data model** — Project Card (one offer to one buyer for one season) and SKU Card (one picked product linked to its project) as first-class objects. ClickUp's flat task model does not support this hierarchy directly.
2. **Design inventory** — Preliminary designs stored independently of the buyer presentation they were created for, searchable by licensor + property + product type + season. Unpicked designs are currently lost.
3. **Bulk operations** — Advancing multiple SKUs through a stage, assigning a designer to a set of licensing sheets, filtering + exporting a set of SKUs as CSV. Currently requires opening each record individually.
4. **Cancel state with required reason** — No formal cancel mechanism exists. Required closure reasons: cost, licensing, sampling, buyer declined.
5. **Brand Assurance number field** — Required for licensor submission and shipping compliance. Not tracked in the current system.
6. **Time-in-stage display and on-track indicator** — Three computed values per SKU: time in current stage, total cycle age, projected completion date vs. on-shelf date.

**High-value additions:**

7. **Multi-buyer conflict detection** — Alert when the same design is selected by two buyers simultaneously.
8. **Art Director queue with SLA timer** — Real-time view of Liz's backlog with time-in-stage per item and escalation thresholds.
9. **Costing sheet linkage** — Specs visible to designers at design time, with role-based access (sourcing/sales see pricing; designers see specs only).
10. **PI Approval field** — Per-SKU, three values: Required / Not Required / Completed.

**Open until Jen's interview:**

- Spruce Line data model (collection-based vs. SKU-based is unconfirmed)
- Spruce Line pipeline stages (provisional stage map from data only)
