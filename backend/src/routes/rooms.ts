import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { buildGrid } from "../lib/timetable.js";
import { DAY_CLOSE_MIN, DAY_OPEN_MIN } from "../lib/schedule-validate.js";

export const roomsRouter = Router();

// Public catalog (search, wing/type filters).
roomsRouter.get("/", async (req, res) => {
  const { search = "", wing = "", type = "", status = "ACTIVE" } = req.query as Record<string, string>;
  const rooms = await prisma.room.findMany({
    where: {
      status: status === "ALL" ? undefined : (status as "ACTIVE"),
      wing: wing || undefined,
      roomType: type || undefined,
      OR: search
        ? [{ code: { contains: search } }, { description: { contains: search } }]
        : undefined,
    },
    orderBy: { code: "asc" },
    take: 200,
  });
  res.json(rooms);
});

roomsRouter.get("/:id", async (req, res) => {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room);
});

// Week timetable for one room: classes plus the row-boundary grid derived
// from the term's period length unioned with actual class edges, so every
// era's schedules render exactly.
roomsRouter.get("/:id/timetable", async (req, res) => {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });
  if (!room) return res.status(404).json({ error: "Room not found" });
  const { termId = "" } = req.query as Record<string, string>;
  const term = termId
    ? await prisma.term.findUnique({ where: { id: termId } })
    : await prisma.term.findFirst({ orderBy: { startDate: "desc" } });
  if (!term) return res.status(404).json({ error: "No term found" });
  const classes = await prisma.classSchedule.findMany({
    where: { roomId: room.id, termId: term.id },
    orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
    take: 500,
  });
  // Display window = the term's own earliest/latest (clamped to the absolute
  // sanitization bounds), unioned with class edges below — so the grid follows
  // how the admin divided this term, and no valid class can ever be clipped.
  const lo = Math.min(Math.max(term.dayStartMin, DAY_OPEN_MIN), DAY_CLOSE_MIN);
  const hi = Math.max(Math.min(term.dayEndMin, DAY_CLOSE_MIN), DAY_OPEN_MIN);
  const [open, close] = hi > lo ? [lo, hi] : [DAY_OPEN_MIN, DAY_CLOSE_MIN];
  const grid = buildGrid(classes, term.dayStartMin, term.periodMin, open, close);
  res.json({
    room: { id: room.id, code: room.code, wing: room.wing, roomType: room.roomType, description: room.description },
    term: { id: term.id, name: term.name, periodMin: term.periodMin, dayStartMin: term.dayStartMin },
    classes: classes.map((c) => ({ weekday: c.weekday, startMin: c.startMin, endMin: c.endMin, course: c.course, section: c.section, professor: c.professor })),
    grid,
  });
});

const roomSchema = z.object({
  code: z.string().min(1),
  wing: z.string().min(1),
  roomType: z.string().default("classroom"),
  openMin: z.number().int().min(0).max(1440).default(480),
  closeMin: z.number().int().min(0).max(1440).default(1170),
  description: z.string().optional(),
});

roomsRouter.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = roomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Room code and wing are required" });
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
