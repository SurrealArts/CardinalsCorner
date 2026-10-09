import { describe, expect, it } from "vitest";
import { overlaps, weekdayManila, isValidInterval } from "./time.js";

describe("interval overlap (boundary sharing is allowed)", () => {
  it("treats touching boundaries as non-overlapping", () => {
    expect(overlaps(540, 600, 600, 660)).toBe(false);
    expect(overlaps(600, 660, 540, 600)).toBe(false);
  });
  it("detects real overlaps", () => {
    expect(overlaps(540, 610, 600, 660)).toBe(true);
    expect(overlaps(540, 660, 560, 600)).toBe(true);
    expect(overlaps(540, 660, 540, 660)).toBe(true);
  });
  it("validates intervals", () => {
    expect(isValidInterval(540, 600)).toBe(true);
    expect(isValidInterval(600, 600)).toBe(false);
    expect(isValidInterval(600, 540)).toBe(false);
    expect(isValidInterval(-1, 600)).toBe(false);
  });
  it("computes Manila weekday", () => {
    // 2026-10-20 is a Tuesday
    expect(weekdayManila("2026-10-20")).toBe(2);
  });
});
