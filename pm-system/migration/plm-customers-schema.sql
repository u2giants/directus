-- Cross-ref table linking authoritative Designflow-PLM customers to curated retailers.
-- Loaded/maintained by pm-system/sync-plm-masters.mjs (customer pass). Idempotent.
--
-- Many-to-one on purpose: a retailer (the curated customer account) can correspond to
-- several PLM customers — e.g. TJX corp + HomeGoods both map to "The TJX Companies, Inc.".
-- So the PLM customer id is the PK here, not a scalar column on retailer.
-- The frontends never read this; it exists only for the PLM sync + status authority.

BEGIN;

CREATE TABLE IF NOT EXISTS retailer_plm_customer (
  plm_customer_id   integer PRIMARY KEY,           -- PLM customers_id (authoritative)
  plm_customer_code varchar(64),                   -- PLM customers_code (NOT unique: e.g. "OS")
  plm_customer_name varchar(255),
  retailer          uuid NOT NULL REFERENCES retailer(id) ON DELETE CASCADE,
  plm_synced_at     timestamptz
);
CREATE INDEX IF NOT EXISTS retailer_plm_customer_retailer_idx ON retailer_plm_customer(retailer);

-- Directus metadata: register the collection + the FK relation (columns auto-detected).
INSERT INTO directus_collections (collection, icon, note, hidden)
SELECT 'retailer_plm_customer','link','PLM customer ↔ retailer cross-ref (sync only). Synced from Designflow PLM.', true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection='retailer_plm_customer');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_deselect_action)
SELECT 'retailer_plm_customer','retailer','retailer', NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection='retailer_plm_customer' AND many_field='retailer');

COMMIT;
