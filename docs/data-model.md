# Unified Data Model — Phase 1 (Directus)

**Date:** 2026-06-09
**Scope:** the concrete Directus schema for the **Phase-1 PM system** (POP Creations + Spruce Line), **designed from day one to also host CRM and DAM entities** (Phases 2–3) so the three domains become one relational graph.
**Companions:** `business-process.md` (the domain), `directus-execution-plan.md` (the how), `pm-system-design.md` (requirements).
**Audience:** the AI agent that will create these collections in Directus Data Studio.

> Everything here is **Directus collections + fields + relations + a status field + policies + Flows** — i.e., **configuration**, not custom code. Build it in Data Studio. No front-end required to use it.

---

## 1. Design principles

1. **One `product` table for both lines.** POP's "SKU" and Spruce's "Style#" are the same kind of thing — a production-committed item with a code, a pipeline stage, and a project. A `business_unit` field distinguishes them; line-specific fields (licensor, Brand Assurance) are simply null for Spruce.
2. **Unify POP's 2-tier and Spruce's 3-tier hierarchy.** POP = `project → product`. Spruce = `design_collection → project → product`. The optional `design_collection` tier exists for Spruce; POP products just leave it null.
3. **The design library is a first-class collection (`design`)**, independent of any presentation — picked or not. This is the #1 requested feature and the seam to the DAM (`design.asset → asset`).
4. **SLA targets are data, not hardcode.** `product_type` carries the per-type stage durations; `stage` carries order/category. Time-in-stage and "on-track" are computed from `stage_history` + these tables.
5. **Field-level visibility is a policy, not UI logic.** Pricing fields are hidden from the Designer role by a Directus policy; the API enforces it everywhere.
6. **Forward-compatible relations.** `retailer`/`buyer`/`licensor`/`factory` are real collections now so that CRM (Phase 2) attaches to them, and `design.asset`/`product.asset` point at the future DAM `asset` collection (Phase 3).

---

## 2. Entity overview

```
                 ┌──────────────┐
                 │ design_      │  (Spruce only; optional tier)
                 │ collection   │
                 └──────┬───────┘
                        │ 1:N
   ┌────────────┐       ▼            ┌───────────┐     ┌──────────┐
   │ retailer   │◄─┐ ┌─────────┐     │ licensor  │◄────│ property │
   └────────────┘  └─│ project │     └───────────┘ 1:N └──────────┘
        ▲ 1:N        │ (offer) │          ▲                  ▲
   ┌────────────┐    └────┬────┘          │                  │
   │ buyer      │◄────────┤ 1:N           │                  │
   └────────────┘         ▼               │                  │
                     ┌─────────┐  N:1     │                  │
        ┌───────────►│ product │──────────┘ (licensor)       │
        │            │ (SKU /  │──────────────────────────────┘ (property)
        │ N:1        │  Style#)│  N:1 ┌──────────┐  N:1 ┌──────────────┐
        │ (design)   └──┬───┬──┘─────►│ factory  │      │ product_type │
   ┌─────────┐          │   │         └──────────┘      │ (+SLA times) │
   │ design  │──────────┘   │ 1:N                       └──────────────┘
   │(library)│              ▼                                  ▲
   └────┬────┘        ┌──────────────┐  ┌──────────┐           │
        │ N:1         │ stage_history│  │  order   │   ┌──────┐│
        ▼             │  (SLA ledger)│  │(PO hist.)│   │ stage││
   ┌──────────┐       └──────────────┘  └──────────┘   │ defs ├┘
   │  asset   │  ◄── DAM seam (Phase 3)                 └──────┘
   │ (Phase 3)│
   └──────────┘
```

`season` is referenced by `project` (and filterable on `design`). `business_unit` is an enum field on `project`, `product`, `design`, and `design_collection`.

---

## 3. Collections

Notation: **PK** id is Directus's default UUID. Types are Directus field types. "🔒pricing" marks fields hidden from the Designer role (§7). "POP"/"Spruce" marks line-specific fields.

### 3.1 Reference / lookup collections

**`retailer`** — a store (also the future CRM "company")
| field | type | notes |
|---|---|---|
| name | string | Burlington, Hobby Lobby, Ross, Ollies… |
| aliases | json/string | alternate names (migration aid) |
| resale_restriction | boolean | some buyers prohibit reselling what they bought |
| notes | text | |

