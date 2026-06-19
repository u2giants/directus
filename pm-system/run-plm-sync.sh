#!/usr/bin/env bash
# Wrapper for the daily PLM master-data sync (plm-sync.service).
# Resolves the Directus DB container IP at runtime so a container recreation
# (new IP) doesn't require editing any unit/env. Secrets come from the
# systemd EnvironmentFile (/home/ai/.plm-sync.env): PLM_API_KEY + DB_PASSWORD.
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-directus-db-nzli85mk3luzb6u7cnq5fidu}"
DB_IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$DB_CONTAINER")"
if [ -z "$DB_IP" ]; then echo "could not resolve IP for $DB_CONTAINER" >&2; exit 1; fi

export DATABASE_URL="postgres://directus:${DB_PASSWORD}@${DB_IP}:5432/directus"
exec /usr/bin/node /worksp/directus/pm-system/sync-plm-masters.mjs
