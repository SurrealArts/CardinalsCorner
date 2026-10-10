import "dotenv/config";
import "express-async-errors";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { authRouter, usersRouter } from "./routes/auth.js";
import { roomsRouter } from "./routes/rooms.js";
import { vacancyRouter } from "./routes/vacancy.js";
import { closuresRouter, schedulesRouter } from "./routes/schedules.js";
import { termsRouter } from "./routes/terms.js";
import { prisma } from "./lib/prisma.js";
import { assertJwtSecret, hashPassword } from "./lib/auth.js";
import { clientIp, createRateLimiter } from "./lib/rate-limit.js";

assertJwtSecret();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// Safe baseline headers (no CSP: the SPA serves hashed Vite bundles that a
// static policy would break on first deploy; revisit if inline scripts appear).
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// Same-origin app: only the dev server needs cross-origin access.
const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / curl
      cb(null, corsOrigins.includes(origin));
    },
    credentials: true,
  })
);

// Generous global guard; login/sync routes get stricter limits below.
app.use(
  "/api",
  createRateLimiter({ windowMs: 60_000, max: 600, key: (req) => clientIp(req), message: "Too many requests, please slow down" })
);

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "cardinals-corner", time: new Date().toISOString() }));
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/vacancy", vacancyRouter);
app.use("/api/schedules", schedulesRouter);
app.use("/api/closures", closuresRouter);
app.use("/api/terms", termsRouter);

// Unknown API routes -> JSON 404 (keeps SPA fallback from swallowing /api/*).
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Serve frontend static build when present (single-domain Dokploy deploy).
const frontendDist = path.resolve(__dirname, "../../frontend/dist");
if (fs.existsSync(path.join(frontendDist, "index.html"))) {
  app.use(express.static(frontendDist));
  app.get("*", (_req, res) => res.sendFile(path.join(frontendDist, "index.html")));
} else {
  app.get("/", (_req, res) => res.json({ service: "cardinals-corner API", frontend: "not built" }));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong, please try again" });
});

// First-boot admin: on an empty database (fresh volume), create the initial
// administrator from ADMIN_EMAIL/ADMIN_PASSWORD so the system is usable
// without demo seeds. Never runs when users already exist.
async function bootstrapAdmin() {
  let count: number;
  try {
    count = await prisma.user.count();
  } catch {
    // Most likely the database was never migrated (fresh volume). The
    // container entrypoint runs `prisma migrate deploy` before starting;
    // bare `node dist/server.js` needs it run manually. Stay up so the
    // cause is visible instead of crashing on boot.
    console.log("Database tables are missing: run `prisma migrate deploy` first.");
    return;
  }
  if (count > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    await prisma.user.create({
      data: { name: "Administrator", email, role: "ADMIN", passwordHash: await hashPassword(password) },
    });
    console.log(`Bootstrapped initial admin ${email}`);
  } else {
    console.log("No users yet: set ADMIN_EMAIL/ADMIN_PASSWORD to create the first admin, or seed demo data.");
  }
}

await bootstrapAdmin();

const PORT = Number(process.env.PORT) || 3040;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Cardinal's Corner API listening on 0.0.0.0:${PORT}`);
});
