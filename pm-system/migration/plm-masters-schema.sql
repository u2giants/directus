-- One-time schema for the Designflow-PLM master-data link (licensor → property → character).
-- Data is loaded/maintained by pm-system/sync-plm-masters.mjs. Idempotent.
--
-- Strict dependency: a property MUST have a licensor, a character MUST have a property
-- (NOT NULL + ON DELETE CASCADE). Cross-ref key is plm_mg_code, unique within its parent.

BEGIN;

-- Cross-ref columns
ALTER TABLE licensor ADD COLUMN IF NOT EXISTS plm_mg_code  varchar(64);
ALTER TABLE licensor ADD COLUMN IF NOT EXISTS plm_synced_at timestamptz;
ALTER TABLE property ADD COLUMN IF NOT EXISTS plm_mg_code  varchar(64);
ALTER TABLE property ADD COLUMN IF NOT EXISTS plm_synced_at timestamptz;

-- Tighten property → licensor (strict). Safe: property starts empty.
ALTER TABLE property ALTER COLUMN licensor SET NOT NULL;
ALTER TABLE property DROP CONSTRAINT IF EXISTS property_licensor_foreign;
ALTER TABLE property ADD  CONSTRAINT property_licensor_foreign FOREIGN KEY (licensor) REFERENCES licensor(id) ON DELETE CASCADE;

-- Tier-3 collection
CREATE TABLE IF NOT EXISTS "character" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255),
  property uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  plm_mg_code varchar(64),
  plm_synced_at timestamptz
);

-- Composite unique keys (mg_code unique within its parent)
CREATE UNIQUE INDEX IF NOT EXISTS licensor_plm_mg_uk     ON licensor(plm_mg_code)               WHERE plm_mg_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS property_lic_plm_uk     ON property(licensor, plm_mg_code)     WHERE plm_mg_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS character_prop_plm_uk   ON "character"(property, plm_mg_code)  WHERE plm_mg_code IS NOT NULL;

-- Directus metadata for licensor/property plm_* fields
INSERT INTO directus_fields (collection, field, interface, width, sort, note)
SELECT * FROM (VALUES
  ('licensor','plm_mg_code','input','half',90,'Designflow PLM merchandising code (cross-ref key)'),
  ('licensor','plm_synced_at','datetime','half',91,'Last PLM sync'),
  ('property','plm_mg_code','input','half',90,'Designflow PLM merchandising code (cross-ref key)'),
  ('property','plm_synced_at','datetime','half',91,'Last PLM sync')
) v(collection,field,interface,width,sort,note)
WHERE NOT EXISTS (SELECT 1 FROM directus_fields f WHERE f.collection=v.collection AND f.field=v.field);

-- Directus metadata for the `character` collection (modeled on `property`)
INSERT INTO directus_collections (collection, icon, note)
SELECT 'character','theater_comedy','Licensed character / sub-property (tier 3, under property). Synced from Designflow PLM.'
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection='character');

INSERT INTO directus_fields (collection, field, special, interface, options, display, display_options, readonly, hidden, sort, width, translations, note, conditions, required, "group", validation, validation_message, searchable)
SELECT 'character', CASE WHEN field='licensor' THEN 'property' ELSE field END, special, interface, options, display, display_options, readonly, hidden, sort, width, translations,
       CASE WHEN field='licensor' THEN 'Parent property' ELSE note END, conditions, required, "group", validation, validation_message, searchable
FROM directus_fields WHERE collection='property'
  AND NOT EXISTS (SELECT 1 FROM directus_fields f WHERE f.collection='character');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'character','property','property', one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action
FROM directus_relations WHERE many_collection='property' AND many_field='licensor'
  AND NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection='character' AND many_field='property');

INSERT INTO directus_permissions (policy, collection, action, permissions, validation, presets, fields)
SELECT policy, 'character', action, permissions, validation, presets, fields FROM directus_permissions p
WHERE collection='property' AND NOT EXISTS (SELECT 1 FROM directus_permissions q WHERE q.collection='character');

COMMIT;
