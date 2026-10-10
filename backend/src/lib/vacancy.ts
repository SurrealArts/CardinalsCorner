import { prisma } from "./prisma.js";
import { weekdayManila } from "./time.js";

export interface Occupied {
  startMin: number;
  endMin: number;
  label: string;
}

export interface FreeBlock {
  startMin: number;
  endMin: number;
}

export interface VacancySummary {
  nowFree: boolean;
  freeBlocks: FreeBlock[];
  nextVacant: FreeBlock | null;
  longestFreeMin: number;
  freeMinutesTotal: number;
}

// Merge overlapping or boundary-touching intervals (continuous occupation).
export function mergeIntervals(xs: Array<{ startMin: number; endMin: number }>): FreeBlock[] {
  const sorted = [...xs].sort((a, b) => a.startMin - b.startMin);
  const out: FreeBlock[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, iv.endMin);
    } else {
      out.push({ startMin: iv.startMin, endMin: iv.endMin });
    }
  }
  return out;
}

// Free blocks within [open, close] given merged occupied intervals.
export function subtractBounds(open: number, close: number, occupied: FreeBlock[]): FreeBlock[] {
  const free: FreeBlock[] = [];
  let cur = open;
  for (const o of occupied) {
    if (o.startMin > cur) free.push({ startMin: cur, endMin: Math.min(o.startMin, close) });
    cur = Math.max(cur, o.endMin);
    if (cur >= close) break;
  }
  if (cur < close) free.push({ startMin: cur, endMin: close });
  return free.filter((f) => f.endMin > f.startMin);
}

// Summarize free blocks relative to `atMin`. Blocks are clipped to [atMin, dayEnd]
// for next-vacant / qualification purposes; totals cover the whole day.
export function summarize(free: FreeBlock[], atMin: number, dayEnd: number): VacancySummary {
  const after = free
    .map((f) => ({ startMin: Math.max(f.startMin, atMin), endMin: Math.min(f.endMin, dayEnd) }))
    .filter((f) => f.endMin > f.startMin);
  const nowFree = after.some((f) => f.startMin <= atMin && atMin < f.endMin);
  const upcoming = after.filter((f) => f.endMin > atMin).sort((a, b) => a.startMin - b.startMin);
  const nextVacant = upcoming[0] ?? null;
  const longestFreeMin = after.reduce((m, f) => Math.max(m, f.endMin - f.startMin), 0);
  const freeMinutesTotal = free.reduce((a, f) => a + (f.endMin - f.startMin), 0);
  return { nowFree, freeBlocks: free, nextVacant, longestFreeMin, freeMinutesTotal };
}

export function qualifies(summary: VacancySummary, minFreeMin: number): boolean {
  if (minFreeMin <= 0) return true;
  return summary.longestFreeMin >= minFreeMin;
}

// Manila "now" helpers.
export function todayManila(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function nowManilaMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const [h, m] = parts.split(":").map(Number);
  return h * 60 + m;
}

// Resolve the reference minute: explicit HH:MM/minutes, "now", or default
// ( Manila now when date is today, otherwise the room's opening time).
export function resolveAtMin(at: string | undefined, date: string, openMin: number): number {
  if (at === undefined || at === "" || at === "now") {
    if (date === todayManila()) return nowManilaMinutes();
    return openMin;
  }
  if (/^\d+$/.test(at)) return Number(at);
  const m = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return openMin;
}

export interface RoomVacancy extends VacancySummary {
  roomId: string;
  code: string;
  wing: string;
}

