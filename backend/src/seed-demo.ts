import "dotenv/config";
import { prisma } from "./lib/prisma.js";
import { excludeOverlapping, generateDemoSchedules } from "./lib/demo-schedule.js";

// Demo-data seeder runnable anywhere the built app runs — including the
// Dokploy terminal (Open Terminal on the app, then):
//
//   SCHEDULE_TERM=1T-2026-2027 SEED_DEMO_WIPE=1 node backend/dist/seed-demo.js
//
// (Named SCHEDULE_TERM because plain TERM is already the terminal type.)
// SCHEDULE_TERM defaults to the latest term. Without SEED_DEMO_WIPE=1 the
// script refuses to touch a term that already has schedules, and otherwise
// only fills blocks that are still free (safe to re-run).
async function main() {
  const term = process.env.SCHEDULE_TERM
    ? await prisma.term.findUnique({ where: { name: process.env.SCHEDULE_TERM } })
    : await prisma.term.findFirst({ orderBy: { startDate: "desc" } });
  if (!term) {
    console.error("No term found. Create one first (Admin page → Terms), then re-run with TERM=<name>.");
    process.exit(1);
  }
  const existingCount = await prisma.classSchedule.count({ where: { termId: term.id } });
  if (existingCount > 0 && process.env.SEED_DEMO_WIPE !== "1") {
    console.error(
      `Term ${term.name} already has ${existingCount} schedules. ` +
        `Re-run with SEED_DEMO_WIPE=1 to replace them, or pick an empty term.`
    );
    process.exit(2);
  }
  if (process.env.SEED_DEMO_WIPE === "1") {
    const wiped = await prisma.classSchedule.deleteMany({ where: { termId: term.id } });
    console.log(`Cleared ${wiped.count} existing schedules in ${term.name}.`);
  }

  const rooms = await prisma.room.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, code: true, roomType: true },
  });
  let rows = generateDemoSchedules(rooms, term.id);
  if (process.env.SEED_DEMO_WIPE !== "1") {
    const existing = await prisma.classSchedule.findMany({
      where: { termId: term.id },
      select: { roomId: true, weekday: true, startMin: true, endMin: true },
    });
    rows = excludeOverlapping(rows, existing);
  }
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    await prisma.classSchedule.createMany({ data: rows.slice(i, i + BATCH) });
  }

  const days = await prisma.classSchedule.groupBy({
    by: ["weekday"],
    where: { termId: term.id },
    _sum: { startMin: true, endMin: true },
    _count: true,
  });
  let occMin = 0;
  let n = 0;
  for (const d of days) {
    occMin += (d._sum.endMin ?? 0) - (d._sum.startMin ?? 0);
    n += d._count;
  }
  const schedulableRooms = rooms.filter((r) => ["classroom", "laboratory", "smart"].includes(r.roomType)).length;
  const windowMin = 810 * 6 * Math.max(schedulableRooms, 1);
  console.log(`Seeded ${n} demo schedules in ${term.name} across ${schedulableRooms} rooms.`);
  console.log(`Occupancy ≈ ${Math.round((100 * occMin) / windowMin)}% of the Mon-Sat 07:30-21:00 window.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
