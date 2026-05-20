# Architecture

## System overview

This system has two purposes that share infrastructure:

1. **Data collection** — capture ClickUp workspace activity (webhooks + nightly snapshots) into a Cloudflare D1 database to inform Plane configuration decisions.
2. **Interview collection** — an async Q&A interface delivered to employees via a Cloudflare Worker, storing answers directly in D1.

A third capability, **natural language querying** of the product database, is live via the `/query` endpoint.

---

## Component diagram

```
┌─────────────────────────────────────────────────────────┐
│  ClickUp workspace (team 2298436)                       │
│  22 subscribed event types → HMAC-signed webhooks       │
└────────────────────┬────────────────────────────────────┘
                     │ POST /clickup/webhook
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Worker: plane-integrations                  │
│  plane-integrations.u2giants.workers.dev                │
│                                                         │
│  GET  /health           liveness                        │
│  POST /clickup/webhook  → D1 (raw_events + specialized) │
│  POST /query            NL → SQL → plain English        │
│  GET  /interview        per-respondent Q&A UI           │
│  POST /interview/answer stores answer → D1              │
│  GET  /interview/responses  admin view of all answers   │
└────────────────────┬────────────────────────────────────┘
                     │ D1 binding: DB
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare D1: clickup-events                          │
│  c37aeb36-e16e-416b-b699-c910f6f8dc10                  │
│                                                         │
│  raw_events           append-only webhook log           │
│  tasks / lists / spaces / users / workspaces            │
│  status_transitions   from→to with timestamps           │
│  task_assignments     who was assigned, when            │
│  task_comments        with comment_driver classification │
│  task_tags / task_links / task_attachments              │
│  task_custom_fields / task_checklists / checklist_items │
│  products             MATERIALIZED — rebuilt nightly    │
│  product_checkpoints  checklist items → process steps   │
│  checkpoint_map       27 canonical process milestones   │
│  workflow_stages      ClickUp status → pipeline stage   │
│  interview_questions  Q&A for employee interviews       │
│  retailers / licensors reference entities               │
└────────────────────┬────────────────────────────────────┘
                     │ rebuilt by
                     ▼
┌─────────────────────────────────────────────────────────┐
│  GitHub Actions (nightly scheduled)                     │
│  02:00 UTC  clickup-snapshot.yml → snapshot → artifacts │
│  06:00 UTC  refresh-products.yml → build_products_table │
└─────────────────────────────────────────────────────────┘
```

---

## Data flow — webhook path

Each ClickUp event follows this path:

