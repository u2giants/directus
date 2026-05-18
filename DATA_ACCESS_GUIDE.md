# Data Access Guide — POP Creations / Spruce Line Platform

This document gives a second AI session everything needed to independently access and analyze the data collected from ClickUp and from employee interviews.

---

## What This Company Does

Licensed and generic home decor products. Designed in-house, manufactured in China, imported and sold to major U.S. retail chains (Burlington, TJX, Ross, Hobby Lobby, Walmart, etc.). 75% of products are licensed (Disney, Marvel, Warner Bros, etc.) and require licensor approval of designs AND physical samples before mass production can begin. The other 25% are non-licensed ("Spruce Line") with a simpler approval path.

Full business intelligence, pipeline details, SLA targets, and requirements are in **BUSINESS_INTELLIGENCE.md** in the same repo.

---

## Data Sources

### 1. Cloudflare D1 Database

**Database ID:** `c37aeb36-e16e-416b-b699-c910f6f8dc10`  
**Account:** `u2giants`  
**MCP tool:** `mcp__9a4e64b3-8b0d-4708-9ca2-19515b76966e__d1_database_query`

To query, call the MCP tool with:
```json
{
  "database_id": "c37aeb36-e16e-416b-b699-c910f6f8dc10",
  "sql": "SELECT ..."
}
```

Note: D1 uses SQLite syntax.

---

## Key Tables and How to Use Them

### `products` — Start here. The primary query surface.
9,069 rows. One row per product. Denormalized and enriched.

**Always add `WHERE is_internal = 0`** to exclude the internal software dev space.

Key columns:
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | ClickUp task ID |
| name | TEXT | SKU name with structured code prefix |
| licensor | TEXT | Disney, Marvel, WB, Star Wars, DC Comics, etc. |
| retailer | TEXT | Burlington, TJX, Ross, Walmart, etc. |
| product_category | TEXT | Wall, Storage, Desktop, etc. (sparse — only 57 rows populated) |
| stage_name | TEXT | Current pipeline stage (clean name) |
| stage_category | TEXT | Ideation / Concept / Design / Pre-Production / Production / Fulfillment / Complete / Admin |
| stage_order | INT | Numeric order (5–609). Higher = further along |
| status | TEXT | Raw ClickUp status string |
| space_name | TEXT | "POP Creations" or "Spruce Line" |
| list_name | TEXT | Which ClickUp list |
| is_active | INT | 1 = currently open, 0 = closed |
| is_internal | INT | 1 = designflow/dev space (exclude these) |
| days_in_pipeline | REAL | Days since task was created |
| days_since_last_update | REAL | Days since last change |
| is_overdue | INT | 1 if past due_date |
| concept_revisions | INT | Number of concept revision cycles |
| packaging_revisions | INT | Number of packaging revision cycles |
| sample_rounds | INT | Number of sample rounds |
| milestone_concept_approved | INT | 1 if reached concept approval |
| milestone_sample_approved | INT | 1 if sample approved |
| milestone_art_complete | INT | 1 if art marked complete |
| milestone_pi_approved | INT | 1 if PI approval reached |
| milestone_tech_pack_checked | INT | 1 if tech pack checked |
| assignee_ids | TEXT | JSON array of user IDs |
| comment_approvals | INT | Approval signals in comments |
| comment_revisions | INT | Revision requests in comments |

**Sample query — active POP Creations products by stage:**
```sql
SELECT stage_name, stage_category, COUNT(*) as cnt
FROM products
WHERE is_internal = 0 AND is_active = 1 AND space_name = 'POP Creations'
GROUP BY stage_name
ORDER BY stage_order
```

---

### `workflow_stages` — Stage dictionary
76 rows. Maps raw ClickUp status strings to clean names.

| Column | Notes |
|--------|-------|
| status_raw | Raw ClickUp status string (e.g., "concp apprv") |
| stage_name | Clean name (e.g., "Concept Approved") |
| stage_category | Category group |
| stage_order | Numeric ordering |
| description | What this stage means |

---

### `checkpoint_map` — Formal milestone definitions
27 rows. Defines each formal milestone checkpoint.

