#!/bin/sh
# Container entrypoint: apply pending migrations to the volume database,
# then start the server. Fails fast if the database is unreachable.
set -eu
# Sensible container default: the image declares VOLUME /data, so an unset
# DATABASE_URL points at the persistent volume. Explicit env always wins.
export DATABASE_URL="${DATABASE_URL:-file:/data/cardinals-corner.db}"
# NOTE: `pnpm --filter backend exec` runs inside backend/, so the schema path
# must be absolute. Apply pending migrations, then start the server.
pnpm --filter backend exec prisma migrate deploy --schema /app/backend/prisma/schema.prisma
exec node backend/dist/server.js
