# AGENTS.md

## 1. Project summary

This repo is the integration and analytics layer for a licensed home decor company's product management system. The company develops licensed (Disney, Marvel, WB, etc.) and non-licensed consumer goods (plush, apparel, wall decor) under two business units:

- **POP Creations** — licensed products requiring multi-stage licensor approval
- **Spruce Line** — generic/non-licensed products with a simpler workflow

**Current phase:** Discovery / planning. ClickUp behavioral data has been collected into Cloudflare D1. Employee interviews are in progress (Rounds 1-2 complete for Jessica and Liz; Jen's Round 1 pending). Plane (open-source PM tool) will be deployed and configured on Coolify once interview data is complete enough to drive design decisions.

The custom code in this repo is a Cloudflare Worker that:
1. Receives HMAC-signed ClickUp webhook events and writes them to D1
2. Serves a `/query` endpoint: natural language question → SQL → plain English answer (via OpenRouter AI)
3. Serves an `/interview` UI for async employee Q&A, storing answers directly in D1

GitHub Actions automate nightly ClickUp snapshots, D1 loads, `products` table rebuilds, and webhook management. No application servers — the Worker is the only runtime service in this repo.

---

## 2. Multi-model AI note

This project uses multiple AI models:
- **SQL generation and answer formatting:** OpenRouter API routing to `deepseek/deepseek-v3.2` (called from the Worker's `/query` endpoint at `https://openrouter.ai/api/v1/chat/completions`)
- **Claude Code (this session):** used for code editing, analysis, and document writing

The `OPENROUTER_MODEL` and `OPENROUTER_URL` constants are hardcoded in `integrations/worker/src/index.js`. Changing the model requires editing that constant and redeploying.

---

## 3. Repository structure

```
u2giants/plane/                          GitHub repo
├── integrations/
│   └── worker/
│       ├── src/index.js                 Cloudflare Worker — only runtime custom code
│       └── wrangler.toml                Worker config: name, D1 binding, account_id
├── scripts/
│   ├── clickup_snapshot.py              Full ClickUp workspace → gzip JSON artifacts
│   ├── load_snapshot_to_d1.py           Load snapshot JSON artifacts → D1 tables
│   ├── build_products_table.py          Rebuild products + product_checkpoints tables
│   ├── fetch_task_activity.py           Backfill status_transitions from snapshot/API
│   ├── migrate_robust_schema.sql        Full D1 schema — idempotent, safe to re-run
│   ├── migrate_schema.sql               Older schema file (superseded by migrate_robust_schema.sql)
│   ├── populate_list_space_map.py       Seed list_space_map from snapshot data
│   ├── populate_list_space_map.sql      SQL for list_space_map population (run via Wrangler)
│   ├── query_d1.py                      Ad-hoc local D1 query helper
│   ├── analyze_*.py / investigate_*.py  Exploratory scripts from discovery phase (reference only)
│   └── analysis/                        Periodic behavioral analysis report outputs
├── .github/workflows/
│   ├── deploy-worker.yml                Auto-deploys Worker on push to integrations/worker/**
│   ├── clickup-snapshot.yml             Nightly 02:00 UTC ClickUp snapshot
│   ├── load-snapshot-to-d1.yml          Manual: load snapshot artifacts → D1
│   ├── refresh-products.yml             Nightly 06:00 UTC products table rebuild
│   ├── migrate-database.yml             Manual: apply migrate_robust_schema.sql to D1
│   ├── backfill-transitions.yml         Manual: backfill status_transitions
│   ├── create-webhook.yml               Manual: create new ClickUp webhook
│   ├── update-webhook.yml               Manual: re-enable the existing webhook
│   ├── update-webhook-events.yml        Manual: update webhook event subscriptions
│   ├── list-webhook.yml                 Manual: list current webhooks
│   └── populate-list-space-map.yml      Manual: seed list_space_map
├── .githooks/
│   └── post-checkout                    Enforces single-branch policy (blocks non-main branches)
├── docs/
│   ├── architecture.md
│   ├── deployment.md
│   ├── development.md
│   ├── configuration.md
│   └── interview-synthesis.md
├── AGENTS.md                            This file
├── CLAUDE.md                            Claude Code session context (MCP tool names, credentials)
├── AI_OPERATING_RULES.md                AI behavior rules for this repo
├── BUSINESS_INTELLIGENCE.md             Full business context, pipeline stages, SLAs
├── DATA_ACCESS_GUIDE.md                 D1 table reference with sample queries
├── FUTURE_SESSION_START_HERE.md         Orientation for new AI sessions
├── HANDOFF.md                           Plane design decisions pending interview completion
└── README.md                            Project overview
```

No `package.json` exists anywhere in this repo. The Worker has no npm dependencies — Wrangler bundles `src/index.js` as a pure ES module.

---

## 4. Prime Directive: custom-code boundary

**Only one file contains custom runtime logic:** `integrations/worker/src/index.js`

Everything else in the repo is either:
- Schema / migration SQL (`scripts/migrate_robust_schema.sql`)
- Python data pipeline scripts (`scripts/*.py`) — run only in GitHub Actions or locally
- GitHub Actions workflow definitions (`.github/workflows/`)
- Documentation markdown files
- The Plane open-source application (AGPL-3.0), deployed separately on Coolify — its source is not in this repo

Do not edit the Plane application source. Do not add new runtime services. The deployment path is: edit files → commit to `main` → GitHub Actions deploys. There is no other approved deployment path.

---

## 5. Core modification inventory

### `integrations/worker/src/index.js`

| Component | Location | What it does |
|-----------|----------|--------------|
| Route dispatch | `export default { async fetch() }` | Routes GET /health, POST /clickup/webhook, POST /query, GET /interview, POST /interview/answer, GET /interview/responses |
| `SCHEMA_CONTEXT` | Top of file, string constant | Full D1 schema description embedded as LLM system prompt for SQL generation |
| `FORMAT_CONTEXT` | Top of file, string constant | System prompt for converting SQL results to plain English |
| `OPENROUTER_MODEL` | Constant | `'deepseek/deepseek-v3.2'` — change here to swap model |
| `OPENROUTER_URL` | Constant | `'https://openrouter.ai/api/v1/chat/completions'` |
| `KNOWN_LICENSORS` | Array constant | Used to extract licensor hints from NAS file paths in comments |
| `LICENSOR_KW` / `FACTORY_KW` / `RETAILER_KW` | Array constants | Keyword lists that drive `comment_driver` classification on `task_comments` |
| `RESPONDENTS` | Object constant | Maps URL `?who=` keys to display names and colors: `jessica` / `liz` / `jen` |
| `handleAIQuery` | Function | Two-shot LLM call: generate SQL → execute on D1 → format answer |
| `callLLM` | Function | OpenRouter API wrapper (OpenAI-compatible chat completions) |
| `cleanSQL` | Function | Strips markdown code fences from LLM SQL output |
| `handleClickUpWebhook` | Function | HMAC validation → write to `raw_events` (with fallback to legacy `events` table) → secondary specialized writes |
| `writeStatusTransition` | Function | Secondary write for `taskStatusUpdated` → `status_transitions` |
| `writeTaskAssignment` | Function | Secondary write for `taskAssigneeUpdated` → `task_assignments` |
| `writeTaskComment` | Function | Secondary write for `taskCommentPosted` → `task_comments` (extracts file paths, classifies comment_driver) |
| `writeTaskStub` | Function | Secondary write for `taskCreated` → `tasks` |
| `writeCustomFieldChange` | Function | Secondary write for `taskCustomFieldUpdated` → `task_custom_fields` |
| `writeChecklistItemUpdate` | Function | Secondary write for `taskChecklistUpdated` → `checklist_items` |
| `handleInterviewPage` | Function | Serves per-respondent Q&A form (pending question) + answered history |
| `handleInterviewAnswer` | Function | Receives POST form submission, updates `interview_questions` in D1, redirects |
| `handleInterviewResponses` | Function | Admin view of all answers across all respondents |
| `verifyHmac` | Function | HMAC-SHA256 signature validation using Web Crypto API |
| `extractFilePaths` | Function | Regex to pull Windows-style NAS paths from comment text |
| `extractLicensorFromPaths` | Function | Infers licensor from first path component against `KNOWN_LICENSORS` |

### `scripts/build_products_table.py`

Rebuilds `products` (fully denormalized, one row per parent task) and `product_checkpoints` (checklist items classified by `step_id` from `checkpoint_map`). Runs DELETE + full INSERT on each execution. Key constants: `ACTIVE_DAYS = 180`, `INTERNAL_SPACES = {"designflow"}`, `D1_MAX_PARAMS = 90`, `PAGE_SIZE = 500`.

### `scripts/migrate_robust_schema.sql`

Authoritative D1 schema. All statements are `CREATE ... IF NOT EXISTS` — idempotent. Applied via `migrate-database.yml` workflow using `wrangler d1 execute clickup-events --file ... --remote`.

---

## 6. Task-to-file navigation

| Task | Files to touch |
|------|---------------|
| Add a new Worker route | `integrations/worker/src/index.js` (add route in `fetch()`, add handler function) |
| Change the AI model | `integrations/worker/src/index.js` → `OPENROUTER_MODEL` constant |
| Add a new interview respondent | `integrations/worker/src/index.js` → `RESPONDENTS` object |
| Change comment driver keyword rules | `integrations/worker/src/index.js` → `LICENSOR_KW` / `FACTORY_KW` / `RETAILER_KW` |
| Update the SQL generation prompt | `integrations/worker/src/index.js` → `SCHEMA_CONTEXT` string |
| Add a D1 table or view | `scripts/migrate_robust_schema.sql` → add CREATE TABLE/VIEW, then run `migrate-database.yml` |
| Change how products are built | `scripts/build_products_table.py` → then run `refresh-products.yml` |
| Change what ClickUp events are captured | `.github/workflows/create-webhook.yml` or `update-webhook-events.yml` (event list); `integrations/worker/src/index.js` → `handlers` object in `handleClickUpWebhook` |
| Deploy the Worker | Push to `main` touching `integrations/worker/**` (auto), or `gh workflow run deploy-worker.yml` |
| Run a full data refresh | `gh workflow run clickup-snapshot.yml` then `gh workflow run load-snapshot-to-d1.yml` |
| Add a Worker secret | Update the corresponding step in `deploy-worker.yml`; set the value in GitHub repo secrets |
| Query D1 interactively | Use Cloudflare MCP tool, or `curl` the D1 REST API, or `wrangler d1 execute ... --remote` |

---

## 7. Data model and external identifiers

### Fixed IDs (never change without updating all references)

| Item | Value | Referenced in |
|------|-------|--------------|
| Cloudflare account ID | `8303d11002766bf1cc36bf2f07ba6f20` | `wrangler.toml`, all scripts, `CLAUDE.md`, `README.md` |
| D1 database ID | `c37aeb36-e16e-416b-b699-c910f6f8dc10` | `wrangler.toml`, all scripts, `CLAUDE.md`, `README.md` |
| D1 database name | `clickup-events` | `wrangler.toml`, all `wrangler d1 execute` commands |
| ClickUp workspace/team ID | `2298436` | Scripts, `CLAUDE.md`, webhook workflow payloads |
| ClickUp webhook ID | `b114d599-aa9a-4069-b08f-a4bf0ac4fe20` | Hardcoded in `update-webhook.yml` and `update-webhook-events.yml` |
| Worker name | `plane-integrations` | `wrangler.toml` |
| Worker URL | `https://plane-integrations.u2giants.workers.dev` | Deploy health check, ClickUp webhook endpoint |
| D1 binding name | `DB` | `wrangler.toml`, accessed as `env.DB` in Worker code |

### D1 tables (primary)

| Table | Rows (approx) | Purpose |
|-------|--------------|---------|
| `products` | 9,069 | **Primary query surface.** Fully denormalized, rebuilt nightly. Always `WHERE is_internal = 0`. |
| `tasks` | 17,751 | Raw ClickUp tasks from snapshot |
| `raw_events` | growing | Append-only webhook log; full payload in `raw_payload` |
| `events` | 1,247 | Legacy table name — fallback target if `raw_events` doesn't exist |
| `status_transitions` | 17,978+ | Status change history; only `source='webhook'` rows have real `from_status` |
| `task_assignments` | 14,670+ | Assignment history |
| `task_comments` | 244+ | Comment text with `comment_driver` classification |
| `task_custom_fields` | 3,733+ | Custom field values (SMPL Req, Factory, Category, etc.) |
| `task_tags` | 13,333 | Tags on tasks — primary licensor signal |
| `task_links` | 495 | Linked task relationships |
| `task_checklists` / `checklist_items` | 7,184 checklists | Checklist progress |
| `product_checkpoints` | 32,534 | Checklist items classified to `step_id` from `checkpoint_map` |
| `checkpoint_map` | 27 | Canonical process milestones |
| `workflow_stages` | 76 | Maps raw ClickUp status strings → pipeline stage names |
| `interview_questions` | 59 | Employee interview Q&A (respondents: jessica, liz, jen) |
| `users` | 64 | Workspace members (username often NULL; use `events` for display names) |
| `spaces` | 3 | POP Creations (4294720), Spruce Line (2571984), designflow (90114122073) |
| `lists` | 21 | ClickUp lists; Licensing Management (13194624) is primary SKU list |
| `time_entries` | 0 | Empty — time tracking not used by the team |
| `task_attachments` | 0 | Empty — `taskAttachmentUpdated` not subscribed |

### D1 views (prefer over raw tables for common queries)

`overdue_products`, `stalled_products`, `comment_signals`, `comment_drivers`, `tag_usage`, `task_dependency_map`, `licensor_activity`, `product_journey`, `checkpoint_velocity`

### Key data caveats

- `products.is_internal = 1` for the `designflow` space — always filter `WHERE is_internal = 0`
- 17,765 of 17,978 `status_transitions` rows have `source='estimated'` with `from_status = NULL` — not real observed transitions
- `product_category` is populated on only 57 of 9,051 non-internal products
- `retailer` populated on only 200 of 9,051 rows; `buyer` on only 17
- ClickUp fires `taskUpdated` alongside every specific event, producing duplicate rows in `raw_events` — filter with `WHERE event_type != 'taskUpdated'` for unique-action counts
- `space_id` is always NULL in webhook payloads (ClickUp does not send it); derive from `list_space_map`

---

## 8. Container and service inventory

| Service | Type | Location | Notes |
|---------|------|----------|-------|
| `plane-integrations` Worker | Cloudflare Worker | `integrations/worker/src/index.js` | Auto-deployed; no container |
| `clickup-events` D1 | Cloudflare D1 (SQLite) | Cloudflare managed | ID: `c37aeb36-...` |
| Plane PM app | Docker (on Coolify) | `178.156.180.212` (Coolify server UUID: `onwp0kd7w1w74w9yeotnoihp`) | Not yet configured; deployment pending Round 3 interviews |
| Coolify | Self-hosted PaaS | `http://178.156.180.212:8000` | Manages Plane runtime env vars and deployment |

**Plane planned configuration (not yet deployed):**
- File storage: Cloudflare R2 bucket `plane-uploads` (replacing bundled MinIO)
- `GUNICORN_WORKERS=2` (shared server with Twenty + OpenClaw)
- PostgreSQL, Redis, RabbitMQ: bundled Plane defaults
- Reverse proxy: Coolify-managed Caddy with automatic SSL
- R2 env vars: `AWS_S3_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME=plane-uploads`

---

## 9. What to ignore

- `scripts/analyze_*.py`, `scripts/investigate_*.py`, `scripts/deep_snapshot_analysis.py`, `scripts/check_custom_fields.py`, `scripts/find_relationships.py` — exploratory scripts from discovery phase, not part of any production flow
- `scripts/analysis/*.md` — analysis reports generated during discovery; not maintained
- `scripts/migrate_schema.sql` — superseded by `scripts/migrate_robust_schema.sql`
- `scripts/__pycache__/` — gitignored Python bytecode
- `snapshot_output/` — gitignored; generated locally by `clickup_snapshot.py`
- The Plane open-source application source — not in this repo; deployed via Coolify from Docker image
- `docs/interview-synthesis.md` — untracked file; informational only; not part of the build

---

## 10. Intentional quirks and non-obvious decisions

### raw_events fallback to legacy `events` table
The webhook handler tries to write to `raw_events` first. If that fails, it falls back to the legacy `events` table. This was intentional: the schema migration from `events` → `raw_events` was applied after the Worker was already deployed, so events would have been lost during the transition without the fallback. Keep this fallback — do not remove it.

### raw_events stores full payload alongside extracted columns
ClickUp's webhook payload structure is partially undocumented and has changed over time. The full JSON is stored in `raw_payload` as ground truth. Extracted columns (`user_id`, `field_changed`, `from_value`, `to_value`) are query conveniences only. If extraction logic has bugs, the raw payload allows reprocessing.

### Secondary webhook writes are best-effort
The specialized writes (`writeStatusTransition`, `writeTaskComment`, etc.) are inside try/catch with errors logged but not surfaced. The Worker always returns `200 ok` to ClickUp to prevent ClickUp from retrying. Losing a specialized write does not lose the event — `raw_events` always captures it first.

### `space_id` column always NULL on raw_events
ClickUp does not include `space_id` in webhook payloads. The column exists in the schema but is intentionally never populated. Derive division context via `JOIN list_space_map ON list_id` or use the `space_name` column on `products`.

### `products` is a materialized table, not a view
D1/SQLite doesn't support indexed views. The multi-join query needed to produce the product entity would be too slow for interactive AI queries. The `products` table is deleted and fully rebuilt nightly by `build_products_table.py`. It has 15 indexes. Never update it incrementally — always rebuild.

### OpenRouter not direct Anthropic API
The `/query` endpoint routes through OpenRouter. This allows model substitution without code changes and avoids direct API key management complexity on the Worker. The variable is `OPENROUTER_API_KEY` (not `ANTHROPIC_API_KEY`).

### Single-branch policy enforced by git hook
`.githooks/post-checkout` deletes any newly created branch and returns to `main`. To activate after cloning: `git config core.hooksPath .githooks`. The hook allows one exception: branch named `upstream` (for tracking the upstream Plane repo).

### `taskUpdated` fires alongside every specific event
ClickUp sends both `taskUpdated` and the specific event (e.g., `taskStatusUpdated`) for every change. This produces duplicate rows in `raw_events`. When counting unique actions, filter `WHERE event_type != 'taskUpdated'`.

### QUERY_SECRET is optional
If `QUERY_SECRET` is not set on the Worker, the `/query` endpoint is open to anyone with the URL. If set, it requires `Authorization: Bearer <secret>`. The deploy workflow sets it silently only if the GitHub secret exists.

---

## 11. Credentials and environment

### Worker secrets (set via `wrangler secret put` or `deploy-worker.yml`)

| Secret | Required | Purpose |
|--------|----------|---------|
| `CLICKUP_WEBHOOK_SECRET` | Recommended | HMAC-SHA256 key for webhook signature validation. If unset, all webhooks accepted without validation. |
| `OPENROUTER_API_KEY` | Required for `/query` | OpenRouter API key. `/query` returns 500 if missing. |
| `QUERY_SECRET` | Optional | Bearer token protecting `/query`. If unset, endpoint is open. |

### GitHub Actions secrets (repo: `u2giants/plane`)

| Secret | Used by workflows |
|--------|------------------|
| `CLOUDFLARE_API_TOKEN` | All CF-touching workflows |
| `CLOUDFLARE_ACCOUNT_ID` | snapshot, load, refresh, backfill |
| `CLOUDFLARE_D1_DATABASE_ID` | snapshot, load, refresh, backfill |
| `CLICKUP_TOKEN` | `clickup-snapshot.yml`, backfill with `fetch_history=true` |
| `CLICKUP_WORKSPACE_ID` | `clickup-snapshot.yml`, webhook workflows |
| `CLICKUP_WEBHOOK_SECRET` | `deploy-worker.yml` (pushed to Worker) |
| `OPENROUTER_API_KEY` | `deploy-worker.yml` (pushed to Worker) |
| `QUERY_SECRET` | `deploy-worker.yml` (pushed to Worker) |

### Script environment variables (set before running locally)

```bash
export CLOUDFLARE_ACCOUNT_ID=8303d11002766bf1cc36bf2f07ba6f20
export CLOUDFLARE_D1_DATABASE_ID=c37aeb36-e16e-416b-b699-c910f6f8dc10
export CLOUDFLARE_API_TOKEN=<your_token>
export CLICKUP_TOKEN=<pk_4384255_...>        # for clickup_snapshot.py only
export CLICKUP_WORKSPACE_ID=2298436          # for clickup_snapshot.py only
```

### Coolify API (for Plane runtime management)

```
Base URL: http://178.156.180.212:8000/api/v1
Auth: Bearer 1|mlVx9mbwsN1Sga6eLtJEvmPioy6Sra9AnepnCe3K7d0a2927
Server UUID: onwp0kd7w1w74w9yeotnoihp
```

### D1 query via Cloudflare MCP (in Claude Code sessions)

```
Tool: mcp__claude_ai_Cloudflare_Developer_Platform__d1_database_query
database_id: c37aeb36-e16e-416b-b699-c910f6f8dc10
```

---

## 12. Deployment

### Worker (primary deployment)

Auto-triggers on push to `main` when any file under `integrations/worker/**` or `.github/workflows/deploy-worker.yml` changes. The workflow: installs Wrangler → `wrangler deploy` → pushes 3 secrets → health check.

```bash
# Manual trigger
gh workflow run deploy-worker.yml --repo u2giants/plane

# Verify live
curl https://plane-integrations.u2giants.workers.dev/health
```

### Schema migration

```bash
gh workflow run migrate-database.yml --repo u2giants/plane
```

Runs `wrangler d1 execute clickup-events --file ../../scripts/migrate_robust_schema.sql --remote`. All statements are idempotent — safe to re-run against a live database.

### Data refresh pipeline (three stages)

```bash
# Stage 1: snapshot ClickUp workspace (nightly 02:00 UTC, or manual)
gh workflow run clickup-snapshot.yml --repo u2giants/plane -f include_closed=true

# Stage 2: load snapshot into D1 (manual only)
gh workflow run load-snapshot-to-d1.yml --repo u2giants/plane
# Or for a specific snapshot run:
gh workflow run load-snapshot-to-d1.yml --repo u2giants/plane -f run_id=<run_id>

# Stage 3: rebuild products table (nightly 06:00 UTC, or manual)
gh workflow run refresh-products.yml --repo u2giants/plane
```

Snapshot artifacts are retained for 30 days. The snapshot script supports manifest-based resume — if it fails partway, re-running continues from the last completed list.

### Status transition backfill

```bash
# Synthesized backfill (fast, derives from snapshot data)
gh workflow run backfill-transitions.yml --repo u2giants/plane

# Full backfill including ClickUp history API (slow, hours, needs CLICKUP_TOKEN)
gh workflow run backfill-transitions.yml --repo u2giants/plane -f fetch_history=true
```

Rows from this workflow have `source='api_history'` and are the only rows with real `from_status` values for most products.

### Webhook management

```bash
gh workflow run list-webhook.yml --repo u2giants/plane          # view current webhooks
gh workflow run update-webhook.yml --repo u2giants/plane        # re-enable webhook b114d5...
gh workflow run update-webhook-events.yml --repo u2giants/plane # update event subscriptions
gh workflow run create-webhook.yml --repo u2giants/plane        # create new webhook
```

After creating a new webhook: copy the secret from run logs → set as `CLICKUP_WEBHOOK_SECRET` GitHub secret → redeploy Worker.

---

## 13. Critical incidents

### Webhook suspended (known past event)
The ClickUp webhook `b114d599-aa9a-4069-b08f-a4bf0ac4fe20` has been suspended at least once. `update-webhook.yml` exists specifically to re-enable it. If live events stop arriving, check webhook health first: `gh workflow run list-webhook.yml`.

### Schema migration gap
The `raw_events` table was added after initial deployment. The fallback to the legacy `events` table in `handleClickUpWebhook` is the mitigation. If `raw_events` is missing from a fresh D1 instance, run `migrate-database.yml` before events start arriving.

### status_transitions data quality
17,765 of 17,978 rows have `source='estimated'` with `from_status = NULL`. These were bulk-imported from snapshot data (point-in-time, not observed transitions). Only ~213 rows have real from→to transitions from the live webhook period (March 30 – May 18, 2026). Do not use this table for historical flow analysis without filtering by `source`.

---

## 14. Pending work

### Immediate (blocking next phase)
- Get Jen's interview answers (12 questions pending in `interview_questions` WHERE respondent='jen' AND status='pending') — blocks Spruce Line data model decisions
- Get Jessica's remaining Round 3 answers (11 pending) — blocks POP Creations workflow finalization

### Domain model (before Plane configuration)
- Define Project + SKU two-tier data model (currently everything is flat in `products`)
- Define design inventory as a first-class searchable object (preliminary designs are currently lost)
- Define Cancel state with required reason field (no formal cancel mechanism exists today)
- Model SKU reuse across buyers (detection, restriction tracking)
- Clarify Spruce Line workflow (provisional only until Jen interviews)
- Rename `sarbani_approval` checkpoint to `creative_director_review`

### Plane deployment (after domain model decisions)
- Configure Plane on Coolify (remove MinIO service, add R2 env vars, set `GUNICORN_WORKERS=2`)
- Map Project card and SKU card to Plane issue types
- Implement bulk stage advancement (hard requirement from Jessica)
- Add time-in-stage display and on-track indicator to every SKU view
- Add Brand Assurance number field (required for licensor submission)
- Build design inventory search view (filter by licensor + property + product type + season)

### Infrastructure (under consideration)
- Moving from Cloudflare Worker + D1 toward Coolify-hosted PostgreSQL + custom API is being evaluated. No decision made. The current Worker + D1 stack remains authoritative until that decision is finalized and implemented.