1. ClickUp sends a signed POST to `/clickup/webhook`.
2. Worker validates HMAC-SHA256 signature (rejects 401 if invalid and `CLICKUP_WEBHOOK_SECRET` is set).
3. Fields extracted from `history_items[0]`: `user`, `field`, `before`, `after`, `parent_id` (used as `list_id`).
4. Full payload + extracted fields written to `raw_events` (primary write). If `raw_events` doesn't exist, falls back to legacy `events` table.
5. Depending on `event_type`, a secondary specialized write fires (best-effort, errors logged but don't affect the 200 response):
   - `taskStatusUpdated` → `status_transitions`
   - `taskAssigneeUpdated` → `task_assignments`
   - `taskCommentPosted` → `task_comments` (with file path extraction + comment driver classification)
   - `taskCreated` → `tasks` stub
   - `taskCustomFieldUpdated` → `task_custom_fields`
   - `taskChecklistUpdated` → `checklist_items`
6. Worker returns `200 ok` immediately — ClickUp retries on anything else.

**Why raw_events stores full payload:** ClickUp's webhook structure is partially undocumented and has changed. The extracted columns are query conveniences; `raw_payload` is ground truth and allows re-processing if extraction logic has bugs.

**Why the raw_events fallback exists:** The schema migration from `events` → `raw_events` was applied after the Worker was deployed. The fallback ensures no events are lost if the migration hasn't been applied yet. It is intentional and should stay.

---

## Data flow — snapshot path

The nightly snapshot pipeline runs in three sequential stages:

```
clickup-snapshot.yml         (02:00 UTC, daily)
  clickup_snapshot.py
    → calls ClickUp REST API for all tasks, lists, spaces, users, comments, time entries
    → writes gzip-compressed JSON files to snapshot_output/
    → uploads as GitHub Actions artifact (retained 30 days)
    → supports manifest-based resume (restarts from last completed list on failure)

load-snapshot-to-d1.yml      (manual trigger — run after snapshot when full reload needed)
  load_snapshot_to_d1.py
    → downloads latest snapshot artifact from GH Actions
    → upserts all rows into D1 tables (tasks, lists, spaces, users, etc.)

refresh-products.yml         (06:00 UTC, daily)
  build_products_table.py
    → reads from tasks, task_custom_fields, task_checklists, checklist_items,
      task_comments, task_assignments, workflow_stages in D1
    → rebuilds products table (DELETE + INSERT, full refresh)
    → rebuilds product_checkpoints table
    → classifies checklist items against checkpoint_map using keyword rules (STEP_RULES)
```

The `products` table is a fully denormalized materialized view — every product analysis query runs against it with no joins. It is rebuilt from scratch nightly; it is not updated incrementally.

---

## Data flow — AI query path

`POST /query` with `{ "question": "..." }`:

1. Question sent to OpenRouter API (`deepseek/deepseek-v3.2`) with a system prompt containing the full D1 schema context.
2. Model returns a SELECT statement.
3. Worker validates that the response starts with `SELECT` (rejects otherwise).
4. Query executed against D1 via the `DB` binding.
5. Up to 30 rows passed back to the LLM with a formatting prompt.
6. Model returns a 1–3 sentence plain English answer.
7. Response includes `question`, `answer`, `sql`, `row_count`, `rows` (capped at 50), and `sql_error` if the query failed.

The endpoint is optionally protected by a `QUERY_SECRET` bearer token. If `QUERY_SECRET` is not set, the endpoint is open.

---

## D1 schema — tables

| Table | Rows (approx) | Purpose |
|-------|--------------|---------|
| `products` | 9,069 | **Primary query surface.** One row per product, fully denormalized. Rebuilt nightly. Always `WHERE is_internal = 0`. |
| `tasks` | 17,751 | Raw ClickUp tasks from snapshot. Parent to most other tables. |
| `raw_events` | growing | Append-only webhook event log. Full payload stored. |
| `status_transitions` | 17,978+ | Every status change. `source = 'snapshot'` rows have `from_status = NULL` (point-in-time, not observed). Only `source = 'webhook'` rows have real from→to. |
| `task_assignments` | 14,670+ | Assignment history with timestamps. |
| `task_comments` | 244+ | Comment text with `comment_driver` classification: `'licensor'` \| `'factory'` \| `'retailer'` \| NULL. |
| `task_custom_fields` | 3,733+ | Custom field values (SMPL Req, Factory, Category, etc.). |
| `task_tags` | 13,333 | Tags on tasks — primary signal for licensor, channel, routing. |
| `task_links` | 495 | Linked task relationships. |
| `task_checklists` / `checklist_items` | 7,184 checklists | Checklist progress; `checklist_items.resolved` drives milestone flags. |
| `product_checkpoints` | 32,534 | Checklist items linked to products with `step_id` from `checkpoint_map`. |
| `checkpoint_map` | 27 | Canonical process milestones (concept_submitted → buyer_presentation). |
| `workflow_stages` | 76 | Maps raw ClickUp status strings → clean stage names with ordering. |
| `interview_questions` | 55 | Q&A for employee interviews (Rounds 1–3, all respondents). |
| `users` | 64 | Workspace members. `username` is often NULL; use `events`/`status_transitions` for display names. |
| `spaces` | 3 | POP Creations, Spruce Line, designflow. |
| `lists` | 21 | All ClickUp lists across 3 spaces. |
| `retailers` / `licensors` | 26 / 34 | Reference entities seeded from products data. |
| `time_entries` | 0 | Time tracking entries. Empty — the team does not use time tracking. |
| `task_attachments` | 0 | Attachment events. `taskAttachmentUpdated` not subscribed. |

---

## D1 schema — views

All views filter `is_internal = 0` (excluding the `designflow` dev space) unless otherwise noted.

| View | What it answers |
|------|----------------|
| `overdue_products` | Open products past their due date, ordered by `days_overdue` |
| `stalled_products` | Active products with no movement in 30+ days |
| `comment_signals` | Products with comment-based approval / revision / rejection signals |
| `comment_drivers` | Per-product breakdown of comments by external driver (licensor, factory, retailer) |
| `tag_usage` | Tags by product count and % of all products |
| `task_dependency_map` | Tasks with blocking dependencies |
| `licensor_activity` | Per-licensor: product count, active count, avg pipeline age |
| `product_journey` | Resolved checkpoints per product in chronological order |
| `checkpoint_velocity` | Avg days from product creation to each checkpoint (requires `resolved_at` data) |
| `task_details` | Denormalized task view joining custom fields, stages, spaces. Prefer `products` for product queries. |
| `pipeline_health` | Active task count per stage with age signals |
| `stage_durations` | Avg time per stage from `status_transitions` (only meaningful for `source = 'api_history'` rows) |
| `task_effort` | Time logged per product (all zero — time tracking unused) |
| `task_completion_times` | Status transition durations using window functions |
| `workflow_efficiency` | Avg days per from→to transition |
| `user_activity` | Transitions, comments, assignments per user |

---

## Key design decisions

**`products` is a materialized table, not a view.** D1/SQLite doesn't support indexed views. The multi-join query needed to produce the product entity would be too slow for interactive AI queries. Building it nightly as a real table with 15 indexes makes every product query fast.

**Two-table write (raw_events + specialized).** The specialized writes (status_transitions, etc.) can fail without losing data — `raw_events` always has the full payload. This decouples data capture from data modeling.

**`space_id` is always NULL in webhook events.** ClickUp does not include space_id in webhook payloads. Derive division context via `JOIN list_space_map ON list_id` (or the `space_name` column on `products`). The `space_id` column on `raw_events` exists but is intentionally never populated.

**`taskUpdated` fires alongside every specific event.** One status change produces two rows in `raw_events`. Use `WHERE event_type != 'taskUpdated'` for unique-action counts. This is ClickUp's behavior, not a bug.

**OpenRouter not direct Anthropic API.** The `/query` endpoint routes through OpenRouter using `deepseek/deepseek-v3.2`. This allows model substitution without code changes and avoids direct Anthropic API key management on the Worker. The `OPENROUTER_API_KEY` Worker secret controls access.
