// Time helpers. All dates are YYYY-MM-DD in Philippine local time (Asia/Manila).
// Intervals are [startMin, endMin) in minutes since midnight. Sharing a boundary
// (e.g. 09:00 end == 09:00 start) is NOT an overlap, per proposal 10(d).

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T12:00:00+08:00`);
  return !Number.isNaN(d.getTime());
}

export function isValidInterval(startMin: number, endMin: number): boolean {
  return Number.isInteger(startMin) && Number.isInteger(endMin) && startMin >= 0 && endMin <= 1440 && startMin < endMin;
}

// Weekday 0=Sunday..6=Saturday for a YYYY-MM-DD date in Manila time.
export function weekdayManila(date: string): number {
  const d = new Date(`${date}T12:00:00+08:00`);
  // Convert from UTC day to Manila day: noon Manila is 04:00 UTC same day, safe.
  return d.getUTCDay();
}

export function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

export function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 24 || mm < 0 || mm > 59) return null;
  if (h === 24 && mm !== 0) return null;
  return h * 60 + mm;
}
