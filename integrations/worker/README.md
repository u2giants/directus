# Cloudflare Worker — plane-integrations

**URL:** `https://plane-integrations.u2giants.workers.dev`

Single-file Worker (`src/index.js`) with no npm dependencies. Deployed automatically when `integrations/worker/**` changes on `main`.

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | None | Liveness: returns `{"status":"ok","ts":"..."}` |
| POST | `/clickup/webhook` | HMAC-SHA256 header | Receives ClickUp events → D1 |
| POST | `/query` | Optional bearer token | Natural language → SQL → plain English answer |
| GET | `/interview?who=<name>` | None | Per-respondent Q&A UI (jessica / liz / jen) |
| POST | `/interview/answer` | None | Submit an answer (form POST from the UI) |
| GET | `/interview/responses` | None | Admin view of all Q&A responses |

## Required secrets

Set via `wrangler secret put` or pushed by `deploy-worker.yml`:

| Secret | Effect if missing |
|--------|------------------|
| `CLICKUP_WEBHOOK_SECRET` | All webhooks accepted without HMAC validation |
| `OPENROUTER_API_KEY` | `/query` returns 500 |
| `QUERY_SECRET` | `/query` is open (no auth) |

## D1 binding

The Worker accesses D1 as `env.DB` (binding name `DB`, database `clickup-events`). The binding is declared in `wrangler.toml`.

## Deploy

```bash
# Automatic: push any change to integrations/worker/** on main
# Manual:
gh workflow run deploy-worker.yml --repo u2giants/plane
```
