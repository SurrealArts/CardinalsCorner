import type { NextFunction, Request, Response } from "express";

// Minimal fixed-window rate limiter (in-memory; fine for a single replica).
// Testable: inject `now` to control time.
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  key: (req: Request) => string;
  message?: string;
  now?: () => number;
}) {
  const { windowMs, max, key, message = "Too many attempts, please try again later", now = Date.now } = options;
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const t = now();
    const k = key(req);
    const recent = (hits.get(k) ?? []).filter((ts) => t - ts < windowMs);
    if (recent.length >= max) {
      res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: message });
    }
    recent.push(t);
    if (hits.size > 5000 && !hits.has(k)) {
      // Bound memory: drop the oldest bucket when full.
      const oldest = hits.keys().next().value;
      if (oldest) hits.delete(oldest);
    }
    hits.set(k, recent);
    next();
  };
}

// Best-effort client IP behind Cloudflare tunnel / proxies.
export function clientIp(req: Request): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf.split(",")[0].trim();
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}
