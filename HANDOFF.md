# Handoff — Session 2026-05-28/29

**Repo:** `u2giants/plane`
**Written:** 2026-05-29
**Replaces:** the 2026-05-18 HANDOFF.md (kept for reference in git history)

This file is the authoritative starting point for any new AI session or developer. Read it before opening any other file.

---

## What This Project Is

**POP Creations / Spruce Line** is a licensed and generic home decor company that manufactures products in China and sells to US retail chains (Burlington, TJX, Ross, Hobby Lobby, Walmart, Dollar General, and others).

The company currently tracks all product work in **ClickUp**. The goal is to replace ClickUp with a custom-built PM system designed specifically around how this company works — not a generic reconfiguration of an off-the-shelf tool.

**Two product lines with fundamentally different workflows:**

| | POP Creations | Spruce Line |
|---|---|---|
| Nature | Licensed (Disney, Marvel, WB, DC, Peanuts, etc.) | Generic / original designs |
| Volume | ~8,000 SKUs | ~700 items |
| Key constraint | Licensor approval of concept AND sample before manufacturing | No licensor — internal approval only |
| Pipeline | 17 confirmed stages | Not fully mapped — waiting on Jen's interview |
| Contact | Jessica (PM), Liz (Creative Director) | Jen (Creative Director) |

**The build has not started.** The project is in pre-design, completing employee interviews before any code is written.

---

## What Happened in the 2026-05-28/29 Session

This was the most substantive session since the project started. The following was accomplished:

### 1. Interview rounds completed and synthesized

- **Jessica (PM) — Rounds 1 and 3:** All answers captured and synthesized.
- **Liz (Creative Director) — Round 2:** All answers captured and synthesized.
- A full synthesis document was written: `docs/interview-synthesis.md` — 15 sections, 43 answered questions converted into concrete system requirements, design decisions, and build priorities.

### 2. All documentation rewritten

The following files were rewritten or created with current, accurate content:
- `README.md` — system architecture, quick commands, repo structure
- `AGENTS.md` — operating rules for AI sessions
- `docs/architecture.md` — infrastructure diagrams
- `docs/deployment.md` — deployment procedures
- `docs/configuration.md` — environment and secrets reference
- `docs/development.md` — local dev workflow
- `docs/interview-synthesis.md` — NEW: interview findings → system requirements
- `BUSINESS_INTELLIGENCE.md` — updated with new findings from Rounds 1–3

### 3. Infrastructure decision made

The project was originally intended to configure self-hosted Plane (the open-source PM tool). That plan changed this session.

**New plan:** Build a custom PM system from scratch, purpose-built for this company's workflow.

**Infrastructure decision:**
- **Backend:** Fastify API hosted on the existing Coolify server (`178.156.180.212`)
- **Database:** PostgreSQL (also on Coolify) — replacing Cloudflare D1 as the primary data store
- **Jobs/automation:** Trigger.dev for background jobs (licensor turnaround tracking, SLA alerts, nightly pipelines)
- **Frontend:** not yet designed
- **Cloudflare Worker:** stays live for webhook ingestion and the `/interview` endpoint until a replacement is built

**Why the change:** Plane (the open-source tool) would require heavy customization to support the two-tier project/SKU model, the design inventory, bulk operations, and role-specific views. Building custom gives full control of the data model from the start and avoids fighting Plane's constraints. The ClickUp data in D1 remains the reference source for migration.

### 4. Build gate established

**No custom features will be designed or built until:**

(a) Jen (Spruce Line Creative Director) answers her 30 interview questions.
(b) A full system design document is written and approved by the project owner.

This gate was set because the Spruce Line data model is unknown until Jen answers. Building POP Creations first and retroactively fitting Spruce Line in would likely require a redesign of the core schema.

### 5. Oracle report planned

After Jen's interview, a comprehensive AI-to-AI knowledge transfer document (the "Oracle report") will be written before any build session begins. It will cover: all interview findings, ClickUp behavioral data, business model, pain points, data model decisions, and system architecture. The purpose is to give any future AI session full context without having to read 10+ source documents.

---

## Current State of Each Work Stream

### Employee interviews

| Person | Role | Status |
|--------|------|--------|
| Jessica Cortázar | Project Manager | Rounds 1 and 3 complete — all questions answered |
| Liz Parkin | Creative Director, POP Creations | Round 2 complete — all questions answered |
| Jen Chaffier | Creative Director, Spruce Line | **PENDING** — 30 questions ready, not yet answered |