| Column | Notes |
|--------|-------|
| step_id | Identifier (e.g., "concept_approved") |
| step_name | Display name |
| step_order | Numeric order |
| step_category | Design / Production / Sampling / Fulfillment / etc. |
| description | What this milestone means |

---

### `product_checkpoints` — Which milestones each product has reached
32,534 rows. JOIN to `checkpoint_map` on step_id.

---

### `status_transitions` — Every status change ever recorded
17,978 rows. Important caveat: **most rows have `from_status = NULL`** because they were bulk-imported from the snapshot. Only ~473 rows have real from→to transitions (from the live webhook period, Mar 30–May 18, 2026).

| Column | Notes |
|--------|-------|
| task_id | Links to tasks/products |
| from_status | NULL for snapshot imports; populated for live webhook events |
| to_status | The status the task moved to |
| transitioned_at | Timestamp |
| user_id / user_name | Who made the change |

---

### `task_tags` — Tags on tasks
13,333 rows. Most important signal for licensor, channel, and routing.

Top tags: disney (3,574), marvel (2,125), customer refresh (1,516), wb (1,208), star wars (1,095), on po (356), sega (341), peanuts (272), prod development (142), for adam (104).

```sql
SELECT tag_name, COUNT(*) as cnt FROM task_tags GROUP BY tag_name ORDER BY cnt DESC
```

---

### `task_comments` — Comment text
244 rows with non-null content. Comments often contain:
- NAS file paths (e.g., `S:\Coca Cola\27 SS Seasonal Broadcast\...`)
- @mentions (e.g., `@Elizabeth @Jessica Cortázar`)
- Presentation PDFs
- Creative direction instructions

---

### `task_custom_fields` — Custom field values
3,733 rows.

Key fields:
| field_name | field_type | Notes |
|------------|------------|-------|
| SMPL Req | number | Sample request — most used (2,362 entries) |
| Revision received | date | Date revision was received (699 entries) |
| 🧑‍✈ Customer / Retailer | drop_down | Retailer name (198 entries) |
| 👤 Buyer | labels | Buyer name (74 entries) |
| put-up | drop_down | Manufacturing method (ceramic, Framed MDF, Canvas, etc.) |
| 📚 Category | drop_down | Product category (Wall, Storage, Desktop, etc.) |
| 🏭 Factory | drop_down | Factory name |
| cust program | drop_down | Retailer seasonal program (e.g., "DG 2021 Elegant Charm") |
| Due Date Licensor | date | Licensor submission deadline |
| SAS-PO | date | PO-related date |
| Freelancer Name | short_text | Freelancer working on this task |

---

### `task_assignments` — Assignment history
14,670 rows. Who was assigned to what task.

---

### `events` — Live webhook events (49 days)
1,247 rows. Captures real-time ClickUp activity Mar 30 – May 18, 2026.

| Column | Notes |
|--------|-------|
| event_type | taskStatusUpdated, taskUpdated, taskCreated, etc. |
| task_id | ClickUp task ID |
| user_name | Name of the person who triggered the event (this table has real names) |
| field_changed | What changed: status, content, assignee_add, attachments, etc. |
| from_value | Previous value |
| to_value | New value |
| received_at | Timestamp |

**Important:** The `users` table has IDs only (no names). Use `events` for user name lookups.

---

### `interview_questions` — All interview Q&A
49 rows (Rounds 1, 2, and 3). Rounds 1 & 2 are answered. Round 3 questions are inserted (status = 'pending').

| Column | Notes |
|--------|-------|
| id | Auto-increment |
| question | The question text |
| context | Background context given to the interviewer |
| topic | Category (workflow, pain_points, stages, etc.) |
| asked_at | When the question was inserted |
| answer | The respondent's answer (NULL for pending) |
| answered_at | When they answered |
| status | 'answered' or 'pending' |
| respondent | 'jessica', 'liz', or 'jen' |
| answered_by | Who answered (same as respondent for direct responses) |

**To read all answered questions:**
```sql
SELECT respondent, question, answer FROM interview_questions WHERE status = 'answered' ORDER BY id
```

**To read pending Round 3 questions:**
```sql
SELECT id, respondent, topic, question FROM interview_questions WHERE status = 'pending' ORDER BY respondent, id
```

