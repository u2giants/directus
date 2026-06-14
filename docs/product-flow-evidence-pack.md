# Product Flow Evidence Pack

**Last updated:** 2026-06-14

This is the no-shortcut evidence pack for understanding why we monitored ClickUp and what the monitoring proved. It combines the business process, the way ClickUp was actually used, and the raw evidence that should not be lost when designing the replacement Directus system.

Use this with:
- `docs/business-process.md` for the polished business narrative.
- `docs/pm-system-design.md` for the replacement-system requirements.
- `BUSINESS_INTELLIGENCE.md` for the earlier analysis layer. Treat it as useful but partly stale where it says Jen was not yet interviewed.
- Cloudflare D1 `clickup-events` for raw source-of-truth inspection.

## Executive Summary

The monitoring had two jobs:

1. Understand how ClickUp is used so we can design a replacement the team will actually use.
2. Understand the business flow: how an idea becomes a product, how approval works, where work stalls, and what information is currently trapped outside the system.

The central finding is that the business is not one workflow. It is two related businesses sharing people, sales, factories, and product development:

| Business | What it sells | Approval model | Real tracking units |
|---|---|---|---|
| POP Creations | Licensed home decor using Disney, Marvel, WB, etc. | Internal creative review + licensor concept approval + licensor sample/PPS approval | Offer/project, SKU, reusable design |
| Spruce Line | Generic/original home decor | Internal/buyer approval only; no licensor | Trend collection, account project, style-numbered product |

ClickUp blurred those tracking units together. Directus must not.

## Evidence Inventory

Live D1 summary as of 2026-06-14:

| Evidence surface | Rows | What it proves |
|---|---:|---|
| `products` | 9,069 | Denormalized product/query layer; useful but not perfect truth |
| `tasks` | 17,751 | Raw ClickUp task hierarchy from snapshot |
| `events` | 2,691 | Live webhook behavior, 2026-03-30 to 2026-06-13 |
| `status_transitions` | 18,156 | Estimated + live status changes |
| `task_assignments` | 14,718 | Assignment signals |
| `task_tags` | 13,333 | De-facto metadata: licensor, channel, workflow flags |
| `task_comments` | 269 | NAS paths, PDFs, screenshots, handoffs, creative/context notes |
| `checklist_items` | 33,324 | Historical checklist/milestone material |
| `product_checkpoints` | 32,534 | Classified product milestone records |
| `interview_questions` | 77 | Answered structured interviews with Jessica, Liz, and Jen |

Known empty or incomplete surfaces:

| Surface | Rows | Meaning |
|---|---:|---|
| `task_attachments` | 0 | Attachments exist in events/comments, but attachment webhook storage is not populated |
| `task_links` | 0 | Linked-task relationships were not captured into this table |
| `time_entries` | 0 | No usable ClickUp time tracking captured |
| `custom_field_definitions` | 0 | List-level field definitions were not fetched |
| `workspaces` | 0 | Structural table exists but was not populated |

## Confidence Map

| Area | Confidence | Why |
|---|---|---|
| POP high-level flow | High | Jessica interview + D1 statuses/checkpoints/tags align |
| POP roles and handoffs | High | Jessica + Liz answers agree on ownership |
| POP licensor/compliance flow | High | Jessica explains Brand Assurance/PI; Liz explicitly does not own Brand Assurance |
| POP exact historical time-in-stage | Medium | Status transitions are mostly estimated; only 391 rows have real webhook from-to transitions |
| Spruce high-level flow | High | Jen interview resolved the earlier provisional model |
| Spruce account-specific variations | Medium-high | Jen gave examples, but not an exhaustive account-by-account rules table |
| Designer productivity metrics | Medium-low | Desired by Liz/Jessica; raw data is incomplete for actual design output and pick rates |
| File/attachment flow | Medium | Comments and events show files/paths, but attachment table is empty |

## The Business Objects

### POP Creations Objects

