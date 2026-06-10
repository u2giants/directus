# Platform Decision Report — PM, CRM & DAM on One Backend

**Date:** 2026-06-09
**Author:** prepared with Claude (research + synthesis)
**Audience:** decision-makers and any future engineer/AI picking up this work
**Status:** recommendation for direction; not yet a committed build plan

---

## 0. Executive summary

We need a project-management system for our two product lines, we already run a **forked Twenty CRM** and a **custom-built DAM (PopDAM)**, and our deepest operational pain is **fragmentation** — the truth is scattered across ClickUp, Twenty, PopDAM/Supabase, email, Teams, and a separate analytics database. This report evaluates how to build the PM system and whether to unify PM + CRM + DAM onto **one backend**.

**Core constraint:** we hate **forking** — maintaining a modified copy of a platform we want to keep upgrading is painful (our Twenty v1.20→v2.8 upgrade produced ~1,437 merge conflicts). We want to build our idiosyncratic workflow **on top of** a platform **without forking it**.

**Findings:**
- **Plane (the tool this repo is named for) fails our constraint.** Its custom data model (types, typed fields, workflows) is **paywalled in a closed-source Commercial Edition**, it has **no field-level permissions in any edition**, and **no plugin system** — adopting it means paying for closed software *and* forking *and* building our UI as a separate app. (See `plane-free-edition-gaps.md`.)
- **Twenty can be "de-forked"** back to stock + no-code custom objects + external services for ~90% of what our fork does — but its **frontend cannot be customized without forking** (we already hit this wall once), and it's a CRM-shaped product, not a general platform.
- **Directus** is a headless **data platform** (not a PM tool or CRM out of the box) whose entire design is "build on top without forking": custom objects, **native field-level permissions**, a real **Extensions SDK** (custom UI + backend), no-code **Flows** automation, and a built-in **asset/DAM** module. It is the strongest fit for an idiosyncratic, evolving, multi-domain (PM+CRM+DAM) system — **and we were just awarded the Open Innovation Grant, making it free for us, self-hosted, with no caps.**

**Recommendation:** Adopt **Directus as the strategic backbone for a unified PM + CRM + DAM "super-app,"** but **execute incrementally** — build the **greenfield PM system first** (highest current pain, no working system at risk), design the schema to host CRM and DAM entities from day one, then migrate the **CRM off the Twenty fork**, and **last** fold in the **DAM data layer** (keeping our bespoke ingestion/render/checkout agents). Do not rip out working systems on a bet; let Directus earn its place in production on the greenfield build first.

---

## 1. Background & how we got here

The company was running employee interviews to design a replacement for ClickUp. With all interviews complete (Jessica/PM and Liz/Creative Director for the licensed line; Jen/Creative Director for the generic line), we synthesized requirements (`business-process.md`, `pm-system-design.md`). The original plan assumed building on **Plane** (this repo, `u2giants/plane`, with a deployed Plane instance and an analytics layer). Evaluating Plane against our requirements revealed it could not meet them without forking and paying — which opened a broader question: **what platform should we actually build on**, given we also run a forked Twenty CRM and a custom DAM, and given our real goal is **one source of truth** across all of it.

---

## 2. The company and what we do

We **design and source licensed and generic home-decor products** — wall art, framed/stretched canvas, plaques, storage, floor coverings (coir mats), garden, tabletop, clocks, photo frames, desk accessories — **manufactured in China and imported to the US** for major retail chains (Burlington, TJX/HomeGoods/Marshalls, Ross, Hobby Lobby, Walmart, Dollar General, Amazon, Ollies, and others).

We run **two parallel businesses** that share people and factories but follow different processes:

| | **POP Creations** (~75%) | **Spruce Line** (~25%) |
|---|---|---|
| Product | **Licensed** (Disney, Marvel, Star Wars, WB, etc.) | **Generic/original** (formerly "Edge") |
| Defining constraint | Every design needs **licensor approval** twice (concept, then sample) | No licensor — **buyer approval only** |
| Run by | Jessica (PM) + Liz (Creative Director) | Jen (Creative Director) |
| Process weight | Heavyweight, ~17 gated stages | Lightweight, ~11 stages |

