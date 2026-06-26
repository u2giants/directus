#!/usr/bin/env bash
# Create a custom-format PostgreSQL dump suitable for Supabase restore rehearsals.
# This is read-only against production and writes the dump to pm-system/backups/.
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-directus-db-nzli85mk3luzb6u7cnq5fidu}"
DB_NAME="${DB_NAME:-directus}"
DB_USER="${DB_USER:-directus}"
OUT_DIR="${OUT_DIR:-pm-system/backups}"
STAMP="${STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
BASE="directus-to-supabase-${STAMP}"
REMOTE="/tmp/${BASE}.dump"
LOCAL="${OUT_DIR}/${BASE}.dump"
LIST="${OUT_DIR}/${BASE}.restore-list.txt"

mkdir -p "$OUT_DIR"

docker exec "$DB_CONTAINER" pg_dump \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$REMOTE"

docker cp "${DB_CONTAINER}:${REMOTE}" "$LOCAL"
docker exec "$DB_CONTAINER" rm -f "$REMOTE"

pg_restore --list "$LOCAL" > "$LIST"

printf 'wrote %s\n' "$LOCAL"
printf 'wrote %s\n' "$LIST"