**Offer / project.** One offer to one buyer at one retailer for one season. It carries the brief: buyer, retailer, season, product types, licensed properties, restrictions, on-shelf date, and any PPS/sample expectations.

**SKU.** A specific picked product carried through licensor approval and production. A SKU exists when something must be submitted to the licensor system. It may originate from a buyer pick, a proactive concept, a sample-first effort, or anything else that requires licensor approval.

**Reusable design.** A preliminary design shown to a buyer but not picked, or an approved concept that never reached PO/sample. This is real creative inventory, but ClickUp usually hides it inside the original project/presentation.

### Spruce Line Objects

**Trend/art collection.** A body of original art around a theme or format, such as Gaming, Farmhouse, Cowgirl Country, Soft Religion, Wall Art, Floor Coverings, Storage, Seasonal, or Garden. Collections can contain hundreds of designs and are usually account-agnostic.

**Account project.** One buyer/account body of work, often named as account, buyer, title, and status notes. It holds the buyer brief and selections.

**Style-numbered product.** The committed product identity in Spruce. A design becomes a real product when the buyer commits to a size/format and order, or when a sample is requested for an account that uses samples. Files are findable by style number.

## Complete POP Flow

| # | Step | Owner | Evidence | Nuance to preserve |
|---:|---|---|---|---|
| 1 | Idea or buyer request starts | Sales, PM, creative/product team | Jessica Q2; tags/lists such as `customer refresh`, `prod development` | Ideas come from shopping trips, factories, internet inspiration, existing formats, buyer requests, or internal line refreshes |
| 2 | Offer/project brief created | Sales + Jessica | Jessica Q7; parent/child D1 hierarchy | The brief prevents designers from memorizing buyer/property/season restrictions |
| 3 | Preliminary designs created | Creative designers | Jessica Q3/Q6/Q8; comments/files | Designs shown but not picked are the biggest lost asset |
| 4 | Liz reviews preliminary presentation | Liz | Jessica Q4; Liz Q28/Q29 | Liz uses aesthetic and licensor judgment; this is not a mechanical checklist |
| 5 | Adam presents to buyer | Sales | Jessica Q4/Q7 | Buyer picks may define format, material, size, and specs |
| 6 | Buyer pick becomes SKU or approval candidate | Creative designer + Jessica | Jessica Q56 | SKU creation is triggered by licensor submission need, not only by a purchase order |
| 7 | Creative designer writes SKU description and prepares art files | Creative designer | Jessica Q9/Q10 | Description includes material, size, and artwork description |
| 8 | Technical designer creates licensing sheet and packaging | Technical designer | Jessica Q10; Liz Q23 | The licensing sheet exposes details that may trigger later rework |
| 9 | Liz reviews licensing sheet | Liz | Jessica Q11; Liz Q22/Q23/Q25 | Recurring bottleneck; Pantones and manufacturing specs are core review pain |
| 10 | Liz sends approved sheet to licensing team | Liz + licensing team | Jessica Q10 | Jessica wants to ask how many SKUs have LS ready but not sent |
| 11 | Concept/packaging submitted to licensor portal | Licensing team | Jessica Q5/Q10/Q39 | Only licensing talks to licensors; Brand Assurance submission number is recorded here |
| 12 | Licensor responds | Licensor | Stages/tags/checkpoints | Outcomes: approved, approved with changes, or revisions/rejection |
| 13 | Revisions loop if needed | Creative/technical designer + Liz | Jessica Q11; Liz Q24/Q32 | Feedback currently lives in Teams/Illustrator markups and gets lost |
| 14 | Concept approved | Licensor | 1,574 products at Concept Approved | Approved concepts may still never reach PO/sample; they should be reusable inventory |
| 15 | Buyer PO received or sales requests sample | Buyer/Sales + technical designer | Jessica Q10/Q21 | On-shelf date and PPS-requested date are different fields |
| 16 | Tech pack/factory prep | Technical designer + sourcing/China | Jessica Q21/Q38 | Designers need costing/factory constraints before this point |
| 17 | Sample requested from factory | Factory via technical/sourcing flow | Jessica Q10 | Factory constraints sometimes surface too late |
| 18 | PPS photos/sample received and reviewed internally | Liz + licensing team | Jessica Q10; Liz Q23 | Internal review precedes licensor PPS submission |
| 19 | Factory resample if needed | Factory | Jessica Q10/Q37 | Cancellation can happen if construction is impossible or too expensive |
| 20 | Sample/PPS submitted to licensor | Licensing team | Jessica Q10 | Some licensors need more than PPS photos |
| 21 | PPS approved or sample revision requested | Licensor | Jessica Q5/Q10 | PPS approval authorizes mass production |
| 22 | Production approval / closure | Licensing/production | Jessica Q5/Q37/Q39 | Requirements vary: safety form, physical sample, PPS approval alone, Brand Assurance/trademark forms for import |

