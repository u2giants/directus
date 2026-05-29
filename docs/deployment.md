# Deployment

This document covers all deployed infrastructure and the workflows that operate it.

---

## Infrastructure overview

| Component | Platform | Name / URL |
|-----------|----------|-----------|
| Cloudflare Worker | Cloudflare Workers | `plane-integrations` — `https://plane-integrations.u2giants.workers.dev` |
| D1 database | Cloudflare D1 | `clickup-events` — ID `c37aeb36-e16e-416b-b699-c910f6f8dc10` |
| Plane app | Coolify (VPS) | `http://178.156.180.212:8000` |
| GitHub Actions | GitHub | `u2giants/plane` |

---

## GitHub Actions workflows

All workflows live in `.github/workflows/`. All can be triggered via `gh workflow run`.

### Scheduled (automatic)

| Workflow file | Schedule | What it does |
|---------------|----------|--------------|
| `clickup-snapshot.yml` | Daily 02:00 UTC | Snapshots entire ClickUp workspace to gzip JSON → GitHub artifact (30-day retention). Supports manifest-based resume if the run fails partway. |
| `refresh-products.yml` | Daily 06:00 UTC | Rebuilds `products` and `product_checkpoints` tables in D1 from current task/checklist/comment data. Runs after the snapshot. |

### Manual-only

| Workflow file | When to run |
|---------------|-------------|
| `deploy-worker.yml` | Worker code or config changed outside of a push to `main`; or to re-push secrets |
| `load-snapshot-to-d1.yml` | After a full snapshot, when you want to reload all raw task/list/space data into D1 |
| `migrate-database.yml` | When schema changes in `scripts/migrate_robust_schema.sql` need to be applied |
| `backfill-transitions.yml` | One-time or after a schema change: rebuild `status_transitions` from snapshot data or ClickUp history API |
| `create-webhook.yml` | One-time setup, or after deleting and recreating the ClickUp webhook |
| `update-webhook.yml` | Re-enable a suspended webhook (targets hardcoded ID `b114d599-aa9a-4069-b08f-a4bf0ac4fe20`) |
| `update-webhook-events.yml` | Change which event types the webhook subscribes to |
| `list-webhook.yml` | Inspect current webhook registrations and their health status |
| `populate-list-space-map.yml` | One-time: seed `list_space_map` from snapshot data (maps list IDs → space names) |

### Auto-triggered on push

`deploy-worker.yml` also runs automatically when a push to `main` touches:
- `integrations/worker/**`
- `.github/workflows/deploy-worker.yml`

---

## Cloudflare Worker deployment

### Automatic deployment

Any push to `main` that modifies `integrations/worker/**` or `deploy-worker.yml` triggers `deploy-worker.yml` automatically. The workflow:

1. Installs Wrangler globally (`npm install -g wrangler`)
2. Runs `wrangler deploy` from `integrations/worker/`
3. Pushes three Worker secrets (skipped silently if the corresponding GitHub secret is not set):
   - `CLICKUP_WEBHOOK_SECRET`
   - `OPENROUTER_API_KEY`
   - `QUERY_SECRET`
4. Runs a health check: `curl https://plane-integrations.u2giants.workers.dev/health | grep -q "ok"`

The health check will cause the workflow to fail (exit 1) if the Worker does not respond with `"ok"` within a few seconds of deploy.

### Manual deployment

```bash
gh workflow run deploy-worker.yml --repo u2giants/plane
```

### Verify the live Worker

```bash
curl https://plane-integrations.u2giants.workers.dev/health
```

Expected response: `{"status":"ok"}` or similar containing `"ok"`.

### Worker secrets

Secrets are pushed during every deploy run. To update a secret without a full deploy:

```bash
# Requires CLOUDFLARE_API_TOKEN in your local env
cd integrations/worker
echo "new-value" | wrangler secret put OPENROUTER_API_KEY
```

Or update the GitHub secret and re-trigger `deploy-worker.yml`.

**Note:** If `/query` returns HTTP 500, the most likely cause is `OPENROUTER_API_KEY` not being set on the Worker. If webhooks are not being validated (all accepted without signature check), `CLICKUP_WEBHOOK_SECRET` is not set.

