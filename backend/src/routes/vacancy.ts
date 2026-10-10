import { Router } from "express";
import { vacancyForRooms, vacancyTally } from "../lib/vacancy.js";
import { isValidDate } from "../lib/time.js";

export const vacancyRouter = Router();

// Public vacancy lookup for specific rooms.
// GET /api/vacancy?date=YYYY-MM-DD&roomIds=id1,id2&at=now|HH:MM&minFreeMin=60
vacancyRouter.get("/", async (req, res) => {
  const { date = "", roomIds = "", at = "", minFreeMin = "0" } = req.query as Record<string, string>;
  if (!isValidDate(date)) return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
  const ids = roomIds.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
  if (ids.length === 0) return res.status(400).json({ error: "roomIds (up to 12) is required" });
  res.json(await vacancyForRooms(ids, date, at || undefined, Math.max(0, Number(minFreeMin) || 0)));
});

// Full-catalog vacant-period tally.
// GET /api/vacancy/tally?date=YYYY-MM-DD&wing=&at=now|HH:MM&minFreeMin=60
vacancyRouter.get("/tally", async (req, res) => {
  const { date = "", wing = "", at = "", minFreeMin = "0" } = req.query as Record<string, string>;
  if (!isValidDate(date)) return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
  res.json(await vacancyTally(date, at || undefined, wing, Math.max(0, Number(minFreeMin) || 0)));
});
