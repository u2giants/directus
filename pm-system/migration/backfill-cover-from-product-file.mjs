// Backfill product.cover_url from already-imported product_file images.
//
// Context: ClickUp's task API exposes NO cover-image designation (attachments
// have no is_cover/cover flag). The cover backfills (clickup-images.mjs,
// clickup-to-spaces.mjs, clickup-pdf-covers-to-spaces.mjs) therefore guessed a
// cover heuristically: first raster image, else first PDF page-1. The work
// importer separately recorded EVERY attachment in product_file. So a product
// can have image attachments (visible in the gallery) yet an empty cover_url
// when the heuristic recognized nothing (non-image/non-PDF first attachment,
// unsupported extension, fetch/render failure, or the PDF pass not having run).
//
// This script closes that gap WITHOUT touching ClickUp: for each product with
// an empty cover_url, it picks the first usable image already stored in Spaces
// (product_file.stored_url) and sets it as the cover. The board's adapter
// (poppim-web src/domain/products/adapters.ts) only derives a covers/<id>_thumb
// when cover_url is under the Spaces covers/ prefix; a /product-files/ URL is
// rendered as-is, so the board shows the full image (heavier but correct). To
// also get a board thumbnail, run clickup-to-spaces-style copy into covers/
// later — left out here to keep this pure-DB and reversible.
//
// Pure SQL, idempotent (only fills empty covers), reversible (the chosen ids
// had no cover before — revert with: SET cover_url='' WHERE id IN (...)).
//
// Usage (on the directus host):
//   sudo docker exec -i <directus-db-container> psql -U directus -d directus -f - < this-as-sql
// or run the embedded SQL via your preferred psql connection. The SQL is the
// source of truth; this file documents intent and the exact statement applied
// on 2026-06-15 (419 products updated).

export const SQL = `
WITH tgt AS (
  SELECT p.id FROM product p WHERE (p.cover_url IS NULL OR p.cover_url = '')
), pick AS (
  SELECT DISTINCT ON (pf.product) pf.product, pf.stored_url
  FROM product_file pf JOIN tgt ON tgt.id = pf.product
  WHERE pf.stored_url LIKE '%digitaloceanspaces%'
    AND (pf.mime_type LIKE 'image/%'
         OR lower(pf.file_type) IN ('png','jpg','jpeg','webp','gif')
         OR lower(split_part(pf.title, '.', -1)) IN ('png','jpg','jpeg','webp','gif'))
  ORDER BY pf.product, pf.uploaded_at ASC NULLS LAST, pf.id
)
UPDATE product p SET cover_url = pick.stored_url
FROM pick WHERE pick.product = p.id
RETURNING p.id;
`