**Jen's interview URL:** `https://plane-integrations.u2giants.workers.dev/interview?who=jen`

The questions are inserted in D1 `interview_questions` table with `respondent = 'jen'` and `status = 'pending'`. When Jen visits the URL and answers, the Worker stores them in D1 automatically. No session action required to receive them.

### Documentation

Complete and current as of 2026-05-29. No known gaps except the Spruce Line sections (which cannot be written until Jen answers).

### System design

Not started. Blocked on Jen's interview.

### Build

Not started. Blocked on system design approval.

---

## Key Decisions Made This Session and Why

### Decision 1: Build custom instead of configuring Plane

**What:** Replace the plan to configure self-hosted Plane with a plan to build a custom Fastify + PostgreSQL application.

**Why:** Plane's data model is issue-centric and flat. The business needs a strict two-tier hierarchy (Project Card → SKU Card), a design inventory that is independent of buyer presentations, and bulk operations that Plane does not natively support. Every required feature would need a workaround. Building custom is the same effort with a better result.

**Risk:** More engineering work. Mitigated by keeping scope tight — only build what the interviews confirmed is needed.

### Decision 2: Fastify + PostgreSQL on Coolify, Trigger.dev for jobs

**What:** Backend is Fastify. Database is PostgreSQL on the same Coolify server already in use. Background jobs (SLA alerts, nightly ClickUp sync, licensor turnaround tracking) run in Trigger.dev.

**Why:** Coolify server is already provisioned, paid for, and running. Adding PostgreSQL there is zero additional cost. Trigger.dev gives managed job queues without self-hosting a job runner. Fastify is fast to build with and has a clean plugin ecosystem.

**Alternative considered:** Keep using Cloudflare Worker + D1. Rejected because D1 is SQLite with no row-level locking, no full-text search, and limited JOIN performance at scale. The product table alone has 9,000+ rows with complex relationships.

### Decision 3: No build until full system design is approved

**What:** Established a build gate requiring (a) Jen's interview and (b) written system design with owner sign-off before any code is written.

**Why:** The Spruce Line data model is unknown. If POP Creations is built first with a schema that does not fit Spruce Line, the schema will need to be redesigned mid-build. Better to wait two weeks for Jen's answers than rework the schema after two months of code.

---

## The Exact Next Action

1. **Wait for Jen to answer her interview.** Her URL is live. No code change is needed. Monitor D1:
   ```sql
   SELECT respondent, COUNT(*) as answered
   FROM interview_questions
   WHERE respondent = 'jen' AND status = 'answered'
   GROUP BY respondent;
   ```

2. **When answers arrive, start a new session with:**
   - `docs/interview-synthesis.md` — add a Section 16 for Spruce Line findings from Jen
   - Write the Oracle report (comprehensive knowledge transfer document, no specific filename yet — name it `docs/oracle-report.md`)
   - Write the full system design (`docs/system-design.md`) covering: data model, API surface, Fastify route structure, PostgreSQL schema, Trigger.dev job list, frontend views per role
   - Get owner sign-off on the system design
   - Begin build

---

## What Is Fully Done

- All employee interviews for Jessica and Liz — captured and synthesized
- Full synthesis document with prioritized build list (`docs/interview-synthesis.md`)
- All infrastructure documentation
- Decision on infrastructure stack (Fastify + PostgreSQL + Trigger.dev)
- Build gate logic — no premature work on the system

## What Is In Progress

- Jen's interview — questions are live at the Worker URL, waiting for her to answer

## What Has Not Started

- Spruce Line section of interview synthesis
- Oracle knowledge transfer report
- System design document
- PostgreSQL schema design
- Fastify API design
- Any actual build work

---

## Known Risks and Blockers

### Hard blocker: Jen's interview

The Spruce Line data model is entirely unknown. The `products` table has 701 Spruce Line items, but the data shows task names like "Gaming - updated 10.27.25" and "BCF - Kim/Anna - New Formats" — these appear to be collection/presentation names, not individual SKU names. Until Jen answers:

- It is unknown whether Spruce Line should be modeled as collections of designs or as individual SKUs
- It is unknown what the approval stages are
- It is unknown whether a Spruce Line "task" in ClickUp maps to a project card, a collection, or a product

**Do not design any schema that assumes Spruce Line is SKU-like until Jen confirms.**

### Risk: schema design mismatch between POP Creations and Spruce Line

If the two product lines need fundamentally different data models, the system needs to either: (a) use a shared schema with null-able fields for the line that doesn't use them, or (b) use separate tables with a shared parent. This decision requires Jen's answers.

