# Configuration

## Worker secrets

Set via `wrangler secret put <NAME>` or automatically by `deploy-worker.yml` on each deploy.

| Secret | Required | Purpose |
|--------|----------|---------|
| `CLICKUP_WEBHOOK_SECRET` | Recommended | HMAC-SHA256 key for validating incoming ClickUp webhooks. If unset, all webhooks are accepted without validation. |
| `OPENROUTER_API_KEY` | Required for `/query` | OpenRouter API key. `/query` returns 500 if missing. |
| `QUERY_SECRET` | Optional | Bearer token protecting `/query`. If unset, the endpoint is open to anyone with the URL. |

---

## GitHub Actions secrets

All workflows read from repository secrets at `u2giants/plane`.

| Secret | Used by | Purpose |
|--------|---------|---------|
| `CLOUDFLARE_API_TOKEN` | All workflows touching CF | Deploys Worker via Wrangler; queries D1 |
| `CLOUDFLARE_ACCOUNT_ID` | Snapshot, load, refresh, backfill | Cloudflare account ID (`8303d11002766bf1cc36bf2f07ba6f20`) |
| `CLOUDFLARE_D1_DATABASE_ID` | Snapshot, load, refresh, backfill | D1 database ID (`c37aeb36-e16e-416b-b699-c910f6f8dc10`) |
| `CLICKUP_TOKEN` | `clickup-snapshot.yml`, backfill (with `fetch_history`) | ClickUp personal API token (no "Bearer" prefix in ClickUp API calls) |
| `CLICKUP_WORKSPACE_ID` | `clickup-snapshot.yml`, webhook workflows | ClickUp team ID (`2298436`) |
| `CLICKUP_WEBHOOK_SECRET` | `deploy-worker.yml` | Pushed to Worker as a secret during deploy |
| `OPENROUTER_API_KEY` | `deploy-worker.yml` | Pushed to Worker as a secret during deploy |
| `QUERY_SECRET` | `deploy-worker.yml` | Pushed to Worker as a secret during deploy |

---

## wrangler.toml

```toml
name            = "plane-integrations"
main            = "src/index.js"
compatibility_date = "2024-09-23"
account_id      = "8303d11002766bf1cc36bf2f07ba6f20"

[[d1_databases]]
binding       = "DB"
database_name = "clickup-events"
database_id   = "c37aeb36-e16e-416b-b699-c910f6f8dc10"
```

No runtime vars are in `wrangler.toml` — all secrets are stored in Cloudflare's encrypted secret store and pushed during deploy.

---

## Worker code constants

These are hardcoded in `integrations/worker/src/index.js`. Change them there and redeploy.

| Constant | Value | Purpose |
|----------|-------|---------|
| `OPENROUTER_MODEL` | `deepseek/deepseek-v3.2` | Model used for SQL generation and answer formatting |
| `OPENROUTER_URL` | `https://openrouter.ai/api/v1/chat/completions` | OpenRouter endpoint |
| `KNOWN_LICENSORS` | Disney, Marvel, WB, ... | Used to extract licensor hints from NAS file paths in comments |
| `LICENSOR_KW` / `FACTORY_KW` / `RETAILER_KW` | keyword lists | Drive `comment_driver` classification in `task_comments` |

---

## Script constants

These are hardcoded in Python scripts. Change them in the script file.

| Constant | File | Value | Purpose |
|----------|------|-------|---------|
| `ACTIVE_DAYS` | `build_products_table.py` | `180` | Products touched within this window get `is_active = 1` |
| `INTERNAL_SPACES` | `build_products_table.py` | `{"designflow"}` | Spaces excluded from product pipeline; get `is_internal = 1` |
| `D1_MAX_PARAMS` | `build_products_table.py`, `load_snapshot_to_d1.py` | `90` | Conservative bound-parameter limit per D1 REST API call |
| `PAGE_SIZE` | `build_products_table.py` | `500` | Rows per D1 SELECT page during rebuild |
| `WORKSPACE_ID` | `load_snapshot_to_d1.py` | `"2298436"` | ClickUp workspace ID stamped on loaded rows |

---

## Interview respondents

Registered in `RESPONDENTS` object in `integrations/worker/src/index.js`. Only respondents listed here get a working interview page — unlisted `?who=` values get the landing page.

| Key | Display name | Color |
|-----|-------------|-------|
| `jessica` | Jessica | `#4263eb` (indigo) |
| `liz` | Liz | `#0ca678` (teal) |
| `jen` | Jen | `#e67700` (orange) |

To add a respondent: add an entry to `RESPONDENTS` and deploy the Worker.

---

## Fixed IDs (do not change without updating all references)

| Item | Value | Where referenced |
|------|-------|-----------------|
| Cloudflare account ID | `8303d11002766bf1cc36bf2f07ba6f20` | `wrangler.toml`, scripts, `README.md` |
| D1 database ID | `c37aeb36-e16e-416b-b699-c910f6f8dc10` | `wrangler.toml`, scripts, `CLAUDE.md`, `README.md` |
| ClickUp workspace/team ID | `2298436` | Scripts, `CLAUDE.md`, webhook workflows |
| ClickUp webhook ID | `b114d599-aa9a-4069-b08f-a4bf0ac4fe20` | `update-webhook.yml`, `update-webhook-events.yml` (hardcoded) |