**`buyer`** — a named individual at a retailer (future CRM "contact")
| field | type | notes |
|---|---|---|
| name | string | e.g., "Anna", "Kyle (Hobby Lobby)" |
| retailer | M2O → retailer | |
| email / phone | string | (used in Phase 2 CRM) |
| samples_required | boolean | Hobby Lobby = true, Burlington = false (Spruce flow split) |

**`licensor`** (POP) — Disney, Marvel, etc.
| field | type | notes |
|---|---|---|
| name | string | |
| turnaround_days_min / _max | integer | from the SLA tables (Disney 1–3, One Piece 7–15…) |
| requires_pi | boolean | drives PI-status default |
| prohibits_resale | boolean | per-licensor reuse rule |

**`property`** (POP) — a franchise within a licensor
| field | type | notes |
|---|---|---|
| name | string | "Mickey Mouse" vs "Mickey and Friends" |
| licensor | M2O → licensor | |

**`factory`**
| field | type | notes |
|---|---|---|
| name | string | |
| capabilities | text | known constraints (die lines, color count, technique) |
| china_team_contact | string | |

**`product_type`** — carries the **SLA design-time targets** (minutes)
| field | type | notes |
|---|---|---|
| name | string | Stretched/Box, Framed, Plaque, Floor Coverings, Garden… |
| sla_brief / sla_design / sla_art_file / sla_licensing_sheet / sla_revisions / sla_techpack | integer | minutes (from BUSINESS_INTELLIGENCE.md §10) |

**`season`**
| field | type | notes |
|---|---|---|
| name | string | Valentine's, Easter, Graduation, Back to School, Harvest, Halloween, Christmas, Everyday |
| year | integer | |
| business_unit | enum | POP seasons are fixed; Spruce is account-driven (still useful to tag) |

**`stage`** — pipeline stage definitions (one row per stage, per line)
| field | type | notes |
|---|---|---|
| name | string | "Licensing sheet review", "With Buyer for Approval"… |
| business_unit | enum | POP \| Spruce |
| order | integer | 1..17 (POP) / 1..11 (Spruce) |
| category | enum | ideation \| design \| review \| submission \| sampling \| approved \| cancelled |
| is_gate | boolean | e.g., Creative Director review |

*(Rationale for a `stage` collection rather than a plain select: it lets the two lines have different stage sets, attaches order/category/SLA context, and still drives a Kanban board by grouping `product` on `stage`. For the **first spike pass**, a simple single-select `stage` field on `product` is fine; promote to this collection when modeling both lines.)*

### 3.1.1 Designflow PLM master-data link

Designflow PLM (ERP-synced) is the authoritative-but-not-exhaustive source for **customers, licensors, properties, and characters**. A one-way, create/link-only sync (`pm-system/sync-plm-masters.mjs`, daily `plm-sync.timer`) pulls them in. Schema lives in `pm-system/migration/plm-masters-schema.sql` + `plm-customers-schema.sql`. Auth + operational gotchas are in AGENTS.md §11 "PLM master-data link".

**Licensor / property / character (3-tier `licensor → property → character`).** Cross-ref key is `plm_mg_code` (+ `plm_synced_at`) on each, **unique within its parent** (mg_code is NOT globally unique — e.g. `FR` is "1st Order Trooper" under SW and "Friends TV" under WB). `property.licensor` and `character.property` are NOT NULL + `ON DELETE CASCADE` (dependencies are strict). A few PLM top-level "licensors" are really brand **properties** and are reclassified down (`DC`/`FR`/`HP`→Warner Bros, `PP`→nick/VM); their PLM children become **characters**. The new tier-3 collection:

**`character`** (POP) — licensed character / sub-property under a property
| field | type | notes |
|---|---|---|
| name | string | "Batman", "Hogwarts" |
| property | M2O → property | NOT NULL, cascade |
| plm_mg_code / plm_synced_at | string / timestamp | PLM cross-ref |

**Customers → `retailer`.** Curated `retailer` rows are linked to PLM customers via a dedicated cross-ref table (frontends never read it; sync + status authority only):

