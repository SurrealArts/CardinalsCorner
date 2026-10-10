import { describe, expect, it } from "vitest";
import { refreshPayload, sessionStatus } from "./auth.js";
import { createRateLimiter } from "./rate-limit.js";

const payload = (iatSec: number, absSec: number) => ({ id: "u", email: "e", role: "STUDENT" as const, name: "n", jti: "jti-1", iat: iatSec, abs: absSec });

describe("sessionStatus", () => {
  it("is ok for a fresh session", () => {
    const now = Date.now();
    expect(sessionStatus(payload(Math.floor(now / 1000), Math.floor(now / 1000) + 3600), now)).toBe("ok");
  });
  it("goes idle after IDLE_TIMEOUT_MIN of inactivity (default 30m)", () => {
    const now = Date.now();
    const iat = Math.floor((now - 31 * 60_000) / 1000);
    expect(sessionStatus(payload(iat, Math.floor(now / 1000) + 3600), now)).toBe("idle");
  });
  it("expires at the absolute deadline even with recent activity", () => {
    const now = Date.now();
    const past = Math.floor((now - 1000) / 1000);
    expect(sessionStatus(payload(past, past), now)).toBe("expired");
  });
});

describe("refreshPayload", () => {
  it("refreshes activity but preserves session id and deadline", () => {
    const p = payload(1000, 2000);
    const r = refreshPayload({ ...p, jti: "abc" }, 1_500_000);
    expect(r.iat).toBe(1500);
    expect(r.jti).toBe("abc");
    expect(r.abs).toBe(2000);
  });
});

describe("createRateLimiter", () => {
  it("blocks past max within the window and resets after", () => {
    let t = 1_000_000;
    const statuses: number[] = [];
    const mw = createRateLimiter({ windowMs: 60_000, max: 2, key: () => "k", now: () => t });
    const run = () => {
      let code = 200;
      mw({} as never, { status: (c: number) => ({ json: () => { code = c; } }), setHeader: () => {} } as never, () => {});
      statuses.push(code);
    };
    run();
    run();
    run();
    expect(statuses).toEqual([200, 200, 429]);
    t += 61_000;
    run();
    expect(statuses).toEqual([200, 200, 429, 200]);
  });
  it("keys callers independently", () => {
    const mw = createRateLimiter({ windowMs: 60_000, max: 1, key: (req) => (req as unknown as { k: string }).k });
    const codes: number[] = [];
    for (const k of ["a", "a", "b"]) {
      let code = 200;
      mw({ k } as never, { status: (c: number) => ({ json: () => { code = c; } }), setHeader: () => {} } as never, () => {});
      codes.push(code);
    }
    expect(codes).toEqual([200, 429, 200]);
  });
});