### POP Licensor Rules and Compliance

Licensors check asset correctness, color, storytelling, packaging guideline compliance, and style-guide validity for the on-shelf date. They reject designs for mixed style guides, distorted characters, poor storytelling, packaging mismatch, or invalid timing.

Expected licensor response times from Jessica:

| Licensor | Expected response |
|---|---|
| Disney | 1-3 days |
| LucasFilm / Star Wars | 1-2 days |
| Marvel | 1-2 days |
| Nickelodeon / Paramount | 3-6 days |
| Sesame Street | 4 days |
| Coca-Cola | 6 days |
| NBC Universal | 5-7 days |
| Warner Brothers | 5-10 days |
| Peanuts | 7-10 days |
| SEGA | 7-10 days |
| Strawberry Shortcake / WildBrain CPLP | 7-10 days |
| WWE | 7-10 days |
| Care Bears | 7-10 days |
| One Piece / TOEI | 7-15 days |

**Brand Assurance** is the licensor submission number/PDF. It is recorded by licensing and reused for shipping/import compliance. Liz does not own or recognize this checkpoint.

**PI / Product Integrity** is a materials safety report required by some licensors. It should be modeled as required, not required, or pending/complete rather than as a universal binary checkbox.

### POP Failure Modes

| Failure mode | Evidence | Design implication |
|---|---|---|
| Lost preliminary designs | Jessica Q6/Q8 | Design library must capture unpicked designs, not just SKUs |
| Liz bottleneck | Jessica Q11; Liz Q22/Q23 | Need review queue by age and submission completeness |
| Pantone/spec errors | Liz Q25/Q27 | Validate Pantone presence and surface manufacturing specs |
| Manual stage pushing by Jessica | Jessica Q13/Q17 | Each role must be able to advance own work with simple handoff controls |
| Capacity surges | Jessica Q19 | Need workload/capacity view and batch operations |
| Approved concepts go dormant | Jessica Q36; 1,574 Concept Approved | Need reusable inventory and lifecycle states: active, parked, canceled, reusable, complete |
| Ancient open items | Jessica Q37; 246 SKU Created | Need formal cancel/abandon reason |
| Revisions lost in Teams/markups | Liz Q24/Q32/Q54 | Revision notes must attach to the product/submission |
| Costing/factory constraints arrive late | Jessica Q38 | Designers need constraints at design time, while pricing stays role-restricted |

## Complete Spruce Flow

Spruce Line is not a light version of POP. It is a different business. There is no licensor, no licensing sheet, and no PPS licensor approval. The main approval path is Jen/internal review, Adam/buyer feedback, then order/sample/factory execution.

