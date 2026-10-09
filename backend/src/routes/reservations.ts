import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { checkAvailability } from "../lib/availability.js";
import { isValidDate, isValidInterval } from "../lib/time.js";

export const reservationsRouter = Router();

const submitSchema = z.object({
  roomId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMin: z.number().int(),
  endMin: z.number().int(),
  participantCount: z.number().int().min(1).max(1000),
  purpose: z.string().min(3).max(500),
});

reservationsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Room, valid date, start/end times, participant count, and purpose are required" });
  const { roomId, date, startMin, endMin, participantCount, purpose } = parsed.data;
  if (!isValidDate(date) || !isValidInterval(startMin, endMin)) {
    return res.status(400).json({ error: "Invalid date or time interval" });
  }
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room || room.status !== "ACTIVE") return res.status(404).json({ error: "Room is not available for booking" });
  if (participantCount > room.capacity) {
    return res.status(400).json({ error: `Participant count (${participantCount}) exceeds room capacity (${room.capacity})` });
  }
  if (startMin < room.openMin || endMin > room.closeMin) {
    return res.status(400).json({ error: "Requested time is outside room operating hours" });
  }
  const avail = await checkAvailability(roomId, date, startMin, endMin);
  if (!avail.available) {
    return res.status(409).json({ error: "Requested time conflicts with existing schedule", conflicts: avail.conflicts });
  }
  const r = await prisma.reservation.create({
    data: { requesterId: req.user!.id, roomId, date, startMin, endMin, participantCount, purpose, status: "PENDING" },
  });
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "reservation.submit", entityType: "reservation", entityId: r.id, detail: JSON.stringify({ room: room.code, date, startMin, endMin }) } });
  res.status(201).json(r);
});

reservationsRouter.get("/mine", requireAuth, async (req, res) => {
  res.json(await prisma.reservation.findMany({ where: { requesterId: req.user!.id }, include: { room: { select: { code: true } } }, orderBy: { submittedAt: "desc" }, take: 200 }));
});

reservationsRouter.post("/:id/cancel", requireAuth, async (req, res) => {
  const r = await prisma.reservation.findUniqueOrThrow({ where: { id: req.params.id } });
  const isOwner = r.requesterId === req.user!.id;
  const isAdmin = req.user!.role === "ADMIN";
  if (!isOwner && !isAdmin) return res.status(403).json({ error: "You can only cancel your own requests" });
  if (r.status === "APPROVED" && !isAdmin) return res.status(403).json({ error: "Only an administrator can cancel an approved reservation" });
  if (r.status !== "PENDING" && !(isAdmin && r.status === "APPROVED")) {
    return res.status(400).json({ error: `Cannot cancel a ${r.status} request` });
  }
  const schema = z.object({ reason: z.string().optional() });
  const reason = schema.safeParse(req.body).data?.reason;
  if (isAdmin && r.status === "APPROVED" && !reason) {
    return res.status(400).json({ error: "A reason is required to cancel an approved reservation" });
  }
  const updated = await prisma.reservation.update({ where: { id: r.id }, data: { status: "CANCELLED", reason: reason ?? "Cancelled by requester", reviewerId: isAdmin ? req.user!.id : r.reviewerId, decidedAt: new Date() } });
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "reservation.cancel", entityType: "reservation", entityId: r.id, detail: JSON.stringify({ reason: updated.reason }) } });
  res.json(updated);
});

// ---- Admin review queue ----
reservationsRouter.get("/queue/all", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const status = (req.query.status as string) || "PENDING";
  res.json(
    await prisma.reservation.findMany({
      where: { status: status === "ALL" ? undefined : (status as "PENDING") },
      include: { room: { select: { code: true, capacity: true } }, requester: { select: { name: true, email: true } } },
      orderBy: { submittedAt: "asc" },
      take: 200,
    })
  );
});

reservationsRouter.post("/:id/approve", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const r = await prisma.reservation.findUniqueOrThrow({ where: { id: req.params.id } });
  if (r.status !== "PENDING") return res.status(400).json({ error: `Only pending requests can be approved (this is ${r.status})` });
  // Fresh availability recheck before approval.
  const avail = await checkAvailability(r.roomId, r.date, r.startMin, r.endMin);
  if (!avail.available) {
    return res.status(409).json({ error: "No longer available — conflicts appeared since submission", conflicts: avail.conflicts });
  }
  const updated = await prisma.reservation.update({ where: { id: r.id }, data: { status: "APPROVED", reviewerId: req.user!.id, decidedAt: new Date(), reason: null } });
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "reservation.approve", entityType: "reservation", entityId: r.id } });
  res.json(updated);
});

reservationsRouter.post("/:id/reject", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({ reason: z.string().min(3) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A rejection reason is required" });
  const r = await prisma.reservation.findUniqueOrThrow({ where: { id: req.params.id } });
  if (r.status !== "PENDING") return res.status(400).json({ error: `Only pending requests can be rejected (this is ${r.status})` });
  const updated = await prisma.reservation.update({ where: { id: r.id }, data: { status: "REJECTED", reviewerId: req.user!.id, decidedAt: new Date(), reason: parsed.data.reason } });
  await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "reservation.reject", entityType: "reservation", entityId: r.id, detail: JSON.stringify({ reason: parsed.data.reason }) } });
  res.json(updated);
});
