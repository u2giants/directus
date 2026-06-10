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
| Host systemd timer `poppim-entra-sync.timer` (runs as `ai`, hourly) | Runs `pm-system/sync/entra-role-sync.mjs` on this VPS — NOT in Coolify | Intentionally keeps the Entra **directory-write** credential off the internet-facing Directus container; it lives only in mode-600 `/home/ai/.poppim-deploy.env` (see §11 Entra sync) | If the host is rebuilt, re-create the unit + timer (files under `/etc/systemd/system/poppim-entra-sync.*`) |

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
| Entra app "POP PIM — Graph Role Sync" | appId `a645fc70-fea9-4703-871c-900b97f898d7` | role-sync write creds (`GroupMember.ReadWrite.All`); secret in `/home/ai/.poppim-deploy.env` only |
| Entra role groups (`POP PIM ·`) | Administrator `085a0511-5afa-4b01-b38e-ae06e61ea879`, Sales `a4d4447a-2e8c-4594-9738-decadd5dc6c1`, Licensing `df5f7693-1dbc-4b12-9dae-b18570d593bb`, Designer `9d977745-d86c-4950-866d-211e0dd3fac7`, Viewer `6ab28eb2-3c4b-4c81-b746-2ad63def306d`, Vendor `995e1908-912d-4ada-bd76-5485183011f9` | mirror of Directus roles; owned by the sync (§11) |
| Directus SSO admin | `albert@popcre.com` (provider microsoft) | Albert signs in via Microsoft; see §11 |
| Directus script admin | `svc@popcre.com` (provider default) | password in Coolify `DX_ADMIN_PASSWORD`; used by scripts |
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

### Two admin users; SSO matches on `external_identifier` + `provider`
**Looks like:** there are two admins — `albert@popcre.com` (provider `microsoft`) and `svc@popcre.com` (provider `default`).
**Actually:** Directus's OIDC login matches a user by `LOWER(external_identifier)` AND requires the user's `provider` to equal the driver (`microsoft`). A local/password user (provider `default`) can **never** be matched by SSO even with the right `external_identifier`. So:
- **`albert@popcre.com`** = Albert's SSO admin (provider `microsoft`, `external_identifier = Albert@popcre.com` = his UPN/`preferred_username`). He signs in via "Sign in with Microsoft".
- **`svc@popcre.com`** = the automation/script admin (provider `default`, password in Coolify `DX_ADMIN_PASSWORD`, also `DX_ADMIN_EMAIL` in the local secrets file). Used by `apply-schema.mjs` / migration scripts.
**Why:** Entra's userinfo doesn't return `email`, so SSO keys on `preferred_username` (the UPN). A single user can't be both password-auth (for scripts) and microsoft-auth (for SSO), so they're split.
**Do not change because:** changing `albert@popcre.com`'s provider away from `microsoft` breaks his SSO; renaming `svc@popcre.com` breaks the scripts (update the secrets file too).
**Staff onboarding:** SSO **auto-registration is ON** (`AUTH_MICROSOFT_ALLOW_PUBLIC_REGISTRATION=true`). Any `@popcre.com` tenant user who signs in is auto-provisioned as a **non-admin Designer** (`AUTH_MICROSOFT_DEFAULT_ROLE_ID = 7c7299c9-bf6c-44f6-b952-b6983a3ca6e8`). Only org users can authenticate (the Entra app is single-tenant `AzureADMyOrg`). Admins re-assign a new user's role afterward (e.g. to Sales/Licensing) — the Designer default is just a safe non-admin landing role; never make it an admin role.

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

### Kanban is a Marketplace extension, persisted on a volume
**Looks like:** Directus has a native "Kanban (Advanced)" layout.
**Actually:** Directus core has **no drag-Kanban** (only Table/Cards/Calendar/Map). The board comes from the community Marketplace extension **`advanced-kanban-layout`** (`^11.0.0`-compatible, MIT, installed via `POST /extensions/registry/install`). Marketplace extensions install into `/directus/extensions`, so a **named volume `poppim-extensions:/directus/extensions`** (in the compose) keeps it across redeploys — without it the extension vanishes on the next deploy. After install, **restart Directus** so the app loads it.
**Default boards:** global default presets (`user=null, role=null`) make both landing collections open as boards: `project` → Kanban by `status` (`title={{title}}`), `product` → Kanban by `stage` (`groupTitle={{name}}, title={{name}}`). Layout id is `advanced-kanban-layout`; options live under `layout_options["advanced-kanban-layout"]`.
**Reinstall (if recreating):** `node pm-system/setup-roles-and-flows.mjs` does roles+Flow; the Kanban + presets are applied via the Marketplace install call + preset POSTs (see §14 incident).

