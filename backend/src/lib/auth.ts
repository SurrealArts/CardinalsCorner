import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

export type Role = "ADMIN" | "STAFF" | "STUDENT";
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  name: string;
}

interface TokenPayload extends AuthUser {
  jti: string; // session row id (server-side allowlist)
  iat: number; // seconds — last activity (refreshed while in use)
  abs: number; // seconds — hard session deadline fixed at login
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
      syncSource?: string;
    }
  }
}

export const COOKIE_NAME = "cc_token";

// Tunables (env, with safe defaults). Fractional values allowed.
const numOr = (v: string | undefined, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};
export const idleTimeoutMs = () => numOr(process.env.IDLE_TIMEOUT_MIN, 30) * 60_000;
export const sessionMaxMs = () => numOr(process.env.SESSION_MAX_H, 12) * 3_600_000;
// Re-issue the cookie once this much activity has passed (keeps iat fresh).
const ROLL_AFTER_MS = 5 * 60_000;

const JWT_SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
};

// Fail closed: refuse to boot production without a real secret.
export function assertJwtSecret() {
  const s = process.env.JWT_SECRET ?? "";
  if (process.env.NODE_ENV === "production" && s.length < 32) {
    console.error("Refusing to start: JWT_SECRET must be at least 32 characters in production.");
    process.exit(1);
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Valid-format hash so unknown-email logins cost the same bcrypt work as real
// ones (no user-enumeration via timing).
const DUMMY_HASH = "$2b$10$E3rfXM6Hc9gOD11QkDyU2u3kuo0RbzfjPNf4iH.udJP.F2Ietdt2W";
export async function verifyLoginPassword(plain: string, hash: string | null): Promise<boolean> {
  if (hash) return verifyPassword(plain, hash);
  await verifyPassword("dummy-unknown-user", DUMMY_HASH);
  return false;
}

export function signToken(user: AuthUser, keep?: { jti: string; abs: number }): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    ...user,
    jti: keep?.jti ?? crypto.randomUUID(),
    iat: nowSec,
    abs: keep?.abs ?? nowSec + Math.floor(sessionMaxMs() / 1000),
  };
  return jwt.sign(payload, JWT_SECRET(), { expiresIn: Math.floor(sessionMaxMs() / 1000) });
}

// Pure rolling step (unit-testable): fresh activity stamp, same session + deadline.
export function refreshPayload(payload: TokenPayload, nowMs: number = Date.now()): TokenPayload {
  return { ...payload, iat: Math.floor(nowMs / 1000) };
}

export type SessionStatus = "ok" | "idle" | "expired";

// Pure session check (unit-testable). nowMs defaults to Date.now().
export function sessionStatus(payload: TokenPayload, nowMs: number = Date.now()): SessionStatus {
  if (nowMs / 1000 >= payload.abs) return "expired";
  if (nowMs - payload.iat * 1000 > idleTimeoutMs()) return "idle";
  return "ok";
}

export function sessionCookieOptions() {
  // Secure cookies need HTTPS; local dev runs plain HTTP.
  const secure = process.env.NODE_ENV === "production";
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge: sessionMaxMs() };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not signed in", code: "NO_SESSION" });
  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET(), { algorithms: ["HS256"] }) as TokenPayload;
  } catch {
    return res.status(401).json({ error: "Session expired, please sign in again", code: "EXPIRED" });
  }
  const status = sessionStatus(payload);
  if (status === "expired") {
    return res.status(401).json({ error: "Session expired, please sign in again", code: "EXPIRED" });
  }
  if (status === "idle") {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    return res.status(401).json({ error: "Signed out due to inactivity, please sign in again", code: "IDLE_TIMEOUT" });
  }
  // Server-side allowlist: unknown or revoked session IDs are dead tokens
  // (logout, password change, deactivation, admin revocation).
  const { prisma } = await import("./prisma.js");
  const session = payload.jti ? await prisma.session.findUnique({ where: { id: payload.jti } }) : null;
  if (!session || session.revokedAt || session.userId !== payload.id) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    return res.status(401).json({ error: "Session revoked, please sign in again", code: "REVOKED" });
  }
  req.user = { id: payload.id, email: payload.email, role: payload.role, name: payload.name };
  req.sessionId = payload.jti;
  // Throttled activity write + rolling re-issue so active users aren't cut off.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  if (Date.now() - payload.iat * 1000 > ROLL_AFTER_MS) {
    const fresh = signToken(req.user, { jti: payload.jti, abs: payload.abs });
    res.cookie(COOKIE_NAME, fresh, sessionCookieOptions());
  }
  next();
}

export async function revokeSession(jti: string | undefined): Promise<void> {
  if (!jti) return;
  const { prisma } = await import("./prisma.js");
  await prisma.session.updateMany({ where: { id: jti, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeUserSessions(userId: string, exceptJti?: string): Promise<number> {
  const { prisma } = await import("./prisma.js");
  const r = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptJti ? { id: { not: exceptJti } } : {}) },
    data: { revokedAt: new Date() },
  });
  return r.count;
}

// Best-effort purge of long-dead sessions (runs on login).
export async function purgeOldSessions(): Promise<void> {
  const { prisma } = await import("./prisma.js");
  const cutoff = new Date(Date.now() - 7 * 86400_000);
  await prisma.session.deleteMany({ where: { expiresAt: { lt: cutoff } } }).catch(() => {});
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not signed in", code: "NO_SESSION" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Not authorized for this action" });
    next();
  };
}

function keysEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// External sync API auth: shared keys in SYNC_API_KEYS (comma-separated).
// Caller identifies its origin system via X-Sync-Source: Registrar | IT | ILMO | OSAAR.
export function requireSyncKey(req: Request, res: Response, next: NextFunction) {
  const configured = (process.env.SYNC_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (configured.length === 0) return res.status(503).json({ error: "Sync API is not configured (SYNC_API_KEYS empty)" });
  const key = req.headers["x-sync-key"];
  const source = req.headers["x-sync-source"];
  if (typeof key !== "string" || !configured.some((k) => keysEqual(key, k))) {
    return res.status(401).json({ error: "Invalid sync key" });
  }
  if (typeof source !== "string" || !/^(Registrar|IT|ILMO|OSAAR|ADMIN)$/i.test(source)) {
    return res.status(400).json({ error: "X-Sync-Source must be one of Registrar, IT, ILMO, OSAAR, ADMIN" });
  }
  req.syncSource = source.toUpperCase();
  next();
}
