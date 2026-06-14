# PM System Design — The Tailored POP Project Management System

**Purpose.** This is the product and workflow spec for the project-management system the company actually needs. It is broader than "replace ClickUp." It captures what the team already used ClickUp for, what ClickUp could not do, and what the employee interviews revealed the system should do if it were built around the real POP Creations and Spruce Line business.

**Read first:** `docs/business-process.md` for the business flow and vocabulary. Use `docs/product-flow-evidence-pack.md` when you need to validate why a requirement exists. The concrete Phase-1 Directus schema lives in `docs/data-model.md`; the build/deploy mechanics live in `docs/directus-execution-plan.md` and `pm-system/`.

**Design target.** One shared Directus-backed PM system for two different product lines:

| Line | Workflow reality | The system must do |
|---|---|---|
| **POP Creations** | Licensed, heavyweight, 17-stage licensor pipeline, many gates and compliance records | Track project offers, SKUs, licensor submissions, samples, approvals, reusable concepts, and strict handoffs |
| **Spruce Line** | Generic/original, buyer-driven, collection/project/style-number flow, account-specific exceptions | Track design collections, account projects, selections, style-numbered products, pricing/sample timing, and sales self-service |

The goal is not a prettier task board. The goal is a system where **nothing creative gets lost, every handoff has an owner, status is self-explanatory, constraints are visible before rework happens, and the company can plan seasons proactively instead of reacting to buyer requests at the last minute.**

---

# PART 1 — What ClickUp Taught Us

## 1.1 The Old System Was Hiding Different Business Objects

ClickUp made everything look like tasks. The monitored data showed that this was the root structural problem. The business actually uses several different objects:

| Business object | Meaning |
|---|---|
| **Project / offer** | A buyer/retailer/season/account body of work; the brief and context |
| **Product / SKU / style number** | A committed item that can be approved, sampled, ordered, shipped, and reused |
| **Design** | Creative work that may or may not become a product |
| **Design collection** | Spruce trend/theme inventory, often account-agnostic |
| **Submission** | A package sent for internal, licensor, buyer, or sample approval |
| **Order** | A purchase/order history record for a product |
| **Stage history** | The time-and-owner trail of how work moved |

ClickUp's parent/child structure proved this split. For example, Licensing Management had 7,281 parent cards and 4,280 child tasks; Customer Refresh had 264 parent cards and 2,446 child tasks. The system must preserve this hierarchy instead of flattening it.

## 1.2 What ClickUp Did Okay

- Gave people a board where they could see rough stage/status.
- Let the team attach files, paste paths, write comments, assign people, and update due dates.
- Let Jessica and Jen build custom views around their personal workflows.
- Was flexible enough for messy work, which matters because the process has exceptions.

## 1.3 What ClickUp Could Not Do

- Distinguish project, SKU, design, collection, submission, and order as separate business objects.
- Keep unpicked preliminary designs or approved-but-unsold concepts searchable and reusable.
- Show true time-in-stage, on-track/off-track status, or projected completion.
- Make each person update their own step without Jessica manually moving work.
- Keep revision notes, marked-up files, Teams messages, NAS paths, and approval history in one place.
- Hide pricing from designers while still showing them manufacturing constraints.
- Give Liz a clean review queue without forcing her creative judgment into a rigid checklist.
- Give Adam self-service status across POP and Spruce.
- Make Spruce's account-specific exceptions visible without forcing POP's licensor workflow onto it.
- Turn historical timing into proactive seasonal planning.

## 1.4 The Non-Negotiable Lesson

The new system must not ask, "What task is this?" first. It must ask, **"What kind of business object is this, who owns the next decision, and what evidence is needed to move forward?"**

---

# PART 2 — Product Principles

