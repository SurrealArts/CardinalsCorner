# Cardinal's Corner

A web-based room scheduling, availability assessment, and reservation management
system for Mapúa University (Intramuros). Built for CPE106L-4 Software Design
Laboratory: search and filter rooms, compare up to six room schedules
side-by-side, submit reservation requests, and let administrators review them.

## Prerequisites

- **Node.js 22** (see `.nvmrc` — e.g. `nvm use` or `fnm use`)
- **pnpm 12** (`corepack enable && corepack prepare pnpm@12.4.1 --activate`)

## Run locally

```bash
# 1. Install dependencies (approve build scripts for prisma/better-sqlite3 once)
pnpm install
pnpm approve-builds --all && pnpm install

# 2. Configure the backend
cp .env.example backend/.env

# 3. Create the database and load sample data
#    (204 Intramuros rooms, one term, demo users and class schedules)
pnpm --filter backend exec prisma migrate dev
pnpm --filter backend db:seed

# 4. Start both apps
pnpm dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3040/api/health

Sign in with one of the seeded demo accounts:

| Email | Password | Role |
|---|---|---|
| `admin@mapua.edu.ph` | `Admin123!` | Administrator |
| `staff@mapua.edu.ph` | `Staff123!` | Staff |
| `student@mapua.edu.ph` | `Student123!` | Student |

## Useful commands

```bash
pnpm dev                    # backend (:3040) + frontend (:5173, proxies /api)
pnpm --filter backend test  # unit tests (availability/overlap rules)
pnpm --filter backend db:seed   # re-load sample data (idempotent)
pnpm -r build               # production builds for both packages
```

To run the production build as a single server (backend serves the built
frontend and the API on one port):

```bash
pnpm -r build
pnpm --filter backend start   # reads backend/.env; serves API + frontend on PORT
```

## Project structure

```
frontend/   # Svelte 5 + Vite SPA: login, dashboard (search + compare),
            #   reservation form, records, reports, profile, sync lab
backend/    # Node + Express + TypeScript API, Prisma + SQLite storage
backend/prisma/
  schema.prisma  # users, rooms, terms, class schedules, closures,
                 #   reservations, activity log
  seed.ts        # sample data used by `db:seed`
```

## Booking rules

- Availability is computed from regular class schedules, room closures, and
  **approved** reservations only — a pending request does not hold a room.
- Time intervals that only touch at a boundary (09:00 end / 09:00 start) do
  **not** count as overlapping.
- Conflicting requests are rejected with the list of conflicts; approvals
  re-check availability at decision time.
- Rejections and cancellations of approved reservations require a reason.
- Rooms are archived, never hard-deleted, to preserve reservation history.
- All dates use Philippine local time (Asia/Manila).

## External sync API

Non-centralized sources (Registrar, IT, ILMO, OSAAR) can push updates through
an authenticated API. Callers send `X-Sync-Key` (one of the server's
`SYNC_API_KEYS`) plus `X-Sync-Source: Registrar|IT|ILMO|OSAAR|ADMIN`:

- `POST /api/sync/schedules/upsert` — push class schedules
- `POST /api/sync/closures/upsert` — push room closures
- `POST /api/sync/reservations/:id/decide` — approve/reject (conflict-checked)
- `POST /api/sync/dry-run` — admin-only conflict preview without saving

Administrators can also bulk-import per-term class schedules from CSV
(`room_code,course_label,weekday,start,end,term_name`) in Records → Schedule
import.
