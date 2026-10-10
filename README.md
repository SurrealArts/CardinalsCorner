# Cardinal's Corner

A public class-schedule display and vacancy search system for Mapúa University
(Intramuros). Browse room schedules, compare rooms side-by-side, search vacant
periods across the whole catalog, and inspect any room's full weekly timetable.
One invisible admin account maintains terms and schedules.

Live: https://cardinals-corner.anatoarchives.win

## Stack

- **frontend/** — Svelte 5 + Vite SPA (hash router)
- **backend/** — Node.js + Express + TypeScript API, Prisma ORM + better-sqlite3 + SQLite
- One deployable unit: the backend serves `frontend/dist` plus `/api/*` on a
  single `PORT`. `Dockerfile` builds both stages; `.github/workflows/docker-image.yml`
  publishes `ghcr.io/surrealarts/cardinalscorner:latest` on every green `main` build.

## Prerequisites

- **Node.js 22** (see `.nvmrc` — e.g. `nvm use` or `fnm use`; better-sqlite3 has
  no prebuilds for newer Node, so v22 is required, not just recommended)
- **pnpm 12** (`corepack enable && corepack prepare pnpm@12.4.1 --activate`)
- Docker, only for building/running the container image.

## 1. Local setup

```bash
# Install dependencies (approve native build scripts once for prisma/better-sqlite3)
pnpm install
pnpm approve-builds --all && pnpm install

# Configure the backend (this is the only env file; see "Environment" below)
cp .env.example backend/.env

# Create the database and load sample data:
# admin account, 204 Intramuros rooms, one term, dense demo schedules
pnpm --filter backend exec prisma db push
pnpm --filter backend db:seed

# Start both apps
pnpm dev
```

- Frontend: http://localhost:5173 (Vite proxies `/api` to the backend)
- Backend API: http://localhost:3040/api/health

Sign in on the (unlinked) `/admin` page with the seeded admin account:

| Email | Password | Role |
|---|---|---|
| `admin@mapua.edu.ph` | `Admin123!` | Administrator |

Useful commands:

```bash
pnpm dev                      # backend (:3040) + frontend (:5173, proxies /api)
pnpm --filter backend test    # unit tests (vacancy math, validation, auth)
pnpm --filter backend db:seed # re-load sample data (safe to re-run)
pnpm -r build                 # production builds for both packages
pnpm --filter backend start   # run the production build as one server on PORT
```

## 2. Database

SQLite + Prisma. Two separate things — don't confuse them:

- **`backend/prisma/schema.prisma`** — the table definitions (source of truth).
  There is no migration history: `prisma db push` syncs the schema directly,
  which fits a single-developer project whose schedule data is re-importable.
- **`backend/prisma/dev.db`** — the actual data file. Gitignored, per-machine.
  `db:seed` fills it with the demo dataset and is idempotent (re-running only
  adds what's missing).

Path convention: Prisma resolves relative `file:` URLs against the directory
containing `schema.prisma`, **not** the working directory. So
`DATABASE_URL="file:./dev.db"` always means `backend/prisma/dev.db`, for both
`db push` and the app — no matter where you run the command from. Absolute
`file:/...` URLs pass through unchanged (e.g. `file:/data/....db` in containers).

## 3. Production deployment

Reference setup: Dokploy + GHCR + Cloudflare tunnel.

**Image.** Pushing to `main` runs Docker Image CI: unit tests, then build and
push to `ghcr.io/surrealarts/cardinalscorner:latest` (plus `:sha-*`). The image
needs no build secrets — all configuration arrives as container env.

**Dokploy app** (source type: Docker image):

| Setting | Value |
|---|---|
| Image | `ghcr.io/surrealarts/cardinalscorner:latest` |
| Published port | host `8040` → container `3040` |
| Volume | `cardinals-corner-data` mounted at `/data` (the SQLite file lives here) |
| Update order | stop-first, single replica (stateful) |

**Environment** (app Env in Dokploy; `DATABASE_URL`/`PORT` have working defaults):

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | yes | Signs login tokens (generate: `openssl rand -hex 32`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first boot | Creates the initial admin on an empty database |
| `TZ` | recommended | `Asia/Manila` |
| `IDLE_TIMEOUT_MIN` | no | Inactivity sign-out, minutes (default `30`) |
| `SESSION_MAX_H` | no | Hard session cap, hours (default `12`) |
| `CORS_ORIGINS` | no | Extra origins for cookie API access (default `http://localhost:5173`) |
| `DATABASE_URL` | no | Defaults to `file:/data/cardinals-corner.db` (the volume) |
| `PORT` | no | Defaults to `3040` (must match the container target port) |

On boot the container pushes the schema to the volume database, then starts.
With no users and `ADMIN_*` set, first boot creates the admin — sign in at the
unlinked `/admin` page. Demo accounts are never created in production.

**Redeploys.** A server-side cron polls `:latest` every 5 minutes and hits the
app's Dokploy deploy hook when the digest changes — every green `main` build
rolls out automatically, no repo webhooks involved.

**Public URL.** A `cloudflared` tunnel container maps
`cardinals-corner.anatoarchives.win` → `http://172.17.0.1:8040` (host gateway +
published port, same pattern as the other tunnels on the host).

**Loading rooms (one-time).** A fresh volume has empty tables. Load the
Intramuros inventory from `backend/prisma/rooms.source.json` once (server
shell, `python3` + `sqlite3` against the volume's `cardinals-corner.db`, same
column mapping as `backend/prisma/seed.ts`). Class schedules then come from the
admin CSV import — rooms with no schedules simply show as Available.

**Reset admin password.** If you can sign in: Admin page → Accounts → Reset
password (also kills the account's other sessions). If locked out entirely,
empty the users table from the app's Dokploy terminal (you land inside the
container at `/app` — there is no `docker` binary in there, run node
directly), then restart the task from the Deploy Settings buttons — first boot
recreates the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`:

```bash
# Dokploy → cardinals-corner → Open Terminal (prompt is root@…:/app#)
node --input-type=module -e "import('./backend/dist/lib/prisma.js').then(async ({prisma}) => { console.log(await prisma.user.deleteMany()); process.exit(0); })"
```

then Reload/Restart via the Deploy Settings buttons above the terminal.
Sessions cascade away with the users.

**Seed demo schedules.** Dense generated data (~1:1 occupied:free, heavy
per-day variance) for demos and load checks — same generator as local `db:seed`.
From the app's Dokploy terminal (`/app`):

```bash
SCHEDULE_TERM=1T-2026-2027 SEED_DEMO_WIPE=1 node backend/dist/seed-demo.js
```

`SCHEDULE_TERM` defaults to the latest term. Without `SEED_DEMO_WIPE=1` the
script refuses a term that already has schedules and otherwise only fills free
blocks (safe to re-run). `WIPE=1` deletes that term's schedules first — never
use it on a term holding real data.

Verify: `https://cardinals-corner.anatoarchives.win/api/health` → `{"ok":true,…}`.

## Scheduling model

- Vacancy is computed from regular class schedules and room closures.
  Touching boundaries (09:00 end / 09:00 start) do **not** count as overlapping.
- Each term pins its own class grid: earliest/latest class times, period length
  (presently 90 min), and day start. The room timetable renders from that grid
  unioned with actual class edges, so every era displays exactly.
- CSV imports are sanitized (course like `ECEA101`, section like `B14`,
  weekday, term window) and verified for overlaps; off-period durations are
  accepted with a warning.
- Rooms are archived, never hard-deleted, to preserve schedule history.
- All dates use Philippine local time (Asia/Manila).

## Admin maintenance (unlinked `/admin` page)

- Terms: create per `NT-YYYY-ZZZZ` (e.g. `1T-2026-2027`), edit dates and grid.
- Schedules: per-term CSV import (`room_code,course,section,professor,weekday,
  start,end[,term_name]`), single-row delete for corrections.
- Accounts: password resets and sign-out-everywhere.
- All changes are recorded in the activity log.

## Project structure

```
frontend/   # Svelte SPA: schedules catalog, vacancy tally, room week view,
            #   hidden admin page
backend/    # Express API + Prisma schema/seed + vitest
backend/prisma/
  schema.prisma       # users, rooms, terms, class schedules, closures,
                      #   sessions, activity log
  seed.ts             # demo dataset used by `db:seed` (local only)
  rooms.source.json   # Intramuros room inventory (reference data)
backend/src/
  lib/vacancy.ts      # free-block math, per-room vacancy, catalog tally
  lib/timetable.ts    # week-grid row computation from term period grid
  lib/demo-schedule.ts# dense demo generator (dev seed + container entry)
  seed-demo.ts        # container entry: TERM/WIPE demo seeding
Dockerfile  # multi-stage build; entrypoint pushes schema then serves on $PORT
```