We are a **small company (9 employees, under $5M revenue)** with a capable technical operation (we self-host on Coolify/VPS, run Cloudflare Workers + D1, Microsoft Entra SSO, CI/CD, and have built sophisticated custom systems).

Full process detail lives in **`business-process.md`**; system requirements in **`pm-system-design.md`**.

### How a product flows (condensed)
- **POP:** brief/offer → preliminary designs → buyer presentation & picks → SKU created + format chosen → art files → licensing sheet + packaging → **Liz's internal review (the gate)** → licensor concept submission → approve/revise → PO or sales-sample → factory sample (PPS) → licensor PPS approval → mass production → production approved → ship with Brand Assurance + trademark compliance.
- **Spruce:** trend/theme **collections** (account-agnostic, hundreds of designs, no high-res until requested) → buyer presentation → **selections** → on commitment a **style number** is assigned (the product becomes real) → costing (DesignFlow + China team) → optional sample → PO → factory deadline → production. No licensor anywhere.

---

## 3. The current systems landscape (the fragmentation problem)

Today our operational truth is spread across **five+ disconnected systems**:

| System | Role today | Stack |
|---|---|---|
| **ClickUp** | The live PM/pipeline for both lines (being replaced) | SaaS |
| **Twenty (forked)** | Production CRM at `crm.designflow.app` — companies/people/opportunities, plus custom objects (factory, licensorApprovalThread, department, meetingNote…), email-routing from a shared Outlook mailbox, AI summaries, a **ClickUp stage sync** | Forked Twenty v2.8.3 (TypeScript/NestJS/React/Postgres), Coolify |
| **PopDAM** | Production DAM at `dam.designflow.app` / `sg.designflow.app` — NAS-ingested licensed art, thumbnails, search/filter/tag, checkout/check-in, style groups, ERP enrichment, licensor style guides | Custom React/Vite + **Supabase** (Postgres/Auth/Edge Fns/pg_cron) + DO Spaces + NAS/Windows/Electron agents + Railway worker |
| **D1 analytics + Worker** | Webhook ingestion of ClickUp events + a natural-language "ask a question" query endpoint | Cloudflare Worker + D1 (SQLite) |
| **DesignFlow** | Separate pricing/costing system (a named bottleneck) | Separate app |
| **Teams + email** | Where approvals, revisions, and decisions actually happen | Microsoft 365 |

Every interviewee independently named the same root pain: **information is scattered and people get chased for status.** The single most valuable thing we can build is **one source of truth** where nothing gets lost and data flows between domains. That goal is what makes a **unified backend** strategically interesting — not just a PM tool.

---

## 4. What we need (requirements)