### Rollback

There is no dedicated rollback workflow. To roll back the Worker to a previous version:

1. Find the commit hash of the last known-good Worker code:
   ```bash
   git log --oneline integrations/worker/
   ```
2. Check out that commit's Worker files, or revert the change on `main`:
   ```bash
   git revert <bad-commit-hash>
   git push origin main
   ```
   The auto-deploy trigger fires on the push and redeploys.

3. Alternatively, use the Cloudflare dashboard to roll back via the Workers deployment history UI at `dash.cloudflare.com` — Workers retains previous deployment versions.

**There is no staging environment.** Pushes to `main` go directly to the production Worker.

---

## D1 schema migrations

Schema is defined in `scripts/migrate_robust_schema.sql`. All statements use `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE` — the file is idempotent and safe to re-run.

### Apply via GitHub Actions

```bash
gh workflow run migrate-database.yml --repo u2giants/plane
```

The workflow runs:
```
wrangler d1 execute clickup-events \
  --file ../../scripts/migrate_robust_schema.sql \
  --remote
```

After applying, it prints all table and view names to the run log for verification.

### Apply locally (requires Wrangler + CF API token)

```bash
export CLOUDFLARE_API_TOKEN=your_token
cd integrations/worker
wrangler d1 execute clickup-events \
  --file ../../scripts/migrate_robust_schema.sql \
  --remote
```

### Verify tables after migration

```bash
cd integrations/worker
wrangler d1 execute clickup-events \
  --command "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name" \
  --remote
```

---

## ClickUp snapshot pipeline

The data refresh pipeline has three independent stages. Run them in order for a full reload; run only Stage 3 when rebuilding the products table from existing D1 data.

### Stage 1 — Snapshot ClickUp workspace

**Runs automatically:** daily at 02:00 UTC.

**Manual trigger:**
```bash
gh workflow run clickup-snapshot.yml --repo u2giants/plane
# Force-include closed tasks:
gh workflow run clickup-snapshot.yml --repo u2giants/plane -f include_closed=true
```

**What it does:** calls the ClickUp REST API for all tasks, lists, spaces, users, comments, and time entries. Writes gzip-compressed JSON files to `snapshot_output/`. Uploads as a GitHub Actions artifact retained for 30 days. Supports manifest-based resume — a failed run that is re-triggered will continue from the last completed list, not from the beginning.

**Timeout:** 360 minutes.

### Stage 2 — Load snapshot into D1

**Manual trigger only.** Run this after a successful Stage 1 when you want to reload all raw data into D1 (e.g., after a schema migration, or to recover from data corruption).

```bash
# Load the latest successful snapshot
gh workflow run load-snapshot-to-d1.yml --repo u2giants/plane

# Load a specific snapshot by run ID
gh workflow run load-snapshot-to-d1.yml --repo u2giants/plane -f run_id=12345678
```

**What it does:** downloads the snapshot artifact, upserts all rows into `tasks`, `lists`, `spaces`, `users`, etc. via `load_snapshot_to_d1.py`, then runs `build_products_table.py` to rebuild `products`.

To find a specific run ID:
```bash
gh run list --repo u2giants/plane --workflow clickup-snapshot.yml --limit 10
```

### Stage 3 — Rebuild products table

**Runs automatically:** daily at 06:00 UTC (after the 02:00 UTC snapshot).

**Manual trigger:**
```bash
gh workflow run refresh-products.yml --repo u2giants/plane
```

**What it does:** runs `build_products_table.py` only — it does not download a new snapshot. Use this when:
- You've modified `build_products_table.py` logic or `checkpoint_map` and want to see the effect immediately
- Stage 1 ran successfully but Stage 3 failed
- You need to rebuild `products` from data already in D1 without waiting for a full snapshot

**Timeout:** 60 minutes.

---

## Backfilling status transitions

Status transitions are written in real time by the webhook. For historical data (before the webhook was live, or to fill gaps), use the backfill workflow.

