# Business Intelligence — POP Creations / Spruce Line PM Platform

**Last updated:** 2026-05-28  
**Sources:** Direct Cloudflare D1 analysis, live D1 webhook events (Mar 30 – May 19, 2026), ClickUp snapshot imports, employee interviews (Jessica Rounds 1 & 3 complete, Liz Round 2 complete; Jen pending), owner context.

**Interview synthesis:** See `docs/interview-synthesis.md` for the full translation of all 43 interview answers into concrete system requirements and design decisions. That document supersedes the open questions below for everything covered in Rounds 1–3.

**Read this with caution:** this document is a synthesis, not the raw source of truth. It is useful, but it does not replace direct D1 inspection. The most important structural fact learned from the live data is that the current ClickUp system mixes **project cards** and **SKU execution tasks**, and that distinction should drive the design of the replacement system.

---

## Table of Contents

1. [What the Company Does](#1-what-the-company-does)
2. [Three Sales Channels](#2-three-sales-channels)
3. [Three Ways Work Starts](#3-three-ways-work-starts)
4. [The Team](#4-the-team)
5. [POP Creations — Licensed Product Pipeline](#5-pop-creations--licensed-product-pipeline)
6. [Spruce Line — Generic (Non-Licensed) Product Pipeline](#6-spruce-line--generic-non-licensed-product-pipeline)
7. [What's in the Database (D1)](#7-whats-in-the-database-d1)
8. [What the Data Reveals](#8-what-the-data-reveals)
9. [Pain Points — From the People Doing the Work](#9-pain-points--from-the-people-doing-the-work)
10. [SLA Targets — Time Per Stage by Product Type](#10-sla-targets--time-per-stage-by-product-type)
11. [Licensor Turnaround Times](#11-licensor-turnaround-times)
12. [Requirements for the New System](#12-requirements-for-the-new-system)
13. [AI Assistant Queries — Verbatim from Jessica](#13-ai-assistant-queries--verbatim-from-jessica)
14. [Open Questions](#14-open-questions)

---

## 1. What the Company Does

The company designs and sources **licensed and generic home decor products** manufactured in China and imported to the United States for sale to major retail chains (Burlington, TJX/HomeGoods/Marshalls, Ross, Hobby Lobby, Walmart, Dollar General, and others).

**75% of sales are licensed products** — home decor items carrying intellectual property from Disney, Marvel/Star Wars, Warner Bros, DC Comics, NBCUniversal, Paramount/Nickelodeon, Peanuts, and others. For licensed products, the company must obtain:
1. **Design/concept approval** from the licensor before making samples
2. **Sample (PPS) approval** from the licensor before starting mass production

The remaining **25% are non-licensed ("generic") products** under the **Spruce Line** brand — original designs that go through a simpler design-and-buyer-approval process with no licensor involvement.

Products are designed in-house by a creative and technical team, manufactured at factories in China, imported, and shipped to retail distribution centers or sold through wholesale channels.

---

## 2. Three Sales Channels

### Channel A — Major Retail Chains (primary)
Direct sales to mass-market retailers: Burlington, TJX family (HomeGoods, Marshalls, TJ Maxx), Ross, Hobby Lobby, Walmart, Dollar General, Amazon, Hot Topic, Box Lunch, Kohl's, Five Below, and others. These accounts drive the core business. Each sale is tracked as a "project" — an offer to a specific buyer at a specific retailer for a specific season.

### Channel B — Wholesale Sublicensors (secondary)
Online sellers (identified in data: **Stallion Art**, **Iconick**) who buy the product and sell it themselves under their own brand, but sublicense the IP from this company. These sellers still require licensor approval on all designs — they go through the same POP Creations approval pipeline. Tags `stallion art wholesale only` (62 tasks) and `iconick only` (5 tasks) appear in ClickUp to route tasks appropriately.

### Channel C — Internal / New Product Development
Products developed internally without a specific buyer request — the company builds a product line or refreshes an existing line and then presents it to buyers. Tagged `prod development` in ClickUp (142 tasks). Managed via the "New Prod Development" list.

---

## 3. Three Ways Work Starts

The product lifecycle can be triggered three ways:

| Trigger | ClickUp List / Tag | Description |
|---------|-------------------|-------------|
| **A. Customer request** | `Customer Refresh` list (264 products), `Customer Category Expansion` list (78 products) | A retail buyer asks the sales team for a specific product type, format, or refresh of an existing line. Sales relays the brief to the PM (Jessica). |
| **B. Internal line refresh** | `customer refresh` tag (1,516 tasks) | Company decides proactively to refresh a product line — update designs, add new licensors/properties, expand a product category — without a buyer initiating it. Presented to buyers afterward. |
| **C. New product development** | `New Prod Development` list (199 products), `prod development` tag (142 tasks) | Product development team identifies a new product format or category and develops it into a full concept before seeking buyer interest. |

**Important implementation note:** these lists are not pure SKU lists. In live D1, they behave primarily like **project / presentation / brief records** that often have many child SKU tasks beneath them.

---

## 4. The Team

### Activity in the live event log (Mar 30 – May 18, 2026)

| Name | Events | Role (confirmed) |
|------|--------|-----------------|
| Elizabeth (Liz) Parkin | 469 | Creative Director — approves all preliminary designs and licensing sheets; the primary internal gate before anything goes to a licensor |
| Umamaheswararao Meka | 443 | Technical Lead Designer — audits technical work, manages factory communication |
| Jennifer Chaffier | 177 | Designer / coordinator (likely Spruce Line — see note) |
| Ilona Kereki | 43 | Creative Designer |
| Vaibhav | 30 | Designer (offshore) |
| Marcel Zabolotniy | 15 | Designer |
| Jessica Cortázar | 8 | Project Manager — oversees full pipeline, manually advances stages |
| Érica Perestrelo | 6 | Designer |

**Note on Liz:** Previously the Art Director under the Creative Director Sarbani (who left ~2 years ago). Liz is now Creative Director. A formal "Sarbani Approval" checkpoint still exists in the system — whether Liz has taken over that responsibility is a question for Round 3.

**Note on "Adam":** Sales person. 104 tasks are tagged `for adam`, suggesting tasks are routed to him for sales action. Exact meaning of the tag needs clarification from Jessica (Round 3 question).

**Note on "Jen":** Jennifer Chaffier is Creative Director of the Spruce Line (non-licensed). She uses ClickUp very differently from the licensed team. Interview pending (Round 3 — Jen).

### Full role map (from Jessica, interview Round 1)

- **Project Manager (Jessica)** — oversees full POP Creations pipeline, allocates designers, currently advances most non-licensing stages manually
- **Sales (Adam)** — communicates with buyers, sends preliminary concepts, converts picks into orders
- **Creative Director (Liz Parkin)** — approves preliminary designs and licensing sheets; the internal gate before anything external
- **Technical Lead Designer** — audits technical design, manages factory communication, sends files to factories
- **Technical Designers** — costing sheets, licensing sheets, Techpack files, packaging designs
- **Creative Senior Designer** — advises creative team on product restrictions, materials
- **Creative Designers** — preliminary concepts for buyers, art files for picks, SKU descriptions
- **Sourcing Managers** — costing sheets, factory sourcing
- **Licensing Manager / Coordinator** — submits to licensor portals, downloads licensor assets
- **Production Managers** — production phase
- **Factories (China)** — receive Techpacks, produce PPS samples, execute mass production
- **Jen (Spruce Line Creative Director)** — runs the Spruce Line independently; interview pending

---

## 5. POP Creations — Licensed Product Pipeline

### What a ClickUp record represents

There are two levels:

**Project card** = one offer to one buyer at one retailer for one season. Example: "Julie Greer at Burlington for Valentines 2027." Carries: buyer name, retailer, season, license restrictions, product types, on-shelf date, and PPS-requested date.

**SKU card** = one specific product that a buyer picked from a presentation. Linked to its project card. Carries the full approval history from design through production.

**Direct D1 evidence for this hierarchy:**

- `Customer Refresh`: `264` parent cards and `2446` child tasks
- `Customer Category Expansion`: `78` parent cards and `428` child tasks
- `New Prod Development`: `199` parent cards and `457` child tasks
- `Licensing Management`: `7281` parent cards and `4280` child tasks

This is one of the most important findings in the project. The replacement system must model this explicitly rather than flattening everything into one issue type.

### The 17-stage pipeline (confirmed verbatim from Jessica, Q10)

| # | Stage | Owner | Notes |
|---|-------|-------|-------|
| 1 | Art files creation | Creative Designer | Artwork for buyer's selected format |
| 2 | Licensing sheet creation | Technical Designer | LS + packaging design using art files |
| 3 | Licensing sheet review | Creative Director (Liz) | Internal gate — nothing advances without her approval |
| 4 | Ready to submit | Liz → Licensing Team | Liz sends approved sheet to licensing team |
| 5 | Concept submitted | Licensing Team | Submitted to licensor portal |
| 6 | Revisions | Creative + Technical Designer | Licensor rejected concept or packaging |
| 7 | Concept approved | — | Licensor approved with no corrections |
| 8 | Concept approved with changes | Creative + Technical Designer | Approved but minor revisions required before sampling |
| 9 | PO received | Technical Designer | Buyer sent purchase order; Techpack files prepared |
| 10 | Sales requested sample | Technical Designer | No PO yet but buyer wants physical sample before committing |
| 11 | Sample requested | Factory | Techpacks sent to factory |
| 12 | Sample received | Liz + Licensing Team | Factory sent PPS photos; internal review before submitting to licensor |
| 13 | Factory resample | Factory | Sample had errors — corrected and re-photographed |
| 14 | Sample sent to licensor | Licensing Team | PPS submitted (internally: "PPS submitted") |
| 15 | Sample revision | Creative + Technical Designer | Licensor sent changes to sample |
| 16 | Pre-production approved | — | PPS approved; mass production authorized |
| 17 | Production approved | — | All licensor requirements met; submission closed |

### Formal checkpoints tracked in D1 (27 milestones)

The `checkpoint_map` table defines formal milestones beyond just stage status:

**Design phase:**
concept_submitted → concept_revision_submitted → concept_approved → group_concept_approved → packaging_concept_approved → pkg_concept_revision

**Production prep:**
art_complete → designs_complete → tech_packs_complete → tech_pack_check

**Sampling:**
sample_requested → sampling_request → sample_submitted → sample_approved → pps_submitted → pps_approval → pps_revision

**QC / Production:**
factory_qc_china → pi_approved → production_approved

**Fulfillment / Compliance:**
licensor_approval → sarbani_approval → contractual_submitted → contractual_approved → buyer_picks → brand_assurance → buyer_presentation

**Note:** `sarbani_approval` refers to the previous Creative Director (Sarbani) who left ~2 years ago. Whether Liz has assumed this checkpoint is unconfirmed. `pi_approved` (Product Integrity) is only checked on 45 of 9,069 products — its meaning and trigger conditions are unclear (Round 3 question for Jessica). `brand_assurance` is also unconfirmed.

### SKU naming convention

Products in the system follow a structured SKU code format:
```
[FORMAT][SIZE][LICENSOR-ABBR][PROPERTY-ABBR][MATERIAL-ABBR][##]  [Full description + dimensions]
```
Example: `GFZ80MVAV01 Marvel printed glass Avengers high render group on yellow A logo 8x10"`
Example: `MTC3ADYPN02 Disney MDF die-cut block Groovy Princess Tiana 3x4"`

### File storage
Design files are **not stored in ClickUp**. They live on a Synology NAS server accessible as:
- Windows path: `S:\[Licensor]\[Season]\[Project]\`
- UNC path: `\\edgesynology1\files\shared\...`

Designers comment on ClickUp tasks with the NAS path when their work is done. The company also has a **DAM (Digital Asset Management)** system that thumbnails all NAS files and stores thumbnails on DigitalOcean Spaces (S3-compatible). This DAM can be integrated into Plane for thumbnail previews while keeping full-size files on the NAS.

---

## 6. Spruce Line — Generic (Non-Licensed) Product Pipeline

Spruce Line is structurally **different** from POP Creations. Based on the data:

- No licensor approval step
- Tasks appear to track **design collections and presentations** rather than individual product SKUs (task names like `"Gaming - updated 10.27.25"`, `"BCF - Kim/Anna - New Formats & Art"`, `"Soft Religion - updated 2.11.26"`)
- The primary list is **Edge Generic** (701 products in Spruce Line's main tracking list)
- "Edge" appears to be the Spruce Line's brand name within the company

### Observed Spruce Line stages (from data)

The active products in Spruce Line skip the Concept/Licensor stages entirely. Live stages seen:

| Stage | Active Count | Notes |
|-------|-------------|-------|
| Ideas / Ideation | 20 | Raw concepts |
| In Progress | 7 | Design underway |
| Internal Approval | 6 | Internal review before buyer presentation |
| In Work | 5 | Active production work |
| With Buyer for Approval | 5 | Presented to buyer, waiting feedback |
| Waiting for Factory | 4 | Handed to factory |
| Art Sent for PO | 7 | Art sent to buyer for purchase order |
| Complete | 642+ | Done |
| Wall Art / Floor Coverings / Seasonal / Storage | (category labels) | Used as organizational buckets, not pipeline stages |

### How Jen manages Spruce Line (requires Round 3 interview)
The data strongly suggests Jen manages Spruce Line presentations as collections/catalogs (a "Gaming" collection, a "Christmas" collection, a "Soft Religion" collection) that she presents to multiple buyers. Individual products within a collection are likely tracked differently, or not at all, in ClickUp. This is a major gap — Jen's interview will reveal the actual process.

**Status as of 2026-05-19:** Jen has not yet answered her interview round. The Spruce Line model is still provisional and should not be treated as finalized.

---

## 7. What's in the Database (D1)

**Database ID:** `c37aeb36-e16e-416b-b699-c910f6f8dc10`  
**Cloudflare account:** `u2giants`  
**MCP tool:** `mcp__9a4e64b3-8b0d-4708-9ca2-19515b76966e__d1_database_query`

### Table inventory

| Table | Rows | What it contains |
|-------|------|-----------------|
| `products` | 9,069 | **Primary query surface, but not pure truth.** Enriched, denormalized view over imported ClickUp tasks. Useful for analysis, but it mixes project-like records and SKU-like records. Always filter `WHERE is_internal = 0`. |
| `tasks` | 17,751 | Raw ClickUp tasks from snapshot. This is where the parent/child structure is most visible. |
| `status_transitions` | 17,979 | Every status change ever recorded. Most have `from_status = NULL` (backfilled estimate). Only `214` currently have real from→to transitions from the live webhook path. |
| `task_assignments` | 14,670 | Who was assigned to what task, with timestamps. |
| `task_comments` | 244 | Comment text extracted from ClickUp. Many are NAS file paths or @mentions. |
| `task_tags` | 13,333 | Tags on tasks — primary signal for licensor, channel, and workflow routing. |
| `task_custom_fields` | 3,733 | Custom field values (SMPL Req, Revision received, Customer/Retailer, Factory, put-up, Category, etc.) |
| `workflow_stages` | 76 | Maps raw ClickUp status strings → clean stage names with stage_order and category. |
| `checkpoint_map` | 27 | Defines all formal milestone checkpoints (concept_submitted through buyer_presentation). |
| `product_checkpoints` | 32,534 | Per-product checkpoint records (which milestones each product has reached). |
| `users` | 64 | User IDs and metadata. `events` is still the most reliable surface for recent human activity names. |
| `spaces` | 3 | POP Creations, Spruce Line, designflow (internal dev). |
| `lists` | 21 | All ClickUp lists across 3 spaces. |
| `licensors` | 34 | Licensor reference table. |
| `retailers` | 26 | Retailer reference table. |
| `events` | 1,255 | Live webhook events Mar 30 – May 19, 2026. Contains user names and recent update signals. |
| `interview_questions` | 59 | Interview Q&A and pending questions. Jessica has 21 answered + 11 pending, Liz 15 answered, Jen 12 pending. |
| `task_attachments` | 0 | Empty — `taskAttachmentUpdated` webhook not yet subscribed. |
| `task_links` | 0 | Empty — `taskLinkedTasksUpdated` webhook not yet subscribed. |
| `time_entries` | 0 | Empty — time tracking API returns no data. |
| `custom_field_definitions` | 0 | Empty — list-level field definitions not yet fetched. |
| `workspaces` | 0 | Structurally present but currently empty in D1. |

### Key lists

| List | Space | Products | Active | Purpose |
|------|-------|----------|--------|---------|
| Licensing Management | POP Creations | 7,281 | 8 | Primary SKU tracking for all licensed products |
| Edge Generic | Spruce Line | 701 | 123 | Primary Spruce Line design tracking |
| Customer Refresh | POP Creations | 264 | 93 | Buyer-requested refreshes |
| Licensing Administration Tasks | POP Creations | 236 | 41 | Admin/coordination tasks |
| New Prod Development | POP Creations | 199 | 26 | Internal new product development |
| Freelancers Generic | Spruce Line | 111 | 17 | Freelancer-managed Spruce Line work |
| Customer Category Expansion | POP Creations | 78 | 12 | Buyer requests for new product categories |
| General Presentations | Spruce Line | 48 | 26 | General buyer presentations |

---

## 8. What the Data Reveals

### Product volume by stage (POP Creations, all time)

| Stage | Category | Products | Active Now |
|-------|----------|----------|-----------|
| Pre-Production Approved | Pre-Production | 2,387 | 4 |
| Production Approved | Production | 2,175 | 0 |
| Concept Approved | Concept | 1,574 | 0 |
| Complete | Complete | 932 | 117 |
| Sample Requested | Pre-Production | 313 | 3 |
| Concept Submitted | Concept | 327 | 0 |
| Revisions | Concept | 210 | 0 |
| (Design stages) | Design | ~227 combined | ~68 |
| (Ideation stages) | Ideation | ~163 combined | ~36 |

**Key observation:** 1,574 products are at "Concept Approved" but have no active next step. These are approved designs sitting dormant, waiting for a buyer to place a PO. What triggers them to advance — or be abandoned — is unclear.

**Correction from direct D1 review:** the database cannot yet prove this cleanly enough to treat every one of these as truly waiting in the same business state. Many records in the system are old, non-closed, or partially stale. The real modeling need is a clearer lifecycle distinction between active, waiting on buyer, parked, canceled, and complete.

### Milestones reached (of 9,051 products)

| Milestone | Count | % of Products |
|-----------|-------|--------------|
| Concept Approved | 2,313 | 25.6% |
| Tech Pack Checked | 2,041 | 22.5% |
| Art Complete | 1,485 | 16.4% |
| Sample Approved | 878 | 9.7% |
| PI Approved | 45 | 0.5% |

### Licensor breakdown (by product count)

| Licensor | Products | Avg Concept Revisions |
|----------|----------|-----------------------|
| Disney | 2,182 | 0.26 |
| Marvel | 1,396 | 0.43 |
| Star Wars | 749 | 0.19 |
| DC Comics | 450 | 0.31 |
| Warner Bros | 399 | 0.26 |
| Peanuts | 131 | 0.38 |
| Care Bears | 33 | 0.00 |
| SEGA | 16 | 1.00 |
| Nickelodeon | 16 | 0.00 |
| Universal | 15 | 0.00 |
| WWE | 13 | 0.00 |

**SEGA is the most demanding licensor** — every product that went through SEGA needed at least one concept revision. Marvel and Peanuts are also significantly more demanding than Disney or Star Wars.

### Retailer breakdown (active products, from custom fields)

Burlington (23), Hobby Lobby (11), Ross (11), Walmart (8), TJX (8), Dollar General (4), Box Lunch (4), Amazon (4), HomeGoods (3), Kohls (2), Hot Topic (2), Five Below (2), At Home (2), Costco (2), DD's (2), Ollies (2)

### Pipeline aging (active products only)

| Stage Category | Avg Days in Pipeline | Max Days |
|----------------|---------------------|----------|
| Pre-Production | 350 days | 975 days |
| Production | 328 days | 1,720 days |
| Design | 285 days | 739 days |
| Fulfillment | 238 days | 500 days |
| Ideation | 145 days | 1,203 days |

Products at "SKU Created" stage: 246 products, **averaging 1,011 days (2.8 years)** in the pipeline. Some products have been in the system for 4–5 years. Whether these are still active or simply never closed is an open question.

### Revision patterns

| Pattern | Products |
|---------|----------|
| 0 concept revisions, 1 sample round | 1,632 |
| 2 concept revisions, 1 sample round | 968 |
| 4 concept revisions, 2 sample rounds | 2 |

~37% of products that went through sampling also needed 2 concept revisions before the sample was requested.

### Tags as business signals

Key tags and what they represent:

| Tag | Count | Meaning |
|-----|-------|---------|
| disney | 3,574 | Disney-licensed products |
| marvel | 2,125 | Marvel-licensed products |
| customer refresh | 1,516 | Buyer requested refresh of existing line |
| wb | 1,208 | Warner Bros-licensed |
| star wars | 1,095 | Star Wars-licensed |
| nick | 495 | Nickelodeon-licensed |
| nbcu | 491 | NBCUniversal-licensed |
| on po | 356 | Product has a purchase order |
| sega | 341 | SEGA-licensed |
| peanuts | 272 | Peanuts-licensed |
| before and after presentation | 228 | Presentation format showing design evolution |
| customer category expansion | 182 | Buyer requesting new product categories |
| for licensor | 160 | Task routed for licensor submission |
| prod development | 142 | Internal product development |
| strawberry shortcake | 142 | Strawberry Shortcake-licensed |
| internal approval | 133 | Requires internal sign-off |
| packaging submitted | 105 | Packaging sent to licensor |
| for adam | 104 | Routed to Adam (Sales) — exact meaning TBD |
| one piece | 89 | One Piece-licensed |
| packaging approved | 65 | Licensor approved packaging |
| stallion art wholesale only | 62 | Wholesale sublicensor channel (Stallion Art) |
| click team only | 68 | Internal-only visibility |
| coca cola | 50 | Coca-Cola-licensed |
| for factory | 39 | Routed to factory |
| template | 33 | Template task (not a real product) |

### What comments reveal about operations

Recent task comments show:
- Designers paste **NAS file paths** when work is done: `S:\Coca Cola\27 SS Seasonal Broadcast\27 SS Y2K Overdrive\Y2K Overdrive`
- Presentations are shared as **PDFs** via ClickUp comments: `BoxLunch_newDevelopments26-v4.pdf`
- Creative direction happens in comments: *"come up with concepts that make sense.. mickey with glasses on that light up.. or stitch space goggles. Fun newness that will be attractive to a home buyer"*
- `@Elizabeth @Jessica` appear together frequently — Liz is always in the approval loop with Jessica
- Instructions reference NAS paths by UNC: `\\edgesynology1\files\shared\Sales Sheets...`

### What the live webhook data (49 days) shows

**1,247 events captured.** Top signals:
- `content` field changes (441) and `status` changes (433) are nearly equal — as much editing/rework as forward movement
- `assignee_add` (87) shows frequent handoffs
- `attachments` (52) — files being added, though not captured as dedicated webhook events
- Peak hours: 9am–1pm Eastern

The only live status transitions with known from→to are mostly from the `designflow` (software dev) space. Product pipeline transitions during this window are sparse but still useful. Product examples seen directly in D1 include:

- `int apprvd/selections made` → `smpl req`
- `send out art for po` → `complete`
- `with buyer for approval` → later execution states

Treat webhook transition analytics as a partial live sample, not a full historical truth set.

---

## 9. Pain Points — From the People Doing the Work

### Jessica (Project Manager) — Rounds 1 & 2

**1. Lost preliminary designs** (Q6, Q8)
> "Designs that are lost are lost several times a week. On several occasions, we've tried to reuse these designs for other projects to avoid starting from scratch. But this involves manually searching through past presentations to see what we can reuse and manually moving those files."
Search needed by: license, license property, product type, season.

**2. Art Director bottleneck** (Q11) — five root causes:
1. Sheets accumulate while Liz handles other responsibilities
2. Liz changes artwork she already approved at the buyer stage — entire LS must be redone
3. Unfamiliarity with product type forces consultation with senior creative, sales, production, or sourcing
4. Color preferences — colors approved for the buyer presentation are later rejected at LS stage
5. License property errors (e.g., Mickey and Friends artwork on a Mickey Mouse submission)

**3. Manual stage advancement** (Q13)
> "I'm the only one who moves certain SKU stages. The creative team should be able to tell me when each art file is ready and include the file path on the server, and I should be able to select multiple SKUs and assign the licensing sheet to a technical designer within the same system."

**4. Fear of batch uploads** (Q17)
> "I'm worried the team will do everything locally and not upload until everything is finished. If they have 20 SKUs, I can't wait for them to create 20 art files. I want to know if they have the first 5, the first 10."

**5. Multi-buyer conflicts** (Q9) — when two buyers pick the same design, a modified version is quietly made and presented as a design change, without explaining why.

**6. No time visibility** (Q12, Q15)
> "I'd like the system to tell me if a SKU has been stuck in a single stage for too long. Also, if a design gets stuck at Concept Approved but never reaches Purchase Order, because then we're wasting that work."

**7. Two separate dates not tracked** (Q21) — on-shelf date and PPS-requested date are different and both need to be tracked.

**8. Costing sheet constraints not accessible at design time** (Q21) — designers need factory constraints (die lines, color count, printing technique) while designing, not after the LS is rejected.

### Liz (Creative Director) — Round 2

**1. Missing product manufacturing specs** (Q27)
> "Specs, the way a product is made — it's the little details on each product type that take up the most time."

**2. Pantone errors** (Q25)
> "The main issues are the Pantones not being provided or wrong colors wrote out."

**3. Designer variance** (Q26) — some designers understand retailer aesthetics and licensor requirements; others don't. Designers who don't know a licensor's rejection patterns create more rework for Liz.

**4. Informal feedback loop** (Q24) — corrections go via Teams messages or Illustrator markups. No structured revision tracking in the system.

---

## 10. SLA Targets — Time Per Stage by Product Type

From Jessica (Q16). Times in **minutes**.

| Product Type | Brief | Design | Art File | Licensing Sheet | Revisions | Techpack for Factory |
|---|---|---|---|---|---|---|
| Stretched/Box | 10 | 30 | 30 | 75 | 30 | 24 |
| Framed | 10 | 30 | 30 | 75 | 30 | 24 |
| Plaque | 10 | 30 | 30 | 75 | 30 | 24 |
| Functional | 20 | 30 | 60 | 150 | 60 | 48 |
| Other Wall | 20 | 30 | 30 | 75 | 30 | 24 |
| Block | 10 | 30 | 30 | 75 | 30 | 24 |
| Box | 10 | 30 | 30 | 75 | 30 | 24 |
| Photo Frames | 30 | 60 | 60 | 150 | 60 | 48 |
| Object | 30 | 60 | 30 | 75 | 30 | 24 |
| Other Tabletop | 20 | 60 | 30 | 75 | 30 | 24 |
| Clocks | 10 | 30 | 40 | 100 | 40 | 32 |
| Soft Storage | 30 | 60 | 40 | 100 | 40 | 32 |
| Hard Storage | 30 | 60 | 40 | 100 | 40 | 32 |
| Other Storage | 20 | 60 | 40 | 100 | 40 | 32 |
| Stationery Org | 30 | 60 | 40 | 100 | 40 | 32 |
| Desk Acc | 20 | 60 | 40 | 100 | 40 | 32 |
| Other Workspace | 20 | 60 | 40 | 100 | 40 | 32 |
| Floor Coverings | 10 | 15 | 20 | 50 | 20 | 16 |
| Garden | 30 | 30 | 40 | 100 | 40 | 32 |

---

## 11. Licensor Turnaround Times

From Jessica (Q16).

| Licensor | Expected Response |
|----------|-------------------|
| Disney | 1–3 days |
| LucasFilm / Star Wars | 1–2 days |
| Marvel | 1–2 days |
| Nickelodeon (Paramount) | 3–6 days |
| Coca-Cola | 6 days |
| Sesame Street | 4 days |
| NBC Universal | 5–7 days |
| Warner Brothers | 5–10 days |
| Peanuts | 7–10 days |
| SEGA | 7–10 days |
| Strawberry Shortcake (Wildbrain CPLP) | 7–10 days |
| WWE | 7–10 days |
| Care Bears | 7–10 days |
| One Piece (TOEI) | 7–15 days |

---

## 12. Requirements for the New System

### Must-have

**Project-SKU linking** — Every SKU belongs to a project (buyer + retailer + season). Two separate date fields per SKU: on-shelf date and PPS-requested date. SKUs inherit project context so designers don't have to look it up.

**Design library** — Searchable repository of all preliminary designs including rejected ones. Filterable by: licensor, license property, product type, season, retailer. Designs exist independently of buyer selections.

**Full 17-stage pipeline tracking** — All stages from Section 5 as explicit checkpoints. Each stage knows its expected duration by product type (Section 10).

**Stage-overdue alerts** — When a SKU exceeds its SLA for the current stage, surface it to the PM automatically. Also alert when a SKU reaches Concept Approved with no PO and no sample request after a defined wait period.

**Pre-submission validation** — Block submission to Liz's queue if Pantone codes or manufacturing specs are missing.

**Costing sheet constraints at design time** — Designers see factory constraints while designing, not after the LS is rejected.

**Batch stage advancement** — Move multiple SKUs to next stage in one action.

**Incremental progress visibility** — Designers mark SKUs ready one at a time; PM sees partial progress as it happens.

**Creative Director review queue** — All sheets awaiting Liz's review, sorted by age. Status: pending / revision sent / approved.

**Two date fields** — On-shelf date (when product must be in stores) and PPS-requested date (when buyer wants to see sample) — separate fields.

**Change-of-hands history** — When a different designer takes over a SKU, the system records who did what and when.

**DAM thumbnail integration** — Thumbnails from the existing DAM (stored on DigitalOcean Spaces S3) displayed in Plane. Full-size files remain on the NAS; Plane shows the thumbnail and the NAS path. No need to re-upload full files.

### Should-have

**PM dashboard** — Bottleneck view, designer workload, retroactive deadline calculator.

**Multi-buyer conflict detection** — Alert when two active projects select the same design.

**Structured revision notes** — In-system revision comments attached to the specific submission, replacing Teams messages and Illustrator markups.

**Role-specific views** — Designer, Creative Director, PM, Sales each see a tailored workspace.

**Notifications** — When Liz approves → notify designer + licensing coordinator. When licensor responds → notify PM + licensing manager.

**Wholesale sublicensor channel support** — Stallion Art and Iconick products go through the same licensor approval pipeline but need routing tags / separate views.

### Nice-to-have

**Designer productivity metrics** — Pick rate, revision rate, avg stage completion time per designer, licensor familiarity score.

**Natural language queries** (see Section 13).

---

## 13. AI Assistant Queries — Verbatim from Jessica (Q20)

These are the exact questions she said she would use every week:

1. *"How many SKUs have a licensing sheet but the art director hasn't sent it to the licensing team?"*
2. *"How many SKUs have techpacks for factory but the art director hasn't confirmed which factory to send to?"*
3. *"List of all projects for the same retailer (client)"*
4. *"Which designer created more designs (preliminary or art files) this week?"*
5. *"Which designer has the least picks from buyers in the last month?"*
6. *"Summary of this project"* → expected: *"Total SKUs 27, 20 are sample requested, 3 concept approved, 4 concept submitted, next action: send the three approved concepts to the factory and wait for the 4 not approved."*

---

## 14. Open Questions

**Resolved in Rounds 1–3 (see `docs/interview-synthesis.md` for full answers):**
- ✅ "for adam" tag — outdated. All client designs go to sales; tag is no longer meaningful
- ✅ PI Approval — required by some licensors only; needs "Not Required" option per-licensor
- ✅ Brand Assurance — submission number from licensor portal; also required for shipping compliance
- ✅ Concept Approved dormant products — buyers passed on them; should be surfaced as reusable design inventory
- ✅ Products open 4–5 years — never formally closed; cancel state with required reason is needed
- ✅ Costing sheet creation — technical designer creates, art director approves, sourcing team confirms
- ✅ SKU creation trigger — anything requiring licensor submission (not just buyer picks)
- ✅ SKU reuse across buyers — same SKU, same code (licensor approval record), show order history

**For Jen (not yet interviewed — Spruce Line still provisional):**
- Full from-scratch interview on the Spruce Line process
- How collections/presentations are tracked vs individual SKUs
- What "Edge Generic" is and how it works
- Pain points specific to non-licensed product development
- When a Spruce design is reused for multiple buyers: duplicate, derivative, or same record?
- If only part of a collection is selected: what is the execution unit — project, collection, or SKU?

**Data gaps still open:**
- `buyer` field in products stores UUIDs, not names — needs resolution
- Product category only populated for 57 of 9,069 products
- Field coverage is generally sparse (`retailer` 200 / 9,051, `buyer` 17 / 9,051, `product_category` 57 / 9,051)
- The `products` table should not be treated as a perfect one-row-per-business-product truth layer
- Time tracking: 0 entries despite being enabled
