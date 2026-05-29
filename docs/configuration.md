# Configuration

This document covers every environment variable, secret, and configuration value used by the system. It is derived directly from the Worker source (`integrations/worker/src/index.js`) and the GitHub Actions workflows.

---

## Worker secrets

These are set in Cloudflare's encrypted secret store via `wrangler secret put <NAME>`. They are never stored in `wrangler.toml` or committed to the repository.

The `deploy-worker.yml` workflow pushes all three automatically on every deploy, reading them from GitHub repository secrets. If a GitHub secret is absent, the workflow step is skipped silently — the Worker will be missing that secret until it is added and a redeploy is triggered.

| Secret | Sensitive | Required | Where set | Purpose |
|--------|-----------|----------|-----------|---------|
| `CLICKUP_WEBHOOK_SECRET` | Yes | Recommended | Cloudflare Worker secrets (pushed by `deploy-worker.yml`) | HMAC-SHA256 key for validating incoming ClickUp webhook signatures. The Worker checks the `x-signature` request header against an HMAC of the raw body using this key. If unset, the Worker skips validation and accepts all requests to `/clickup/webhook` without authentication. |
| `OPENROUTER_API_KEY` | Yes | Required for `/query` | Cloudflare Worker secrets (pushed by `deploy-worker.yml`) | API key for the OpenRouter service. The `/query` endpoint sends two requests to `https://openrouter.ai/api/v1/chat/completions` — one for SQL generation, one for answer formatting. If this secret is not set, `/query` returns `500: OPENROUTER_API_KEY not configured on this Worker`. |
| `QUERY_SECRET` | Yes | Optional | Cloudflare Worker secrets (pushed by `deploy-worker.yml`) | Bearer token for protecting the `/query` endpoint. The Worker checks `Authorization: Bearer <value>` on every `POST /query` request. If this secret is unset or empty, the endpoint is open — anyone who knows the URL can run natural language queries against the database. |

**How the Worker reads them:**

```js
env.CLICKUP_WEBHOOK_SECRET   // webhook HMAC validation
env.OPENROUTER_API_KEY       // OpenRouter API calls
env.QUERY_SECRET             // /query bearer token check
env.DB                       // D1 database binding (not a secret — see below)
```

**To set or rotate a secret manually:**

```bash
cd integrations/worker
wrangler secret put OPENROUTER_API_KEY
# prompts for value; encrypts and stores it in Cloudflare
```

---

## D1 database binding

The Worker accesses D1 through a binding named `DB`, declared in `wrangler.toml`. This is not a secret — it is a static infrastructure reference.

```toml
[[d1_databases]]
binding       = "DB"
database_name = "clickup-events"
database_id   = "c37aeb36-e16e-416b-b699-c910f6f8dc10"
```

The Worker uses `env.DB` everywhere it reads from or writes to D1:

```js
env.DB.prepare(sql).all()     // SELECT queries
env.DB.prepare(sql).bind(...).run()  // INSERT / UPDATE
```

**The binding is read-only from a configuration standpoint** — the binding name `DB` is hardcoded throughout the Worker. Renaming the binding would require updating every `env.DB` reference in `index.js`.

---

## wrangler.toml — full configuration

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

| Field | Value | Purpose |
|-------|-------|---------|
| `name` | `plane-integrations` | Worker name in Cloudflare dashboard; also determines the `*.workers.dev` subdomain |
| `main` | `src/index.js` | Entry point relative to `integrations/worker/` |
| `compatibility_date` | `2024-09-23` | Cloudflare runtime compatibility flag — governs which breaking changes are enabled |
| `account_id` | `8303d11002766bf1cc36bf2f07ba6f20` | Cloudflare account. Not sensitive (visible in URLs), but required for Wrangler to target the right account |
| `DB` binding | database `c37aeb36-...` | Maps `env.DB` in the Worker to the `clickup-events` D1 database |

No `[vars]` section exists — runtime variables are all secrets, not plaintext vars.

---

## GitHub Actions secrets

All workflows read credentials from repository secrets at `u2giants/plane`. Set them at:
**GitHub → repo Settings → Secrets and variables → Actions → Repository secrets**

