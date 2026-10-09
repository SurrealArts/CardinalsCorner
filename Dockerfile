# ---- frontend build ----
FROM node:22-bookworm-slim AS frontend-build
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json ./
COPY frontend/package.json frontend/package.json
RUN pnpm install --filter frontend --frozen-lockfile || pnpm install --filter frontend --no-frozen-lockfile
COPY frontend/ frontend/
RUN pnpm --filter frontend build

# ---- backend build ----
FROM node:22-bookworm-slim AS backend-build
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/package.json
RUN pnpm install --filter backend --frozen-lockfile || pnpm install --filter backend --no-frozen-lockfile
COPY backend/ backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
RUN pnpm --filter backend build
RUN pnpm --filter backend exec prisma generate || true

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
COPY pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/package.json
RUN pnpm install --filter backend --prod --frozen-lockfile || pnpm install --filter backend --prod --no-frozen-lockfile
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=backend-build /app/backend/prisma ./backend/prisma
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
VOLUME ["/data"]
EXPOSE 3040
CMD ["node", "backend/dist/server.js"]