**`retailer_plm_customer`** — PLM customer ↔ retailer, **many-to-one** (banners share one retailer)
| field | type | notes |
|---|---|---|
| plm_customer_id | integer **PK** | PLM `customers_id` (authoritative). `customers_code` is NOT unique — don't key on it |
| plm_customer_code / plm_customer_name | string | for traceability |
| retailer | M2O → retailer | NOT NULL, cascade. Many PLM customers may point at one retailer (e.g. TJX corp + HomeGoods → "The TJX Companies, Inc.") |
| plm_synced_at | timestamp | |

**Status authority:** PLM ACTIVE membership drives `retailer.customer_status` — a **first-time** link promotes a POTENTIAL retailer to ACTIVE; re-runs never change status (so manual downgrades stick). Owner overrides (which PLM customers to skip / keep POTENTIAL / create) are pinned in the script's `CUST_LINK`/`CUST_CREATE`/`CUST_SKIP` maps. Relation to the customer-split model (curated `retailer` vs `ingested_domains`): see `HANDOFF.md`.

### 3.2 Core PM collections

**`design_collection`** (Spruce only; the account-agnostic trend/art theme)
| field | type | notes |
|---|---|---|
| name | string | "Gaming", "Cowgirl Country" |
| format | string | Wall Art, Floor Coverings, Storage… |
| theme | string | the specific theme |
| business_unit | enum | always Spruce |
| version_date | date | "updated 6.11.25" |
| account_specific_for | M2O → retailer (nullable) | most are null; storage + Hobby Lobby are account-specific |
| lifecycle_state / next_action / next_owner_user / next_owner_role / waiting_on / blocker_reason / blocked_since / risk_level | workflow fields | shared lifecycle and ownership layer (§3.2.1) |
| last_meaningful_update_at / closure_reason / closed_at / closed_by | workflow fields | shared closure and reporting layer (§3.2.1) |

**`project`** — an offer (POP) / an account-specific project (Spruce)
| field | type | notes |
|---|---|---|
| title | string | "Julie Greer @ Burlington — Valentines 2027" / "Forman Mills - Jennifer - Wall Art" |
| business_unit | enum | POP \| Spruce |
| retailer | M2O → retailer | |
| buyer | M2O → buyer | |
| season | M2O → season | |
| design_collection | M2O → design_collection (nullable) | Spruce: which collection this offer drew from |
| licensors | M2M → licensor (POP) | |
| properties | M2M → property (POP) | |
| product_types_requested | M2M → product_type | |
| on_shelf_date | date | when it must be in stores |
| pps_requested_date | date | POP: when the buyer wants the sample (often earlier) |
| restrictions | text | style-guide dates, buyer rules |
| brief | text/rich | the creative brief |
| status | enum | active \| won \| lost \| abandoned |
| selections_pdf | file (asset) | Spruce selections doc |
| lifecycle_state / next_action / next_owner_user / next_owner_role / waiting_on / blocker_reason / blocked_since / risk_level | workflow fields | shared lifecycle and ownership layer (§3.2.1) |
| last_meaningful_update_at / closure_reason / closed_at / closed_by | workflow fields | shared closure and reporting layer (§3.2.1) |

**`design`** — the **design library** (every preliminary design, picked or not; for Spruce, style-numbered art)
| field | type | notes |
|---|---|---|
| name | string | |
| business_unit | enum | |
| licensor | M2O → licensor (POP) | |
| property | M2O → property (POP) | |
| theme | string (Spruce) | |
| product_type | M2O → product_type | |
| season | M2O → season | |
| first_offered_to | M2O → retailer | where it first appeared |
| status | enum | unpicked \| picked \| offered_to_multiple |
| projects | M2M → project | every project it appeared in (multi-buyer detection seam) |
| asset | M2O → asset (Phase 3, nullable) | thumbnail / full file in the DAM |
| nas_path | string | interim until DAM seam exists |
| thumbnail_url | string | interim (DAM DO-Spaces thumbnail) |
| lifecycle_state / next_action / next_owner_user / next_owner_role / waiting_on / blocker_reason / blocked_since / risk_level | workflow fields | shared lifecycle and ownership layer (§3.2.1) |
| last_meaningful_update_at / closure_reason / closed_at / closed_by | workflow fields | shared closure and reporting layer (§3.2.1) |