| # | Step | Owner | Evidence | Nuance to preserve |
|---:|---|---|---|---|
| 1 | Theme, collection, or account need starts | Jen + team / buyer | Jen Q40/Q42/Q66/Q70 | Usually proactive art themes; sometimes buyer asks for a specific missing theme |
| 2 | Twice-monthly art/product planning | Jen + design team | Jen Q66 | Jen sends recap assigning who works on what |
| 3 | Art/product development | Jen, Mal, Vie, Nat | Jen Q60/Q66 | Nat pre-screens AI art; Mal and Jen also design |
| 4 | Presentation finalized | Jen | Jen Q44 | Jen finalizes before Adam presents |
| 5 | Adam presents to buyer | Adam | Jen Q44/Q47 | Buyer selections are captured in ClickUp and a visual selections PDF |
| 6 | Buyer-specific branch | Jen/Adam/buyer | Jen Q59/Q64/Q70 | Some work is account-specific from the start, especially storage and Hobby Lobby |
| 7 | Selection document created | Jen/team | Jen Q47/Q59 | Often precedes style numbers |
| 8 | Commitment event | Buyer/Jen/team | Jen Q49/Q59/Q71 | Style numbers are assigned when the buyer commits to format/order, or sample path requires it |
| 9 | Costing tech pack | Design team | Jen Q65 | Design makes costing tech pack for DesignFlow |
| 10 | Factory selection and costing | Albert + China Team | Jen Q65/Q73 | Pricing/factory transparency is a bottleneck |
| 11 | Adam approves costing | Adam | Jen Q65 | Sales approval is part of costing |
| 12 | Samples if account requires them | Mal/Jen/buyer/factory | Jen Q44/Q60 | Burlington does not sample; Hobby Lobby does |
| 13 | PO/order execution | Yuchen/factory/design team | Jen Q68/Q71 | Factory deadline email triggers file prep |
| 14 | Production/completion | Factory + Jen/team | Jen Q43/Q44 | Jen moves the task forward as parts complete |

### Spruce Account Variants

| Account/pattern | Process detail | Evidence |
|---|---|---|
| Burlington / buyer Anna | No samples. Meeting to selections document to final order selections; style numbers assigned only after final order selection. | Jen Q59/Q64 |
| Hobby Lobby / buyer Kyle | Samples required. Meeting to selections document, team chooses size/format, Kyle approves or requests changes, style numbers assigned, samples requested. | Jen Q59/Q64 |
| Ollies | Best-case account: buyer buys everything selected, only canvas format, pricing already exists, buyer communicates well. | Jen Q74 |
| Storage designs | Account-specific exception; not purely general collection work. | Jen Q59 |
| General Presentations | Sales self-serve board for Adam; organized by New Formats, Trend Boards, Garden, Floor Coverings, Storage, Seasonal, Wall Decor, Wall Art, General. | Jen Q58/Q63 |
| Freelancers Generic | Failed art-development tracking experiment; do not model as a live workflow. | Jen Q62 |

### Spruce Failure Modes

| Failure mode | Evidence | Design implication |
|---|---|---|
| Chasing people for status | Jen Q45 | Need one shared system with clear next steps |
| Factory/pricing opacity | Jen Q45/Q73 | Track costing/sample timing outside design team's memory |
| Buyer stalls | Jen Q69 | Need formal parked/canceled state and quarterly review support |
| No timeline tracking | Jen Q68/Q75 | Capture factory deadline, pricing duration, sample duration |
| Revisions scattered | Jen Q67 | Attach buyer feedback/marked-up files to project/product |
| High-res art not always available | Jen Q77 | Design library cannot assume every trend design has production art |

## ClickUp Structure: What We Must Not Copy Blindly

ClickUp lists mix object types. They contain parent cards, child SKU tasks, presentations, admin tasks, and dead experiments.