1. **Two businesses, one platform.** POP and Spruce share people, buyers, factories, and reporting needs, but they do not share the same workflow.
2. **Business objects before boards.** Boards are views over projects, products, designs, submissions, and orders; they are not the data model.
3. **Nothing creative gets lost.** Designs that were not picked, concepts approved without PO, and Spruce trend art remain searchable inventory.
4. **Make the easy path the correct path.** Updating one item, marking 5 of 20 art files done, adding a NAS path, or sending work to the next role must be quick.
5. **Experts keep judgment.** Liz and Jen make creative decisions; the system should organize submissions and evidence, not pretend aesthetic review is a checklist.
6. **Constraints are visible, pricing is protected.** Designers need die lines, material limits, print methods, Pantones, and construction notes; they do not need sensitive pricing.
7. **Stage is not enough.** Files, comments, revisions, submission numbers, samples, factory deadlines, and buyer notes are part of status.
8. **Lifecycle states are explicit.** Active, waiting, stuck, parked, reusable, canceled, abandoned, and complete are different.
9. **Proactive beats reactive.** The system should help the company plan seasonal offers before buyers ask.
10. **Configuration first, extensions only where useful.** Use Directus collections, relations, roles, Flows, and views as the base; add custom UI/services where the workflow deserves it.

---

# PART 3 — Core Data Model the Product Must Expose

The Phase-1 schema in `docs/data-model.md` is the starting point, but the product experience must make these concepts obvious to users.

## 3.1 Shared Objects

| Object | What users need from it |
|---|---|
| **Retailer** | Store/account context, resale restrictions, linked buyers, history of projects/products |
| **Buyer** | Person at retailer, sample requirements, account-specific process notes |
| **Factory** | Capabilities, constraints, contacts, pricing/sample timing, known issues |
| **Product type** | Product category plus expected stage timing and manufacturing constraints |
| **Season/calendar** | POP seasonal cycle and Spruce account-specific timing |
| **Stage** | Current workflow position, owner role, SLA expectations, entry/exit requirements |
| **Stage history** | Who changed what, when, and how long the item spent there |
| **Asset/file reference** | NAS path, thumbnail, presentation PDF, licensing sheet, sample photos, marked-up revision file |
| **Note/revision** | Durable explanation of what changed, who requested it, and what evidence was attached |

## 3.2 POP Objects

| Object | Required behavior |
|---|---|
| **Project / offer** | Carries buyer, retailer, season, licensors/properties, restrictions, product types requested, on-shelf date, PPS-requested date, and creative brief |
| **SKU/product** | Linked to project and design; carries code, stage, owner, licensor/property, factory, compliance records, samples, orders, cancellation/reuse status |
| **Design** | Searchable by licensor, property, product type, season, retailer, source project, picked/unpicked/reusable status |
| **Licensor submission** | Records concept/PPS/production submissions, Brand Assurance, result, response date, revision notes, related files |
| **Order history** | Tracks which retailers bought or reused the product and when |

## 3.3 Spruce Objects

| Object | Required behavior |
|---|---|
| **Design collection** | Account-agnostic or account-specific trend/theme grouping; may contain hundreds of presentation-level designs |
| **Account project** | Buyer/account-specific work with selections PDFs, account rules, status, and next step |
| **Style-numbered product** | Created only when selection becomes a committed order/sample path; style number is permanent |
| **General presentation** | Sales-accessible presentation inventory for Adam; distinct from account projects |
| **Sample/pricing tracker** | Tracks costing tech pack, DesignFlow/pricing status, Adam approval, factory/sample timing |

---

# PART 4 — Role-by-Role Workflows

## 4.1 Jessica — POP Project Manager

Jessica's system should open to a control room, not a generic board.

She needs to see:

- Projects/SKUs due soon, grouped by risk.
- SKUs stuck beyond expected time in current stage.
- Licensing sheets waiting for Liz.
- Art files not yet delivered by creative.
- Tech packs ready but missing factory confirmation.
- Concepts approved but not tied to PO/sample.
- Designer workload and capacity surges.
- Projects for the same retailer/client.
- Products that should be canceled, parked, or resurfaced.

She needs to do:

- Batch move products when a business event affects many SKUs.
- Assign or reassign designers and technical designers.
- Convert buyer picks into SKUs.
- Review partial progress, not just all-or-nothing completion.
- See next action for a project: e.g., "27 SKUs total; 20 sample requested; 3 concept approved; 4 concept submitted."
- Export SKU/project data and download mockups/thumbnails for buyer or internal review.

The system must reduce her manual stage pushing. Each role should advance its own step, while Jessica manages exceptions, deadlines, and resource allocation.

## 4.2 Liz — POP Creative Director

Liz needs a review queue that respects her expertise.

She needs to see:

- Licensing sheets awaiting review, sorted by age, deadline, retailer, licensor, and designer.
- Submission package completeness: licensing sheet, packaging, Pantones, product specs, art, NAS path, style-guide context.
- Product manufacturing details: how the item is made, materials, dimensions, construction notes.
- Prior revision history and licensor rejection patterns.
- Designer track record by licensor/property/product type.
- Wholesale sublicensor submissions separated from internal-team submissions.

She needs to do:

- Approve, reject, or request changes with structured notes.
- Attach marked-up files or screenshots.
- Route approved sheets to licensing.
- See all notes in one place instead of Teams, Illustrator markups, and email fragments.

Important: the system should **not** make Liz fill out a fake aesthetic checklist. It should make sure required evidence is present, then give her a clean decision surface.

## 4.3 Jen — Spruce Creative Director

Jen needs a lifecycle and follow-up cockpit, not a licensor pipeline.

She needs to see:

- General design collections by theme/format.
- Account projects by stage: upcoming, in work, with buyer, pricing, sample, waiting for factory, art sent for PO, complete, on hold.
- Which projects need follow-up with designers, Adam, Albert/China, factories, or buyers.
- Which selections have become style-numbered products and which are still presentation-level designs.
- Sample requests at factories and how long they have been there.
- Pricing requests and how long they have been with DesignFlow/Albert/China.
- Account-specific rules such as Burlington no-sample flow and Hobby Lobby sample flow.
- Stale "with buyer" work that needs quarterly review.

She needs to do:

- Create/update general presentations without making them look like committed products.
- Convert selections into account projects or style-numbered products when the buyer commits.
- Track marked-up buyer feedback and revision requests.
- Give Adam self-service visibility into presentation/project status.
- Use history to build a design calendar for future seasons/accounts.

## 4.4 Adam — Sales

Adam needs self-service status and buyer-ready outputs.

He needs to see:

- All projects by retailer/buyer across POP and Spruce.
- Current status, next action, blocker, and owner.
- Buyer-facing presentations, mockups, selection PDFs, and reusable approved concepts.
- Products/concepts ready to re-offer.
- Sample and PO status.
- Account-specific rules and restrictions.

He needs to do:

- Pull clean status answers without asking Jessica or Jen.
- Record buyer selections, changes, passes, and approvals.
- Trigger or confirm buyer commitments that create SKUs/style numbers.
- Find reusable designs by retailer, season, product type, licensor/property, or theme.

## 4.5 Creative Designers

Creative designers need clarity and fast updates.

They need to see:

- Assigned work, grouped by deadline and priority.
- The project brief: buyer, retailer, season, properties, product types, restrictions.
- Manufacturing constraints that affect design: die lines, color counts, materials, print techniques, legal line placement.
- Product specs and examples.
- Revisions requested by Liz, buyer, or licensor.
- Where to save files and what NAS path/thumbnail is attached.

They need to do:

- Mark individual art files complete as they finish them.
- Paste NAS paths or attach thumbnails/marked-up files.
- Respond to revision notes.
- Create preliminary designs that remain searchable even if not picked.

## 4.6 Technical Designers

Technical designers need submission and factory-prep workflow.

They need to see:

- Art files ready for licensing sheet creation.
- Product type, materials, dimensions, Pantones, packaging requirements.
- Costing sheet status and approved constraints.
- Which factory or sourcing contact is tied to the product.
- Revision notes from Liz/licensor/factory.

They need to do:

- Build licensing sheets and packaging.
- Create/update tech packs.
- Mark licensing sheet ready for Liz.
- Mark tech pack ready for factory.
- Record what changed after revisions.

## 4.7 Sourcing / Albert / China Team

They need a constrained workflow around costing and factories.

They need to see:

- Products needing costing or factory assignment.
- Product type, construction requirements, target cost, quoted cost, and factory capabilities.
- Die lines and factory restrictions requested by designers.
- Factory sample status and issues.

They need to do:

- Add or update factory constraints.
- Record factory options, quotes, and decisions.
- Confirm factory assignment.
- Surface capability/pricing surprises before samples are requested.

Pricing fields should be visible here, but not to designers.

## 4.8 Licensing Team

Licensing needs a submission/compliance workbench.

They need to see:

- Items approved by Liz and ready to submit.
- Licensor/property, style guide timing, licensing sheet, packaging, art, Brand Assurance, PI requirements.
- Concept, PPS, and production approval status.
- Licensor response due dates based on expected turnaround.
- Items needing physical samples, safety forms, or other licensor-specific production requirements.

They need to do:

- Record submission numbers and Brand Assurance PDFs.
- Record licensor responses: approved, approved with changes, revisions/rejected.
- Attach licensor notes and route revisions to the right team.
- Track PI as required / not required / complete.
- Close production approval when all compliance requirements are met.

## 4.9 Production Managers

Production needs post-approval readiness.

They need to see:

- Products authorized for mass production.
- Brand Assurance and trademark/compliance documents needed for shipping/import.
- Factory, sample approval, PO/order details, and any production constraints.

They need to do:

- Confirm production approval and shipping-readiness evidence.
- Record issues that should feed future sourcing/design decisions.

## 4.10 Factories / Vendors

Vendor access is a later, scoped feature. Vendors should only see products assigned to them, with limited fields:

- Product spec, tech pack, sample request, due dates, and revision notes.
- No pricing beyond what is explicitly vendor-facing.
- No unrelated products, buyers, or internal notes.

This requires row scoping and a user-to-factory mapping before the Vendor role can safely access products.

---

# PART 5 — End-to-End Software Workflows

## 5.1 POP Project and SKU Workflow

1. Sales/Jessica creates a project/offer with buyer, retailer, season, licensors/properties, product types, restrictions, on-shelf date, and PPS-requested date.
2. Creative designers create preliminary designs linked to the project.
3. Liz reviews preliminary presentation material when needed.
4. Adam presents designs to buyer and records picks, passes, and buyer comments.
5. Selected designs, or any concepts needing licensor approval, become SKUs.
6. Creative designer finalizes art, description, and NAS path.
7. Technical designer creates licensing sheet and packaging.
8. Liz's review queue receives the submission.
9. Liz approves or requests changes with structured notes and attached markups.
10. Approved package routes to licensing.
11. Licensing submits concept/packaging, records Brand Assurance number/PDF, and starts licensor response timer.
12. Licensor response routes the item to approved, approved with changes, or revision loop.
13. Once buyer PO or sales sample request exists, technical/factory prep begins.
14. Sample/PPS flow tracks factory sample, internal review, licensor PPS submission, revisions, and PPS approval.
15. Production approval tracks final licensor requirements, PI if needed, Brand Assurance/shipping-compliance documents, and closure.
16. At any point, product can become active, waiting, stuck, parked, reusable, canceled, abandoned, or complete, with reason and history.

## 5.2 POP Reusable Design and Approved Concept Workflow

The system must treat unused work as inventory:

- Every preliminary design can be stored even if not picked.
- Every approved-but-unsold concept is searchable and visibly reusable.
- Users can filter by licensor, property, product type, season, retailer, original project, style guide, and status.
- Adam/Jessica can build a new offer from reusable designs.
- The system should warn when reuse conflicts with buyer restrictions or timing.
- If two buyers select the same design concurrently, the system flags a conflict and helps record the derivative/variant relationship.

## 5.3 Spruce Collection to Product Workflow

1. Jen/team creates or updates a design collection by theme/format.
2. Designers develop presentation-level art; high-res production files may not exist yet.
3. Jen finalizes presentation material.
4. Adam presents to buyer.
5. Buyer selections are recorded in the account project and/or selections PDF.
6. Account-specific path applies:
   - Burlington-style: no samples; style numbers after final order selection.
   - Hobby Lobby-style: sample required; internal size/format choice, buyer approval/change request, then sample request.
7. When buyer commitment exists, selection becomes a style-numbered product.
8. Design creates costing tech pack.
9. Albert/China/DesignFlow handles factory selection and costing.
10. Adam approves costing.
11. Sample/factory/PO timing is tracked.
12. Completed work closes; buyer-stalled work is parked/canceled during review.

## 5.4 Revision Workflow

Every revision request should have:

- Source: Liz, buyer, licensor, factory, sourcing, production.
- Related object: design, product, submission, sample, packaging, tech pack.
- Requested change.
- Attached markup/file/screenshot if present.
- Owner responsible.
- Due date or urgency.
- Resolution note and timestamp.

This should replace the current situation where Teams messages, emails, Illustrator screenshots, PDFs, and ClickUp comments are all separate truth fragments.