```bash
# Fast: derive transitions from snapshot data (no ClickUp API calls)
gh workflow run backfill-transitions.yml --repo u2giants/plane

# Slow (hours): include the ClickUp /task/{id}/history API for real from→to values
gh workflow run backfill-transitions.yml --repo u2giants/plane -f fetch_history=true

# Scope to one list only
gh workflow run backfill-transitions.yml --repo u2giants/plane -f list_id=13194624

# Specific snapshot run + history
gh workflow run backfill-transitions.yml --repo u2giants/plane \
  -f fetch_history=true -f run_id=12345678
```

Rows written by this workflow have `source = 'api_history'` and carry real `from_status` values. Rows written by the snapshot workflow have `source = 'snapshot'` with `from_status = NULL` (point-in-time only).

**Timeout:** 360 minutes.

---

## Webhook management

The active webhook ID is `b114d599-aa9a-4069-b08f-a4bf0ac4fe20`. It is hardcoded in `update-webhook.yml` and `update-webhook-events.yml`.

### List registered webhooks

```bash
gh workflow run list-webhook.yml --repo u2giants/plane
gh run list --repo u2giants/plane --workflow list-webhook.yml --limit 1
# Then view the log:
gh run view --repo u2giants/plane --log <run-id>
```

### Create a new webhook (if the existing one is gone)

```bash
gh workflow run create-webhook.yml --repo u2giants/plane
```

After the run completes, retrieve the webhook secret from the run log:
```bash
gh run view --repo u2giants/plane --log <run-id> | grep "Webhook Secret"
```

Then:
1. Set `CLICKUP_WEBHOOK_SECRET` in GitHub Secrets to the new value.
2. Update the hardcoded webhook ID in `update-webhook.yml` and `update-webhook-events.yml` to the new ID.
3. Redeploy the Worker so the new secret is pushed to Cloudflare:
   ```bash
   gh workflow run deploy-worker.yml --repo u2giants/plane
   ```

### Re-enable a suspended webhook

```bash
gh workflow run update-webhook.yml --repo u2giants/plane
```

ClickUp suspends webhooks after repeated delivery failures. This workflow PUTs the webhook back to `"status": "active"` with the full event list.

### Update event subscriptions

```bash
gh workflow run update-webhook-events.yml --repo u2giants/plane
```

The current subscription covers 28 event types: 22 task/list/folder/space events + 6 goal/key-result events. Edit the `events` array in `update-webhook-events.yml` before running to change subscriptions.

---

## One-time setup operations

These workflows were run during initial setup. Re-run only if rebuilding from scratch.

### Populate list_space_map

Maps ClickUp list IDs to their parent space names. Required for the Worker to derive `space_name` from webhook events (ClickUp does not include `space_id` in webhook payloads).

```bash
gh workflow run populate-list-space-map.yml --repo u2giants/plane
```

Reads from `scripts/populate_list_space_map.sql` and runs `wrangler d1 execute` directly.

---

## GitHub secrets required

All secrets are stored at `u2giants/plane` repository level. Set or update via:
```bash
gh secret set SECRET_NAME --repo u2giants/plane --body "value"
```

| Secret | Required by | Notes |
|--------|-------------|-------|
| `CLOUDFLARE_API_TOKEN` | All CF-touching workflows | Must have D1 write + Worker deploy permissions |
| `CLOUDFLARE_ACCOUNT_ID` | `clickup-snapshot.yml`, `load-snapshot-to-d1.yml`, `refresh-products.yml`, `backfill-transitions.yml` | Value: `8303d11002766bf1cc36bf2f07ba6f20` |
| `CLOUDFLARE_D1_DATABASE_ID` | Same as above | Value: `c37aeb36-e16e-416b-b699-c910f6f8dc10` |
| `CLICKUP_TOKEN` | `clickup-snapshot.yml`, `backfill-transitions.yml` (with `fetch_history=true`), webhook workflows | ClickUp personal API token; no `Bearer` prefix needed in ClickUp API calls |
| `CLICKUP_WORKSPACE_ID` | `clickup-snapshot.yml`, `create-webhook.yml`, `list-webhook.yml` | Value: `2298436` |
| `CLICKUP_WEBHOOK_SECRET` | `deploy-worker.yml` | HMAC-SHA256 key; pushed to Worker during every deploy. If unset, webhooks are accepted without validation. |
| `OPENROUTER_API_KEY` | `deploy-worker.yml` | Pushed to Worker during every deploy. `/query` returns 500 if absent. |
| `QUERY_SECRET` | `deploy-worker.yml` | Pushed to Worker during every deploy. If unset, `/query` is open to anyone with the URL. |

