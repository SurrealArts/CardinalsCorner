import { overlaps } from "./time.js";
import { hhmmToMinutes, isValidInterval, minutesToHHMM } from "./time.js";

// Sanitization bounds for class schedules (07:00 earliest, 21:00 latest).
export const DAY_OPEN_MIN = 420;
export const DAY_CLOSE_MIN = 1260;

// Course code like ECEA101; section like A1, B14, E05.
export const COURSE_RE = /^[A-Z]{2,6}[0-9]{2,4}[A-Z]?$/;
export const SECTION_RE = /^[A-Z][0-9]{1,3}$/;

const DAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

export function parseWeekday(v: string): number | null {
  const t = v.trim().toLowerCase();
  if (/^[0-6]$/.test(t)) return Number(t);
  const w = DAY_NAMES[t.slice(0, 3)] ?? DAY_NAMES[t];
  return w === undefined ? null : w;
}

export function parseMinute(v: string): number | null {
  const t = v.trim();
  if (/^\d+$/.test(t)) return Number(t);
  return hhmmToMinutes(t);
}

export interface ValidSchedule {
  roomCode: string;
  termName: string;
  course: string;
  section: string;
  professor: string;
  weekday: number;
  startMin: number;
  endMin: number;
}

// Validate one schedule row (CSV or single create). DB-existence and overlap
// checks happen in the route; everything checkable offline happens here.
// The term pins the allowed window (earliest/latest) and the period length:
// out-of-window is a hard error, off-period duration is a non-blocking warning
// (eras change periods, and legitimate entries don't always match).
export interface TermWindow {
  periodMin: number;
  dayStartMin: number;
  dayEndMin: number;
}

export function validateScheduleRow(
  r: Record<string, string>,
  term?: TermWindow
): { ok: true; data: ValidSchedule; warnings: string[] } | { ok: false; error: string } {
  const roomCode = (r.room_code ?? "").trim();
  const termName = (r.term_name ?? "").trim();
  const course = (r.course ?? "").trim().toUpperCase();
  const section = (r.section ?? "").trim().toUpperCase();
  const professor = (r.professor ?? "").trim();
  if (!roomCode) return { ok: false, error: "room_code is required" };
  if (!termName) return { ok: false, error: "term_name is required" };
  if (!COURSE_RE.test(course)) return { ok: false, error: `bad course code ${r.course ?? ""} (expected like ECEA101)` };
  if (!SECTION_RE.test(section)) return { ok: false, error: `bad section ${r.section ?? ""} (expected like A1, B14, E05)` };
  if (professor.length < 2) return { ok: false, error: "professor is required" };
  const weekday = parseWeekday(r.weekday ?? "");
  if (weekday === null) return { ok: false, error: `bad weekday ${r.weekday ?? ""} (0-6 or Mon..Sun)` };
  const startMin = parseMinute(r.start ?? "");
  const endMin = parseMinute(r.end ?? "");
  if (startMin === null || endMin === null || !isValidInterval(startMin, endMin)) {
    return { ok: false, error: `bad interval ${r.start ?? ""}-${r.end ?? ""}` };
  }
  const lo = term ? Math.max(DAY_OPEN_MIN, term.dayStartMin) : DAY_OPEN_MIN;
  const hi = term ? Math.min(DAY_CLOSE_MIN, term.dayEndMin) : DAY_CLOSE_MIN;
  const [loB, hiB] = lo < hi ? [lo, hi] : [DAY_OPEN_MIN, DAY_CLOSE_MIN];
  if (startMin < loB || endMin > hiB) {
    return { ok: false, error: `interval must be within ${minutesToHHMM(loB)}-${minutesToHHMM(hiB)} (got ${r.start ?? ""}-${r.end ?? ""})` };
  }
  const warnings: string[] = [];
  const periodMin = term?.periodMin;
  if (periodMin && periodMin > 0 && endMin - startMin !== periodMin) {
    warnings.push(`duration ${endMin - startMin}min is not the term period of ${periodMin}min`);
  }
  return { ok: true, data: { roomCode, termName, course, section, professor, weekday, startMin, endMin }, warnings };
}

// True when `cand` overlaps any interval in `existing` (boundary touch is fine).
export function hasOverlap(cand: { startMin: number; endMin: number }, existing: Array<{ startMin: number; endMin: number }>): boolean {
  return existing.some((e) => overlaps(cand.startMin, cand.endMin, e.startMin, e.endMin));
}