## 5.5 Handoff Workflow

Each stage should know:

- Owner role.
- Entry evidence required.
- Exit action.
- Next role to notify.
- SLA/expected duration.
- Whether partial completion is allowed.

Examples:

| Stage | Entry evidence | Exit action |
|---|---|---|
| Art files creation | Project brief, buyer pick or concept, constraints | Designer marks each file ready and adds NAS path/thumbnail |
| Licensing sheet creation | Art ready, specs, product type, packaging needs | Technical designer marks LS/package ready for Liz |
| Liz review | Licensing sheet, Pantones, packaging, product specs | Approve to licensing or return with revision |
| Concept submitted | Approved package | Licensing records Brand Assurance and licensor response timer |
| Sample requested | PO/sample request, factory, tech pack | Factory/sample status starts |
| With buyer for approval | Presentation/selections sent | Record buyer approve/change/pass |

## 5.6 Cancellation, Parking, and Closure Workflow

The system must make dead/stalled states explicit:

| State | Meaning | Required information |
|---|---|---|
| Active | Work is moving now | Owner, next action, deadline |
| Waiting | External/internal party must respond | Waiting on whom and since when |
| Stuck | Expected time exceeded | Blocker, owner, escalation |
| Parked | Deliberately paused but may resume | Reason and review date |
| Reusable | Valuable approved/design inventory | Search tags and reuse restrictions |
| Canceled | Business decided not to proceed | Reason: cost, licensing, sampling, buyer, other |
| Abandoned | Old/stale item closed for cleanup | Import/cleanup note |
| Complete | Production/project done | Completion evidence |

---

# PART 6 — Feature Catalog

## 6.1 Core Must-Haves

| Feature | Why it matters |
|---|---|
| Project/product/design/collection separation | Prevents ClickUp's core flattening mistake |
| POP and Spruce workflow separation | Keeps Spruce out of licensor workflow and POP out of collection workflow |
| Parent-child linking | Projects/offers need many SKUs/products |
| Design library | Captures unpicked designs and reusable concepts |
| Reusable approved concept pool | Turns wasted licensor-approved work into sales inventory |
| Stage history | Enables time-in-stage, stuck alerts, and planning |
| Explicit lifecycle states | Prevents ancient open items and unclear limbo |
| Role-specific views | Each user sees their work, not every field in the company |
| Field-level pricing security | Designers see constraints, not pricing |
| Manufacturing constraints field/workflow | Reduces rework before sampling |
| Liz review queue | Makes the bottleneck visible and manageable |
| Submission completeness checks | Ensures Pantones, specs, packaging, files are present before review/submission |
| Structured revisions | Keeps feedback from getting lost in Teams/email/markups |
| Batch operations | Jessica must move/assign many SKUs efficiently |
| Partial progress updates | Designers can mark first 5 of 20 files ready |
| Brand Assurance / PI tracking | Required compliance artifacts |
| Sample/PPS tracking | Critical POP approval gate and Spruce factory visibility |
| Sales self-service | Adam can answer status questions without interrupting PM/design |
| DAM/NAS link support | Full files stay on NAS; thumbnails/paths must be visible |
| AI/reporting layer | Answers operational questions without manual filter-building |

## 6.2 What ClickUp Did Not Do But We Need

| Need | Description |
|---|---|
| Proactive seasonal planner | Use prior timing, buyers, seasons, licensors, and product types to suggest when to start offers |
| Approved concept resurfacing | Recommend concepts approved but never sold for future buyer/season opportunities |
| Buyer/account rules | Capture sample requirements, resale restrictions, account-specific timing, and exceptions |
| Factory capability memory | Record what factories can/cannot do so surprises do not repeat |
| Designer learning signals | Show Liz patterns in revisions/rejections by designer/licensor/product type |
| Licensor behavior memory | Track response times, common rejection causes, and extra requirements |
| Conflict/derivative tracking | Same design picked by multiple buyers should create a visible relationship, not a hidden workaround |
| Decision-ready summaries | System-generated "what is next" summaries for project meetings |
| Evidence-based alerts | Alerts based on stage age, missing files, missing fields, expected turnaround, or no next action |
| Cross-line sales view | Adam sees both POP and Spruce status in one place |

## 6.3 Nice-to-Have Later

