import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../lib/auth.js";

export const roomsRouter = Router();

roomsRouter.get("/", requireAuth, async (req, res) => {
  const { search = "", wing = "", type = "", minCapacity = "", status = "ACTIVE" } = req.query as Record<string, string>;
  const rooms = await prisma.room.findMany({
    where: {
      status: status === "ALL" ? undefined : (status as "ACTIVE"),
      wing: wing || undefined,
      roomType: type || undefined,
      capacity: minCapacity ? { gte: Number(minCapacity) } : undefined,
      OR: search
        ? [{ code: { contains: search } }, { description: { contains: search } }]
        : undefined,
    },
    orderBy: { code: "asc" },
    take: 200,
  });
  res.json(rooms);
});

roomsRouter.get("/:id", requireAuth, async (req, res) => {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room);
});

const roomSchema = z.object({
  code: z.string().min(1),
  wing: z.string().min(1),
  roomType: z.string().default("classroom"),
  capacity: z.number().int().min(0).max(1000),
  openMin: z.number().int().min(0).max(1440).default(480),
  closeMin: z.number().int().min(0).max(1440).default(1170),
  description: z.string().optional(),
});

roomsRouter.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = roomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Room code, wing, and capacity are required" });
  try {
    const room = await prisma.room.create({ data: { ...parsed.data, campus: "Intramuros" } });
    await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "room.create", entityType: "room", entityId: room.id, detail: JSON.stringify({ code: room.code }) } });
    res.status(201).json(room);
  } catch {
    res.status(409).json({ error: "Room code already exists" });
  }
});

roomsRouter.patch("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = roomSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid room fields" });
  const room = await prisma.room.update({ where: { id: req.params.id }, data: parsed.data });
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "room.update", entityType: "room", entityId: room.id, detail: JSON.stringify(parsed.data) } });
  res.json(room);
});

// Archive preserves referenced records and reservation history (no hard delete).
roomsRouter.post("/:id/archive", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const room = await prisma.room.update({ where: { id: req.params.id }, data: { status: "ARCHIVED" } });
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "room.archive", entityType: "room", entityId: room.id } });
  res.json(room);
});

roomsRouter.delete("/:id", requireAuth, requireRole("ADMIN"), (_req, res) => {
  res.status(400).json({ error: "Rooms are archived, not deleted, to preserve reservation history" });
});
