import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hashPassword, requireAuth, requireRole, signToken, verifyPassword } from "../lib/auth.js";

export const authRouter = Router();
export const usersRouter = Router();

authRouter.post("/login", async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your university email and password" });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.active) return res.status(401).json({ error: "Invalid credentials" });
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
  const token = signToken(payload);
  res.cookie("cc_token", token, { httpOnly: true, sameSite: "lax", maxAge: 12 * 3600 * 1000, path: "/" });
  await prisma.activityLog.create({ data: { actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id } });
  res.json({ user: payload, token });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("cc_token", { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "Account not found" });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, department: user.department });
});

authRouter.patch("/password", requireAuth, async (req, res) => {
  const schema = z.object({ current: z.string().min(1), next: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "New password must be at least 8 characters" });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verifyPassword(parsed.data.current, user.passwordHash))) {
    return res.status(400).json({ error: "Current password is incorrect" });
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.next) } });
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
    password: z.string().min(8),
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
  res.json({ id: user.id, role: user.role, active: user.active });
});