- Calendar planning by retailer/season/account.
- Buyer presentation builder from reusable designs.
- Thumbnail wall/grid for design review.
- Bulk mockup download by filtered product set.
- Licensor portal link/credential notes and submission templates.
- Factory scorecards: pricing turnaround, sample accuracy, issue history.
- Lightweight check-in/check-out if designer time tracking becomes culturally acceptable.
- Vendor portal with row-scoped factory access.
- AI-generated project summaries and meeting prep packets.

---

# PART 7 — Views and Dashboards

## 7.1 Jessica Dashboard

- At-risk SKUs by deadline and stage age.
- Liz review backlog.
- Licensor revisions needing action.
- Designers overloaded or underutilized.
- Projects with no next action.
- Concept Approved with no PO/sample.
- Products open too long.
- Bulk action panel for selected SKUs.

## 7.2 Liz Dashboard

- Awaiting my review.
- Revisions I requested, still unresolved.
- Approved and ready for licensing.
- Wholesale sublicensor submissions.
- Missing Pantones/specs/files before review.
- Designer revision patterns.

## 7.3 Jen Dashboard

- Spruce projects by lifecycle stage.
- With buyer too long.
- Pricing requests waiting on Albert/China/DesignFlow.
- Samples at factory.
- General presentations by format/theme.
- Upcoming account/season needs.
- Adam self-service presentation/status area.

## 7.4 Adam Dashboard

- Projects by retailer/buyer.
- Buyer-ready presentations and mockups.
- Status and next action for every active project.
- Reusable approved concepts/designs.
- PO/sample status.
- Spruce general presentations.

## 7.5 Designer Dashboard

- My assigned art files/designs.
- Due soon / overdue.
- Brief and constraints.
- Revision requests.
- Files/NAS paths missing.
- Completed work awaiting next role.

## 7.6 Licensing Dashboard

- Ready to submit.
- Submitted, waiting on licensor.
- Licensor response overdue.
- Brand Assurance missing.
- PI required/pending.
- PPS submitted/approved/revision.
- Production approval closeout.

## 7.7 Sourcing / Factory Dashboard

- Costing needed.
- Factory assignment missing.
- Constraints requested.
- Sample requests outstanding.
- Factory issues and capability notes.

---

# PART 8 — Automations and Rules

## 8.1 Stage and Handoff Automation

- On stage change, write `stage_history`.
- Notify the next owner role.
- Require/flag missing entry evidence for the next stage.
- Allow partial completion where appropriate.
- Keep stage movement auditable.

## 8.2 SLA and Stuck Work

- Compare current stage age to product-type SLA and licensor response expectations.
- Flag overdue/stuck items by owner.
- Separate stuck from deliberately parked.
- Show projected completion against on-shelf/PPS dates.

## 8.3 Dormant and Reusable Inventory

- Detect Concept Approved with no PO/sample after a threshold.
- Move or flag for reusable inventory review.
- Suggest buyers/seasons based on licensor, property, product type, retailer history, and restrictions.

## 8.4 Submission Completeness

Before Liz review or licensing submission, flag:

- Missing Pantones.
- Missing product specs.
- Missing packaging.
- Missing art/NAS path/thumbnail.
- Missing licensor/property.
- Missing style-guide or on-shelf-date compatibility note.
- Missing Brand Assurance once submitted.
- PI required but not tracked.

## 8.5 Buyer and Factory Follow-Up

- Flag Spruce projects sitting with buyer beyond review threshold.
- Flag pricing requests not returned.
- Flag sample requests at factory too long.
- Remind responsible owner, not everyone.

## 8.6 Closure Rules

- Product cannot be canceled without reason.
- Product cannot be marked complete without completion evidence.
- Abandoned import items retain original ClickUp id and cleanup note.
- Reusable designs/concepts stay searchable after original project is closed.

---

# PART 9 — AI Assistant and Analytics

The AI assistant should not be a generic chatbot. It should answer role-specific operational questions using trusted system data, cite the relevant records internally, and avoid guessing when the data is incomplete.

## 9.1 Jessica Questions