---

### `spaces` — Three ClickUp spaces
| ID | Name | Notes |
|----|------|-------|
| 4294720 | POP Creations | Licensed products — main business |
| 2571984 | Spruce Line | Non-licensed generic products |
| 90114122073 | designflow | Internal software dev — EXCLUDE (is_internal=1) |

---

### `lists` — 21 ClickUp lists

**POP Creations key lists:**
- Licensing Management (13194624) — 7,281 products — PRIMARY SKU tracking
- Customer Refresh (901103451229) — buyer-requested refreshes
- New Prod Development (901103451188) — internal development
- Customer Category Expansion (901103451267) — new category requests
- Licensing Administration Tasks (901103525796) — admin tasks

**Spruce Line key lists:**
- Edge Generic (15061776) — 701 products — primary Spruce tracking

---

## 2. GitHub Repository

**Repo:** `u2giants/plane`  
**Branch:** `main` (single branch policy)  
**CLI:** `gh api repos/u2giants/plane/...` or `gh` commands

Key files:
- `BUSINESS_INTELLIGENCE.md` — full business context and requirements
- `README.md` — project overview and infrastructure
- `AI_OPERATING_RULES.md` — rules for AI working in this repo
- `SCHEMA_DESIGN.md` — proposed robust schema
- `DB_ANALYSIS.md` — original database analysis
- `integrations/worker/src/index.js` — Cloudflare Worker (webhook receiver + /query endpoint)

---

## 3. Cloudflare Worker (Live API Endpoints)

**Worker URL:** `https://plane-integrations.u2giants.workers.dev`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Liveness check |
| `/clickup/webhook` | POST | ClickUp webhook receiver (live events → D1) |
| `/query` | POST | Natural language → SQL → answer (Claude-powered) |
| `/interview` | GET | Interview UI (add `?who=jessica`, `?who=liz`, `?who=jen`) |

---

## 4. Additional MCP Tools Available

```
mcp__9a4e64b3-8b0d-4708-9ca2-19515b76966e__workers_list          — list Workers
mcp__9a4e64b3-8b0d-4708-9ca2-19515b76966e__workers_get_worker    — get Worker details
mcp__9a4e64b3-8b0d-4708-9ca2-19515b76966e__r2_buckets_list       — list R2 buckets
mcp__9a4e64b3-8b0d-4708-9ca2-19515b76966e__kv_namespaces_list    — list KV namespaces
mcp__9a4e64b3-8b0d-4708-9ca2-19515b76966e__d1_databases_list     — list all D1 databases
mcp__9a4e64b3-8b0d-4708-9ca2-19515b76966e__accounts_list         — list Cloudflare accounts
```

---

## 5. Coolify (Production Deployment)

Coolify manages the production runtime. REST API:
```
Base URL: http://178.156.180.212:8000/api/v1
Auth: Bearer 1|mlVx9mbwsN1Sga6eLtJEvmPioy6Sra9AnepnCe3K7d0a2927
Server UUID: onwp0kd7w1w74w9yeotnoihp
```

---

## Suggested Starting Queries

**Understand the current active pipeline:**
```sql
SELECT stage_name, stage_category, stage_order, COUNT(*) as cnt
FROM products WHERE is_internal=0 AND is_active=1
GROUP BY stage_name ORDER BY stage_order
```

**Licensor breakdown with revision rates:**
```sql
SELECT licensor, COUNT(*) as products, AVG(concept_revisions) as avg_revisions
FROM products WHERE is_internal=0 AND licensor IS NOT NULL
GROUP BY licensor ORDER BY products DESC
```

**Most active users in webhook period:**
```sql
SELECT user_name, COUNT(*) as events FROM events
WHERE user_name IS NOT NULL GROUP BY user_name ORDER BY events DESC
```

**Read all answered interview content:**
```sql
SELECT respondent, topic, question, answer FROM interview_questions
WHERE status='answered' ORDER BY id
```

**Products stuck in Concept Approved (no next step):**
```sql
SELECT name, licensor, days_in_pipeline, days_since_last_update
FROM products WHERE stage_name='Concept Approved' AND is_active=1
ORDER BY days_since_last_update DESC LIMIT 20
```