### Entra is the role hub; Directus is the single writer (Model B)
**Looks like:** roles are managed in Directus, yet six `POP PIM ·` security groups exist in Entra.
**Actually:** roles live in **Directus** (the editing surface) and are mirrored **outbound to Entra** so other apps (CRM/DAM) read one source. A reconcile script (`pm-system/sync/entra-role-sync.mjs`) maps each Directus role → its Entra group, **hourly**, via the host systemd timer `poppim-entra-sync.timer`. Direction is **one-way Directus→Entra**; only `provider=microsoft`, active users with a mapped role are managed; the six groups are **owned by the sync** (a member without a matching Directus role is removed).
- **Role→group map** (also in the script): Administrator/Sales/Licensing/Designer/Viewer/Vendor → the six `POP PIM ·` groups (ids in §8).
- **Write credential:** a dedicated Entra app **`POP PIM — Graph Role Sync`** (separate from the SSO app) with application perms `GroupMember.ReadWrite.All` + `User.Read.All`, admin-consented. Client id/secret + tenant are `GRAPH_*` in `/home/ai/.poppim-deploy.env` only — **never** in the repo or the Directus container.
- **Safety:** the script is **dry-run by default**; it writes only with `SYNC_APPLY=1` (the systemd unit sets it). Run a dry run anytime: `POPPIM_ENV_FILE=/home/ai/.poppim-deploy.env DX_URL=https://pm.designflow.app node pm-system/sync/entra-role-sync.mjs`.
**Do not change because:** widening the Graph app's permissions or moving its secret onto the public Directus container increases blast radius; keep it least-privilege and host-only.
**Follow-ups:** the **Vendor** role currently has **no product/order access** (deliberate, until scoping exists) — per-vendor **row scoping** (a vendor sees only their own products) needs a user→factory/vendor mapping and a permission filter. CRM/DAM become **read-only consumers** of these groups; promote one to a second writer only deliberately (avoids sync loops).

### Content-collection order is set via `meta.sort`
Login lands on the first non-hidden collection in the content nav. Collections sort by `meta.sort` (set on each via `PATCH /collections/:name`); `project` and `product` are pinned first, lookup tables (retailer/buyer/licensor/…) last. Without `sort`, Directus falls back to alphabetical (which dumped users on `buyer`/`licensor`).

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
| `GRAPH_TENANT_ID`, `GRAPH_SYNC_CLIENT_ID`, `GRAPH_SYNC_CLIENT_SECRET` | Entra role-sync write creds (Model B) | **secrets file only** (`/home/ai/.poppim-deploy.env`); deliberately NOT in Coolify/the container — see §11 | — | yes (host timer) |

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
| open | Phase-1.x data model | M2M relations (multi-buyer seam), remaining Flows (dormant/SLA), per-role saved Views |
| superseded | Designflow PLM integration | Dropped in favor of Entra-as-role-hub (Model B); roles now centralize in Entra, not another app |
| open | Vendor role row-scoping | Vendor role has no product access yet; add per-vendor filter (user→factory/vendor map) so a vendor sees only their own products |
| open | CRM/DAM read Entra groups | Wire the CRM and DAM to read the six `POP PIM ·` groups for roles (read-only consumers; one writer = Directus) |
| open | Verify new-user notify Flow end-to-end | "New user role reminder" Flow is active but only fires on a real `provider=microsoft` sign-in; confirm on next real SSO signup |
| open | ClickUp → Directus migration import | Script under `pm-system/migration/` reading D1 → Directus API with `external_id` |
| open | Orphaned Entra secret | One unused client secret exists on the SSO app (lost to a capture bug); remove for hygiene |
| open | R2 file storage | Add R2 env to Coolify when needed (Directus uses local storage now; full design files stay on NAS) |
| open | Reconcile repo compose with deployed | Update `pm-system/docker-compose.yml` to match the deployed Coolify service (SSO/license/FQDN) |
| done | Deploy Directus PM to pm.designflow.app | Live + verified 2026-06-10 |
| done | Repo + folder renamed plane → poppim | — |
| done | Canonical standard saved | `/home/ai/Albert-AI-Standards/NEW-PROJECT-PROMPT.md` |
| done | ClickUp import | 651 projects + 16,534 products imported via ClickUp API (`pm-system/migration/clickup-import.mjs`) |
| done | Role taxonomy + new-user notify Flow | Designer/Sales/Licensing/Viewer/Administrator; `pm-system/setup-roles-and-flows.mjs`; 2026-06-10 |
| done | Kanban boards | `advanced-kanban-layout` Marketplace extension on a persistent volume; Project (by status) + Product (by stage) global default boards; 2026-06-10 |
| done | Entra role hub (Model B) | 6 `POP PIM ·` groups + `Graph Role Sync` app; hourly `poppim-entra-sync.timer` mirrors Directus roles → Entra; Vendor role added; 2026-06-10 |
