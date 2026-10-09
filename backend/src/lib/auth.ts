import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

export type Role = "ADMIN" | "STAFF" | "STUDENT";
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      syncSource?: string;
    }
  }
}

const JWT_SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET(), { expiresIn: "12h" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const cookieToken = (req as unknown as { cookies?: Record<string, string> }).cookies?.["cc_token"];
  const token = header?.startsWith("Bearer ") ? header.slice(7) : cookieToken;
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    req.user = jwt.verify(token, JWT_SECRET()) as AuthUser;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired, please sign in again" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not signed in" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Not authorized for this action" });
    next();
  };
}

// External sync API auth: shared keys in SYNC_API_KEYS (comma-separated).
// Caller identifies its origin system via X-Sync-Source: Registrar | IT | ILMO | OSAAR.
export function requireSyncKey(req: Request, res: Response, next: NextFunction) {
  const configured = (process.env.SYNC_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (configured.length === 0) return res.status(503).json({ error: "Sync API is not configured (SYNC_API_KEYS empty)" });
  const key = req.headers["x-sync-key"];
  const source = req.headers["x-sync-source"];
  if (typeof key !== "string" || !configured.includes(key)) return res.status(401).json({ error: "Invalid sync key" });
  if (typeof source !== "string" || !/^(Registrar|IT|ILMO|OSAAR|ADMIN)$/i.test(source)) {
    return res.status(400).json({ error: "X-Sync-Source must be one of Registrar, IT, ILMO, OSAAR, ADMIN" });
  }
  req.syncSource = source.toUpperCase();
  next();
}
