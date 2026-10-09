import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, requireSyncKey } from "../lib/auth.js";
import { checkAvailability } from "../lib/availability.js";
import { isValidDate, isValidInterval } from "../lib/time.js";

export const syncRouter = Router();

// Compatibility socket for non-centralized sources (Registrar, IT, ILMO, OSAAR).
// Auth via X-Sync-Key + X-Sync-Source headers. Every mutation is conflict-checked
// and recorded in ActivityLog with its source.

const scheduleUpsert = z.object({
  roomCode: z.string().min(1),
  termName: z.string().min(1),
  courseLabel: z.string().min(1),
  weekday: z.number().int().min(0).max(6),
  startMin: z.number().int(),
  endMin: z.number().int(),
});

syncRouter.post("/schedules/upsert", requireSyncKey, async (req, res) => {
  const parsed = scheduleUpsert.safeParse(req.body);
  if (!parsed.success || !isValidInterval(parsed.data.startMin, parsed.data.endMin)) {
    return res.status(400).json({ error: "roomCode, termName, courseLabel, weekday, valid startMin/endMin required" });
  }
  const room = await prisma.room.findUnique({ where: { code: parsed.data.roomCode } });
  const term = await prisma.term.findUnique({ where: { name: parsed.data.termName } });
  if (!room || !term) return res.status(404).json({ error: "Unknown roomCode or termName" });
  const s = await prisma.classSchedule.create({
    data: { roomId: room.id, termId: term.id, courseLabel: parsed.data.courseLabel, weekday: parsed.data.weekday, startMin: parsed.data.startMin, endMin: parsed.data.endMin },
  });
  await prisma.activityLog.create({ data: { action: "sync.schedule.upsert", entityType: "schedule", entityId: s.id, detail: JSON.stringify({ source: req.syncSource, ...parsed.data }) } });
  res.status(201).json(s);
});

syncRouter.post("/closures/upsert", requireSyncKey, async (req, res) => {
  const schema = z.object({ roomCode: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startMin: z.number().int().nullable().optional(), endMin: z.number().int().nullable().optional(), reason: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "roomCode, date, reason required" });
  const room = await prisma.room.findUnique({ where: { code: parsed.data.roomCode } });
  if (!room) return res.status(404).json({ error: "Unknown roomCode" });
  const c = await prisma.closure.create({ data: { roomId: room.id, date: parsed.data.date, startMin: parsed.data.startMin ?? null, endMin: parsed.data.endMin ?? null, reason: `[${req.syncSource}] ${parsed.data.reason}` } });
  await prisma.activityLog.create({ data: { action: "sync.closure.upsert", entityType: "closure", entityId: c.id, detail: JSON.stringify({ source: req.syncSource }) } });
  res.status(201).json(c);
});

// ILMO/OSAAR direct decision on an existing pending reservation (still conflict-checked).
syncRouter.post("/reservations/:id/decide", requireSyncKey, async (req, res) => {
  const schema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "decision must be APPROVED or REJECTED" });
  const r = await prisma.reservation.findUnique({ where: { id: req.params.id } });
  if (!r) return res.status(404).json({ error: "Reservation not found" });
  if (r.status !== "PENDING") return res.status(400).json({ error: `Only PENDING can be decided (is ${r.status})` });
  if (parsed.data.decision === "REJECTED" && !parsed.data.reason) return res.status(400).json({ error: "Rejection requires a reason" });
  if (parsed.data.decision === "APPROVED") {
    const avail = await checkAvailability(r.roomId, r.date, r.startMin, r.endMin);
    if (!avail.available) return res.status(409).json({ error: "Conflicts prevent approval", conflicts: avail.conflicts });
  }
  const updated = await prisma.reservation.update({
    where: { id: r.id },
    data: { status: parsed.data.decision, decidedAt: new Date(), reason: parsed.data.reason ?? `[${req.syncSource}] external decision`, externalSource: req.syncSource },
  });
  await prisma.activityLog.create({ data: { action: `sync.reservation.${parsed.data.decision.toLowerCase()}`, entityType: "reservation", entityId: r.id, detail: JSON.stringify({ source: req.syncSource }) } });
  res.json(updated);
});

// Dry-run simulator: validate a hypothetical sync payload without saving.
// Used by the frontend Sync Simulator + automated tests.
syncRouter.post("/dry-run", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({ roomCode: z.string().min(1), date: z.string(), startMin: z.number().int(), endMin: z.number().int() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !isValidDate(parsed.data.date) || !isValidInterval(parsed.data.startMin, parsed.data.endMin)) {
    return res.status(400).json({ error: "roomCode, valid date, startMin/endMin required" });
  }
  const room = await prisma.room.findUnique({ where: { code: parsed.data.roomCode } });
  if (!room) return res.status(404).json({ error: "Unknown roomCode" });
  res.json(await checkAvailability(room.id, parsed.data.date, parsed.data.startMin, parsed.data.endMin));
});