| Secret | Sensitive | Used by workflows | Purpose |
|--------|-----------|-------------------|---------|
| `CLOUDFLARE_API_TOKEN` | Yes | `deploy-worker.yml`, `migrate-database.yml`, `populate-list-space-map.yml` | Cloudflare API token with Worker deploy + D1 write permissions. Passed as `CLOUDFLARE_API_TOKEN` env var to `wrangler`. Required for any workflow that touches Cloudflare. |
| `CLOUDFLARE_ACCOUNT_ID` | No | `clickup-snapshot.yml`, `load-snapshot-to-d1.yml`, `refresh-products.yml`, `backfill-transitions.yml` | Cloudflare account ID (`8303d11002766bf1cc36bf2f07ba6f20`). Used by Python scripts to construct D1 REST API URLs. Not secret but stored here to keep scripts environment-agnostic. |
| `CLOUDFLARE_D1_DATABASE_ID` | No | `clickup-snapshot.yml`, `load-snapshot-to-d1.yml`, `refresh-products.yml`, `backfill-transitions.yml` | D1 database ID (`c37aeb36-e16e-416b-b699-c910f6f8dc10`). Used by Python scripts to target the correct database via the Cloudflare REST API. |
| `CLICKUP_TOKEN` | Yes | `clickup-snapshot.yml`, `backfill-transitions.yml` (with `fetch_history=true`), `create-webhook.yml`, `list-webhook.yml`, `update-webhook.yml`, `update-webhook-events.yml` | ClickUp personal API token. Passed directly as the `Authorization` header value in ClickUp API calls — no `Bearer` prefix. Required for snapshot and webhook management workflows. |
| `CLICKUP_WORKSPACE_ID` | No | `clickup-snapshot.yml`, `create-webhook.yml`, `list-webhook.yml` | ClickUp team/workspace ID (`2298436`). Used in API URL paths like `/api/v2/team/{id}/webhook`. Not sensitive but stored as a secret for consistency. |
| `CLICKUP_WEBHOOK_SECRET` | Yes | `deploy-worker.yml` | The HMAC secret that ClickUp signs webhook payloads with. Pushed to Cloudflare as a Worker secret during every deploy. Must match the value registered with ClickUp when the webhook was created (via `create-webhook.yml`). |
| `OPENROUTER_API_KEY` | Yes | `deploy-worker.yml` | OpenRouter API key. Pushed to Cloudflare as a Worker secret during every deploy. If absent from GitHub secrets, the Worker will be deployed without this key and `/query` will return 500 until it is added and the Worker is redeployed. |
| `QUERY_SECRET` | Yes | `deploy-worker.yml` | Bearer token protecting `/query`. Pushed to Cloudflare as a Worker secret during every deploy. If absent, the `deploy-worker.yml` log will say "QUERY_SECRET not set — /query endpoint is open" and the endpoint will accept unauthenticated requests. |

**Note on `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_DATABASE_ID`:** These are not sensitive values — they are visible in dashboard URLs. They are stored as secrets purely so the same workflow files work without hardcoded values.

---

## Worker code constants

These values are hardcoded directly in `integrations/worker/src/index.js`. They cannot be changed at runtime — changing them requires editing the file and redeploying the Worker.

| Constant | Value | Purpose |
|----------|-------|---------|
| `OPENROUTER_MODEL` | `deepseek/deepseek-v3.2` | The model used for both SQL generation and plain-English answer formatting in `/query`. Change this to substitute a different model without touching the API auth logic. |
| `OPENROUTER_URL` | `https://openrouter.ai/api/v1/chat/completions` | OpenRouter API endpoint. The Worker uses the OpenAI-compatible chat completions format. |
| `KNOWN_LICENSORS` | `Disney, Marvel, Warner Bros, WB, Paramount, SEGA, Universal, Nickelodeon, DreamWorks, Hasbro, Mattel` | When a comment contains a Windows file path (e.g., `C:\Marvel\...`), the Worker extracts the top-level folder and checks it against this list to populate `task_comments.licensor_hint`. |
| `LICENSOR_KW` | 30 keyword phrases | Phrases that indicate a comment is driven by licensor feedback (e.g., `"per licensor"`, `"disney approved"`). Drives `task_comments.comment_driver = 'licensor'`. |
| `FACTORY_KW` | 16 keyword phrases | Phrases that indicate factory/vendor feedback (e.g., `"factory says"`, `"qc issue"`). Drives `comment_driver = 'factory'`. |
| `RETAILER_KW` | 17 keyword phrases | Phrases that indicate buyer/retailer feedback (e.g., `"per target"`, `"buyer approved"`). Drives `comment_driver = 'retailer'`. |
| `RESPONDENTS` | `jessica`, `liz`, `jen` | The three registered interview respondents. Only keys present in this object get a working interview UI at `/interview?who=<key>`. All others see a "use the link you were sent" landing page. |

---

## Script constants

These values are hardcoded in Python scripts in `scripts/`. Change them in the source file; no redeploy is needed (scripts run in GitHub Actions or locally).

