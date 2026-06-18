-- Split curated customers out of the raw ingested CRM dump.
-- See HANDOFF.md. retailer/buyer are raw Twenty-CRM ingestion dumps.
-- End state:
--   ingested_domains  = today's retailer (ALL ~3,740 rows; ingestion dedup + crm_* relations)
--   retailer (new)    = the 102 active/potential customers, copied (same IDs), editable
--   ingested_contact  = today's buyer (ALL ~8,396 rows)
--   buyer (new)       = the 743 contacts at customer companies, copied (same IDs), editable
-- Customers are COPIED (kept in both) so the email worker still sees a domain was ingested,
-- and so crm_* relations (which stay on ingested_domains/ingested_contact) need no repoint.
-- Only PIM relations flip to the curated tables; their stored IDs are unchanged.
--
-- Run wrapped in BEGIN/…/ROLLBACK first (dry run) then BEGIN/…/COMMIT.

-- ── 0. Null the 2 self-reference orphan PIM links (owner test data; companies are OTHER) ──
UPDATE project SET retailer = NULL WHERE id = '3ddba6dc-aac9-4128-a00d-e36804f9ad27'; -- co "Albert Hazan"
UPDATE project SET buyer    = NULL WHERE id = '245ba753-1ad2-4a4e-9624-6dd86f70c8d4'; -- buyer "Albert Hazan"/Edgeho

-- ── 1. Rename the big dumps + free up the clean constraint/index names ──
ALTER TABLE retailer RENAME TO ingested_domains;
ALTER INDEX retailer_pkey RENAME TO ingested_domains_pkey;
ALTER TABLE ingested_domains RENAME CONSTRAINT retailer_primary_salesperson_foreign TO ingested_domains_primary_salesperson_foreign;
ALTER TABLE ingested_domains RENAME CONSTRAINT retailer_account_owner_foreign      TO ingested_domains_account_owner_foreign;

ALTER TABLE buyer RENAME TO ingested_contact;
ALTER INDEX buyer_pkey RENAME TO ingested_contact_pkey;
ALTER TABLE ingested_contact RENAME CONSTRAINT buyer_retailer_foreign   TO ingested_contact_retailer_foreign;
ALTER TABLE ingested_contact RENAME CONSTRAINT buyer_department_foreign TO ingested_contact_department_foreign;
-- the crm_buyer_department_scope trigger rides along on ingested_contact (harmless there).

-- ── 2. Curated retailer = the 102 customers (same IDs) ──
CREATE TABLE retailer (LIKE ingested_domains INCLUDING DEFAULTS);
ALTER TABLE retailer ADD CONSTRAINT retailer_pkey PRIMARY KEY (id);
ALTER TABLE retailer ADD CONSTRAINT retailer_primary_salesperson_foreign FOREIGN KEY (primary_salesperson) REFERENCES directus_users(id) ON DELETE SET NULL;
ALTER TABLE retailer ADD CONSTRAINT retailer_account_owner_foreign      FOREIGN KEY (account_owner)      REFERENCES directus_users(id) ON DELETE SET NULL;
INSERT INTO retailer SELECT * FROM ingested_domains WHERE customer_status IN ('ACTIVE_CUSTOMER','POTENTIAL_CUSTOMER');

-- ── 3. Curated buyer = the 743 contacts at customer companies (same IDs) ──
CREATE TABLE buyer (LIKE ingested_contact INCLUDING DEFAULTS);
ALTER TABLE buyer ADD CONSTRAINT buyer_pkey PRIMARY KEY (id);
ALTER TABLE buyer ADD CONSTRAINT buyer_retailer_foreign   FOREIGN KEY (retailer)   REFERENCES retailer(id)       ON DELETE SET NULL;
ALTER TABLE buyer ADD CONSTRAINT buyer_department_foreign FOREIGN KEY (department) REFERENCES crm_department(id) ON DELETE SET NULL;
-- Seed = contacts at customer companies, PLUS any buyer still referenced by live PIM work
-- (some real buyers have a blank company link; their project/product links must stay valid).
INSERT INTO buyer SELECT * FROM ingested_contact ic
WHERE ic.retailer IN (SELECT id FROM retailer)
   OR ic.id IN (SELECT buyer FROM product WHERE buyer IS NOT NULL
                UNION SELECT buyer FROM project WHERE buyer IS NOT NULL
                UNION SELECT buyer FROM "order" WHERE buyer IS NOT NULL);
CREATE TRIGGER crm_buyer_department_scope BEFORE INSERT OR UPDATE OF retailer, department
  ON buyer FOR EACH ROW EXECUTE FUNCTION crm_check_buyer_department_scope();