**`product`** — the executable item: **SKU (POP)** / **Style# (Spruce)**
| field | type | notes |
|---|---|---|
| code | string (unique, read-only after create) | SKU code / style number — **immutable** (enforce via field permission: create-only) |
| name | string | description + dimensions |
| business_unit | enum | POP \| Spruce |
| project | M2O → project | **required** (every product belongs to an offer) |
| design | M2O → design | the design it was built from |
| product_type | M2O → product_type | |
| licensor | M2O → licensor (POP) | |
| property | M2O → property (POP) | |
| factory | M2O → factory | |
| stage | M2O → stage (or single-select) | current pipeline position |
| put_up | string | packaging format |
| on_shelf_date | date | (inherited/echoed from project) |
| pps_requested_date | date (POP) | |
| **cost_target** | decimal | 🔒pricing — **hidden from Designer role** |
| **quoted_cost** | decimal | 🔒pricing |
| brand_assurance_number | string (POP) | required once at "Concept submitted"; reused at production |
| brand_assurance_pdf | file (asset) (POP) | |
| pi_status | enum (POP) | Required \| Not Required \| Completed (default "Not Required") |
| closure_reason | enum | (null while open) cost \| licensing \| sampling \| buyer \| abandoned \| completed |
| created_at / updated_at | timestamp | Directus built-ins (cycle age) |
| lifecycle_state / next_action / next_owner_user / next_owner_role / waiting_on / blocker_reason / blocked_since / risk_level | workflow fields | shared lifecycle and ownership layer (§3.2.1) |
| last_meaningful_update_at / closed_at / closed_by | workflow fields | shared closure and reporting layer (§3.2.1) |

#### 3.2.1 Shared lifecycle and ownership fields

These fields exist on `product`, `project`, `design`, and `design_collection`. They deliberately separate **business state** from **pipeline stage**: stage answers "where is it in the process?", lifecycle answers "what is happening to it as work?"

| field | type | notes |
|---|---|---|
| lifecycle_state | enum | active \| waiting \| blocked \| parked \| reusable \| canceled \| abandoned \| complete |
| next_action | text | plain-language next action, visible in queues and detail views |
| next_owner_user | M2O → directus_users | specific person who owns the next move |
| next_owner_role | M2O → directus_roles | role/team owner when no exact user is known |
| waiting_on | enum | internal_design \| technical_design \| creative_director \| licensing \| licensor \| sales \| buyer \| sourcing \| factory \| production \| unknown |
| blocker_reason | text | why the item is blocked/waiting |
| blocked_since | timestamp | used for stuck-work reporting |
| risk_level | enum | low \| medium \| high \| critical |
| last_meaningful_update_at | timestamp | non-noise update date for freshness/staleness |
| closure_reason | enum | cost \| licensing \| sampling \| buyer \| abandoned \| completed \| duplicate \| other |
| closed_at | timestamp | when the object closed |
| closed_by | M2O → directus_users | who closed it |

**`order`** — purchase-order history (supports multi-buyer reuse + order history)
| field | type | notes |
|---|---|---|
| product | M2O → product | |
| retailer | M2O → retailer | |
| buyer | M2O → buyer | |
| order_number | string | |
| order_date | date | |
| quantity | integer | |
| **value** | decimal | 🔒pricing |
| project | M2O → project | optional direct project/offer context |
| status | enum | pending \| received \| in_production \| shipped \| complete \| canceled |
| notes | text/rich | order-specific notes |

**`product_submission`** — submissions to internal review, licensors, buyers, PPS, packaging, or production
| field | type | notes |
|---|---|---|
| external_id / external_source | string | stable provenance for backfill/import dedupe |
| product | M2O → product | submitted SKU/style |
| project | M2O → project | offer/account context |
| business_unit | enum | POP Creations \| Spruce Line |
| submission_type | enum | internal_review \| licensing_sheet \| concept \| packaging \| pps_sample \| production |
| recipient_type | enum | internal \| licensor \| buyer \| factory |
| licensor | M2O → licensor | POP licensor when applicable |
| submitted_by | M2O → directus_users | |
| submitted_at / expected_response_at | timestamp | sent date and expected response date |
| status | enum | draft \| ready \| submitted \| waiting \| changes_requested \| approved \| rejected \| canceled |
| response_at / response_summary | timestamp / text | approval/rejection/change-request response |
| brand_assurance_number / brand_assurance_file | string / M2O → directus_files | portal proof |
| portal_url / portal_reference | string | external system seam |
| revision_required | boolean | whether response generated a revision |
| revision | M2O → revision_request | linked revision when one exists |
| notes | text/rich | submission context |