async function occupiedForRoom(roomId: string, date: string): Promise<{ occupied: Occupied[]; open: number; close: number }> {
  const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  const open = Math.max(room.openMin, 420);
  const close = Math.min(room.closeMin, 1260);
  const occupied: Occupied[] = [];
  const day = new Date(`${date}T12:00:00+08:00`);
  const weekday = weekdayManila(date);

  const schedules = await prisma.classSchedule.findMany({
    where: { roomId, weekday, term: { startDate: { lte: day }, endDate: { gte: day } } },
  });
  for (const s of schedules) {
    occupied.push({ startMin: s.startMin, endMin: s.endMin, label: `${s.course} ${s.section} · ${s.professor}` });
  }
  const closures = await prisma.closure.findMany({ where: { roomId, date } });
  for (const c of closures) {
    occupied.push({ startMin: c.startMin ?? 0, endMin: c.endMin ?? 1440, label: `Closed: ${c.reason}` });
  }
  return { occupied, open, close };
}

export async function vacancyForRooms(
  roomIds: string[],
  date: string,
  at: string | undefined,
  minFreeMin: number
): Promise<RoomVacancy[]> {
  const out: RoomVacancy[] = [];
  for (const roomId of roomIds) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.status !== "ACTIVE") continue;
    const { occupied, open, close } = await occupiedForRoom(roomId, date);
    const atMin = Math.min(Math.max(resolveAtMin(at, date, open), open), close);
    const free = subtractBounds(open, close, mergeIntervals(occupied));
    const summary = summarize(free, atMin, close);
    if (!qualifies(summary, minFreeMin)) continue;
    out.push({ roomId, code: room.code, wing: room.wing, ...summary });
  }
  return out;
}

export interface Tally {
  date: string;
  atMin: number;
  roomsChecked: number;
  roomsFreeNow: number;
  rooms: RoomVacancy[];
}

// Whole-catalog tally in 3 queries + in-memory math.
export async function vacancyTally(date: string, at: string | undefined, wing: string, minFreeMin: number): Promise<Tally> {
  const day = new Date(`${date}T12:00:00+08:00`);
  const weekday = weekdayManila(date);
  const rooms = await prisma.room.findMany({
    where: { status: "ACTIVE", wing: wing || undefined },
    orderBy: { code: "asc" },
  });
  const roomIds = rooms.map((r) => r.id);
  const [schedules, closures] = await Promise.all([
    prisma.classSchedule.findMany({
      where: { roomId: { in: roomIds }, weekday, term: { startDate: { lte: day }, endDate: { gte: day } } },
    }),
    prisma.closure.findMany({ where: { roomId: { in: roomIds }, date } }),
  ]);
  const schedByRoom = new Map<string, typeof schedules>();
  for (const s of schedules) {
    const arr = schedByRoom.get(s.roomId) ?? [];
    arr.push(s);
    schedByRoom.set(s.roomId, arr);
  }
  const closByRoom = new Map<string, typeof closures>();
  for (const c of closures) {
    const arr = closByRoom.get(c.roomId) ?? [];
    arr.push(c);
    closByRoom.set(c.roomId, arr);
  }
  const out: RoomVacancy[] = [];
  for (const room of rooms) {
    const open = Math.max(room.openMin, 420);
    const close = Math.min(room.closeMin, 1260);
    const occupied: Occupied[] = [
      ...(schedByRoom.get(room.id) ?? []).map((s) => ({
        startMin: s.startMin, endMin: s.endMin, label: `${s.course} ${s.section} · ${s.professor}`,
      })),
      ...(closByRoom.get(room.id) ?? []).map((c) => ({
        startMin: c.startMin ?? 0, endMin: c.endMin ?? 1440, label: `Closed: ${c.reason}`,
      })),
    ];
    const atMin = Math.min(Math.max(resolveAtMin(at, date, open), open), close);
    const free = subtractBounds(open, close, mergeIntervals(occupied));
    const summary = summarize(free, atMin, close);
    if (!qualifies(summary, minFreeMin)) continue;
    out.push({ roomId: room.id, code: room.code, wing: room.wing, ...summary });
  }
  return {
    date,
    // Display reference only (each room resolves `at` against its own hours).
    atMin: Math.min(Math.max(resolveAtMin(at, date, 0), 0), 1440),
    roomsChecked: rooms.length,
    roomsFreeNow: out.filter((r) => r.nowFree).length,
    rooms: out,
  };
}