-- ── 4. Repoint PIM incoming FKs from the dumps to the curated tables ──
ALTER TABLE product           DROP CONSTRAINT product_retailer_foreign,                     ADD CONSTRAINT product_retailer_foreign                     FOREIGN KEY (retailer)             REFERENCES retailer(id) ON DELETE SET NULL;
ALTER TABLE project           DROP CONSTRAINT project_retailer_foreign,                     ADD CONSTRAINT project_retailer_foreign                     FOREIGN KEY (retailer)             REFERENCES retailer(id) ON DELETE SET NULL;
ALTER TABLE "order"           DROP CONSTRAINT order_retailer_foreign,                       ADD CONSTRAINT order_retailer_foreign                       FOREIGN KEY (retailer)             REFERENCES retailer(id) ON DELETE SET NULL;
ALTER TABLE design            DROP CONSTRAINT design_first_offered_to_foreign,              ADD CONSTRAINT design_first_offered_to_foreign              FOREIGN KEY (first_offered_to)     REFERENCES retailer(id) ON DELETE SET NULL;
ALTER TABLE design_collection DROP CONSTRAINT design_collection_account_specific_for_foreign, ADD CONSTRAINT design_collection_account_specific_for_foreign FOREIGN KEY (account_specific_for) REFERENCES retailer(id) ON DELETE SET NULL;
ALTER TABLE product           DROP CONSTRAINT product_buyer_foreign,                        ADD CONSTRAINT product_buyer_foreign                        FOREIGN KEY (buyer)                REFERENCES buyer(id)    ON DELETE SET NULL;
ALTER TABLE project           DROP CONSTRAINT project_buyer_foreign,                        ADD CONSTRAINT project_buyer_foreign                        FOREIGN KEY (buyer)                REFERENCES buyer(id)    ON DELETE SET NULL;
ALTER TABLE "order"           DROP CONSTRAINT order_buyer_foreign,                          ADD CONSTRAINT order_buyer_foreign                          FOREIGN KEY (buyer)                REFERENCES buyer(id)    ON DELETE SET NULL;

-- ── 5. Directus metadata: collections (add ingested_*; re-note curated) ──
CREATE TEMP TABLE _c ON COMMIT DROP AS SELECT * FROM directus_collections WHERE collection IN ('retailer','buyer');
UPDATE _c SET collection='ingested_domains', icon='inbox',
  note='Raw ingestion registry — ALL ingested Twenty-CRM companies/domains (~3,740, ~97% not customers). Written by the email worker for dedup. NOT for app pickers. Real customers are copied to the retailer collection on promotion.'
  WHERE collection='retailer';
UPDATE _c SET collection='ingested_contact', icon='inbox',
  note='Raw ingestion registry — ALL ingested email contacts (~8,400). NOT for app pickers. Real buyers are copied to the buyer collection.'
  WHERE collection='buyer';
INSERT INTO directus_collections SELECT * FROM _c;
UPDATE directus_collections SET icon='store',  note='Curated customers only (customer_status ACTIVE/POTENTIAL). Editable. Safe as a picker. Promoted from ingested_domains by the worker; originals stay there for dedup.' WHERE collection='retailer';
UPDATE directus_collections SET icon='person', note='Curated buyers only — contacts at customer companies. Editable. Safe as a picker.' WHERE collection='buyer';

-- ── 6. Directus metadata: fields (copy for the new ingested_* collections; exclude serial id) ──
INSERT INTO directus_fields (collection, field, special, interface, options, display, display_options, readonly, hidden, sort, width, translations, note, conditions, required, "group", validation, validation_message, searchable)
SELECT 'ingested_domains', field, special, interface, options, display, display_options, readonly, hidden, sort, width, translations, note, conditions, required, "group", validation, validation_message, searchable
  FROM directus_fields WHERE collection='retailer';
INSERT INTO directus_fields (collection, field, special, interface, options, display, display_options, readonly, hidden, sort, width, translations, note, conditions, required, "group", validation, validation_message, searchable)
SELECT 'ingested_contact', field, special, interface, options, display, display_options, readonly, hidden, sort, width, translations, note, conditions, required, "group", validation, validation_message, searchable
  FROM directus_fields WHERE collection='buyer';

-- ── 7. Directus metadata: relations ──
-- ingested_domains outgoing (copy retailer's M2O to directus_users)
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'ingested_domains', many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action
  FROM directus_relations WHERE many_collection='retailer';
-- ingested_contact outgoing (copy buyer's M2O; its retailer link points at the dump)
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'ingested_contact', many_field,
       CASE WHEN one_collection='retailer' THEN 'ingested_domains' ELSE one_collection END,
       one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action
  FROM directus_relations WHERE many_collection='buyer';
-- CRM incoming relations follow the dumps (PIM incoming stay on the curated tables)
UPDATE directus_relations SET one_collection='ingested_domains' WHERE one_collection='retailer' AND many_collection LIKE 'crm%';
UPDATE directus_relations SET one_collection='ingested_contact' WHERE one_collection='buyer'    AND many_collection LIKE 'crm%';

-- ── 8. Copy-on-promotion: flag a domain customer → it appears in curated retailer ──
-- Promotion only; never clobbers curated edits, never auto-removes (protects PIM FKs).
CREATE OR REPLACE FUNCTION promote_customer_to_retailer() RETURNS trigger AS $$
BEGIN
  IF NEW.customer_status IN ('ACTIVE_CUSTOMER','POTENTIAL_CUSTOMER') THEN
    INSERT INTO retailer SELECT (NEW).* ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS promote_customer ON ingested_domains;
CREATE TRIGGER promote_customer AFTER INSERT OR UPDATE OF customer_status
  ON ingested_domains FOR EACH ROW EXECUTE FUNCTION promote_customer_to_retailer();
