import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { generateDemoSchedules } from "../src/lib/demo-schedule.js";
import groups from "./rooms.source.json" with { type: "json" };

// Seed: one invisible admin + reference term + sample class schedules in the
// current format (course / section / professor). No demo users, no reservations.

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashCode = (s: string) =>
  [...s].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) | 0), 7);

type RoomSeed = { code: string; wing: string; roomType: string; description: string };

function buildRooms(): RoomSeed[] {
  const out: RoomSeed[] = [];
  const push = (code: string, wing: string, roomType: string, description: string) =>
    out.push({ code, wing, roomType, description });
  const g = groups as Record<string, string[]>;
  const wingDesc: Record<string, string> = {
    S: "South wing", SW: "Southwest wing", W: "West wing", N: "North wing", NW: "Northwest wing",
  };
  for (const wing of ["S", "SW", "W", "N", "NW"]) {
    for (const code of g[wing] ?? []) {
      const r = rng(hashCode(code));
      const m = code.match(/^[A-Z]+(\d)/);
      const floor = m ? Number(m[1]) : 1;
      push(code, wing, r() < 0.18 ? "laboratory" : "classroom", `${wingDesc[wing]}, floor ${floor}`);
    }
  }
  for (const code of g["North Bridge"] ?? []) push(code, "NB", "bridge", "North Bridge, second floor");
  for (const code of g["South Bridge"] ?? []) push(code, "SB", "bridge", "South Bridge, second floor");
  for (const code of g["Audio Visual rooms"] ?? []) push(code, "AV", "av", "Audio Visual room, commonly booked for org events");
  for (const code of g["Smart classrooms"] ?? []) push(code, "SMART", "smart", "Smart classroom");
  for (const code of g["Other coded rooms"] ?? []) {
    const t = code.startsWith("SR") ? "stock" : "other";
    push(code, "OTHER", t, "Special-purpose room");
  }
  return out;
}

async function main() {
  console.log("Seeding Cardinal's Corner...");

  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@mapua.edu.ph";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "Admin123!";
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: "ADMIN", active: true },
    create: {
      name: "Administrator", email: adminEmail, role: "ADMIN", department: "IT",
      passwordHash: bcrypt.hashSync(adminPassword, 10),
    },
  });

  const term = await prisma.term.upsert({
    where: { name: "1T-2026-2027" },
    update: {},
    create: { name: "1T-2026-2027", startDate: new Date("2026-08-01T00:00:00+08:00"), endDate: new Date("2026-12-31T23:59:59+08:00"), periodMin: 90, dayStartMin: 450 },
  });

  const rooms = buildRooms();
  console.log(`Upserting ${rooms.length} rooms...`);
  for (const r of rooms) {
    await prisma.room.upsert({
      where: { code: r.code },
      update: { wing: r.wing, roomType: r.roomType, description: r.description, status: "ACTIVE" },
      create: { ...r, campus: "Intramuros" },
    });
  }

  // Dense demo schedules via the shared generator (same one the Dokploy
  // terminal entry uses): ~1:1 occupied:free with heavy per-day variance.
  await prisma.classSchedule.deleteMany({ where: { termId: term.id } });
  const dbRooms = await prisma.room.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, code: true, roomType: true },
  });
  const demoRows = generateDemoSchedules(dbRooms, term.id);
  for (let i = 0; i < demoRows.length; i += 500) {
    await prisma.classSchedule.createMany({ data: demoRows.slice(i, i + 500) });
  }
  console.log(`Created ${demoRows.length} sample class schedules.`);

  const av1 = await prisma.room.findUnique({ where: { code: "AV-1" } });
  if (av1) {
    await prisma.closure.deleteMany({ where: { roomId: av1.id } });
    await prisma.closure.create({ data: { roomId: av1.id, date: "2026-10-20", startMin: null, endMin: null, reason: "University event setup" } });
  }
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
