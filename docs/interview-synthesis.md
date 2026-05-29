# Interview Synthesis — POP Creations System Requirements

**Last updated:** 2026-05-28  
**Sources:** 43 answered interview questions across 3 rounds (May 5 – May 21, 2026)  
**Interviewees:** Jessica Cortázar (PM, Rounds 1 & 3), Liz Parkin (Creative Director, Round 2)  
**Spruce Line (Jen):** Not yet interviewed — Spruce Line design is provisional until her answers arrive.

This document translates raw interview answers into concrete system requirements and design decisions.
It supersedes the "open questions" section of `BUSINESS_INTELLIGENCE.md` for everything covered here.

---

## Table of Contents

1. [The Two Objects the System Must Model](#1-the-two-objects-the-system-must-model)
2. [SKU Creation and Lifecycle](#2-sku-creation-and-lifecycle)
3. [The Design Inventory Problem (Most Critical)](#3-the-design-inventory-problem-most-critical)
4. [SKU Reuse Across Buyers](#4-sku-reuse-across-buyers)
5. [Licensor Pipeline — Clarified Sub-stages](#5-licensor-pipeline--clarified-sub-stages)
6. [Checkpoints — Resolved Open Questions](#6-checkpoints--resolved-open-questions)
7. [The Art Director Bottleneck](#7-the-art-director-bottleneck)
8. [Role-Specific Requirements](#8-role-specific-requirements)
9. [Bulk Operations](#9-bulk-operations)
10. [Time-Based Visibility](#10-time-based-visibility)
11. [AI Assistant — Exact Queries Requested](#11-ai-assistant--exact-queries-requested)
12. [Product Closure](#12-product-closure)
13. [Costing Sheet Integration](#13-costing-sheet-integration)
14. [What the System Must NOT Do](#14-what-the-system-must-not-do)
15. [Summary: Prioritized Build List](#15-summary-prioritized-build-list)

---

## 1. The Two Objects the System Must Model

This is the most important structural insight from all three interview rounds.

**Project Card** = one offer to one buyer at one retailer for one season.
- Example: "Julie Greer at Burlington for Valentines 2027"
- Fields: buyer name, retailer, season, licensor(s), properties, product types requested, on-shelf date, PPS-requested date, any restrictions
- Purpose: gives the creative team a brief they can refer to without memorizing details
- A project card is created whenever sales presents concepts to a buyer

**SKU Card** = one product that a buyer picked from a presentation, linked to its project card.
- Created when a buyer selects a design, OR when a design needs licensor submission for any reason (factory proposal, internal development, etc.)
- Carries: full approval history from design through production, linkage to the project brief, licensor submission numbers, sample photos, file paths
- Must show order history (which retailers ordered it, when)

**Key constraint:** preliminary designs that are NOT picked by a buyer must also be stored — they are currently lost, and this is the #1 pain point. These do not generate SKU cards today, but they must be findable for reuse.

---

## 2. SKU Creation and Lifecycle

**When a SKU is created (confirmed Round 3):**

A SKU is created whenever something needs to be submitted to a licensor's system — you cannot submit without one. This includes:
- A buyer's official pick from a presentation
- A new design the company wants to offer (proactively)
- A factory proposal the company wants evaluated
- Any concept going to a licensor for approval

The SKU code is the identifier linked to the licensor's approval record. It must be immutable once created.

**When a SKU is closed:**

A SKU should be marked canceled with a mandatory closure reason when:
- Factory quote does not meet the company's cost target
- The product is not under contract with the licensor
- A manufacturing problem was discovered during sampling (construction impossible, too expensive, or too difficult)
- The buyer declined and there is no other buyer interest

**Current gap:** no formal cancel action exists. The system must add a Cancel state with a required reason field.

**1,574 products at "Concept Approved" with no PO:** These are concepts that buyers passed on due to price, timing, or order cancellations. They should be surfaced in the design inventory (see §3) as available-to-offer — not closed, not hidden, but actively reusable.

---

## 3. The Design Inventory Problem (Most Critical)

**The verbatim problem (Jessica, Round 1):**
> "We manage a large number of projects simultaneously with very tight deadlines. Designs that are lost are lost several times a week. We've tried to reuse these designs for other projects, but it involves manually searching through past presentations."

**The verbatim solution (Jessica):**
> "We need to be able to search according to project requirements: license, license property, product type, and season."

**What the system must do:**

Designs must live independently of the buyer presentation they were created for. Every preliminary design — picked or not — must be stored as a first-class object with:
- Licensor + property
- Product type
- Season
- Thumbnail (NAS → DAM integration already exists for this)
- Link to the project(s) it appeared in
- Status: picked / unpicked / offered-to-multiple-buyers

A "design inventory" view must let any PM or sales person browse all designs ever created, filtered by any combination of the above fields, and attach any of them to a new project in one action.

**The proactive sales problem (Jessica, Round 2):**
> "Project management should be proactive, not reactive. We should have offered the products beforehand. We already have the major seasons... and history of which buyers order them."

The system should enable: filter by season + product type → find approved-but-unsold concepts → generate a deck to offer to buyers. This is a query on the design inventory, not a new workflow.

---

## 4. SKU Reuse Across Buyers

**Confirmed (Round 3):**
- Most licensors allow a product to be sold to multiple buyers over time
- Some buyers prohibit resale of what they've purchased — this restriction must be trackable per-licensor or per-buyer-agreement
- Reuse currently happens on a case-by-case basis because there's no system for it
- The SKU code must be preserved (it's the licensor's approval record); the SKU card should display a full order history of which retailers ordered it and when

**When two buyers simultaneously pick the same design:**
- The creative designer or PM notices manually
- Current workaround: create a second version with minor changes (icons, sizes, colors, embellishments), present it to one buyer as a variation
- The system should detect this the moment it happens and alert — before either version is half-built

---

## 5. Licensor Pipeline — Clarified Sub-stages

The 17-stage pipeline from BUSINESS_INTELLIGENCE.md is confirmed. Two additions from Round 3:

**Concept approved with changes** is a real and important state — the licensor approved but with required revisions before sampling. This must be a distinct stage (not collapsed into "Concept Approved") because it requires action from the creative and technical designers before anything can advance.

**PO received vs. Sales requested sample** are parallel paths at the same point in the pipeline. A product can reach the sample stage either because a buyer placed a formal order (PO received) or because sales asked for a sample to close a potential order (Sales requested sample). Both lead to "Sample requested" (Techpacks sent to factory). The system must support both entry points into sampling.

---

## 6. Checkpoints — Resolved Open Questions

### Brand Assurance (previously unknown)

**Confirmed (Round 3):**
Brand Assurance is the submission number assigned by the licensor's portal when a concept is submitted. The licensing team:
1. Records the number in the system, linking each SKU to its Brand Assurance number
2. Prints and saves the PDF of the submission

The Brand Assurance form is also required at the end of production — the Production team uses it to print and attach to shipping boxes along with the trademark authorization for import. This makes it both a submission record and a shipping compliance document.

**Implementation:** Brand Assurance number should be a required field on every SKU once it reaches "Concept submitted." The PDF should be attachable. A second instance of the document is needed at production time.

### PI Approval (Product Integrity)

**Confirmed (Round 3):**
PI is a test report certifying materials are non-toxic and non-hazardous. Only some licensors require it. The licensing team receives it via email and submits to the licensor.

**Why only 45 of 9,069 products have it:** most licensors don't require it, and it's not being tracked consistently.

**Implementation:**
- Add a PI status field per SKU with three values: Required, Not Required, Completed
- Default to "Not Required" for Generic (Spruce Line) and for licensors that don't request it
- Required when: licensor mandates it (this list needs to be documented per-licensor)

### Sarbani Approval

Still maps to Liz's review function. Liz confirmed she performs the same approval step (licensing sheet review + preliminary design approval) that Sarbani did, just without a formal named checkpoint. The system should rename `sarbani_approval` to `creative_director_review` or equivalent.

---

## 7. The Art Director Bottleneck

This was the most detailed finding across all three rounds. Multiple independent sources confirmed the same bottleneck.

**Five distinct causes of the bottleneck (Jessica, Round 2):**

1. **Volume:** licensing sheets accumulate when Liz is occupied with other responsibilities
2. **Late design changes:** Liz sometimes changes artwork she already approved at the buyer-presentation stage, requiring the entire licensing sheet to be rebuilt
3. **Property/packaging mismatch:** Liz sometimes catches that the wrong property was used (e.g., "Mickey and Friends" vs "Mickey Mouse") — the licensing team returns the sheet until corrected
4. **Product type unfamiliarity:** Liz has to consult sourcing (China), sales, or production before approving some product types, adding days
5. **Brief quality:** when Liz's brief to the creative team was incomplete, the creative team delivers the wrong product type, and the entire licensing sheet must be redone

**What the system can do:**
- Show Liz's real-time queue with time-in-stage for every item waiting on her
- Alert when an item has been in "Licensing sheet review" longer than the SLA for its product type (from §8 of BUSINESS_INTELLIGENCE.md)
- Surface which items are waiting on Liz specifically (AI assistant query verbatim: "How many SKUs have a licensing sheet but the art director hasn't sent it to the licensing team?")
- Reduce root cause #3 by auto-validating licensor property against the style guide before submission

**What the system cannot fix:** causes #2 (late design changes) and #4 (product type unfamiliarity) are process problems, not data problems.

---

## 8. Role-Specific Requirements

### Jessica (Project Manager)
- Wants to advance multiple SKUs simultaneously — bulk stage movement is a hard requirement
- Wants to assign a technical designer to a set of licensing sheets without opening each SKU individually
- Wants to see progress within a batch (not wait for all 20 to be done before she sees any)
- Wants a "stuck" alert: SKU in the same stage longer than SLA without progress
- Wants retroactive timeline: given on-shelf date and remaining stages, calculate whether the SKU is on track
- Wants history of who touched a product (including design handoffs between creative designers)

### Liz (Creative Director)
- Reviews 20+ licensing sheets per week; spends ~1 hour/day on submissions
- Needs to see dimensions, Pantones, packaging, and licensor guidelines on the same screen — not in a separate file
- Wants designer track-record data: revision rates, licensor rejection patterns per designer
- Wants feedback to live on the product card, not in Teams — but acknowledges it's "a different platform, same steps"
- Concerned about wholesale designers (Stallion Art, Iconick) who don't understand licensing guidelines — very time-consuming
- Does NOT use a formal process; relies on expertise. The system should support her, not enforce a checklist on her

**Liz's wishlist item:** one platform instead of multiple. Currently uses Teams for feedback, ClickUp for status, shared server for files.

### Technical Designer role (inferred from data + Round 3)
- Creates costing sheets using internet references, shopping trip photos, and factory offers
- Costing sheet approved by art director before going to factories for quotes
- Sourcing team confirms or clarifies construction details, obtains die lines
- Wants costing sheet linked to the project so designers can see constraints (die lines, color count, printing technique) without asking the art director

---

## 9. Bulk Operations

**Hard requirement — verbatim (Jessica, Round 1):**
> "It should allow for group actions — for example, moving several SKUs from one stage to another, not just individual ones."

**And (Round 2 follow-up):**
> "I should be able to select multiple SKUs and assign the licensing sheet to a technical designer within the same system, instead of manually accessing each SKU and assigning it."

**Specific operations needed in bulk:**
- Stage advancement for a set of SKUs
- Designer assignment across a set of SKUs
- Filtering by retailer + season + status → download CSV of all matching SKUs with field values
- Downloading mockups/thumbnails for all SKUs in a filtered view at once (Liz's explicit wishlist item from Round 2)

---

## 10. Time-Based Visibility

**What Jessica wants on every SKU card (verbatim):**
> "How long it has been in a certain status, how long ago its entire cycle began, and the deadline for it to change status so that the on-shelf date is met (retroactive planning based on the remaining stages and what we know they take)."

**Implementation:**
- `time_in_current_stage`: elapsed since last status change
- `total_cycle_age`: elapsed since SKU was created
- `projected_completion`: sum of SLA targets for all remaining stages (from the stage-time table in §10 of BUSINESS_INTELLIGENCE.md)
- `on_track`: boolean — will `projected_completion` land before the on-shelf date?
- Alert threshold: when `time_in_current_stage` exceeds the SLA for that product type + stage combination

**The on-shelf date vs. PPS-requested date distinction (Round 3):**
Jessica explicitly flagged these as two different dates that must both exist on the project card. The PPS-requested date is when the buyer wants to see physical samples — often weeks before the on-shelf date. Both drive different deadline calculations.

---

## 11. AI Assistant — Exact Queries Requested

**From Jessica (Round 1, verbatim):**
- "How many SKUs have a licensing sheet but the art director hasn't sent it to the licensing team?"
- "How many SKUs have techpacks for factory but the art director hasn't confirmed which factory to send to?"
- "List of all projects for the same retailer (client)"
- "Which designer created more designs (preliminary or art files) this week?"
- "Which designer has the least picks from buyers in the last month?"
- "Summary of this project" → expected response: "total SKUs 27, 20 are sample requested, 3 concept approved, 4 concept submitted, next action: send the three approved concepts to the factory and wait for the 4 not approved"

**From Liz (Round 2, implied):**
- Which designs have been submitted to licensor but no response in X days?
- Which designer has the highest revision rate from licensors?

**From data analysis (not from interviews, but consistent with their requests):**
- Which concepts are approved but have no PO and no sample request? (the 1,574 stuck products)
- Which licensor has the most outstanding submissions?
- Which products have been stuck in the same stage for 30+ days?

---

## 12. Product Closure

**Current state:** no formal cancel mechanism. Products just sit open indefinitely.

**Required closure types (from Round 3):**
- Canceled — cost: factory quote didn't meet target
- Canceled — licensing: product not under contract with licensor
- Canceled — sampling: construction not feasible
- Canceled — buyer: buyer declined, no other buyer interest
- Completed: reached Production Approved (the happy path)

Every SKU must have a closure type before it can be closed. The system should prompt for it.

**Products open 4-5 years:** these are almost certainly one of the above canceled states, never formally closed. A one-time migration task will be needed to close them with a best-guess reason or a bulk "Abandoned" state.

---

## 13. Costing Sheet Integration

**Current state:** costing sheets are created by technical designers, approved by the art director, then sent to factories for quotes. They exist separately from ClickUp.

**What interviewees want:**
- Costing sheet linked to the project so designers can see the specs (die lines, color count, printing technique, materials) while designing
- Visibility permissions: sales and sourcing see full costing; designers see only the constraint-relevant portions (not pricing)
- "It's much easier to connect and know what was costed and design precisely with those constraints, based on the product price the buyer agreed to"

**Root cause this solves:** the art director sometimes doesn't share manufacturing constraints with the creative team, which causes rework when samples reveal the design doesn't match factory capabilities. Making the constraint sheet visible to designers at design time removes the dependency on the art director as the information relay.

---

## 14. What the System Must NOT Do

Based on interview answers, some intuitive features would create friction rather than help:

- **Don't enforce a checklist on Liz's review process.** She uses 20 years of experience, not a checklist. A checklist would add steps without adding value.
- **Don't block auto-validation on things that are already working.** Wrong licensor property and style guide mismatches are the most common issues, but Pantone errors are the real everyday problem — auto-check Pantones, not everything.
- **Don't hide "assigned to me" views.** Color-coding and personal task views are important; they should be preserved from ClickUp.
- **Don't rely on people updating the system in real-time.** The PM's concern is that people will batch-update at the end rather than updating as they go. The system needs to make incremental updating the path of least resistance (e.g., upload one file, advance one stage, before starting the next).

---

## 15. Summary: Prioritized Build List

### Must-Have (system is broken without these)
1. **Project + SKU two-tier data model** — everything else depends on this hierarchy
2. **Design inventory** — preliminary designs stored independently of buyer presentations, searchable by licensor + property + product type + season
3. **Bulk stage advancement and designer assignment** — Jessica cannot do her job without this
4. **Cancel state with required reason** — no SKU can be abandoned silently
5. **Brand Assurance number field** — required for licensor submission and shipping compliance
6. **Time-in-stage display + on-track indicator** — the most requested visibility feature

### High Value (significant friction reduction)
7. **Multi-buyer conflict detection** — alert when the same design is picked by two buyers simultaneously
8. **Art Director queue with SLA timer** — shows Liz's backlog with time-in-stage and escalation signals
9. **Costing sheet linkage to project** — with role-based visibility (sourcing/sales see full, designers see specs only)
10. **PI Approval field** — three values: Required / Not Required / Completed, per-licensor defaulting
11. **Bulk CSV export + thumbnail download** — filtered view → download all matching SKUs

### Workflow Improvements (meaningful but not blocking)
12. **Designer track record view** — revision rates and licensor rejection patterns per designer
13. **Retroactive timeline projection** — given on-shelf date, calculate if each remaining stage will fit
14. **AI natural language queries** — starting with the 6 exact questions Jessica specified
15. **Proactive season deck builder** — filter approved-but-unsold concepts by season + product type → generate offer deck

### Open Until Jen's Interview
16. **Spruce Line data model** — collection-based vs. SKU-based is unconfirmed
17. **Spruce Line stages** — provisional stage map from data only; Jen may describe something different
