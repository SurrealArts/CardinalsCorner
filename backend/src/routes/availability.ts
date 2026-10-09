import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../lib/auth.js";
import { checkAvailability } from "../lib/availability.js";
import { isValidDate, isValidInterval } from "../lib/time.js";

export const availabilityRouter = Router();

availabilityRouter.get("/", requireAuth, async (req, res) => {
  const { roomId, date, startMin, endMin } = req.query as Record<string, string>;
  const s = Number(startMin);
  const e = Number(endMin);
  if (!roomId || !isValidDate(date ?? "") || !isValidInterval(s, e)) {
    return res.status(400).json({ error: "roomId, valid date (YYYY-MM-DD), and startMin/endMin are required" });
  }
  res.json(await checkAvailability(roomId, date, s, e));
});

availabilityRouter.post("/compare", requireAuth, async (req, res) => {
  const schema = z.object({ roomIds: z.array(z.string()).min(1).max(6), date: z.string(), startMin: z.number().int(), endMin: z.number().int() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !isValidDate(parsed.data.date) || !isValidInterval(parsed.data.startMin, parsed.data.endMin)) {
    return res.status(400).json({ error: "Provide roomIds (1-6), date, and a valid time interval" });
  }
  const results = [];
  for (const roomId of parsed.data.roomIds) {
    results.push(await checkAvailability(roomId, parsed.data.date, parsed.data.startMin, parsed.data.endMin));
  }
  res.json(results);
});
