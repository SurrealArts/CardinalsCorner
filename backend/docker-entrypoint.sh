#!/bin/sh
# Container entrypoint: apply pending migrations to the volume database,
# then start the server. Fails fast if the database is unreachable.
set -eu
pnpm --filter backend exec prisma migrate deploy --schema backend/prisma/schema.prisma
exec node backend/dist/server.js