**`product_sample`** — factory, buyer, licensor, PPS, and production sample tracking
| field | type | notes |
|---|---|---|
| external_id / external_source | string | stable provenance for backfill/import dedupe |
| product | M2O → product | sampled SKU/style |
| project | M2O → project | offer/account context |
| factory | M2O → factory | factory producing the sample |
| sample_type | enum | pps \| factory \| buyer \| licensor \| production \| resample |
| requested_by | M2O → directus_users | |
| requested_at / expected_at / received_at | timestamp | sample timing |
| sent_to_buyer_at / sent_to_licensor_at | timestamp | outbound sample handoffs |
| status | enum | not_required \| needed \| requested \| in_factory \| received \| under_internal_review \| sent_to_buyer \| sent_to_licensor \| approved \| revision_needed \| canceled |
| primary_photo | M2O → directus_files | primary sample photo/proof |
| photo_urls | text | additional URLs/NAS paths until DAM file relations mature |
| notes | text/rich | sample notes |
| revision_required / revision_reason | boolean / text | why a resample/revision is needed |
| revision | M2O → revision_request | linked revision/resample request |

**`revision_request`** — change requests from Liz/Jen, buyers, licensors, factories, or internal review
| field | type | notes |
|---|---|---|
| external_id / external_source | string | stable provenance for backfill/import dedupe |
| object_collection / object_id | string | generic target seam for non-product revisions |
| product / project / design | M2O | explicit business context |
| submission | M2O → product_submission | submission that generated the revision |
| source | enum | liz \| jen \| licensor \| buyer \| factory \| internal |
| requested_by_user / requested_by_external | M2O → directus_users / string | internal or external requester |
| requested_at / due_at | timestamp | |
| assigned_to | M2O → directus_users | person doing the revision |
| status | enum | open \| in_progress \| resolved \| accepted \| rejected \| canceled |
| body | text/rich | requested change |
| markup_file | M2O → directus_files | markup/reference file |
| resolved_at / resolution_note | timestamp / text | resolution record |

**`pm_saved_view`** — saved view/preferences for the custom PM frontend
| field | type | notes |
|---|---|---|
| user / role | M2O → directus_users/directus_roles | owner/default scope |
| name / screen / business_unit | string / string / enum | view identity |
| filters_json / sort_json / columns_json | json | serialized UI preferences |
| is_default | boolean | default for the owner scope |
| shared_with_role | M2O → directus_roles | optional shared role visibility |

**`pm_dependency`** — cross-item dependencies, blockers, and related-work links
| field | type | notes |
|---|---|---|
| product | M2O → product | product this dependency is tracked from |
| depends_on_product | M2O → product | product this item depends on or relates to |
| project | M2O → project | project/offer context |
| title | string | short dependency title |
| dependency_type | enum | blocked_by \| blocks \| related \| duplicate \| parent_child |
| status | enum | open \| waiting \| resolved \| canceled |
| waiting_on | string | person/team/vendor/licensor/buyer blocking progress |
| due_at / resolved_at | timestamp | expected unblock/follow-up date and resolution date |
| notes | text/rich | dependency notes |
| source_system / source_id | string | optional external provenance |

**`pm_decision`** — structured decision and approval records
| field | type | notes |
|---|---|---|
| product | M2O → product | product context |
| project | M2O → project | project/offer context |
| object_collection / object_id | string | generic target seam for non-product decisions |
| decision_type | enum | approved \| rejected \| changes_requested \| parked \| canceled \| reusable \| buyer_picked \| buyer_passed \| licensor_approved \| sample_approved \| order_received \| custom |
| status | enum | proposed \| decided \| superseded \| canceled |
| decided_by | M2O → directus_users | user who made or recorded the decision |
| decided_at | timestamp | decision time |
| reason / notes | text / text-rich | short rationale and detailed evidence |
| evidence_url | string | proof/portal/source URL |
| source_system / source_id | string | optional external provenance |

