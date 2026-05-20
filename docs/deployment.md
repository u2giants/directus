# Deployment

## Worker deployment

The Worker deploys automatically on every push to `main` that touches `integrations/worker/**` or `.github/workflows/deploy-worker.yml`. The workflow:

1. Installs Wrangler
2. Runs `wrangler deploy`
3. Pushes three Worker secrets: `CLICKUP_WEBHOOK_SECRET`, `OPENROUTER_API_KEY`, `QUERY_SECRET`
4. Runs a health check: `curl .../health | grep -q "ok"`

**To deploy manually:**
```bash
gh workflow run deploy-worker.yml --repo u2giants/plane
```

**To verify the live Worker:**
```bash
curl https://plane-integrations.u2giants.workers.dev/health
```

**Note:** Secret steps are skipped silently if the corresponding GitHub secret is not set. If `/query` returns 500, check that `OPENROUTER_API_KEY` is configured.

---

## Schema migration

The schema is defined in `scripts/migrate_robust_schema.sql`. All statements use `CREATE ... IF NOT EXISTS` and `INSERT OR IGNORE` — safe to re-run against a live database.

**To apply the migration:**
```bash
gh workflow run migrate-database.yml --repo u2giants/plane
```

This runs `wrangler d1 execute clickup-events --file ../../scripts/migrate_robust_schema.sql --remote` and then prints all table and view names to verify.

**To apply locally (if you have Wrangler and the CF API token):**
```bash
cd integrations/worker
wrangler d1 execute clickup-events --file ../../scripts/migrate_robust_schema.sql --remote
```

---

## ClickUp snapshot pipeline

The full data refresh pipeline is three stages. They can be run independently.

### Stage 1 — Snapshot ClickUp

Runs **nightly at 02:00 UTC** automatically. Also triggerable manually:

```bash
gh workflow run clickup-snapshot.yml --repo u2giants/plane
# Include closed tasks explicitly:
gh workflow run clickup-snapshot.yml --repo u2giants/plane -f include_closed=true
```

Produces gzip-compressed JSON files in `snapshot_output/`, uploaded as a GitHub Actions artifact retained for 30 days. Supports manifest-based resume — if the run fails partway, re-running will continue from the last completed list.

### Stage 2 — Load snapshot into D1

Manual trigger only. Loads the latest (or a specific) snapshot artifact into D1:

```bash
# Load latest successful snapshot
gh workflow run load-snapshot-to-d1.yml --repo u2giants/plane

# Load a specific snapshot run
gh workflow run load-snapshot-to-d1.yml --repo u2giants/plane -f run_id=12345678
```

After loading, this workflow also runs `build_products_table.py` to rebuild `products`.

### Stage 3 — Rebuild products table

Runs **nightly at 06:00 UTC** automatically (after the snapshot at 02:00). Also triggerable manually:

```bash
gh workflow run refresh-products.yml --repo u2giants/plane
```

This only runs `build_products_table.py` — it does not download a new snapshot. Use this when you've made changes to `build_products_table.py` or `checkpoint_map` and want to rebuild `products` from current D1 data without a full snapshot reload.

---

## Backfilling status transitions

For richer pipeline analytics, status transitions can be backfilled from the ClickUp history API:

```bash
# Synthesized backfill only (fast — derives from snapshot data)
gh workflow run backfill-transitions.yml --repo u2giants/plane

# Full backfill including ClickUp /task/{id}/history API (slow — hours; requires CLICKUP_TOKEN)
gh workflow run backfill-transitions.yml --repo u2giants/plane -f fetch_history=true

# Backfill a single list only
gh workflow run backfill-transitions.yml --repo u2giants/plane -f list_id=13194624
```

Rows written by this workflow have `source = 'api_history'` and have real `from_status` values. These are the only `status_transitions` rows with meaningful `from_status` for most products.

---

## Webhook management

### List current webhooks
```bash
gh workflow run list-webhook.yml --repo u2giants/plane
```
Then check the run logs.

### Create a new webhook
```bash
gh workflow run create-webhook.yml --repo u2giants/plane
```
After creation, copy the webhook secret from the run logs and set it as `CLICKUP_WEBHOOK_SECRET` in GitHub secrets. Then redeploy the Worker so the secret reaches Cloudflare.

### Re-enable the existing webhook
```bash
gh workflow run update-webhook.yml --repo u2giants/plane
```
This targets the hardcoded webhook ID `b114d599-aa9a-4069-b08f-a4bf0ac4fe20`. If the webhook was recreated with a new ID, update the workflow file before running.

### Update webhook event subscriptions
```bash
gh workflow run update-webhook-events.yml --repo u2giants/plane
```
Applies the current event list (22 task/list/folder/space events + 6 goal events) to the existing webhook.

---

## Deploying Plane (build phase)

Plane will be deployed on Coolify once Round 3 interviews are complete and configuration decisions are finalized. Key decisions already made:

| Component | Decision |
|-----------|----------|
| File storage | Cloudflare R2 (not bundled MinIO) |
| PostgreSQL / Redis / RabbitMQ | Bundled Plane defaults |
| Gunicorn workers | `GUNICORN_WORKERS=2` (shared server with Twenty + OpenClaw) |
| Reverse proxy | Coolify-managed Caddy (automatic SSL) |

R2 configuration (replaces MinIO with 3 env vars set in Coolify):
```
AWS_S3_ENDPOINT_URL=https://8303d11002766bf1cc36bf2f07ba6f20.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID={r2_access_key}
AWS_SECRET_ACCESS_KEY={r2_secret_key}
AWS_S3_BUCKET_NAME=plane-uploads
```

Remove the `plane-minio` service from `docker-compose.yml` before deploying. Plane uses `django-storages` with boto3 and picks up S3-compatible config automatically.

Coolify REST API:
```
Base URL: http://178.156.180.212:8000/api/v1
Auth: Bearer 1|mlVx9mbwsN1Sga6eLtJEvmPioy6Sra9AnepnCe3K7d0a2927
Server UUID: onwp0kd7w1w74w9yeotnoihp
```