---

## Coolify — Plane app deployment

Plane (the project management app itself) is deployed on a VPS managed by Coolify.

**Coolify API:**
```
Base URL: http://178.156.180.212:8000/api/v1
Auth: Bearer 1|mlVx9mbwsN1Sga6eLtJEvmPioy6Sra9AnepnCe3K7d0a2927
Server UUID: onwp0kd7w1w74w9yeotnoihp
```

**List applications:**
```bash
curl -s "http://178.156.180.212:8000/api/v1/applications" \
  -H "Authorization: Bearer 1|mlVx9mbwsN1Sga6eLtJEvmPioy6Sra9AnepnCe3K7d0a2927"
```

### Deployment decisions (locked)

| Component | Decision |
|-----------|----------|
| File storage | Cloudflare R2 (MinIO disabled) |
| PostgreSQL / Redis / RabbitMQ | Bundled Plane defaults |
| Gunicorn workers | `GUNICORN_WORKERS=2` (shared server with Twenty and OpenClaw) |
| Reverse proxy | Coolify-managed Caddy — handles SSL automatically |

### R2 storage configuration

Set these environment variables in Coolify for the Plane application (replaces MinIO):

```
AWS_S3_ENDPOINT_URL=https://8303d11002766bf1cc36bf2f07ba6f20.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=<r2_access_key>
AWS_SECRET_ACCESS_KEY=<r2_secret_key>
AWS_S3_BUCKET_NAME=plane-uploads
```

Plane uses `django-storages` with boto3, which picks up S3-compatible configuration automatically.

### Pre-deploy checklist

Before deploying Plane via Coolify:
1. Remove the `plane-minio` service from `docker-compose.yml`.
2. Set the three R2 environment variables above in Coolify.
3. Set `GUNICORN_WORKERS=2`.
4. Verify the `plane-uploads` R2 bucket exists.

### Status

As of the last update to this document, Plane deployment is pending completion of Round 3 interviews. The Coolify server and R2 bucket are provisioned; the application has not yet been deployed.

---

## What is NOT automated

The following operations require manual steps and have no automated workflow:

1. **Adding a new GitHub secret.** Must be done via `gh secret set` or the GitHub UI. Workflows cannot create their own secrets.

2. **Creating the Cloudflare API token.** Requires the Cloudflare dashboard. The token must have `D1:Edit` and `Workers Scripts:Edit` permissions scoped to account `8303d11002766bf1cc36bf2f07ba6f20`.

3. **Creating the R2 bucket `plane-uploads`.** One-time via Cloudflare dashboard or `wrangler r2 bucket create plane-uploads`.

4. **Creating the D1 database.** The `clickup-events` database already exists. If recreating: `wrangler d1 create clickup-events`, then update `database_id` in `wrangler.toml`.

5. **Updating the hardcoded webhook ID** in `update-webhook.yml` and `update-webhook-events.yml` after creating a new webhook. The ID `b114d599-aa9a-4069-b08f-a4bf0ac4fe20` is hardcoded in both files.

6. **Adding a new interview respondent.** Requires editing `RESPONDENTS` in `integrations/worker/src/index.js` and deploying the Worker.

7. **Configuring Plane on Coolify.** No workflow exists — must be done through the Coolify UI or REST API.

8. **Downloading snapshot artifacts for local analysis.** Must be done manually:
   ```bash
   gh run download <run-id> --repo u2giants/plane --dir scripts/snapshot_output/
   ```

9. **Rotating secrets.** Generate new values externally, update via `gh secret set`, then redeploy the Worker (`gh workflow run deploy-worker.yml`) so the new secrets are pushed to Cloudflare.
