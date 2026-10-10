import { describe, expect, it } from "vitest";
import { mergeIntervals, qualifies, subtractBounds, summarize } from "./vacancy.js";
import { buildGrid, rowSpan } from "./timetable.js";
import { hasOverlap, validateScheduleRow } from "./schedule-validate.js";

describe("mergeIntervals", () => {
  it("merges overlapping and boundary-touching intervals", () => {
    expect(mergeIntervals([{ startMin: 540, endMin: 600 }, { startMin: 600, endMin: 660 }, { startMin: 700, endMin: 720 }]))
      .toEqual([{ startMin: 540, endMin: 660 }, { startMin: 700, endMin: 720 }]);
  });
  it("leaves disjoint intervals alone", () => {
    expect(mergeIntervals([{ startMin: 1, endMin: 2 }, { startMin: 5, endMin: 6 }])).toHaveLength(2);
  });
});

describe("subtractBounds + summarize", () => {
  const free = subtractBounds(480, 1170, [{ startMin: 540, endMin: 660 }]);
  it("computes free blocks", () => {
    expect(free).toEqual([{ startMin: 480, endMin: 540 }, { startMin: 660, endMin: 1170 }]);
  });
  it("reports nowFree and next vacant", () => {
    const s = summarize(free, 500, 1170);
    expect(s.nowFree).toBe(true);
    expect(s.nextVacant).toEqual({ startMin: 500, endMin: 540 }); // clipped to atMin
    expect(s.freeBlocks).toEqual(free); // full-day blocks kept unclipped
    expect(s.freeMinutesTotal).toBe(60 + 510);
    expect(qualifies(s, 60)).toBe(true);
    expect(qualifies(s, 600)).toBe(false);
  });
  it("finds next vacant when currently occupied", () => {
    const s = summarize(free, 600, 1170);
    expect(s.nowFree).toBe(false);
    expect(s.nextVacant).toEqual({ startMin: 660, endMin: 1170 });
  });
});

describe("validateScheduleRow", () => {
  const good = {
    room_code: "SW305", term_name: "2026-1Q", course: "ECEA101", section: "B14",
    professor: "Dela Cruz, J.", weekday: "Tue", start: "13:00", end: "14:30",
  };
  it("accepts a valid row", () => {
    const r = validateScheduleRow(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatchObject({ course: "ECEA101", section: "B14", weekday: 2, startMin: 780, endMin: 870 });
    }
  });
  it("rejects bad course, section, and out-of-bounds times", () => {
    expect(validateScheduleRow({ ...good, course: "xyz" }).ok).toBe(false);
    expect(validateScheduleRow({ ...good, section: "14B" }).ok).toBe(false);
    expect(validateScheduleRow({ ...good, start: "06:30" }).ok).toBe(false);
    expect(validateScheduleRow({ ...good, end: "21:30" }).ok).toBe(false);
    expect(validateScheduleRow({ ...good, weekday: "Funday" }).ok).toBe(false);
    expect(validateScheduleRow({ ...good, professor: "" }).ok).toBe(false);
  });
});

describe("hasOverlap", () => {
  it("treats touching boundaries as free", () => {
    expect(hasOverlap({ startMin: 540, endMin: 600 }, [{ startMin: 600, endMin: 660 }])).toBe(false);
    expect(hasOverlap({ startMin: 540, endMin: 601 }, [{ startMin: 600, endMin: 660 }])).toBe(true);
  });
});

describe("validateScheduleRow period lint", () => {
  const good = {
    room_code: "SW305", term_name: "1T-2026-2027", course: "ECEA101", section: "B14",
    professor: "Dela Cruz, J.", weekday: "Tue", start: "13:00", end: "14:30",
  };
  const term90 = { periodMin: 90, dayStartMin: 450, dayEndMin: 1260 };
  it("warns (not errors) when duration differs from the term period", () => {
    const r = validateScheduleRow(good, term90);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
    const w = validateScheduleRow({ ...good, end: "14:00" }, term90);
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.warnings).toEqual(["duration 60min is not the term period of 90min"]);
  });
  it("rejects classes outside the term window", () => {
    const early = validateScheduleRow({ ...good, start: "07:00", end: "08:30" }, term90);
    expect(early.ok).toBe(false);
  });
});

describe("buildGrid", () => {
  const classes = [
    { weekday: 2, startMin: 780, endMin: 870, course: "ECEA101", section: "B14", professor: "X" },
    { weekday: 2, startMin: 885, endMin: 975, course: "CPEA106", section: "A1", professor: "Y" },
  ];
  it("unions the period grid with class edges", () => {
    // 90-min periods from 07:30: 450,540,630,720,810,900,990,1080,1170 + open/close + class edges.
    const grid = buildGrid(classes, 450, 90, 480, 1170);
    expect(grid[0]).toBe(480);
    expect(grid[grid.length - 1]).toBe(1170);
    for (const t of [540, 780, 870, 885, 975]) expect(grid).toContain(t);
    expect(rowSpan(grid, 780, 870)).toBe(grid.indexOf(870) - grid.indexOf(780));
  });
  it("still renders off-grid (old-era) classes exactly", () => {
    const grid = buildGrid(
      [{ weekday: 1, startMin: 460, endMin: 510, course: "OLD", section: "A1", professor: "Z" }],
      450, 90, 480, 1170
    );
    expect(grid).toContain(480);
    expect(grid).toContain(510);
    expect(rowSpan(grid, 480, 510)).toBe(1);
  });
});