| Space | List | Parent tasks | Child tasks | Total |
|---|---|---:|---:|---:|
| POP Creations | Licensing Management | 7,281 | 4,280 | 11,561 |
| POP Creations | Customer Refresh | 264 | 2,446 | 2,710 |
| Spruce Line | Edge Generic | 701 | 565 | 1,266 |
| POP Creations | New Prod Development | 199 | 457 | 656 |
| POP Creations | Licensing Administration Tasks | 236 | 314 | 550 |
| POP Creations | Customer Category Expansion | 78 | 428 | 506 |
| POP Creations | Licensor's projects | 38 | 103 | 141 |
| Spruce Line | Freelancers Generic | 111 | 22 | 133 |
| Spruce Line | General Presentations | 48 | 28 | 76 |
| POP Creations | Freelancers Licensed | 64 | 10 | 74 |
| Spruce Line | Store Shopping | 3 | 17 | 20 |
| POP Creations | Sourcing/Sampling Projects | 6 | 12 | 18 |
| designflow | development | 18 | 0 | 18 |
| Spruce Line | Dev | 17 | 0 | 17 |
| Spruce Line | Nathalie - Tasks | 3 | 0 | 3 |
| POP Creations | Carlos | 1 | 0 | 1 |
| Spruce Line | New Prod Ideas | 1 | 0 | 1 |

The replacement must model business objects explicitly:

| ClickUp shape | Directus shape |
|---|---|
| Parent task used as project/offer | `project` |
| Child task used as picked SKU | `product` |
| Unpicked or reusable art/design | `design` |
| Spruce trend collection | `design_collection` |
| Status history hidden in ClickUp columns | `stage_history` |
| Tags as metadata | Typed relations and enums |
| Comments/files/Teams scattered | Structured notes, assets, NAS paths, submission records |

## Status Evidence

Top POP stages from `products`:

| Stage | Category | Products | Active |
|---|---|---:|---:|
| Pre-Production Approved | Pre-Production | 2,387 | 1 |
| Production Approved | Production | 2,175 | 0 |
| Concept Approved | Concept | 1,574 | 0 |
| Concept Submitted | Concept | 327 | 0 |
| Sample Requested | Pre-Production | 310 | 0 |
| SKU Created | Fulfillment | 246 | 0 |
| Complete | Complete | 227 | 22 |
| Revisions | Concept | 210 | 0 |
| Design Done | Design | 71 | 12 |
| Idea Notes | Ideation | 71 | 2 |
| Design Brief | Design | 60 | 14 |
| Design Complete | Design | 60 | 5 |
| Buyer Approval | Production | 54 | 9 |
| Buyer Insight | Ideation | 52 | 25 |
| Design In Progress | Design | 47 | 17 |
| In Progress | Design | 42 | 7 |

Important interpretation: many "approved" products are not live work. They are historical, reusable, closed-in-practice, or stale-but-never-formally-closed records. Do not infer that every non-closed ClickUp status means active business work.

Top raw statuses in Spruce:

| Status | What it means |
|---|---|
| Complete / Completed | Done work; historical volume dominates |
| On Hold / Hold | Parked but not always formally closed |
| Wall Art / Floor Coverings / Seasonal / Storage | Category-like buckets mixed into the board |
| Ideas / In Progress / In Work | Design and development work |
| Send Out Art for PO | Art is tied to an order path |
| Initial Approval / Selections Made | "Int apprvd" means initial, not internal |
| With Buyer for Approval | Buyer stall/waiting state |
| Waiting for Factory | Factory-side handoff |
| Price Request / Buyer Approving | Costing/buyer decision limbo |

## Tag Evidence

Top raw task tags:

| Tag | Rows | Interpretation |
|---|---:|---|
| `disney` | 3,574 | Licensor/property metadata |
| `marvel` | 2,125 | Licensor/property metadata |
| `customer refresh` | 1,516 | Buyer/request/channel metadata |
| `wb` | 1,208 | Warner Bros |
| `star wars` | 1,095 | Licensor/property metadata |
| `nick` | 495 | Nickelodeon |
| `nbcu` | 491 | NBCUniversal |
| `on po` | 356 | Order/PO signal |
| `sega` | 341 | Licensor/property metadata |
| `peanuts` | 272 | Licensor/property metadata |
| `before and after presentation` | 228 | Presentation format/process signal |
| `customer category expansion` | 182 | Buyer/category-expansion workflow |
| `for licensor` | 160 | Routing/submission signal |
| `strawberry shortcake` | 142 | Licensor/property metadata |
| `prod development` | 142 | Internal development workflow |
| `internal approval` | 133 | Approval/routing signal |
| `packaging submitted` | 105 | Milestone signal |
| `for adam` | 104 | Stale; Jessica says not to carry forward |
| `stallion art wholesale only` | 62 | Wholesale sublicensor channel |

