import { Router } from "express";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { hhmmToMinutes, isValidInterval } from "../lib/time.js";

export const schedulesRouter = Router();
export const closuresRouter = Router();

const schedSchema = z.object({
  roomId: z.string().min(1),
  termId: z.string().min(1),
  courseLabel: z.string().min(1),
  weekday: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440),
});

schedulesRouter.get("/", requireAuth, async (req, res) => {
  const { roomId, termId, weekday } = req.query as Record<string, string>;
  res.json(
    await prisma.classSchedule.findMany({
      where: { roomId: roomId || undefined, termId: termId || undefined, weekday: weekday !== undefined && weekday !== "" ? Number(weekday) : undefined },
      include: { room: { select: { code: true } }, term: { select: { name: true } } },
      orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
      take: 500,
    })
  );
});

schedulesRouter.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = schedSchema.safeParse(req.body);
  if (!parsed.success || !isValidInterval(parsed.data.startMin, parsed.data.endMin)) {
    return res.status(400).json({ error: "roomId, termId, course label, weekday, and valid start/end are required" });
  }
  const s = await prisma.classSchedule.create({ data: parsed.data });
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "schedule.create", entityType: "schedule", entityId: s.id, detail: JSON.stringify(parsed.data) } });
  res.status(201).json(s);
});

// CSV import: room_code,course_label,weekday,start,end,term_name
// weekday accepts 0-6 or Mon/Tue/...; start/end accept minutes or HH:MM.
schedulesRouter.post("/import", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { csv } = req.body as { csv?: string };
  if (!csv || typeof csv !== "string") return res.status(400).json({ error: "Provide { csv: string }" });
  let rows: Record<string, string>[];
  try {
    rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true });
  } catch {
    return res.status(400).json({ error: "Could not parse CSV. Expected header: room_code,course_label,weekday,start,end,term_name" });
  }
  const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  let created = 0;
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const room = await prisma.room.findUnique({ where: { code: String(r.room_code ?? "").trim() } });
      if (!room) throw new Error(`unknown room_code ${r.room_code}`);
      const term = await prisma.term.findUnique({ where: { name: String(r.term_name ?? "").trim() } });
      if (!term) throw new Error(`unknown term_name ${r.term_name}`);
      const wdRaw = String(r.weekday ?? "").trim().toLowerCase();
      const weekday = /^\d$/.test(wdRaw) ? Number(wdRaw) : dayMap[wdRaw.slice(0, 3)];
      if (weekday === undefined || weekday < 0 || weekday > 6) throw new Error(`bad weekday ${r.weekday}`);
      const toMin = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : hhmmToMinutes(v));
      const startMin = toMin(String(r.start ?? ""));
      const endMin = toMin(String(r.end ?? ""));
      if (startMin === null || endMin === null || !isValidInterval(startMin, endMin)) throw new Error(`bad interval ${r.start}-${r.end}`);
      await prisma.classSchedule.create({ data: { roomId: room.id, termId: term.id, courseLabel: String(r.course_label ?? "").trim(), weekday, startMin, endMin } });
      created++;
    } catch (e) {
      errors.push(`row ${i + 2}: ${(e as Error).message}`);
    }
  }
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "schedule.import", entityType: "schedule", detail: JSON.stringify({ created, errors: errors.length }) } });
  res.json({ created, errors });
});

schedulesRouter.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  // Deleting a schedule that overlaps approved reservations requires explicit force.
  const s = await prisma.classSchedule.findUniqueOrThrow({ where: { id: req.params.id } });
  const force = req.query.force === "true";
  if (!force) {
    const affected = await prisma.reservation.count({ where: { roomId: s.roomId, status: "APPROVED" } });
    if (affected > 0) {
      return res.status(409).json({ error: `This schedule room has ${affected} approved reservation(s). Re-run with ?force=true after resolving them.` });
    }
  }
  await prisma.classSchedule.delete({ where: { id: s.id } });
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "schedule.delete", entityType: "schedule", entityId: s.id } });
  res.json({ ok: true });
});

// ---- Closures ----
closuresRouter.get("/", requireAuth, async (req, res) => {
  const { roomId, date } = req.query as Record<string, string>;
  res.json(await prisma.closure.findMany({ where: { roomId: roomId || undefined, date: date || undefined }, orderBy: { date: "asc" }, take: 500 }));
});

closuresRouter.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({ roomId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startMin: z.number().int().nullable().optional(), endMin: z.number().int().nullable().optional(), reason: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "roomId, date (YYYY-MM-DD), and reason are required" });
  const c = await prisma.closure.create({ data: { roomId: parsed.data.roomId, date: parsed.data.date, startMin: parsed.data.startMin ?? null, endMin: parsed.data.endMin ?? null, reason: parsed.data.reason } });
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "closure.create", entityType: "closure", entityId: c.id } });
  res.status(201).json(c);
});

closuresRouter.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  await prisma.closure.delete({ where: { id: req.params.id } });
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "closure.delete", entityType: "closure", entityId: req.params.id } });
  res.json({ ok: true });
});