- How many SKUs have a licensing sheet but Liz has not sent it to licensing?
- Which SKUs have tech packs ready but no factory confirmed?
- Show all projects for Burlington / a specific buyer / a season.
- Which designer created more designs this week?
- Which designer has the least buyer picks this month?
- Summarize this project: total SKUs, stages, blockers, next action.
- Which approved concepts have no PO/sample and should be re-offered?
- Which products are stuck beyond expected timing?
- What should we start now for next Valentine's / Halloween / Christmas based on prior history?

## 9.2 Liz Questions

- What is waiting for my review, oldest first?
- Which submissions are missing Pantones/specs before I review?
- Which designs were submitted to the licensor with no response in X days?
- Which designer has high revision/rejection patterns for a licensor or product type?
- What notes did I give last time on this product/property/designer?

## 9.3 Jen Questions

- What is waiting on pricing?
- What sample requests are at the factory?
- Which projects are with buyer too long?
- What should be in the design calendar based on previous years?
- Which account projects have selections but no style numbers yet?
- What is Adam likely to ask me for this week?

## 9.4 Adam Questions

- What is the exact status of all projects for this retailer?
- What can I show this buyer now?
- Which approved concepts can be re-offered?
- What changed since my last buyer meeting?
- Which Spruce presentations are ready for self-service?

## 9.5 Analytics to Build

- Time in each stage by product type, licensor, designer, retailer, and factory.
- Licensor turnaround and rejection patterns.
- Factory pricing/sample turnaround and issue patterns.
- Designer workload, pick rate, revision rate, and learning opportunities.
- Buyer/account timing by season.
- Dormant/reusable inventory value.
- Bottleneck trends by role and stage.

---

# PART 10 — Adoption Mechanics

The interviews were clear: the system fails if it depends on perfect discipline from busy, non-technical users.

## 10.1 Make Updates Tiny

- One-click "mark my part ready."
- Drag/drop or batch stage move for PMs.
- Inline add NAS path / attach thumbnail / add revision note.
- Save common filters as default role views.
- Show only fields relevant to the current role and stage.

## 10.2 Make Responsibility Obvious

Every active item should show:

- Current stage.
- Current owner role/person.
- Next action.
- Waiting on whom.
- Due date / SLA risk.
- Missing evidence.

## 10.3 Avoid Alert Fatigue

- Notify the owner, not every stakeholder.
- Roll up daily summaries for managers.
- Escalate only when stuck/overdue or missing required evidence.
- Suppress alerts for deliberately parked/canceled/complete items.

## 10.4 Preserve Familiar Workflows Where Useful

- Boards remain useful for stage scanning.
- Comments remain useful, but should be structured around product/submission/revision context.
- Files can stay on NAS; the system stores paths, thumbnails, metadata, and durable references.
- Teams/email may still happen, but final decisions and revision notes need a home in the product record.

---

# PART 11 — Directus Implementation Mapping

## 11.1 Built or Partially Built

| Capability | Directus mechanism | Current status |
|---|---|---|
| Core collections | `project`, `product`, `design`, `stage`, refs | Phase 1 built |
| POP/Spruce separation | `business_unit`, line-specific stages | Built |
| Field-level pricing policy | Directus roles/policies | Built and verified |
| Stage history foundation | Flow to `stage_history` | Built and verified |
| Kanban boards | Advanced Kanban layout | Built |
| Roles | Directus roles + Entra sync | Built |
| Collaboration model | assignees/checklists/subtasks/comments | Built as later add-on |

## 11.2 Needs Expansion

| Capability | Likely mechanism |
|---|---|
| Review/submission packages | New `submission` collection or structured fields tied to product/stage |
| Structured revisions | `revision_note` collection linked to product/design/submission/sample |
| Reusable design inventory workflow | Views + status fields + M2M design/project/product relations |
| Buyer/account rules | Enrich `buyer`/`retailer` with sample requirements, resale restrictions, account notes |
| Factory constraints | Enrich `factory` and product/product_type constraints fields |
| Spruce general presentations | `design_collection` plus presentation asset/status fields |
| Sample/pricing trackers | Collections or fields for costing requests, sample requests, factory status |
| Seasonal planner | Analytics service over historical projects/products/orders |
| AI assistant | Existing D1/Worker layer re-pointed at Directus data |
| Vendor access | User-to-factory mapping + row-scoped policies |

## 11.3 Keep Out of Directus Core