Tags are the old metadata layer. They should be converted to fields/relations where meaningful, not preserved as the primary model.

## Behavioral Evidence

Live webhook events captured from 2026-03-30 to 2026-06-13:

| Event type | Count | Meaning |
|---|---:|---|
| `taskUpdated` | 1,888 | Content/edit/file/field churn dominates |
| `taskStatusUpdated` | 402 | Stage movement sample |
| `taskAssigneeUpdated` | 102 | Handoffs |
| `taskCreated` | 99 | New tasks |
| `taskDueDateUpdated` | 57 | Deadlines exist but are not the dominant signal |
| `taskCommentPosted` | 53 | Comments are sparse relative to edits |
| `taskPriorityUpdated` | 41 | Mostly system/default priority behavior, not a strong business signal |
| `taskMoved` | 36 | Movement between lists/sections |

Top actors in the live webhook log:

| User | Events | Interpretation |
|---|---:|---|
| Elizabeth | 1,109 | Heavy review/edit activity; creative gate is visible in behavior |
| Umamaheswararao Meka | 943 | Technical/factory/design operations are heavily represented |
| Jennifer Chaffier | 292 | Spruce flow active in ClickUp |
| ClickBot | 80 | System/default updates |
| Ilona Kereki | 75 | Creative/designer activity |
| Vaibhav | 55 | Designer/offshore activity |
| Jessica Cortazar | 8 | PM work is not fully represented by ClickUp clicks |

Interpretation: ClickUp event counts do not equal labor. Jessica's low event count does not mean low involvement; her work is coordination, decision-making, and manual routing that is partly off-system.

## Raw Interview Nuance Worth Preserving

The polished process docs are good, but these exact points are easy to lose:

| Person | Nuance |
|---|---|
| Jessica | SKU creation is triggered by needing licensor approval, not only by buyer picks |
| Jessica | On-shelf date and PPS-requested date are different and both matter |
| Jessica | Approved concepts are wasted unless resurfaced to buyers |
| Jessica | Formal cancellation needs reasons: cost, licensing, sampling/manufacturing, buyer decline |
| Jessica | Project management should become proactive seasonal planning, not reactive buyer-response chaos |
| Jessica | Many people do not understand the full workflow; wrong people doing tasks causes rework |
| Liz | Her review depends on 20 years of judgment; do not over-mechanize it |
| Liz | Pantones and product specs are more valuable to validate than generic style-guide checks |
| Liz | Brand Assurance is not part of her mental model; it belongs to licensing/compliance |
| Liz | Revision notes in a different platform are not automatically better unless the work is actually centralized |
| Liz | Wholesale sublicensor work is harder because outside teams often do not understand licensing guidelines |
| Jen | Spruce tasks represent account projects or general development projects, not always individual products |
| Jen | High-res art for trend collections often does not exist until a buyer asks |
| Jen | "Int apprvd" means initial approval, not internal approval |
| Jen | "Art sent for PO" is always for an order; order numbers are added to task titles once received |
| Jen | General Presentations exists so Adam can self-serve presentations |
| Jen | Spruce shares product development with POP, but not art |

## What Is Still Not Fully Reflected Elsewhere

These are the areas where raw data still adds understanding beyond the current docs:

