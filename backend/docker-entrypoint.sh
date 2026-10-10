#!/bin/sh
# Container entrypoint: apply pending migrations to the volume database,
# then start the server. Fails fast if the database is unreachable.
set -eu
# Sensible container default: the image declares VOLUME /data, so an unset
# DATABASE_URL points at the persistent volume. Explicit env always wins.
export DATABASE_URL="${DATABASE_URL:-file:/data/cardinals-corner.db}"
# NOTE: `pnpm --filter backend exec` runs inside backend/, so the schema path
# must be absolute. Apply pending migrations, then start the server.
# No migration history in this project (schema.prisma is the source of truth):
# push the schema, accepting data loss on structural changes. Schedule data is
# re-importable reference data (CSV import), so a fresh table beats a stale one.
pnpm --filter backend exec prisma db push --accept-data-loss --schema /app/backend/prisma/schema.prisma
exec node backend/dist/server.js
