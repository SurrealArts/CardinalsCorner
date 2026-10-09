import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

// Load backend/.env (absolute DATABASE_URL for local dev) before reading env.
// Works from any cwd: dev src/lib -> ../../.env, built dist/lib -> ../../.env.
const here = path.dirname(fileURLToPath(import.meta.url));
// backend/.env fills in whatever the cwd .env (or real environment) lacks.
// dotenv never overrides existing vars, so injected env (e.g. PORT) always wins.
dotenv.config({ path: path.resolve(here, "../../.env") });
dotenv.config();

// Relative `file:` URLs resolve against the prisma schema dir so the Prisma
// CLI (migrate) and the runtime adapter always open the same database file
// regardless of the working directory. Absolute URLs (e.g. file:/data/....db
// in production) pass through unchanged.
function resolveDatabaseUrl(raw: string): string {
  if (raw.startsWith("file:")) {
    const p = raw.slice("file:".length);
    if (!path.isAbsolute(p)) {
      return "file:" + path.resolve(here, "../../prisma", p);
    }
  }
  return raw;
}

const adapter = new PrismaBetterSQLite3({
  url: resolveDatabaseUrl(process.env.DATABASE_URL ?? "file:./dev.db"),
});

export const prisma = new PrismaClient({ adapter });
