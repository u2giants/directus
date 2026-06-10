# AGENTS.md

Canonical operating guide for the **poppim** repo. Read this first; it routes you to everything else.

## 1. Project summary

**poppim** is POP Creations' project-management / product-information system. It replaces ClickUp for two product lines — **POP Creations** (licensed home decor, 17-stage licensor pipeline) and **Spruce Line** (generic, 11-stage). It is built on **self-hosted Directus** (a headless data platform), **live at https://pm.designflow.app**. Non-technical staff (PM, creative directors, sales) work in Directus **Data Studio** (Kanban boards, forms, field-level permissions) with **zero custom front-end** for now. Built by a non-programmer + AI agents, so the system is **configuration + Flows over custom code**.

The repo also still contains the **legacy ClickUp analytics** — a live Cloudflare Worker (`plane-integrations`) + Python snapshot scripts that feed a D1 database and a natural-language query endpoint. This will be repurposed to feed the PM system's AI assistant from Directus webhooks; it is NOT the PM system itself.

## 2. Multi-model AI note

There is no universal ignore-file standard across AI coding tools. `.claudeignore` works for Claude Code. When using any other AI tool, paste this file as your first message and follow the instructions in the "What to ignore" section.

## 3. Documentation map: what to read for each task

Always start with **`AGENTS.md`**. Then load only what the task needs:

| Task / question | Read these | Usually skip |
|---|---|---|
| Quick orientation | `README.md`, `AGENTS.md` | the `docs/` deep dives |
| Understand the business/process | `docs/business-process.md` | software docs |
| Why Directus (vs Plane/Twenty) | `docs/platform-decision-report.md`, `docs/plane-free-edition-gaps.md` | — |
| Build/extend the PM system | `AGENTS.md`, `docs/data-model.md`, `docs/pm-system-design.md`, `pm-system/README.md` | legacy analytics docs |
| Change the Directus schema / Flows / roles | `docs/data-model.md`, `pm-system/apply-schema.mjs` | deployment docs unless infra changes |
| Deploy / domain / env / runtime config | `AGENTS.md` §13, `docs/deployment.md` (legacy worker), `pm-system/docker-compose.yml` | — |
| Migration import (ClickUp → Directus) | `docs/data-model.md` §7, `BUSINESS_INTELLIGENCE.md`, `docs/legacy/*` (when archived) | — |
| Work on the legacy worker | `integrations/worker/README.md`, `BUSINESS_INTELLIGENCE.md` | PM docs |
| Continue unfinished work | `AGENTS.md` §15, `HANDOFF.md` if present | — |
| Claude Code session | `CLAUDE.md`, then this file | — |

## 4. Repository structure

| Path | What | Ownership |
|---|---|---|
| `pm-system/` | **The Directus PM system** — `apply-schema.mjs` (schema/config migration), `seed-and-verify.mjs`, `docker-compose.yml`, `schema-snapshot.yaml`, `README.md` | project-owned |
| `docs/` | Business + design docs (business-process, data-model, pm-system-design, platform-decision-report, directus-execution-plan, plane-free-edition-gaps) | project-owned |
| `integrations/worker/` | Legacy `plane-integrations` Cloudflare Worker (ClickUp webhooks + NL query) — live | project-owned (legacy) |
| `scripts/` | Legacy Python: ClickUp snapshot, D1 product-table builder, analysis | project-owned (legacy) |
| `BUSINESS_INTELLIGENCE.md` | Data-evidence layer (volumes, SLA tables, pipeline defs) | project-owned |
| root `*.md` (DB_ANALYSIS, SCHEMA_DESIGN, DATA_*, WEBHOOK_SETUP, SETUP_INSTRUCTIONS, etc.) | **legacy ClickUp-era docs** — slated to move to `docs/legacy/` (pending approval) | project-owned (legacy) |

