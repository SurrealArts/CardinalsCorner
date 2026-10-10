import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../lib/auth.js";

export const termsRouter = Router();

// Term names follow NT-YYYY-ZZZZ: nth term (1-4), school-year start and end,
// e.g. 1T-2026-2027.
export const TERM_RE = /^([1-4])T-(\d{4})-(\d{4})$/;

// Public term catalog (schedules and vacancy views resolve terms by name).
termsRouter.get("/", async (_req, res) => {
  res.json(await prisma.term.findMany({ orderBy: { startDate: "desc" } }));
});

// Admin: open a new term each start of term (schedules import references it).
termsRouter.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { name, startDate, endDate, periodMin = 90, dayStartMin = 450, dayEndMin = 1260 } = req.body as {
    name?: string; startDate?: string; endDate?: string; periodMin?: number; dayStartMin?: number; dayEndMin?: number;
  };
  const checked = checkTermFields({ name, startDate, endDate, periodMin, dayStartMin, dayEndMin });
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  try {
    const term = await prisma.term.create({
      data: { name: checked.data.name, startDate: checked.data.start, endDate: checked.data.end, periodMin: checked.data.periodMin, dayStartMin: checked.data.dayStartMin, dayEndMin: checked.data.dayEndMin },
    });
    await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "term.create", entityType: "term", entityId: term.id, detail: JSON.stringify({ name }) } });
    res.status(201).json(term);
  } catch {
    res.status(409).json({ error: "Term name already exists" });
  }
});

// Admin: fix a term (dates, period grid, even the name). Schedules reference
// the term by id, so renaming never orphans them.
termsRouter.patch("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { name, startDate, endDate, periodMin, dayStartMin, dayEndMin } = req.body as {
    name?: string; startDate?: string; endDate?: string; periodMin?: number; dayStartMin?: number; dayEndMin?: number;
  };
  const current = await prisma.term.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Term not found" });
  const checked = checkTermFields({
    name: name ?? current.name,
    startDate: startDate ?? current.startDate.toISOString(),
    endDate: endDate ?? current.endDate.toISOString(),
    periodMin: periodMin ?? current.periodMin,
    dayStartMin: dayStartMin ?? current.dayStartMin,
    dayEndMin: dayEndMin ?? current.dayEndMin,
  });
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  try {
    const term = await prisma.term.update({
      where: { id: current.id },
      data: { name: checked.data.name, startDate: checked.data.start, endDate: checked.data.end, periodMin: checked.data.periodMin, dayStartMin: checked.data.dayStartMin, dayEndMin: checked.data.dayEndMin },
    });
    await prisma.activityLog.create({ data: { actorId: req.user!.id, action: "term.update", entityType: "term", entityId: term.id, detail: JSON.stringify(checked.data) } });
    res.json(term);
  } catch {
    res.status(409).json({ error: "Term name already exists" });
  }
});

function checkTermFields(input: {
  name?: string; startDate?: string; endDate?: string; periodMin?: number; dayStartMin?: number; dayEndMin?: number;
}): { ok: true; data: { name: string; start: Date; end: Date; periodMin: number; dayStartMin: number; dayEndMin: number } } | { ok: false; error: string } {
  const { name, startDate, endDate, periodMin = 90, dayStartMin = 450, dayEndMin = 1260 } = input;
  if (!name || !startDate || !endDate) return { ok: false, error: "name, startDate, endDate are required" };
  const m = TERM_RE.exec(name.trim());
  if (!m) return { ok: false, error: "Term name must look like 1T-2026-2027 (nth term 1-4, school-year start-end)" };
  if (Number(m[3]) !== Number(m[2]) + 1) {
    return { ok: false, error: "Term school years must be consecutive (e.g. 2026-2027)" };
  }
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return { ok: false, error: "startDate must be a valid date before endDate" };
  }
  if (!Number.isInteger(periodMin) || periodMin < 20 || periodMin > 240) {
    return { ok: false, error: "periodMin must be 20-240 minutes (presently 90)" };
  }
  for (const [label, v] of [["dayStartMin", dayStartMin], ["dayEndMin", dayEndMin]] as const) {
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 1440) {
      return { ok: false, error: `${label} must be minutes since midnight` };
    }
  }
  if ((dayStartMin as number) >= (dayEndMin as number)) {
    return { ok: false, error: "Term day must start before it ends" };
  }
  return { ok: true, data: { name: name.trim(), start, end, periodMin, dayStartMin: dayStartMin as number, dayEndMin: dayEndMin as number } };
}
