import { Router } from "express";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { hasOverlap, validateScheduleRow } from "../lib/schedule-validate.js";

export const schedulesRouter = Router();
export const closuresRouter = Router();

const schedSchema = z.object({
  roomCode: z.string().min(1),
  termName: z.string().min(1),
  course: z.string().min(1),
  section: z.string().min(1),
  professor: z.string().min(1),
  weekday: z.union([z.number().int().min(0).max(6), z.string()]),
  start: z.union([z.number().int(), z.string()]),
  end: z.union([z.number().int(), z.string()]),
});

// Public schedule catalog (filter by room, term, weekday, course, professor).
schedulesRouter.get("/", async (req, res) => {
  const { roomId, termId, weekday, course, professor } = req.query as Record<string, string>;
  res.json(
    await prisma.classSchedule.findMany({
      where: {
        roomId: roomId || undefined,
        termId: termId || undefined,
        weekday: weekday !== undefined && weekday !== "" ? Number(weekday) : undefined,
        course: course ? { contains: course.toUpperCase() } : undefined,
        professor: professor ? { contains: professor } : undefined,
      },
      include: { room: { select: { code: true } }, term: { select: { name: true } } },
      orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
      take: 1000,
    })
  );
});

async function resolveRoomTerm(roomCode: string, termName: string) {
  const room = await prisma.room.findUnique({ where: { code: roomCode } });
  if (!room || room.status !== "ACTIVE") throw new Error(`unknown or archived room_code ${roomCode}`);
  const term = await prisma.term.findUnique({ where: { name: termName } });
  if (!term) throw new Error(`unknown term_name ${termName}`);
  return { room, term };
}

schedulesRouter.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = schedSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "roomCode, termName, course, section, professor, weekday, start, end are required" });
  }
  const raw = {
    room_code: parsed.data.roomCode, term_name: parsed.data.termName,
    course: parsed.data.course, section: parsed.data.section, professor: parsed.data.professor,
    weekday: String(parsed.data.weekday), start: String(parsed.data.start), end: String(parsed.data.end),
  };
  try {
    const { room, term } = await resolveRoomTerm(raw.room_code, raw.term_name);
    const v = validateScheduleRow(raw, term);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const existing = await prisma.classSchedule.findMany({ where: { roomId: room.id, termId: term.id, weekday: v.data.weekday } });
    if (hasOverlap(v.data, existing)) {
      return res.status(409).json({ error: `Overlaps an existing ${room.code} class on weekday ${v.data.weekday}` });
    }
    const s = await prisma.classSchedule.create({
      data: { roomId: room.id, termId: term.id, course: v.data.course, section: v.data.section, professor: v.data.professor, weekday: v.data.weekday, startMin: v.data.startMin, endMin: v.data.endMin },
    });
    await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "schedule.create", entityType: "schedule", entityId: s.id, detail: JSON.stringify(v.data) } });
    res.status(201).json({ schedule: s, warnings: v.warnings });
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

// CSV import: room_code,course,section,professor,weekday,start,end,term_name
// Sanitized per row (required fields, code/section patterns, 07:00-21:00,
// weekday), verified against existing schedules AND within the batch for
// overlaps. Partial success: valid rows save, bad rows are reported.
schedulesRouter.post("/import", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { csv, termName: defaultTerm } = req.body as { csv?: string; termName?: string };
  if (!csv || typeof csv !== "string") {
    return res.status(400).json({ error: "Provide { csv: string } with header room_code,course,section,professor,weekday,start,end,term_name" });
  }
  let rows: Record<string, string>[];
  try {
    rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true });
  } catch {
    return res.status(400).json({ error: "Could not parse CSV" });
  }
  let created = 0;
  const errors: string[] = [];
  const warnings: string[] = [];
  const accepted: Array<{ roomId: string; termId: string; weekday: number; startMin: number; endMin: number }> = [];
  const roomCache = new Map<string, { id: string }>();
  const termCache = new Map<string, { id: string; periodMin: number; dayStartMin: number; dayEndMin: number }>();
  for (let i = 0; i < rows.length; i++) {
    const label = `row ${i + 2}`;
    const raw = { ...rows[i] };
    // Rows may omit term_name when the whole file targets one term (the admin
    // page sends the selected term as the default).
    if (!((raw.term_name ?? "").trim()) && defaultTerm) raw.term_name = defaultTerm;
    const roomCode = (raw.room_code ?? "").trim();
    const termName = (raw.term_name ?? "").trim();
    if (!roomCode || !termName) {
      errors.push(`${label}: room_code and term_name are required`);
      continue;
    }
    try {
      if (!roomCache.has(roomCode) || !termCache.has(termName)) {
        const { room, term } = await resolveRoomTerm(roomCode, termName);
        roomCache.set(roomCode, { id: room.id });
        termCache.set(termName, { id: term.id, periodMin: term.periodMin, dayStartMin: term.dayStartMin, dayEndMin: term.dayEndMin });
      }
      const v = validateScheduleRow(raw, termCache.get(termName)!);
      if (!v.ok) {
        errors.push(`${label}: ${v.error}`);
        continue;
      }
      for (const w of v.warnings) warnings.push(`${label}: ${w}`);
      const d = v.data;
      const roomId = roomCache.get(d.roomCode)!.id;
      const termId = termCache.get(d.termName)!.id;
      const existing = await prisma.classSchedule.findMany({ where: { roomId, termId, weekday: d.weekday } });
      const batchPeers = accepted
        .filter((a) => a.roomId === roomId && a.termId === termId && a.weekday === d.weekday)
        .map((a) => ({ startMin: a.startMin, endMin: a.endMin }));
      if (hasOverlap(d, [...existing, ...batchPeers])) {
        errors.push(`${label}: overlaps another ${d.roomCode} class on weekday ${d.weekday}`);
        continue;
      }
      await prisma.classSchedule.create({
        data: { roomId, termId, course: d.course, section: d.section, professor: d.professor, weekday: d.weekday, startMin: d.startMin, endMin: d.endMin },
      });
      accepted.push({ roomId, termId, weekday: d.weekday, startMin: d.startMin, endMin: d.endMin });
      created++;
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
    }
  }
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "schedule.import", entityType: "schedule", detail: JSON.stringify({ created, errors: errors.length, warnings: warnings.length }) } });
  res.json({ created, errors, warnings: warnings.slice(0, 20) });
});

schedulesRouter.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  await prisma.classSchedule.delete({ where: { id: req.params.id } });
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "schedule.delete", entityType: "schedule", entityId: req.params.id } });
  res.json({ ok: true });
});

// ---- Closures (reads public; writes admin) ----
closuresRouter.get("/", async (req, res) => {
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
