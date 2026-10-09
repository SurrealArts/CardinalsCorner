import { prisma } from "./prisma.js";
import { overlaps, weekdayManila } from "./time.js";

export interface Conflict {
  kind: "class" | "closure" | "reservation";
  label: string;
  startMin: number;
  endMin: number;
}

export interface RoomAvailability {
  roomId: string;
  code: string;
  available: boolean;
  conflicts: Conflict[];
  occupied: Array<{ startMin: number; endMin: number; label: string }>;
}

// Evaluate a requested interval against regular classes, closures, and approved
// reservations. Returns conflicts; empty = available.
export async function checkAvailability(roomId: string, date: string, startMin: number, endMin: number): Promise<RoomAvailability> {
  const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  const conflicts: Conflict[] = [];
  const occupied: RoomAvailability["occupied"] = [];

  const day = new Date(`${date}T12:00:00+08:00`);
  const weekday = weekdayManila(date);

  // Regular class schedules whose term covers the date + matching weekday
  const schedules = await prisma.classSchedule.findMany({
    where: {
      roomId,
      weekday,
      term: { startDate: { lte: day }, endDate: { gte: day } },
    },
  });
  for (const s of schedules) {
    occupied.push({ startMin: s.startMin, endMin: s.endMin, label: s.courseLabel });
    if (overlaps(startMin, endMin, s.startMin, s.endMin)) {
      conflicts.push({ kind: "class", label: `${s.courseLabel} (${fmt(s.startMin)}-${fmt(s.endMin)})`, startMin: s.startMin, endMin: s.endMin });
    }
  }

  // Closures on that date
  const closures = await prisma.closure.findMany({ where: { roomId, date } });
  for (const c of closures) {
    const cs = c.startMin ?? 0;
    const ce = c.endMin ?? 1440;
    occupied.push({ startMin: cs, endMin: ce, label: `Closed: ${c.reason}` });
    if (overlaps(startMin, endMin, cs, ce)) {
      conflicts.push({ kind: "closure", label: `Closure: ${c.reason}`, startMin: cs, endMin: ce });
    }
  }

  // Approved reservations on that date. Pending does NOT block (only approved
  // becomes an occupied period, per proposal).
  const approved = await prisma.reservation.findMany({ where: { roomId, date, status: "APPROVED" } });
  for (const r of approved) {
    occupied.push({ startMin: r.startMin, endMin: r.endMin, label: r.purpose });
    if (overlaps(startMin, endMin, r.startMin, r.endMin)) {
      conflicts.push({ kind: "reservation", label: `Reserved: ${r.purpose} (${fmt(r.startMin)}-${fmt(r.endMin)})`, startMin: r.startMin, endMin: r.endMin });
    }
  }

  occupied.sort((a, b) => a.startMin - b.startMin);
  return { roomId, code: room.code, available: conflicts.length === 0, conflicts, occupied };
}

function fmt(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
