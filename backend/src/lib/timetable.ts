export interface TimetableClass {
  weekday: number;
  startMin: number;
  endMin: number;
  course: string;
  section: string;
  professor: string;
}

// Row boundaries for the week-grid table: the term's period grid (dayStart +
// k*period) unioned with the actual class boundaries, clamped to the room's
// display window. Period grids change per era (50/70/90 min), but old classes
// keep exact rows because their own edges are always included.
export function buildGrid(
  classes: TimetableClass[],
  dayStartMin: number,
  periodMin: number,
  openMin: number,
  closeMin: number
): number[] {
  const bounds = new Set<number>([openMin, closeMin]);
  if (periodMin > 0) {
    for (let t = dayStartMin; t < closeMin; t += periodMin) {
      if (t > openMin) bounds.add(Math.min(t, closeMin));
    }
  }
  for (const c of classes) {
    bounds.add(Math.min(Math.max(c.startMin, openMin), closeMin));
    bounds.add(Math.min(Math.max(c.endMin, openMin), closeMin));
  }
  return [...bounds].sort((a, b) => a - b);
}

// How many grid rows a class starting at `startMin` spans (for rowspan).
export function rowSpan(grid: number[], startMin: number, endMin: number): number {
  const from = grid.indexOf(startMin);
  const to = grid.indexOf(endMin);
  if (from === -1 || to === -1 || to <= from) return 1;
  return to - from;
}
