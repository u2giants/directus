# plane — POP Creations / Spruce Line PM Platform

## Start Here

If you are a new AI session or developer with no prior context, read these first in order:

1. `FUTURE_SESSION_START_HERE.md`
2. `BUSINESS_INTELLIGENCE.md`
3. `HANDOFF.md`
4. `DATA_ACCESS_GUIDE.md`

**Critical context:** The imported ClickUp data is not a flat list of products. It contains buyer/retailer/season project cards, child SKU execution tasks, and support tasks. Do not design the replacement system as if every ClickUp record is the same business object.

---

Custom self-hosted project management platform built on [Plane](https://github.com/makeplane/plane) (AGPL-3.0), customized to fit the real workflows of a licensed home decor product company.

**Current phase: Build** — ClickUp behavioral data collected, employee interviews in progress (Round 3). Plane will be deployed and configured once Round 3 interviews are complete.

---

## How the system works

```
ClickUp workspace
  │  webhooks (HMAC-SHA256)
  ▼
Cloudflare Worker — plane-integrations.u2giants.workers.dev
  │  writes to
  ▼
Cloudflare D1 — clickup-events (c37aeb36-e16e-416b-b699-c910f6f8dc10)
  │  raw_events → specialized tables → products (materialized, rebuilt nightly)
  │
  ├── POST /query        natural language → SQL → plain English (OpenRouter/deepseek)
  └── GET  /interview    async Q&A UI for employee interviews

GitHub Actions (nightly)
  02:00 UTC  clickup-snapshot.yml   → snapshot ClickUp → upload artifacts
  06:00 UTC  refresh-products.yml   → rebuild products + product_checkpoints tables
```

**Source of truth:** GitHub (`main` branch only — see [AI_OPERATING_RULES.md](AI_OPERATING_RULES.md)).
**Runtime config:** Coolify at `178.156.180.212:8000`.
**Production runtime:** Cloudflare Worker (auto-deployed on push to `integrations/worker/**`).

---

## Quick commands

```bash
# Deploy worker manually
gh workflow run deploy-worker.yml --repo u2giants/plane

# Run a full ClickUp snapshot
gh workflow run clickup-snapshot.yml --repo u2giants/plane

# Load latest snapshot into D1 + rebuild products table
gh workflow run load-snapshot-to-d1.yml --repo u2giants/plane

# Rebuild products table only (no new snapshot needed)
gh workflow run refresh-products.yml --repo u2giants/plane

# Apply schema migration
gh workflow run migrate-database.yml --repo u2giants/plane

# Check recent workflow runs
gh run list --repo u2giants/plane --limit 10

# Health check
curl https://plane-integrations.u2giants.workers.dev/health

# Query D1 directly
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/8303d11002766bf1cc36bf2f07ba6f20/d1/database/c37aeb36-e16e-416b-b699-c910f6f8dc10/query" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT COUNT(*) FROM products WHERE is_internal = 0"}'
```

---

## Documentation

| File | Contents |
|------|----------|
| [docs/architecture.md](docs/architecture.md) | System design, data flow, D1 schema, views |
| [docs/deployment.md](docs/deployment.md) | Deploy worker, run workflows, schema migration |
| [docs/configuration.md](docs/configuration.md) | All secrets, env vars, and configurable constants |
| [docs/development.md](docs/development.md) | Local setup, testing, querying D1, scripts |
| [FUTURE_SESSION_START_HERE.md](FUTURE_SESSION_START_HERE.md) | Orientation for new AI sessions |
| [BUSINESS_INTELLIGENCE.md](BUSINESS_INTELLIGENCE.md) | Full business context — pipeline, team, pain points, requirements |
| [DATA_ACCESS_GUIDE.md](DATA_ACCESS_GUIDE.md) | D1 table reference with sample queries |
| [HANDOFF.md](HANDOFF.md) | Plane design decisions pending Round 3 interviews |
| [AI_OPERATING_RULES.md](AI_OPERATING_RULES.md) | Rules for AI working in this repo |

---

## Repository structure

```
u2giants/plane/
├── integrations/
│   └── worker/
│       ├── src/index.js        Cloudflare Worker (webhook receiver + AI query + interview UI)
│       └── wrangler.toml       Worker config (account, D1 binding)
├── scripts/
│   ├── clickup_snapshot.py     Full ClickUp workspace snapshot (run via GH Actions)
│   ├── load_snapshot_to_d1.py  Loads snapshot JSON files into D1
│   ├── build_products_table.py Rebuilds products + product_checkpoints tables
│   ├── fetch_task_activity.py  Backfills status_transitions from snapshot + ClickUp history API
│   ├── migrate_robust_schema.sql  Full D1 schema (idempotent — safe to re-run)
│   └── analysis/               Periodic behavioral analysis reports
├── .github/workflows/          All CI/CD and operational workflows
├── .githooks/post-checkout     Enforces single-branch policy (main only)
├── docs/                       Developer documentation
└── CLAUDE.md                   Claude Code session context (MCP tool names, credentials)
```

---

## Infrastructure

| Component | Location | Notes |
|-----------|----------|-------|
| Cloudflare Worker | `plane-integrations` | Auto-deploys from `integrations/worker/**` on push to `main` |
| Cloudflare D1 | `clickup-events` | SQLite; ID `c37aeb36-e16e-416b-b699-c910f6f8dc10` |
| Cloudflare Account | `8303d11002766bf1cc36bf2f07ba6f20` | `u2giants` |
| Coolify server | `178.156.180.212:8000` | 8 vCPU / 16 GB / 240 GB; manages Plane runtime |
| ClickUp workspace | Team ID `2298436` | Source of product data |
| Webhook ID | `b114d599-aa9a-4069-b08f-a4bf0ac4fe20` | Active; 22 event types subscribed |

---

## AGPL-3.0 note

Plane is AGPL-3.0. Internal single-company use has no practical impact. If this platform is ever offered as a service to other companies, customizations must be open-sourced.