| Constant | File | Value | Purpose |
|----------|------|-------|---------|
| `ACTIVE_DAYS` | `build_products_table.py` | `180` | Products with `last_activity_at` within this many days get `is_active = 1` in the `products` table. |
| `INTERNAL_SPACES` | `build_products_table.py` | `{"designflow"}` | Space names excluded from the product pipeline. Products in these spaces get `is_internal = 1` and are filtered out of all product queries by default. |
| `D1_MAX_PARAMS` | `build_products_table.py`, `load_snapshot_to_d1.py` | `90` | Maximum bound parameters per D1 REST API call. Cloudflare's documented limit is 100; this value stays below it to avoid off-by-one failures with variable-width rows. |
| `PAGE_SIZE` | `build_products_table.py` | `500` | Number of rows fetched per SELECT page when reading from D1 during the products rebuild. |
| `WORKSPACE_ID` | `load_snapshot_to_d1.py` | `"2298436"` | ClickUp workspace ID stamped onto rows during snapshot load. Matches `CLICKUP_WORKSPACE_ID` in GitHub secrets. |

---

## Interview respondents

Registered in the `RESPONDENTS` object in `integrations/worker/src/index.js`. The interview page at `/interview?who=<key>` only works for keys present here — anything else shows a generic landing page.

| Key | Display name | Accent color | Background color |
|-----|-------------|-------------|-----------------|
| `jessica` | Jessica | `#4263eb` (indigo) | `#eef2ff` |
| `liz` | Liz | `#0ca678` (teal) | `#e6fcf5` |
| `jen` | Jen | `#e67700` (orange) | `#fff4e6` |

To add a respondent: add an entry to `RESPONDENTS`, then run `gh workflow run deploy-worker.yml --repo u2giants/plane`. Also insert their questions into `interview_questions` in D1 with `respondent = '<key>'`.

---

## Fixed IDs

These values appear across multiple files. Changing any of them requires updating every reference listed.

| Item | Value | Sensitive | Where referenced |
|------|-------|-----------|-----------------|
| Cloudflare account ID | `8303d11002766bf1cc36bf2f07ba6f20` | No | `wrangler.toml`, Python scripts (via `CLOUDFLARE_ACCOUNT_ID` env var), `CLAUDE.md`, `README.md` |
| D1 database ID | `c37aeb36-e16e-416b-b699-c910f6f8dc10` | No | `wrangler.toml`, Python scripts (via `CLOUDFLARE_D1_DATABASE_ID` env var), `CLAUDE.md`, `README.md` |
| ClickUp workspace/team ID | `2298436` | No | Python scripts, `CLAUDE.md`, `create-webhook.yml`, `list-webhook.yml` |
| ClickUp webhook ID | `b114d599-aa9a-4069-b08f-a4bf0ac4fe20` | No | `update-webhook.yml`, `update-webhook-events.yml` (hardcoded in the `curl` commands) |
| Worker hostname | `plane-integrations.u2giants.workers.dev` | No | `deploy-worker.yml` health check, `callLLM` `HTTP-Referer` header, webhook `endpoint` field |

---

## Configuration checklist — new environment setup

If standing up a fresh copy of this system:

**GitHub secrets to create (11 total):**
- [ ] `CLOUDFLARE_API_TOKEN` — token with Worker:Edit + D1:Edit permissions
- [ ] `CLOUDFLARE_ACCOUNT_ID` — `8303d11002766bf1cc36bf2f07ba6f20`
- [ ] `CLOUDFLARE_D1_DATABASE_ID` — `c37aeb36-e16e-416b-b699-c910f6f8dc10`
- [ ] `CLICKUP_TOKEN` — personal API token from ClickUp profile
- [ ] `CLICKUP_WORKSPACE_ID` — `2298436`
- [ ] `CLICKUP_WEBHOOK_SECRET` — obtain by running `create-webhook.yml` and copying from logs
- [ ] `OPENROUTER_API_KEY` — from openrouter.ai account
- [ ] `QUERY_SECRET` — generate any random string; used as a bearer token

**Cloudflare resources to create:**
- [ ] D1 database named `clickup-events` — note its ID for the secrets above
- [ ] Worker named `plane-integrations` — created automatically by first `wrangler deploy`

**Deploy order:**
1. Apply schema: `gh workflow run migrate-database.yml`
2. Deploy Worker: `gh workflow run deploy-worker.yml`
3. Register ClickUp webhook: `gh workflow run create-webhook.yml` → copy secret → update `CLICKUP_WEBHOOK_SECRET` → redeploy Worker
4. Run initial snapshot: `gh workflow run clickup-snapshot.yml -f include_closed=true`
5. Load snapshot: `gh workflow run load-snapshot-to-d1.yml`
