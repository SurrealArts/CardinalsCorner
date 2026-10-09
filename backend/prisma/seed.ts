import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import groups from "./rooms.source.json" with { type: "json" };

// Deterministic PRNG (mulberry32) so seeds are stable across runs.
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

type RoomSeed = {
  code: string;
  wing: string;
  roomType: string;
  capacity: number;
  description: string;
};

function buildRooms(): RoomSeed[] {
  const out: RoomSeed[] = [];
  const push = (code: string, wing: string, roomType: string, capacity: number, description: string) =>
    out.push({ code, wing, roomType, capacity, description });
  const g = groups as Record<string, string[]>;

  const wingDesc: Record<string, string> = {
    S: "South wing",
    SW: "Southwest wing",
    W: "West wing",
    N: "North wing",
    NW: "Northwest wing",
  };

  for (const wing of ["S", "SW", "W", "N", "NW"]) {
    for (const code of g[wing] ?? []) {
      const r = rng(hashCode(code));
      // Floor from first digit when standard 3-digit pattern matches
      const m = code.match(/^[A-Z]+(\d)/);
      const floor = m ? Number(m[1]) : 1;
      const capacity = [40, 35, 35, 30][Math.min(Math.max(floor - 1, 0), 3)];
      const roomType = r() < 0.18 ? "laboratory" : "classroom";
      push(code, wing, roomType, capacity, `${wingDesc[wing]}, floor ${floor}`);
    }
  }
  for (const code of g["North Bridge"] ?? []) push(code, "NB", "bridge", 20, "North Bridge, second floor");
  for (const code of g["South Bridge"] ?? []) push(code, "SB", "bridge", 20, "South Bridge, second floor");
  for (const code of g["Audio Visual rooms"] ?? []) push(code, "AV", "av", 120, "Audio Visual room, commonly booked for org events");
  for (const code of g["Smart classrooms"] ?? []) push(code, "SMART", "smart", 40, "Smart classroom");
  for (const code of g["Other coded rooms"] ?? []) {
    const t = code.startsWith("SR") ? "stock" : "other";
    push(code, "OTHER", t, t === "stock" ? 0 : 25, "Special-purpose room");
  }
  return out;
}

// Realistic class slots (minutes since midnight), Mon-Sat
const SLOTS: Array<[number, number]> = [
  [450, 540], // 07:30-09:00
  [555, 645], // 09:15-10:45
  [660, 750], // 11:00-12:30
  [780, 870], // 13:00-14:30
  [885, 975], // 14:45-16:15
  [990, 1080], // 16:30-18:00
];
const COURSES = ["CPE106L-4", "CPE121-3", "CS111-1", "EE103-2", "MATH123", "GED105", "CPE301", "ECE202L"];

async function main() {
  console.log("Seeding Cardinal's Corner...");

  const password = (plain: string) => bcrypt.hashSync(plain, 10);
  const users = [
    { name: "Admin User", email: "admin@mapua.edu.ph", role: "ADMIN" as const, department: "IT", passwordHash: password("Admin123!") },
    { name: "Staff User", email: "staff@mapua.edu.ph", role: "STAFF" as const, department: "SOECE", passwordHash: password("Staff123!") },
    { name: "Student User", email: "student@mapua.edu.ph", role: "STUDENT" as const, department: "CPE", passwordHash: password("Student123!") },
  ];
  for (const u of users) {
    await prisma.user.upsert({ where: { email: u.email }, update: { ...u, active: true }, create: u });
  }

  const term = await prisma.term.upsert({
    where: { name: "2026-1Q" },
    update: {},
    create: { name: "2026-1Q", startDate: new Date("2026-10-01T00:00:00+08:00"), endDate: new Date("2026-12-31T23:59:59+08:00") },
  });

  const rooms = buildRooms();
  console.log(`Upserting ${rooms.length} rooms...`);
  for (const r of rooms) {
    await prisma.room.upsert({
      where: { code: r.code },
      update: { wing: r.wing, roomType: r.roomType, capacity: r.capacity, description: r.description, status: "ACTIVE" },
      create: { ...r, campus: "Intramuros" },
    });
  }

  // Sample weekly schedules on ~40 deterministic rooms (keeps demo readable).
  const schedRooms = rooms.filter((r) => r.roomType === "classroom" || r.roomType === "laboratory").filter((_, i) => i % 4 === 0).slice(0, 40);
  let schedCount = 0;
  for (const room of schedRooms) {
    const dbRoom = await prisma.room.findUniqueOrThrow({ where: { code: room.code } });
    const rand = rng(hashCode(room.code + term.id));
    const n = 2 + Math.floor(rand() * 3);
    await prisma.classSchedule.deleteMany({ where: { roomId: dbRoom.id, termId: term.id } });
    for (let i = 0; i < n; i++) {
      const weekday = 1 + Math.floor(rand() * 6); // Mon-Sat
      const slot = SLOTS[Math.floor(rand() * SLOTS.length)];
      const course = COURSES[Math.floor(rand() * COURSES.length)];
      await prisma.classSchedule.create({
        data: { roomId: dbRoom.id, termId: term.id, courseLabel: `${course} A${1 + Math.floor(rand() * 5)}`, weekday, startMin: slot[0], endMin: slot[1] },
      });
      schedCount++;
    }
  }
  console.log(`Created ${schedCount} sample class schedules.`);

  // Sample closures
  const closureSamples = [
    { code: "AV-1", date: "2026-10-20", startMin: null, endMin: null, reason: "University event setup" },
    { code: "SW305", date: "2026-10-21", startMin: 780, endMin: 975, reason: "Aircon maintenance" },
  ];
  for (const c of closureSamples) {
    const room = await prisma.room.findUnique({ where: { code: c.code } });
    if (!room) continue;
    await prisma.closure.create({ data: { roomId: room.id, date: c.date, startMin: c.startMin, endMin: c.endMin, reason: c.reason } });
  }

  // Sample reservations
  const student = await prisma.user.findUniqueOrThrow({ where: { email: "student@mapua.edu.ph" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@mapua.edu.ph" } });
  const demoRoom = await prisma.room.findUnique({ where: { code: "AV-2" } });
  if (demoRoom) {
    await prisma.reservation.createMany({
      data: [
        { requesterId: student.id, roomId: demoRoom.id, date: "2026-10-22", startMin: 780, endMin: 900, participantCount: 50, purpose: "Org general assembly", status: "PENDING" },
        { requesterId: student.id, roomId: demoRoom.id, date: "2026-10-15", startMin: 780, endMin: 900, participantCount: 40, purpose: "Approved seminar", status: "APPROVED", reviewerId: admin.id, decidedAt: new Date(), reason: "OK" },
      ],
    });
  }

  await prisma.activityLog.create({ data: { actorId: admin.id, action: "db.seed", entityType: "sync", detail: JSON.stringify({ rooms: rooms.length, schedules: schedCount }) } });
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