No vendor/framework code in this repo (Directus runs as a stock image; we don't vendor it).

## 5. Prime Directive: custom-code boundary

Our custom code lives here:
- `pm-system/` — Directus schema/config (apply-schema.mjs), seed/verify, compose
- `docs/`, `AGENTS.md`, `CLAUDE.md`, `README.md`
- `integrations/worker/src/` — the legacy worker
- `.github/workflows/` — CI/CD

**Directus core is a stock image — never fork it.** All Directus customization is **configuration** (collections/fields/states/policies/Flows via `apply-schema.mjs`) or, later, **drop-in extensions** under a future `pm-system/extensions/`. Do not hand-edit the running container or the database except via the approved migration path (`apply-schema.mjs`).

## 6. Core modification inventory

| File | Change | Why | Risk during upgrades |
|---|---|---|---|
| (none in third-party code) | Directus is a stock image; no upstream fork | — | — |
| Coolify DB `service_applications.id=15` `fqdn` | Set to `https://pm.designflow.app:8055` directly in Coolify's Postgres | Coolify's public API has no endpoint to set a **service sub-app** custom domain; the field the UI edits had to be set in the datastore (see §11) | If the service is recreated from scratch, re-apply; check the Traefik `Host()` label |

## 7. Task-to-file navigation

| Task | Edit | Do NOT touch |
|---|---|---|
| Add/modify a collection, field, relation, role, policy, or Flow | `pm-system/apply-schema.mjs` (then run it + restart Directus) | the running container; Coolify DB |
| Change the data model spec | `docs/data-model.md` | — |
| Change deployed infra (image, services, volumes) | `pm-system/docker-compose.yml` (authoritative copy) + reconcile in Coolify | prod containers directly |
| Change runtime config (env, domain, secrets) | **Coolify** (runtime owner) — not the repo | repo `.env` (there is none in prod) |
| Migrate data from ClickUp | new script under `pm-system/migration/` reading D1 → Directus API (`external_id`) | applied data |

## 8. Data model and external identifiers

PM domain model: 14 Directus collections (POP 2-tier `project→product`, Spruce 3-tier `design_collection→project→product`, plus `design` library, `stage_history` SLA ledger, and reference collections). Full spec: `docs/data-model.md`. Identifiers are **permanent**:

| Entity / System | Identifier | Notes |
|---|---|---|
| Public URL | `https://pm.designflow.app` | Directus Data Studio + API |
| Coolify project "POP PIM" | `jdq36h5dq74o6ddhich9l796` | env `production` = `ntcveqoln0n5dx65tbdj5yo5` |
| Coolify service "poppim" | `nzli85mk3luzb6u7cnq5fidu` | the Directus+Postgres stack |
| Service sub-app `poppim-app` | `qmz2drry693qogr9120gaj1g` (DB `service_applications.id=15`) | holds the custom-domain `fqdn` |
| Coolify server (this VPS) | `onwp0kd7w1w74w9yeotnoihp` | localhost, `178.156.180.212` |
| Cloudflare zone `designflow.app` | `921eb133a3f7d5802780445b283f84ce` | `pm` A-record → `178.156.180.212`, DNS-only |
| Entra app "POP PIM — Directus SSO" | appId `55bf6302-0d58-4246-b0e2-970b8371fd70` | tenant `1caeb1c0-a087-4cb9-b046-a5e22404f971`; redirect `https://pm.designflow.app/auth/login/microsoft/callback` |
| Directus admin | `Albert@popcre.com` | password in Coolify env `DX_ADMIN_PASSWORD` |
| Legacy worker | `plane-integrations` | `plane-integrations.u2giants.workers.dev`; D1 `c37aeb36-e16e-416b-b699-c910f6f8dc10` — **do not rename** |

## 9. Container and service inventory

| Container | Purpose | Managed by | Image |
|---|---|---|---|
| `poppim-app-nzli85mk3luzb6u7cnq5fidu` | Directus (API + Data Studio UI), port 8055 | Coolify (service `nzli…`) | `directus/directus:11` |
| `poppim-db-nzli85mk3luzb6u7cnq5fidu` | Postgres (Directus DB) | Coolify | `postgres:16-alpine` |
| volume `poppim-pgdata` | Postgres data (persistent) | Coolify | — |

Naming follows the standard (`poppim-app`, `poppim-db`); Coolify appends the service uuid. Other containers on this VPS (`twenty-*`, `popdam-*`, `coolify-*`) belong to other projects — leave them alone.

## 10. What to ignore

`node_modules/`, `dist/`, `.cache/`, `coverage/`, `scripts/__pycache__/`, `pm-system/schema-snapshot.yaml` (generated reference, large), `*.dump`. The local secrets file `/home/ai/.poppim-deploy.env` is **not** in the repo and must never be committed.

## 11. Intentional quirks and non-obvious decisions

### Custom domain set in Coolify's database
**Looks like:** someone hand-edited Coolify's Postgres (`service_applications.id=15.fqdn`).
**Actually:** Coolify v4's public API exposes no endpoint to set a **service sub-application's** custom domain; the `SERVICE_FQDN_*` env var is regenerated from that `fqdn` field on every deploy, so editing the env didn't stick. The `fqdn` was set to `https://pm.designflow.app:8055` (Coolify encodes `https://<host>:<container-port>`) in Coolify's own datastore — the same field the Coolify UI edits.
**Why:** to bind the real domain + Let's Encrypt cert.
**Do not change because:** reverting it drops the site back to the `*.sslip.io` default and breaks SSL on `pm.designflow.app`. If recreating the service, redo this and verify the Traefik `Host(`pm.designflow.app`)` label appears.

### Event-triggered Flows register only at Directus startup
**Looks like:** a created Flow that doesn't fire.
**Actually:** Directus registers event-hook Flows at boot. After `apply-schema.mjs` creates/changes a Flow, **restart Directus** (Coolify restart) or it won't fire. Also: the event-trigger option key is `collections` (plural), and there is no `{{$now}}` template — `stage_history.changed_at` uses the `date-created` special.

### Collections need `schema: {}` on create
Creating a Directus collection via API without `schema: {}` makes a *folder* (no table). `apply-schema.mjs` handles this.

## 12. Credentials and environment

All runtime secrets live in **Coolify** (service `nzli…` env). None are in the repo. A local convenience copy is at `/home/ai/.poppim-deploy.env` (chmod 600, outside repo) — safe to delete once Coolify is the trusted source.

| Variable | Purpose | Stored | Dev | Prod |
|---|---|---|---|---|
| `KEY`, `SECRET` | Directus crypto keys | Coolify | yes | yes |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First Directus admin | Coolify | yes | yes |
| `DB_*` (`DX_DB_PASSWORD`) | Postgres connection | Coolify | yes | yes |
| `LICENSE_KEY` | Directus OIG license (lifts free-tier caps) | Coolify | — | yes |
| `AUTH_MICROSOFT_CLIENT_ID/SECRET`, `MS_TENANT_ID` | Entra OIDC SSO | Coolify | — | yes |
| `PUBLIC_URL` | `https://pm.designflow.app` | Coolify | — | yes |

Cloudflare DNS token and Coolify API token are operator credentials (in `CLAUDE.md` for Coolify); not app runtime config.

## 13. Deployment

**Current reality (a §25 repo-specific model — Directus is a stock image, so there is no custom image build yet):**
- **Repo** holds the authoritative compose (`pm-system/docker-compose.yml`) and the schema migration (`pm-system/apply-schema.mjs`).
- **Coolify** runs the stock `directus/directus:11` + `postgres:16-alpine` as service `nzli85mk3luzb6u7cnq5fidu` and owns all runtime config (env, domain, SSL, restart).
- **Migration path** = `apply-schema.mjs` run against the instance (idempotent), then **restart Directus** so Flows register.
- **No GitHub Actions pipeline yet** (nothing to build). When we add custom Directus **extensions** (Vue/JS), introduce `GitHub Actions → build custom Directus image → GHCR → trigger Coolify`, per the standard.
- **SSH** is not a deployment path; it was used once for initial setup/verification and the Coolify-DB fqdn fix (§11).
- **Rollback:** redeploy via Coolify; the Postgres volume `poppim-pgdata` holds all data. There is no automated DB backup yet (see §15).

To re-apply schema after a change:
```bash
DX_URL=https://pm.designflow.app DX_ADMIN_EMAIL=Albert@popcre.com DX_ADMIN_PASSWORD=*** node pm-system/apply-schema.mjs
# then restart the Directus service in Coolify
```

## 14. Critical incidents

### 2026-06-10 — Initial production deploy of the Directus PM system
Deployed Directus + Postgres on Coolify at `pm.designflow.app`. Two non-obvious blockers solved: (1) `docker_compose_raw` must be **base64** in the Coolify create-service API; (2) the custom domain had to be set via the Coolify **DB** `service_applications.fqdn` field (no API endpoint) — see §11. Schema applied, SSO + field-level perms + stage-history Flow verified on production. No data loss; greenfield.

## 15. Pending work

| Status | Item | Next action |
|---|---|---|
| open | Repo cleanup | Archive legacy root docs → `docs/legacy/`, delete dead ones (awaiting Albert's OK from the earlier proposal) |
| open | `apply-schema.mjs` creates a test Designer user | Remove user creation from `apply-schema.mjs` (keep it in `seed-and-verify.mjs` only) — it was deleted from prod manually |
| open | Postgres backups | Add scheduled `pg_dump` of `poppim-db` + document retention |
| open | Phase-1.x data model | M2M relations (multi-buyer seam), remaining Flows (dormant/SLA/notify), per-role saved Views |
| open | ClickUp → Directus migration import | Script under `pm-system/migration/` reading D1 → Directus API with `external_id` |
| open | Orphaned Entra secret | One unused client secret exists on the SSO app (lost to a capture bug); remove for hygiene |
| open | R2 file storage | Add R2 env to Coolify when needed (Directus uses local storage now; full design files stay on NAS) |
| open | Reconcile repo compose with deployed | Update `pm-system/docker-compose.yml` to match the deployed Coolify service (SSO/license/FQDN) |
| done | Deploy Directus PM to pm.designflow.app | Live + verified 2026-06-10 |
| done | Repo + folder renamed plane → poppim | — |
| done | Canonical standard saved | `/home/ai/Albert-AI-Standards/NEW-PROJECT-PROMPT.md` |