1. **Post-May-19 webhook behavior.** `BUSINESS_INTELLIGENCE.md` uses a live window ending May 19, but D1 has 1,440 additional events through June 13. These mostly reinforce attachment/content editing and ongoing Spruce/technical activity.
2. **Exact interview wording.** The 77 raw answers include examples and phrasing that are condensed in the docs. If a design decision hinges on nuance, query `interview_questions`.
3. **Comments as operational breadcrumbs.** `task_comments` contains NAS paths, PDFs, screenshots, costing/product-dev references, and handoff text that should inform file and note modeling.
4. **Full raw status vocabulary.** The simplified stage maps are useful, but raw statuses reveal category/status mixing, typo variants, and account-specific process labels.
5. **Raw tag vocabulary.** Tags include licensor, channel, workflow, routing, stale habits, and business exceptions. The top tags are documented; the long tail may matter during migration.
6. **ClickUp content edits.** Many updates are content/attachment changes rather than status changes. A replacement must make files, visuals, notes, and incremental updates first-class, not just stage movement.

## Design Rules Derived From the Evidence

1. **Model POP and Spruce separately, on one shared backend.** They share people and reporting needs, not the same lifecycle.
2. **Do not use one generic "task" as the core business object.** Use project, product/SKU, design, design collection, and stage history.
3. **Preserve reusable creative inventory.** Unpicked POP designs and approved-but-unsold concepts are valuable business assets.
4. **Keep pricing hidden from designers, but expose manufacturing constraints.** This is the difference between secrecy and useful work context.
5. **Make handoffs incremental.** The PM needs to see the first 5 of 20 art files, not wait for all 20.
6. **Let experts keep judgment.** Liz and Jen should not be boxed into fake checklists for aesthetic decisions.
7. **Centralize notes and revision history.** Teams/email/Illustrator can still exist, but the product record needs the durable answer.
8. **Capture explicit lifecycle states.** Active, parked, reusable, canceled, abandoned, complete, and waiting-on-buyer/factory/licensor are different.
9. **Use data for proactive season planning.** The target is not just replacing ClickUp; it is turning historical timing into offers before buyers ask.
10. **Keep the D1/Worker layer as evidence/reporting.** D1 is still useful for analytics, AI questions, SLA alerts, and monitoring Directus once ClickUp is no longer primary.

## Query Pointers

Useful D1 queries when revisiting this evidence:

```sql
-- Table counts and freshness
SELECT COUNT(*) FROM events;
SELECT MIN(received_at), MAX(received_at) FROM events;
SELECT COUNT(*) FROM products;
SELECT COUNT(*) FROM interview_questions;

-- ClickUp hierarchy by list
SELECT s.name AS space_name, l.name AS list_name,
  SUM(CASE WHEN t.parent_task_id IS NULL THEN 1 ELSE 0 END) AS parent_tasks,
  SUM(CASE WHEN t.parent_task_id IS NOT NULL THEN 1 ELSE 0 END) AS child_tasks,
  COUNT(*) AS total
FROM tasks t
LEFT JOIN lists l ON t.list_id = l.id
LEFT JOIN spaces s ON l.space_id = s.id
GROUP BY t.list_id
ORDER BY total DESC;

-- Stage distribution
SELECT space_name, stage_name, stage_category, COUNT(*) AS products,
  SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active
FROM products
WHERE is_internal = 0
GROUP BY space_name, stage_name, stage_category
ORDER BY space_name, products DESC;

-- Raw interview answers
SELECT respondent, topic, question, answer
FROM interview_questions
ORDER BY respondent, id;

-- Raw tags
SELECT tag_name, COUNT(*) AS rows
FROM task_tags
GROUP BY tag_name
ORDER BY rows DESC;

-- Recent webhook behavior
SELECT event_type, user_name, field_changed, from_value, to_value, received_at
FROM events
ORDER BY received_at DESC
LIMIT 100;
```

## Bottom Line

There is no single old document that preserves every nuance. This pack is intended to become that bridge: a compact but evidence-backed source that keeps the process narrative, the D1 proof, and the raw nuance in one place.

For business understanding, start here and then read `docs/business-process.md`. For implementation, read `docs/pm-system-design.md` and `docs/data-model.md` after this.