### 4.1 Functional rubric (the platform must do these, built-in OR buildable on top **without forking**)
- **R1** Multiple custom object types (Offer/Project, SKU, Collection, Design, Style#; plus CRM and DAM objects)
- **R2** Typed custom fields (text, number, date, enum/select, boolean, relation, user) — e.g., Brand Assurance #, PI status, on-shelf/PPS dates, licensor, property, buyer, cost target, style #
- **R3** Multi-level hierarchy/relations (≥3 levels)
- **R4** Custom workflow states per line + transition history (for time-in-stage / SLA)
- **R5** Bulk operations (multi-select stage/assignee/field changes)
- **R6** Saved filtered/grouped views per role
- **R7** **Field-level permissions** (designers see specs, not pricing) — a hard requirement
- **R8** Strong cross-record search/filter (the "design library")
- **R9** Attachments via S3/R2 + external thumbnail/NAS-path links
- **R10** REST/GraphQL API + webhooks (for migration, the analytics/AI layer, notifications)
- **R11** **Extensibility without forking** (plugin/extension system or headless/API-first)
- **R12** Self-hostable; license permissive enough; note any feature-gating
- **R13** UX good enough for non-technical adoption (designers, sales)

### 4.2 The signature features the PM system must deliver (from `pm-system-design.md`)
Design library + reuse; two-tier (POP) / three-tier (Spruce) model; custom typed fields; per-line stage pipelines; cancel-with-reason; time-in-stage + on-track + SLA/dormant alerts; multi-buyer conflict detection; Creative-Director review queue + submission checklist; costing/constraint visibility with **field-level** role control; bulk ops + CSV/mockup export; structured revision notes; capacity/workload view; proactive seasonal planner; AI natural-language assistant; designer track-record; wholesale-sublicensor handling.

---

## 5. Constraints

1. **No forking.** We will not maintain a modified copy of a platform we want to keep upgrading. (This is the lesson of the Twenty fork's upgrade pain.)
2. **Non-technical adoption.** Designers and sales must actually use it daily; prior ClickUp delegation attempts failed when the tool was hard.
3. **Self-hosted.** We run our own infra (Coolify/VPS, R2, NAS, Microsoft SSO).
4. **Small team / small budget.** 9 employees, <$5M revenue. Free or cheap matters; engineering time is the real cost.
5. **Existing investment is real but not sacred.** We've put months into Twenty and far more into PopDAM. We will switch *if* a platform is definitively better long-term — sunk cost won't dictate the decision.
6. **Two lines, one platform.** Must serve POP (licensor-heavy) and Spruce (collection-based) without forcing one's model on the other.

---

## 6. What we want to accomplish

- **One source of truth** spanning PM + CRM + DAM, with data shared between domains (a SKU links to its design → its asset → its project → its buyer → its licensor → its factory).
- **Nothing lost** — every design, decision, note, and stalled item findable and reusable (the design library).
- **Proactive, not reactive** — get ahead of seasons using history.
- **Customize our idiosyncratic, evolving workflow without forking**, including needs we can't foresee yet.
- **Stop rebuilding plumbing** — auth, API, admin UI, permissions, automation — for every new internal app.

---

## 7. Options evaluated

### 7.1 Plane — free Community Edition
**Verdict: fails our constraint.** Custom Work-Item Types, Custom Properties (typed fields), Workflows, and Epics are **not in the AGPL Community Edition** — they live in a **separate closed-source Commercial Edition** unlocked by a paid per-seat key (Pro $7 / Business $17). There is **no field-level permission in any edition** (requires forking), and **no plugin/extension system** (custom UI ⇒ fork the Next.js monorepo, or build a separate external app). Full detail and sources in **`plane-free-edition-gaps.md`**.
- **Benefit:** modern UX; good REST API + webhooks; states/views/search/R2 in CE.
- **Disadvantage:** to use it we'd pay for closed software, *and* fork for field-level visibility, *and* build all custom UI as a separate app. That is the opposite of "build on top of the free version without forking."

### 7.2 Plane — Commercial Edition (paid)
Gets us types/fields/workflows, but it's **closed-source per-seat paid**, **still no field-level permissions**, and **still no custom-UI embedding** without forking. Not aligned with our goals.

### 7.3 Twenty — our current fork
What we run today: a deep fork (v2.8.3) adding 8 custom objects, ~23 program fields on `opportunity`, email routing, AI summaries, a ClickUp stage sync, and a few frontend tweaks (a company-scoped department picker, etc.).
- **Benefit:** already in production; working SSO/integrations/ops; a friendly app-like UX; we've proven the data model works.
- **Disadvantage:** **the fork is the pain** — the v1.20→v2.8 upgrade was ~1,437 conflicts and required a "re-fork." Adding custom objects the way we did **requires touching framework files** = forking.

### 7.4 Twenty — de-forked (stock + no-code + external services)
We could move ~90% back to **stock** Twenty: the 8 custom objects + fields via **no-code/Metadata API**; all server logic (Outlook routing, ClickUp sync, Fireflies, AI) as **external services on the API + webhooks** (or Twenty's own serverless functions). **Field-level permissions are in Twenty's free core.** License is **AGPL — genuinely free forever, self-host, no caps** (only SSO + row-level perms are paid; we already run Entra SSO).
- **Benefit:** keeps our investment, friendly UX, **the most stable licensing of any option** (unconditional AGPL), low migration risk, solves the fork pain.
- **Disadvantage / hard ceiling:** **Twenty's frontend cannot be customized without forking.** Its app framework only runs custom React in **sandboxed slots** (side panel, widgets, command menu) — it **cannot** override a field input or a relation picker's behavior. Our company-scoped/greyed-out department picker is **unsupported upstream** (open, unshipped request). So de-forked Twenty caps our **UI** customization. It is also CRM-shaped — a product we configure, not a general platform — which matters for the PM and especially DAM ambitions.

### 7.5 Directus — headless data platform
**What it is:** a back-end "data platform" on top of Postgres with an auto-generated REST+GraphQL API, an admin app ("Data Studio"), auth/SSO, policy-based permissions, no-code automation (Flows), a built-in asset/DAM module, and a first-class **Extensions SDK**. **It is not a PM tool or a CRM out of the box** — you model your data and build/skin the app.
- **Extensibility without forking (its core strength):** 9 drop-in extension types — **Modules** (custom full-page apps), **Interfaces** (custom field inputs — this is exactly what we had to fork Twenty for), **Layouts** (custom board/list/gantt views), **Displays/Panels/Themes**, and **Hooks/Endpoints/Operations** (custom server logic + API routes). All installed as packages, hot-loaded, **no core fork**.
- **Field-level permissions:** native (policy-based) — R7 satisfied by config.
- **Automation:** **Flows** (event/webhook/schedule triggers → operations) for SLA logging, notifications, etc., no fork.
- **DAM:** built-in asset module (folders, metadata, on-the-fly image transforms, focal points, S3/R2) — can serve as PopDAM's cloud layer (the NAS/render/checkout *agents* stay).
- **Starters:** **AgencyOS** (MIT; Nuxt + Directus; a full CRM + project/task management + client portal + invoicing) and a **Simple CRM** template (Kanban pipeline in Data Studio) give real head-starts. A **Gantt layout** extension exists; Kanban/Calendar are built-in.
- **License/cost:** source-available (MSCL). Default free self-host ("Core") is **capped (3 seats, 25 collections, 5 Flows, no SSO)** — but the **Open Innovation Grant (which we were awarded)** removes all caps and unlocks SSO + custom access policies, **free, self-hosted**, for orgs under $5M revenue and 50 employees.
- **Benefit:** the only option where **all** customization (UI, backend, views, field-perms) is **no-fork**; the natural backbone for **PM + CRM + DAM unification**; we stop rebuilding auth/API/admin/permissions for every app.
- **Disadvantage:** **you build the end-user UI** (Data Studio is admin-shaped; AgencyOS mitigates this); a **re-platform** for our existing systems; the "free" status **depends on the OIG**, which is **revocable and eligibility-bound** (under $5M/50 employees) — a real, if small, strategic dependency that AGPL Twenty does not have; extensions run **in-process** (vet what you install); realtime is weaker than Supabase.

### 7.6 Others evaluated and eliminated
- **OpenProject** — no field-level permissions without forking; plugins require custom Docker builds; everything is a "work-package subtype" (not true custom objects). Eliminated on R7 + R11.
- **NocoDB** — license **no longer open-source** (Sustainable-Use, since v0.301), and its field permissions control **edit only, not visibility** (can't hide pricing). Eliminated.
- **Huly** — fixed all-in-one app; webhooks essentially absent; SDK-only; weak field-level perms. Not a build-on-top base.
- **Baserow** — MIT core + plugin system, but field-level RBAC is **paid** self-host. Viable only if we pay.
- **Teable** — AGPL core, Postgres-native, but field permissions (authority matrix) are **paid Business**. Third choice.

---

## 8. The DAM dimension (PopDAM)

PopDAM is **not** a simple file store — it is a sophisticated, NAS-integrated system: a Synology **Bridge Agent** (scans the NAS, renders `.psd`/`.ai` thumbnails, outbound-only networking), a **Windows Illustrator render agent**, an **Electron checkout/check-in Helper**, a **Railway bulk worker** (AI tagging, style-group rebuild, ERP enrichment, SKU backfill), **dual-mode** (PopDAM assets + PopSG licensor style guides), on **Supabase** + **DO Spaces**, with strict file-timestamp preservation.

**On Directus:**
- The **cloud "brain"** (DB, auth, API, admin UI, permissions, metadata, asset browsing, image transforms) **can be Directus** — replacing Supabase's Postgres/Auth/Edge-Functions/pg_cron. **DO Spaces stays.**
- The **"muscle"** (NAS ingestion, PSD/AI rendering, desktop checkout) is **platform-independent and stays ours forever** — the agents would call Directus's API instead of Supabase edge functions.
- **Standalone benefits** of moving the DAM backend to Directus (even ignoring unification): stop maintaining hand-built edge-function APIs + RLS; get a real admin UI, field-level policies, no-code automation, a typed SDK, one SSO surface, and built-in image derivatives — i.e., **less bespoke plumbing to maintain.**
- **Caveat:** PopDAM already works and its domain logic (style groups, ERP, SKU extraction) would need re-implementing as Directus collections/hooks. On its own, the DAM is the **least** urgent migration; its payoff is mainly in **consolidation**.

---

## 9. The super-app vision

A single Directus-backed Postgres where **PM + CRM + DAM are one relational graph**:
- A **SKU** links to its **Design** → its **DAM asset** → its **Project/offer** → its **Buyer** (CRM company/person) → its **Licensor** → its **Factory**.
- Cross-domain features that are integration projects today become **one query**: the design library; "every asset for this licensor's approvals"; "which buyer ordered this asset's SKU"; "which approved-but-unsold concepts fit this season."

**Why this is the right north star:**
- It directly attacks our **#1 documented pain (fragmentation)** — the thing every interviewee named.
- The biggest payoff isn't even unification — it's that **Directus gives us, as stock upgradable infrastructure, the plumbing we keep rebuilding** (auth, API, admin UI, permissions, automation). PopDAM rebuilt all of it on Supabase; Twenty gave it to us but chained to a forked CRM. With Directus as the backbone, the **next** internal app is mostly data-modeling + domain logic, not re-plumbing.

**Why to be careful:**
- Three live/deep systems → one is a **multi-month, high-risk** effort. Don't big-bang it.
- The **OIG dependency** now covers the *entire* stack — weigh the revocable/eligibility-bound nature vs. Twenty's unconditional AGPL.
- **Monolith blast-radius** — one platform powering PM+CRM+DAM means one upgrade/outage touches all three (mitigated by stock+upgradable core and our strong ops).
- **Validate at our asset scale** before committing the DAM.

---

## 10. Recommendation & phased plan

**Adopt Directus as the strategic backbone for a unified PM + CRM + DAM super-app — and execute incrementally.**

**Phase 1 — Greenfield PM on Directus (prove it).**
Build the new PM system (replacing ClickUp) on Directus: model POP (Project→SKU) and Spruce (Collection→Project→Style) as collections/issue-types; per-line stage states; the custom fields; **field-level policies** (designers vs pricing); the **design library** as a filtered view; **Flows** for time-in-stage/SLA/dormant alerts and notifications; reuse the existing D1/Worker layer (fed by Directus webhooks) for the **AI assistant**. Start the front-end from **AgencyOS** (or build minimal custom UI). **Design the schema from day one to also hold CRM and DAM entities.** Lowest risk (no working system replaced), highest current pain.

**Phase 2 — Consolidate the CRM.**
Once Directus is proven in production, migrate the CRM **off the Twenty fork** into the same Directus instance (companies/people/opportunities + our custom objects), moving email-routing/AI logic to Hooks/Flows or keeping it as external services. This *also* solves the Twenty fork-upgrade pain — by consolidating rather than de-forking in place.

**Phase 3 — Fold in the DAM data layer.**
Last and biggest: move PopDAM's data/metadata/permissions from Supabase to Directus, **keeping the bespoke agents** (Bridge/Render/Helper/Railway) and re-pointing them at Directus's API. Do this only when Directus is well-understood, because the DAM holds the most irreplaceable custom muscle.

**Throughout:** keep the agents; keep DO Spaces/R2 and the NAS; keep Microsoft SSO; treat Directus core as **stock and upgradable** with all customization in extensions/Flows/owned front-end.

**The honest counter-position (for the record):** if we did **not** have the super-app/DAM ambition, the pragmatic call would be to **de-fork Twenty** (Option 7.4) — less work, friendly UX, and **unconditional AGPL licensing** with no grant dependency. The reason to prefer Directus is the **unification + extensibility + stop-rebuilding-plumbing** thesis, which only pays off if we actually pursue the multi-domain super-app. If priorities narrow to "just replace ClickUp, cheaply, soon," reconsider de-forked Twenty.

---

## 11. Open questions / risks to resolve before committing

- **OIG mechanics:** confirm activation (license key?), renewal terms, and what happens if we cross $5M/50 employees (commercial license cost). Our whole stack would ride on this grant.
- **WeChat SSO:** Microsoft and Google SSO are straightforward on Directus; **WeChat** likely needs the generic OAuth2 driver or a small custom extension (WeChat's OAuth is non-standard) — verify before relying on it.
- **DAM at scale:** validate Directus's asset module + search at our real asset volume and thumbnail/derivative load.
- **Realtime needs:** if any feature needs live updates, confirm Directus's realtime is sufficient (Supabase is stronger here).
- **Effort estimate:** size the Phase-1 PM build and the front-end work (Data Studio vs AgencyOS vs custom) before committing.
- **Migration tooling:** plan the ClickUp/D1 → Directus import (the ~9,000 historical records, dead-board archival, field backfill).

---

## 12. Quick reference — option scorecard

| Option | No-fork fit | Field-level perms | Custom UI w/o fork | DAM fit | License stability | Effort to adopt | Verdict |
|---|---|---|---|---|---|---|---|
| Plane (free CE) | ✗ | ✗ | ✗ | ✗ | AGPL core / closed features | high | Rejected |
| Plane (Commercial) | ✗ | ✗ | ✗ | ✗ | paid closed | high | Rejected |
| Twenty (current fork) | ✗ (is a fork) | ✓ free core | ✓ (by forking) | ✗ | AGPL (stable) | n/a (in prod) | The pain we're leaving |
| **Twenty de-forked** | ~90% | ✓ free core | **✗ (frontend ceiling)** | ✗ | **AGPL — best/unconditional** | low | Pragmatic fallback |
| **Directus** | **✓ (built for it)** | **✓ native** | **✓ (Extensions SDK)** | **✓ (backbone)** | MSCL + **OIG (granted, but revocable)** | high (re-platform) | **Recommended backbone, phased** |
| OpenProject | ✗ | ✗ | ✗ | ✗ | GPL + paid | high | Rejected |
| NocoDB | ✗ | ✗ (edit-only) | partial | ~ | **not OSS** | — | Rejected |
| Baserow | ✓ if paid | 💰 paid | ✓ | ~ | MIT core + paid | med | If we pay |
| Teable | ✓ | 💰 paid | ✓ | ~ | AGPL + paid | med | Third choice |

**Bottom line:** Directus is the best long-term backbone for the one-source-of-truth super-app, now that the OIG makes it free for us. Prove it on the greenfield PM build, design for CRM+DAM from day one, and migrate the working systems only after Directus has earned production trust. Keep de-forked Twenty in mind as the lower-risk fallback if scope narrows to "just replace ClickUp."

---

### Companion documents
- `business-process.md` — how the company works (no software)
- `pm-system-design.md` — PM system requirements (currently written against Plane; to be re-targeted to the chosen platform)
- `plane-free-edition-gaps.md` — what free Plane cannot do that we need
- `BUSINESS_INTELLIGENCE.md` — data-evidence layer (volumes, SLA tables, pipeline definitions)
