# ---- frontend build ----
FROM node:22-bookworm-slim AS frontend-build
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY frontend/package.json frontend/package.json
RUN pnpm install --filter frontend --frozen-lockfile
COPY frontend/ frontend/
RUN pnpm --filter frontend build

# ---- backend build ----
FROM node:22-bookworm-slim AS backend-build
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json backend/package.json
RUN pnpm install --filter backend --frozen-lockfile
COPY backend/ backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
# Dummy URL: `generate` only needs the env var present, not a live database.
ENV DATABASE_URL="file:./dev.db"
RUN pnpm --filter backend build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json backend/package.json
RUN pnpm install --filter backend --prod --frozen-lockfile
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=backend-build /app/backend/prisma ./backend/prisma
COPY --from=backend-build /app/backend/docker-entrypoint.sh ./backend/docker-entrypoint.sh
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
RUN chmod +x ./backend/docker-entrypoint.sh
VOLUME ["/data"]
EXPOSE 3040
ENTRYPOINT ["./backend/docker-entrypoint.sh"]
