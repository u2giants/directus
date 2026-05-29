# plane — POP Creations / Spruce Line BI Integration

This is the data integration layer for a licensed consumer goods company (plush toys, apparel, accessories sold through Target, Walmart, etc.). It captures ClickUp product pipeline activity into Cloudflare D1, exposes a natural-language query interface for business analysis, and hosts an async interview UI for employee research. Used internally by the product and operations team.

## Start Here

New AI session or developer? Read `AGENTS.md` first. It covers context, operating rules, and what not to do.

---

## System architecture

```
ClickUp workspace (Team ID 2298436)
  │  webhooks — HMAC-SHA256 validated, 22 event types
  ▼
Cloudflare Worker — plane-integrations.u2giants.workers.dev
  │  src/index.js routes:
  │    GET  /health
  │    POST /clickup/webhook   → raw_events → status_transitions, task_comments, etc.
  │    POST /query             → natural language → SQL (deepseek via OpenRouter) → plain English
  │    GET  /interview         → async Q&A UI for employee interviews
  │
  ▼
Cloudflare D1 — clickup-events (c37aeb36-e16e-416b-b699-c910f6f8dc10)
  raw_events → specialized tables → products (materialized view, rebuilt nightly)

GitHub Actions (nightly)
  02:00 UTC  clickup-snapshot.yml    snapshot ClickUp workspace → artifacts
  06:00 UTC  refresh-products.yml    rebuild products + product_checkpoints from D1
```

**Deployed and active:** Cloudflare Worker, D1 database, webhook (ID `b114d599-aa9a-4069-b08f-a4bf0ac4fe20`), nightly pipelines.

**Not yet deployed:** Plane (self-hosted). Plane deployment is planned after employee interviews conclude.

---

## Quick commands

```bash
# Deploy worker manually
gh workflow run deploy-worker.yml --repo u2giants/plane

# Run full ClickUp snapshot
gh workflow run clickup-snapshot.yml --repo u2giants/plane

# Load latest snapshot into D1 + rebuild products table
gh workflow run load-snapshot-to-d1.yml --repo u2giants/plane

# Rebuild products table only (no new snapshot needed)
gh workflow run refresh-products.yml --repo u2giants/plane

# Apply schema migration
gh workflow run migrate-database.yml --repo u2giants/plane

# Health check
curl https://plane-integrations.u2giants.workers.dev/health

# Natural language query
curl -X POST https://plane-integrations.u2giants.workers.dev/query \
  -H "Authorization: Bearer $QUERY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"question": "Which licensors have the most overdue products?"}'

# Recent workflow runs
gh run list --repo u2giants/plane --limit 10
```

---

## Repository structure

```
u2giants/plane/
├── integrations/worker/
│   ├── src/index.js            Worker: webhook receiver, /query, /interview
│   └── wrangler.toml           Worker config and D1 binding
├── scripts/
│   ├── clickup_snapshot.py     Full workspace snapshot (via GH Actions)
│   ├── load_snapshot_to_d1.py  Loads snapshot JSON artifacts into D1
│   ├── build_products_table.py Rebuilds products + product_checkpoints
│   ├── fetch_task_activity.py  Backfills status_transitions from history
│   ├── migrate_robust_schema.sql  Full D1 schema (idempotent)
│   └── analysis/               Periodic analysis reports
├── .github/workflows/          All CI/CD and operational workflows
├── docs/                       Architecture, deployment, configuration, development guides
└── CLAUDE.md                   Claude Code session context (MCP tools, credentials)
```

---

## Infrastructure

| Component | Detail |
|-----------|--------|
| Cloudflare Worker | `plane-integrations` — auto-deploys on push to `integrations/worker/**` |
| Cloudflare D1 | `clickup-events` — ID `c37aeb36-e16e-416b-b699-c910f6f8dc10` |
| Cloudflare Account | `8303d11002766bf1cc36bf2f07ba6f20` (`u2giants`) |
| Coolify server | `178.156.180.212:8000` — reserved for Plane runtime when deployed |
| ClickUp workspace | Team ID `2298436` |

## Required Worker secrets

Set via `wrangler secret put` or GitHub Actions secrets:

| Secret | Purpose |
|--------|---------|
| `CLICKUP_WEBHOOK_SECRET` | HMAC validation of incoming webhooks |
| `OPENROUTER_API_KEY` | Powers `/query` via deepseek-v3.2 |
| `QUERY_SECRET` | Bearer token protecting `/query` (open if unset) |

---

## AGPL-3.0 note

Plane is AGPL-3.0. Internal single-company use has no practical impact. If this platform is ever offered as a service, customizations must be open-sourced.
