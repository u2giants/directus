# HANDOFF — Split customer data out of the ingested CRM dump

**Status:** planned, not started (authored 2026-06-18). No schema/code changes made yet.
**Owner decision:** physical-split (rejected read-only views and flag-only filtering).
**Scope:** `directus` backend (schema + `crm-worker.mjs`), with one-line follow-ups in `poppim-web` and screen changes in `popcrm-web`.

## Why

The `retailer` collection is **not** a customer list — it's a raw dump of every Twenty-CRM
company ingested by `pm-system/migration/twenty-import.mjs` and the email worker. Likewise
`buyer` is a dump of ingested email contacts. The product owner's rule: apps must only ever
see **real customers (active/potential)** and their real buyers — never a table that is ~97%
ingested garbage.

Current counts (live prod, 2026-06-18):

| Collection | Rows | Real customers / buyers | Junk |
|---|---|---|---|
| `retailer` | 3,740 | 102 (40 `ACTIVE_CUSTOMER` + 62 `POTENTIAL_CUSTOMER`) | 3,635 `OTHER` + 3 `UNASSIGNED` |
| `buyer` | 8,396 | 743 attached to customer companies | 7,653 on non-customers |

`customer_status` choices (see `pm-system/crm-schema.mjs`): `ACTIVE_CUSTOMER`,
`POTENTIAL_CUSTOMER`, `OTHER` ("Not a Customer"), `UNASSIGNED` ("New Company").

## Target structure (copy, not move)

Customers are **copied** into curated tables and **also kept** in the ingested tables, because
the email ingestion flow must still see "this domain was already ingested — don't re-act on it."

| New table | Contents | Used by |
|---|---|---|
| `ingested_domains` | today's `retailer`, **renamed** — all 3,740 rows | ingestion dedup + all `crm_*` relations |
| **`retailer`** (new, editable) | copy of the 102 customers, **same IDs** | PIM: `product`, `project`, `order`, `design.first_offered_to`, `design_collection.account_specific_for` |
| `ingested_contact` | today's `buyer`, **renamed** — all 8,396 rows | ingestion + CRM history |
| **`buyer`** (new, editable) | copy of the 743 contacts-at-customers, **same IDs** | PIM: `product`/`project`/`order` buyer links |

Key consequence: because customers are copied (kept in `ingested_domains` with the same IDs),
**the `crm_*` relations need zero repointing** — they keep resolving against `ingested_domains`
for every company. Only the PIM M2O relations flip to the curated tables, and since IDs are
identical the stored values don't change — only the relation's target collection.

## Relation inventory (who points at today's `retailer`)

12 collections relate to `retailer`. After the split:

- **Repoint to curated `retailer`:** `product.retailer`, `project.retailer`, `order.retailer`,
  `design.first_offered_to`, `design_collection.account_specific_for`.
- **Repoint to curated `buyer`:** `product.buyer`, `project.buyer`, `order.buyer`.
- **Leave on `ingested_domains` (no change):** `crm_opportunity` (0 rows), `crm_department`
  (38, all customers), `crm_meeting_note` (27), `crm_note` (0), `crm_task` (0),
  `crm_email_message` (11,210; 1,472 on non-customers). `buyer`→retailer becomes
  `ingested_contact`→? — repoint `ingested_contact.retailer` to `ingested_domains`.

PIM link integrity is nearly clean: 30 `product` + 31 `project` retailer links land on
customers; **only 2 self-reference orphans** exist (both the owner's own test data) — null them:

1. project `3ddba6dc-aac9-4128-a00d-e36804f9ad27` "Q4 2024 Disney Style Guide Presentations"
   → company **"Albert Hazan"** (`OTHER`, no domain).
2. project `245ba753-1ad2-4a4e-9624-6dd86f70c8d4` "MDF Shelves 2PK - Amazon"
   → buyer **"Albert Hazan" <albert@edgeho.me>**, company **"Edgeho"** (`OTHER`).

## Migration phases

**Phase 0 — Backup.** `pg_dump` of `retailer` + `buyer` (+ dependents) before any write.

**Phase 1 — Schema (idempotent script under `pm-system/`).**
1. Rename `retailer` → `ingested_domains` (physical table **and** Directus metadata:
   `directus_collections`, `directus_fields`, `directus_relations` — not just `ALTER TABLE`).
2. Create editable `retailer`; copy the 102 active/potential rows with same IDs.
3. Rename `buyer` → `ingested_contact`; repoint `ingested_contact.retailer` → `ingested_domains`.
4. Create editable `buyer`; copy the 743 contacts-at-customers (same IDs); `buyer.retailer` → new `retailer`.
5. Repoint the PIM M2O relations listed above to the curated tables.
6. Null the 2 orphan links; log them.

**Phase 2 — `crm-worker.mjs`.** contact-sync writes newly-ingested domains/contacts to the
`ingested_*` tables; on promotion (status → active/potential) **copy** the row into
`retailer`/`buyer` (same ID), original stays for dedup; routing/match queries read the clean
`retailer`; dedup keeps reading `ingested_domains`. (Worker already filters retailer by
`customer_status IN (ACTIVE, POTENTIAL)` at lines ~326/344/354/393 — those become reads of the
clean `retailer`.)

**Phase 3 — `poppim-web`.** Drop the `customer_status` filter in `fetchCustomers`
(`src/features/board/collab.ts`) — read the clean `retailer` directly. One line.

**Phase 4 — `popcrm-web`** (separate repo). Company/contact list screens point at `ingested_*`
(full) vs `retailer`/`buyer` (curated). Flag exact spots when reached.

## Open questions / watch-outs

- Collection renames must update Directus metadata tables, not just the physical table. Prefer
  the Directus schema API or a careful migration that updates `directus_relations`/`fields`/
  `collections` atomically.
- Decide whether edits to a customer in `retailer` mirror back to its `ingested_domains` row.
  Recommendation: **no** — `retailer` is the source of truth for customers going forward;
  `ingested_domains` is just the dedup registry.
- Confirm `crm_department`/`crm_meeting_note` should stay on `ingested_domains` vs. move to the
  curated `retailer` (CRM app owns these; default = leave them).

## Next action

On owner's go-ahead: build the Phase 1 script + run a **counts-only dry-run** for review
before any prod write.
