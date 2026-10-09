import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth.js";

export const termsRouter = Router();
export const reportsRouter = Router();

termsRouter.get("/", requireAuth, async (_req, res) => {
  res.json(await prisma.term.findMany({ orderBy: { startDate: "desc" } }));
});

termsRouter.post("/", requireAuth, async (req, res) => {
  if (req.user!.role !== "ADMIN") return res.status(403).json({ error: "Not authorized" });
  const { name, startDate, endDate } = req.body as { name?: string; startDate?: string; endDate?: string };
  if (!name || !startDate || !endDate) return res.status(400).json({ error: "name, startDate, endDate are required" });
  const term = await prisma.term.create({ data: { name, startDate: new Date(startDate), endDate: new Date(endDate) } });
  res.status(201).json(term);
});

// Filtered occupancy summary + reservation status counts.
// Occupancy = scheduled time (classes + approved reservations), not observed use.
reportsRouter.get("/summary", requireAuth, async (req, res) => {
  const { termId, wing = "", from = "", to = "" } = req.query as Record<string, string>;
  const whereRes: Record<string, unknown> = {};
  if (from || to) whereRes.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  if (wing) whereRes.room = { wing };

  const [pending, approved, rejected, cancelled] = await Promise.all(
    (["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const).map((status) =>
      prisma.reservation.count({ where: { ...whereRes, status } })
    )
  );

  const rooms = await prisma.room.findMany({ where: { status: "ACTIVE", wing: wing || undefined }, select: { id: true, code: true, capacity: true } });
  const approvedRes = await prisma.reservation.findMany({
    where: { ...whereRes, status: "APPROVED", roomId: { in: rooms.map((r) => r.id) } },
    select: { roomId: true, startMin: true, endMin: true },
  });
  const minutesByRoom = new Map<string, number>();
  for (const r of approvedRes) minutesByRoom.set(r.roomId, (minutesByRoom.get(r.roomId) ?? 0) + (r.endMin - r.startMin));

  let classMinutes = 0;
  if (termId) {
    const scheds = await prisma.classSchedule.findMany({
      where: { termId, roomId: { in: rooms.map((r) => r.id) } },
      select: { startMin: true, endMin: true },
    });
    // Approximate weekly scheduled minutes x weeks in term (for summary scale).
    const term = await prisma.term.findUnique({ where: { id: termId } });
    const weeks = term ? Math.max(1, Math.round((term.endDate.getTime() - term.startDate.getTime()) / (7 * 864e5))) : 1;
    classMinutes = scheds.reduce((a, s) => a + (s.endMin - s.startMin), 0) * weeks;
  }

  res.json({
    statusCounts: { PENDING: pending, APPROVED: approved, REJECTED: rejected, CANCELLED: cancelled },
    rooms: rooms.map((r) => ({ code: r.code, capacity: r.capacity, approvedMinutes: minutesByRoom.get(r.id) ?? 0 })),
    classMinutesPerWeekBasis: classMinutes,
  });
});
