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
import { availabilityRouter } from "./routes/availability.js";
import { closuresRouter, schedulesRouter } from "./routes/schedules.js";
import { reservationsRouter } from "./routes/reservations.js";
import { reportsRouter, termsRouter } from "./routes/reports.js";
import { syncRouter } from "./routes/sync.js";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./lib/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "cardinals-corner", time: new Date().toISOString() }));
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/availability", availabilityRouter);
app.use("/api/schedules", schedulesRouter);
app.use("/api/closures", closuresRouter);
app.use("/api/reservations", reservationsRouter);
app.use("/api/terms", termsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/sync", syncRouter);

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
  const count = await prisma.user.count();
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
