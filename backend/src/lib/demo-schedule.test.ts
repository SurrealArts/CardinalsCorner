import { describe, expect, it } from "vitest";
import { excludeOverlapping, generateDemoSchedules } from "./demo-schedule.js";

const rooms = [
  { id: "r1", code: "SW305", roomType: "classroom" },
  { id: "r2", code: "AV-1", roomType: "av" },
  { id: "r3", code: "SR1", roomType: "stock" },
];

describe("generateDemoSchedules", () => {
  it("is deterministic and skips non-class venues", () => {
    const a = generateDemoSchedules(rooms, "t1");
    const b = generateDemoSchedules(rooms, "t1");
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((r) => r.roomId === "r1")).toBe(true);
  });
  it("stays in bounds with no same-day overlaps", () => {
    const rows = generateDemoSchedules(rooms, "t1");
    for (const r of rows) {
      expect(r.startMin).toBeGreaterThanOrEqual(450);
      expect(r.endMin).toBeLessThanOrEqual(1260);
      expect(r.endMin - r.startMin).toBe(90);
      expect(r.weekday).toBeGreaterThanOrEqual(1);
      expect(r.weekday).toBeLessThanOrEqual(6);
    }
    const byDay = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = `${r.roomId}:${r.weekday}`;
      byDay.set(k, [...(byDay.get(k) ?? []), r]);
    }
    for (const [, day] of byDay) {
      const sorted = [...day].sort((x, y) => x.startMin - y.startMin);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].startMin).toBeGreaterThanOrEqual(sorted[i - 1].endMin);
      }
    }
  });
  it("excludeOverlapping drops colliding candidates", () => {
    const rows = generateDemoSchedules(rooms, "t1");
    const first = rows[0];
    const kept = excludeOverlapping(rows, [{ roomId: first.roomId, weekday: first.weekday, startMin: first.startMin, endMin: first.endMin }]);
    expect(kept.length).toBe(rows.length - 1);
    expect(excludeOverlapping(rows, [])).toHaveLength(rows.length);
  });
});