### Risk: costing sheet integration scope creep

Costing sheets are currently outside ClickUp entirely. Liz, Jessica, and the technical designers all want costing sheet constraints visible at design time. This could be a simple text/attachment field, or a full costing workflow with its own table. The system design needs to scope this explicitly before build.

### Risk: DAM thumbnail integration

Thumbnails exist on DigitalOcean Spaces (S3-compatible). The current Cloudflare Worker has the integration already. When migrating to Fastify + PostgreSQL, this integration needs to be re-implemented. The DigitalOcean Spaces credentials must be confirmed before the migration is complete.

---

## Context That Would Otherwise Be Lost

### The 1,574 "Concept Approved" products

There are 1,574 products at "Concept Approved" with no PO and no sample request. These are NOT abandoned — they are approved concepts that no buyer has purchased yet. They should be surfaced as the "design inventory" and actively offered to buyers each season. The new system must make these findable and offerable, not just show them as a stuck-stage count.

### The "Sarbani approval" checkpoint

Sarbani was a previous Creative Director. A checkpoint named `sarbani_approval` exists in the D1 `checkpoint_map`. Liz (Round 2) confirmed she performs the same review function. The new system should rename this to `creative_director_review`. Do not remove the checkpoint — it is a real gate.

### Products open 4–5 years

The `products` table contains items that have been open for 4–5 years at early stages. These are almost certainly abandoned but never formally closed. The migration plan needs a one-time closure pass with a bulk "Abandoned" state. The system itself needs a Cancel action with a required reason field — no SKU should ever go silent again.

### Interview data is in D1

All interview questions and answers are in D1 `interview_questions` table. The Cloudflare Worker at `https://plane-integrations.u2giants.workers.dev/interview?who=jen` is the live interview delivery UI. The Worker source is at `integrations/worker/src/index.js`. Do not shut down this Worker — it is the only way Jen can answer.

### The "for adam" tag

104 ClickUp tasks are tagged "for adam." This likely means routing to a sales person named Adam. It was listed as an open question but was not answered in Rounds 1–3. It is a low-priority open item.

### Wholesale channel (Stallion Art, Iconick)

These are sublicensors who buy the product and resell it, but their designs still go through the full POP Creations licensor approval pipeline. They are tagged `stallion art wholesale only` (62 tasks) and `iconick only` (5 tasks) in ClickUp. The new system should preserve these routing tags.

### File storage model

Design files live on a Synology NAS at path format `S:\[Licensor]\[Season]\[Project]\`. A DAM system generates thumbnails stored on DigitalOcean Spaces. The new system should display thumbnails and NAS paths — no need to re-upload full files. Liz confirmed a thumbnail + NAS path is sufficient for approvals.

### The interview system stays in this repo

Previously discussed moving the interview system to `u2giants/bizanalysis`. That move did not happen. The interview endpoint is part of the Cloudflare Worker at `integrations/worker/src/index.js`, which is in this repo. Keep it here.

---

## Key Files

| File | Purpose |
|------|---------|
| `docs/interview-synthesis.md` | Full translation of 43 interview answers into system requirements — primary design reference |
| `BUSINESS_INTELLIGENCE.md` | Company overview, pipeline, pain points, data analysis, SLA targets |
| `AGENTS.md` | Operating rules for AI sessions working in this repo |
| `README.md` | System architecture, quick commands, infra reference |
| `docs/architecture.md` | Infrastructure diagrams |
| `integrations/worker/src/index.js` | Cloudflare Worker — webhook receiver, /query, /interview |
| `scripts/build_products_table.py` | Rebuilds `products` + `product_checkpoints` from D1 |
| `scripts/migrate_robust_schema.sql` | Full D1 schema (idempotent) |

## Key Infrastructure

| Component | Detail |
|-----------|--------|
| Cloudflare Worker | `plane-integrations.u2giants.workers.dev` — live, do not modify without deploying |
| Cloudflare D1 | `clickup-events` — ID `c37aeb36-e16e-416b-b699-c910f6f8dc10` |
| Coolify server | `178.156.180.212:8000` — reserved for the new Fastify API + PostgreSQL |
| Coolify API auth | `Bearer 1|mlVx9mbwsN1Sga6eLtJEvmPioy6Sra9AnepnCe3K7d0a2927` |
| ClickUp workspace | Team ID `2298436` |
| GitHub | `u2giants/plane` — Claude Code sessions run in `/worksp/plane` |
