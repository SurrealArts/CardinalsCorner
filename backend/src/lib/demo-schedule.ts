import { overlaps } from "./time.js";

export interface DemoRoom {
  id: string;
  code: string;
  roomType: string;
}

export interface DemoRow {
  roomId: string;
  termId: string;
  course: string;
  section: string;
  professor: string;
  weekday: number;
  startMin: number;
  endMin: number;
}

// This term's period blocks: 90 minutes from 07:30 (last block 19:30-21:00).
export const DEMO_BLOCKS: Array<[number, number]> = [
  [450, 540], [540, 630], [630, 720], [720, 810], [810, 900],
  [900, 990], [990, 1080], [1080, 1170], [1170, 1260],
];

const COURSES = ["ECEA101", "ECEA102", "ECEA202", "CPEA106", "CPEA301", "EEA103", "MATHA123", "GEDA105"];
const PROFS = ["Dela Cruz, J.", "Santos, M.", "Reyes, A.", "Bautista, R.", "Ocampo, L.", "Torres, K.", "Garcia, P.", "Mendoza, L."];
const SECTIONS = ["A", "B", "C", "D", "E"];

// Periods per room-day: mean ~4 of 9 blocks (~1:1 occupied:free) with heavy
// tails, so one day packs wall-to-wall and the next sits nearly empty.
const COUNT_WEIGHTS: Array<[count: number, weight: number]> = [
  [0, 0.04], [1, 0.08], [2, 0.11], [3, 0.14], [4, 0.16],
  [5, 0.15], [6, 0.11], [7, 0.09], [8, 0.07], [9, 0.05],
];

// Only real class venues get schedules (bridges/AV/stock/others don't).
const SCHEDULABLE = new Set(["classroom", "laboratory", "smart"]);

function hashCode(s: string): number {
  return [...s].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) | 0), 7);
}

function mulberry(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawCount(rand: () => number): number {
  let x = rand();
  for (const [count, w] of COUNT_WEIGHTS) {
    x -= w;
    if (x <= 0) return count;
  }
  return 4;
}

// Deterministic per room+weekday: same inputs always yield the same rows, so
// re-runs are stable and safe to reason about.
export function generateDemoSchedules(
  rooms: DemoRoom[],
  termId: string,
  weekdays: number[] = [1, 2, 3, 4, 5, 6]
): DemoRow[] {
  const rows: DemoRow[] = [];
  for (const room of rooms) {
    if (!SCHEDULABLE.has(room.roomType)) continue;
    for (const weekday of weekdays) {
      const rand = mulberry(hashCode(`${room.id}:${termId}:${weekday}`));
      let k = drawCount(rand);
      if (weekday === 6) k = Math.floor(k / 2); // lighter Saturdays
      if (k <= 0) continue;
      const idx = DEMO_BLOCKS.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      const picked = idx.slice(0, k).sort((a, b) => a - b);
      for (const b of picked) {
        const [startMin, endMin] = DEMO_BLOCKS[b];
        rows.push({
          roomId: room.id,
          termId,
          course: COURSES[Math.floor(rand() * COURSES.length)],
          section: `${SECTIONS[Math.floor(rand() * SECTIONS.length)]}${1 + Math.floor(rand() * 14)}`,
          professor: PROFS[Math.floor(rand() * PROFS.length)],
          weekday,
          startMin,
          endMin,
        });
      }
    }
  }
  return rows;
}

// Drop candidate rows colliding with already-stored ones (append mode).
export function excludeOverlapping(
  rows: DemoRow[],
  existing: Array<{ roomId: string; weekday: number; startMin: number; endMin: number }>
): DemoRow[] {
  const byKey = new Map<string, Array<{ startMin: number; endMin: number }>>();
  for (const e of existing) {
    const key = `${e.roomId}:${e.weekday}`;
    const arr = byKey.get(key) ?? [];
    arr.push({ startMin: e.startMin, endMin: e.endMin });
    byKey.set(key, arr);
  }
  return rows.filter((r) => {
    const occ = byKey.get(`${r.roomId}:${r.weekday}`) ?? [];
    return !occ.some((o) => overlaps(r.startMin, r.endMin, o.startMin, o.endMin));
  });
}