- Do not fork Directus.
- Do not hand-edit production DB.
- Use configuration, Flows, API services, or extensions.
- Keep DAM full-size files on NAS/asset system; Directus should reference and preview them, not become the file server for every design file.

---

# PART 12 — Migration and Data Strategy

## 12.1 What to Migrate as Live Work

- Active projects/products.
- Recent projects/products with useful history.
- Concept Approved reusable pool.
- Current Spruce collections/projects/presentations.
- Buyer/retailer/licensor/factory references.
- Product images already moved to Spaces.

## 12.2 What to Preserve but Not Treat as Active

- Ancient open products that were never closed.
- Completed production history.
- Approved-but-unsold concepts.
- Old ClickUp ids as `external_id`.
- Old stage/tag data as migration metadata where helpful.

## 12.3 What Not to Preserve as Live Workflow

- `for adam` as a routing rule; Jessica says it is stale.
- Freelancers Generic as a live Spruce process.
- designflow internal dev board as product business work.
- Raw ClickUp status typos as first-class stages, unless they represent real business states.

## 12.4 Data Cleanup Required

- Resolve buyer IDs/names where sparse.
- Normalize retailer/licensor/property tags.
- Map raw statuses to line-specific stages and lifecycle states.
- Separate design inventory from committed products.
- Identify product records that are really project/presentation records.
- Mark abandoned/stale items with reason rather than leaving them open.

---

# PART 13 — Roadmap

## Phase 1 — Verified Backend Foundation

Already built: Directus backend, core PM schema, roles, pricing policy, stage history, Kanban defaults, SSO, collaboration model, and product cover migration.

## Phase 1.x — Make Data Studio Operationally Useful

- Role-specific saved views.
- Liz review queue.
- Jen Spruce lifecycle views.
- Adam status views.
- Dormant/stuck alert Flows.
- Design/project/product M2M refinements.
- Reusable concept views.
- Basic migration import from ClickUp/D1.

## Phase 2 — Purpose-Built PM Frontend

Build a real PM frontend for daily users:

- Jessica control room.
- Liz review queue.
- Jen Spruce cockpit.
- Adam sales status and presentation access.
- Designer "my work" queue.
- Product/project detail pages with files, notes, stages, and next action.
- Fast partial progress updates.

## Phase 3 — Intelligence and Planning

- AI assistant over Directus data.
- Seasonal planner.
- Reusable concept recommendations.
- Designer/licensor/factory analytics.
- Predictive stuck-risk and deadline planning.
- Buyer/account history surfacing.

## Phase 4 — External/Adjacent Domains

- CRM uses the same retailer/buyer/contact graph.
- DAM links design/product assets into the PM flow.
- Vendor/factory portal with scoped access.
- Production/compliance reporting.

---

# PART 14 — Traps to Avoid

- Do not build a generic task tracker and hope fields will fix it.
- Do not force Spruce into POP's licensor workflow.
- Do not treat every ClickUp list as a real workflow to preserve.
- Do not treat every open ClickUp item as active.
- Do not make Liz's aesthetic judgment a checkbox ritual.
- Do not hide manufacturing constraints from designers just because pricing is sensitive.
- Do not make revision notes another disconnected comment stream.
- Do not rely on users to update everything at the end of a batch.
- Do not create alerts that punish people for deliberately parked work.
- Do not build AI that guesses from incomplete data without saying so.
- Do not make Directus the final UI for everyone if daily workflows need a faster purpose-built frontend.

---

# PART 15 — Definition of "Perfect for Us"

The system is successful when:

- Jessica can see risk, capacity, blockers, and next actions without manually opening every card.
- Liz has one review queue with all evidence and revision history in place.
- Jen can tell where every Spruce project, presentation, sample, and pricing request stands.
- Adam can answer buyer status questions without interrupting Jessica or Jen.
- Designers know exactly what to make, what constraints apply, and how to mark partial progress.
- Technical designers know what package to build and what changed after revisions.
- Licensing knows what is ready to submit and what is overdue from licensors.
- Sourcing/factories surface constraints before samples waste time.
- Approved-but-unsold concepts and unpicked designs become reusable inventory.
- Stale work is parked/canceled/abandoned with reason instead of silently aging.
- The company can plan seasonal work earlier, using its own history.
- People actually update the system because the update path is easier than the workaround.

That is the bar. Anything less is just another place to track tasks.