**`pm_reminder`** — in-app follow-up reminders and due operational nudges
| field | type | notes |
|---|---|---|
| product | M2O → product | product context |
| project | M2O → project | project/offer context |
| object_collection / object_id | string | generic target seam |
| title | string | reminder title |
| due_at | timestamp | reminder due date/time |
| assigned_to | M2O → directus_users | user responsible for the follow-up |
| status | enum | open \| snoozed \| done \| canceled |
| reminder_type | enum | follow_up \| licensor_response \| buyer_response \| sample_due \| factory_due \| missing_evidence \| stage_sla \| custom |
| snoozed_until / completed_at | timestamp | reminder lifecycle dates |
| notes | text/rich | reminder notes |

**`pm_workflow_template`** — reusable checklist, evidence, and stage-gate templates
| field | type | notes |
|---|---|---|
| name | string | template name |
| business_unit | enum | All \| POP Creations \| Spruce Line \| Software |
| object_type | enum | product \| project \| submission \| sample \| revision |
| template_type | enum | checklist \| stage_gate \| project \| submission \| sample |
| active | boolean | whether the template is available |
| description | text | template description |
| checklist_json / required_evidence_json | json | reusable checklist and evidence requirements |
| default_next_action | text | optional next-action text when applying |
| default_owner_role | M2O → directus_roles | role/team that usually owns the next action |

### 3.2.2 Workflow model migration status

What changed:
The workflow/lifecycle layer above was applied to production on 2026-06-14 by `pm-system/add-workflow-model.mjs`. A one-time evidence backfill then populated 16,534 product lifecycle records plus 84 submissions, 5 samples, and 610 revision requests via `pm-system/migration/backfill-workflow-model.mjs`.

Why:
The imported ClickUp/D1 evidence had repeated task activity, but the custom PM frontend needs synthesized business objects that expose next action, ownership, waiting/blocker context, submissions, samples, and revisions without forcing users to interpret raw history.

Future sessions should:
Treat the backfill as an evidence-derived baseline, not as a full historical recreation of every repeated ClickUp event. Backfilled child rows use `external_source='workflow_backfill_v1'` and stable `external_id` values for dedupe; dry-run the script first and use `APPLY=1` only when intentionally writing.

### 3.2.3 Operating model migration status

What changed:
The PM operating-record layer above was applied to production on 2026-06-22 by `pm-system/add-operating-model.mjs`. It is additive/idempotent and grants app-role permissions for `pm_dependency`, `pm_decision`, `pm_reminder`, and `pm_workflow_template`.

Why:
The `poppim-web` frontend now has first-class, durable records for blockers/dependencies, decisions/approvals, in-app reminders, and reusable workflow/evidence/checklist templates.

Future sessions should:
Extend `pm-system/add-operating-model.mjs` additively for this layer and update this doc plus the frontend `src/lib/types.ts` / `src/features/operating/api.ts`. `pm_reminder` is only the durable reminder record; external notification delivery still needs a future Flow or worker.

### 3.3 Automation / ledger collections

**`stage_history`** — the time-in-stage / SLA ledger (written by a Flow)
| field | type | notes |
|---|---|---|
| product | M2O → product | |
| from_stage | M2O → stage (nullable) | |
| to_stage | M2O → stage | |
| changed_by | M2O → directus_users | |
| changed_at | timestamp | |

From this + `product_type` SLA + `stage` order, compute (in views/analytics, not stored): `time_in_current_stage`, `total_cycle_age`, `projected_completion`, `on_track`.

### 3.4 Forward-compat stubs (define later, in Phases 2–3)
- **CRM (Phase 2):** `retailer`→company, `buyer`→contact already exist; add `opportunity` (or reuse `project`), `activity`, `email_message`, plus the Twenty fork's custom objects (`licensor_approval_thread`, `meeting_note`, `department`).
- **DAM (Phase 3):** `asset` (file, nas_path, thumbnail_url, style_group, metadata, checkout state), `style_group`, `style_guide_file` (PopSG). `design.asset` and `product`/`design` thumbnails point here.

---

## 4. Stage models (status options)

**POP — 17 stages** (`stage` rows, business_unit=POP): Art files creation · Licensing sheet creation · Licensing sheet review *(gate)* · Ready to submit · Concept submitted · Revisions · Concept approved · Concept approved with changes · PO received · Sales requested sample · Sample requested · Sample received · Factory resample · Sample sent to licensor (PPS) · Sample revision · Pre-production approved · Production approved. Plus cancellation handled by `closure_reason`.

