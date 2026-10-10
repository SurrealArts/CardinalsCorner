import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import jwt from "jsonwebtoken";
import { COOKIE_NAME, hashPassword, purgeOldSessions, requireAuth, requireRole, revokeSession, revokeUserSessions, sessionCookieOptions, signToken, verifyLoginPassword, verifyPassword } from "../lib/auth.js";
import { clientIp, createRateLimiter } from "../lib/rate-limit.js";

export const authRouter = Router();
export const usersRouter = Router();

// Brute-force guard: 10 attempts per 15 min per client + email.
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 10,
  key: (req) => `${clientIp(req)}:${typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "?"}`,
  message: "Too many sign-in attempts, please try again in 15 minutes",
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your university email and password" });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  // Same work + same message whether or not the account exists (no enumeration).
  const ok = user?.active ? await verifyLoginPassword(parsed.data.password, user.passwordHash) : await verifyLoginPassword(parsed.data.password, null);
  if (!ok || !user) return res.status(401).json({ error: "Invalid credentials" });
  const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
  const token = signToken(payload);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  // Register the session (jti) so logout / password change / admin revocation
  // actually kills the token instead of leaving it valid until JWT expiry.
  const decoded = jwt.decode(token) as { jti: string; abs: number } | null;
  if (decoded?.jti) {
    await prisma.session.create({
      data: {
        id: decoded.jti,
        userId: user.id,
        userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null,
        ip: clientIp(req),
        expiresAt: new Date(decoded.abs * 1000),
      },
    });
  }
  await purgeOldSessions();
  await prisma.activityLog.create({ data: { actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id } });
  res.json({ user: payload, token });
});

authRouter.post("/logout", async (req, res) => {
  // Revoke best-effort (garbage/expired tokens simply clear the cookie).
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.[COOKIE_NAME];
    const decoded = token ? (jwt.decode(token) as { jti?: string } | null) : null;
    await revokeSession(decoded?.jti);
  } catch {
    /* ignore */
  }
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "Account not found" });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, department: user.department });
});

authRouter.patch("/password", requireAuth, async (req, res) => {
  // bcrypt silently truncates past 72 bytes: cap set-passwords there, and cap
  // login input at 200 chars as a hashing-DoS guard.
  const schema = z.object({ current: z.string().min(1).max(200), next: z.string().min(8).max(72) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "New password must be at least 8 characters" });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verifyPassword(parsed.data.current, user.passwordHash))) {
    return res.status(400).json({ error: "Current password is incorrect" });
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.next) } });
  // A password change signs out every other session (stolen copies die too).
  await revokeUserSessions(user.id, req.sessionId);
  res.json({ ok: true });
});

authRouter.patch("/profile", requireAuth, async (req, res) => {
  const schema = z.object({ name: z.string().min(1).max(100), department: z.string().max(100).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Name is required" });
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { name: parsed.data.name, department: parsed.data.department ?? null },
  });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, department: user.department });
});

// ---- Admin account management (accounts are created by an administrator) ----
usersRouter.use(requireAuth, requireRole("ADMIN"));

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, email: true, role: true, department: true, active: true, createdAt: true } });
  res.json(users);
});

usersRouter.post("/", async (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    role: z.enum(["ADMIN", "STAFF", "STUDENT"]),
    department: z.string().optional(),
    password: z.string().min(8).max(72),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Name, valid university email, role, and 8+ char password are required" });
  try {
    const user = await prisma.user.create({
      data: { name: parsed.data.name, email: parsed.data.email, role: parsed.data.role, department: parsed.data.department, passwordHash: await hashPassword(parsed.data.password) },
    });
    await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "user.create", entityType: "user", entityId: user.id, detail: JSON.stringify({ email: user.email, role: user.role }) } });
    res.status(201).json({ id: user.id, email: user.email });
  } catch {
    res.status(409).json({ error: "Email is already registered" });
  }
});

usersRouter.patch("/:id", async (req, res) => {
  const schema = z.object({ role: z.enum(["ADMIN", "STAFF", "STUDENT"]).optional(), department: z.string().nullable().optional(), active: z.boolean().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update" });
  const user = await prisma.user.update({ where: { id: req.params.id }, data: parsed.data });
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "user.update", entityType: "user", entityId: user.id, detail: JSON.stringify(parsed.data) } });
  if (parsed.data.active === false) {
    // Deactivation kills all sessions immediately.
    await revokeUserSessions(user.id);
  }
  res.json({ id: user.id, role: user.role, active: user.active });
});

// Sign out a user everywhere (admin). Returns the revoked session count.
usersRouter.post("/:id/revoke-sessions", async (req, res) => {
  const revoked = await revokeUserSessions(req.params.id);
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "user.revoke-sessions", entityType: "user", entityId: req.params.id, detail: JSON.stringify({ revoked }) } });
  res.json({ revoked });
});

// Admin password reset (the recovery path for forgotten passwords — the user
// proves nothing; the admin's own authenticated session is the authority).
// Kills all other sessions; keeps the admin's current one when resetting self.
usersRouter.post("/:id/reset-password", async (req, res) => {
  const schema = z.object({ newPassword: z.string().min(8).max(72) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "New password must be 8-72 characters" });
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "Account not found" });
  await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await hashPassword(parsed.data.newPassword) } });
  const keepCurrent = target.id === req.user!.id ? req.sessionId : undefined;
  const revoked = await revokeUserSessions(target.id, keepCurrent);
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "user.password-reset", entityType: "user", entityId: target.id, detail: JSON.stringify({ revoked }) } });
  res.json({ ok: true, revoked });
});