**Spruce — 11 stages** (`stage` rows, business_unit=Spruce): Send Out Art for PO · Approved for Future Orders · Sample Received · Sample Requested · Price Requested/Buyer Approving · Initial Approval/Selections Made · With Buyer for Approval · Waiting for Factory · In Work · Upcoming Projects · On Hold.

Kanban: group `product` by `stage`, filter by `business_unit`.

---

## 5. Permissions (Directus policies) — role × access

| Role | product specs/stage | **cost_target / quoted_cost / order.value (pricing)** | brand_assurance / pi | design/art fields | who |
|---|---|---|---|---|---|
| **Designer** | read | **NO READ** (policy hides field) | read | read/write | creative & technical designers |
| **Sales** | read | read | read | read | Adam |
| **Sourcing / China** | read | **read/write** | read | read | Albert + China team |
| **Licensing** | read | read | **read/write** | read | licensing manager/coordinator |
| **Creative Director** | read + move stage | read | read | read/comment | Liz / Jen |
| **PM (admin in line)** | read/write all | read | read | read/write | Jessica |

**The make-or-break test (spike step 5):** log in as **Designer** and confirm `cost_target`/`quoted_cost`/`order.value` are not visible anywhere — this is the one requirement no other evaluated platform met without forking.

---

## 6. Flows (no-code automation)

1. **Stage-history ledger** *(spike)* — trigger: `product.stage` updated → **Create Item** in `stage_history` `{product, from_stage, to_stage, changed_by, changed_at}`.
2. **Dormant alert** — schedule (daily): products at "Concept Approved" with no related `order` and no sample stage for N days → flag/notify.
3. **SLA / stuck alert** — schedule: `time_in_current_stage` (from `stage_history`) > `product_type` SLA for that stage → notify PM.
4. **Multi-buyer conflict** — trigger: a `design` gains a 2nd related `project` while a product is mid-build → notify.
5. **Next-person notification** — trigger: `product.stage` enters a stage owned by another role → notify that role.
6. **Brand Assurance required** — trigger: `product.stage` = "Concept submitted" and `brand_assurance_number` empty → require/flag.

*(Complex logic — multi-buyer detection, the AI assistant — can also live in the existing Cloudflare Worker/D1 layer, fed by Directus webhooks, rather than Flows. Use whichever is simpler per case.)*

---

## 7. Migration mapping (ClickUp → Directus, summary)

- ClickUp parent "project" tasks → `project`; child SKU tasks → `product` (keep the SKU code in `product.code`).
- Spruce `design_collection` from the "General Presentations" board; `design` rows from presentations.
- Licensor/channel **tags** → `licensor`/`property` relations + `business_unit` + flags (drop the stale `for adam` tag).
- Buyer UUIDs → resolve to `buyer.name` where possible.
- Ancient open items (4–5 yr) → import with `closure_reason = abandoned`.
- Use Directus `external_id`/`external_source` = the ClickUp id on every row for traceability.
- Do not leave live ClickUp lists out of Poppim. The 2026-06-14 parity pass imports non-archived ClickUp list tasks into live `product` rows across POP, Spruce, and designflow/Software lists; the audit matched 17,859 live ClickUp task ids to 17,859 Poppim external ids with 0 missing and 0 extra.

### 7.1 Attachment storage parity

What changed:
Imported `product_file` attachments are copied from ClickUp source URLs into DigitalOcean Spaces by `pm-system/migration/clickup-files-to-spaces.mjs`. The frontend should read `thumbnail_url` / `stored_url` before falling back to ClickUp URLs.

Why:
ClickUp attachment URLs are not durable. On 2026-06-14, 20,234 of 20,281 `product_file` rows were stored in Spaces. The remaining 47 rows have source URLs that return 404 or 200 with zero bytes even when probed with `CLICKUP_TOKEN`.

Future sessions should:
Treat those 47 rows as source-byte recovery from another source, not as missing product/card rows. Rerun the Spaces migration only after ClickUp source URLs or replacement files are available.

---

## 8. The minimal spike subset (build these first)

For the Phase-1 spike (`directus-execution-plan.md` §6), build only: `retailer`, `buyer`, `licensor`, `factory`, `project`, `design`, `product` (with `stage` as a simple single-select of the Spruce 11), `stage_history`, plus the **Designer policy hiding pricing** and the **stage-history Flow**. That's enough to prove the relational graph, the Kanban board, field-level visibility, and the SLA foundation — with zero custom code.
