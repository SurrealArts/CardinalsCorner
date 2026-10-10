// API base: VITE_API_URL in local dev, relative /api in production (same-origin).
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

// Cookie-only auth: the server sets an httpOnly session cookie on login and
// the browser sends it automatically (credentials: include). No token is ever
// kept in JS-accessible storage, so page scripts can't leak it.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body as { error?: string; code?: string };
    // NOTE: no auto-redirect here. The catalog is public and anonymous calls
    // (e.g. the session check on boot) legitimately 401 — redirecting on any
    // 401 bounced every first-time visitor to the admin sign-in. The Admin
    // page handles its own 401s by showing the sign-in form.
    if (res.status === 401) {
      try {
        sessionStorage.setItem("cc_expired", err.code === "IDLE_TIMEOUT" ? "idle" : "expired");
      } catch {
        /* private mode */
      }
    }
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export interface Room {
  id: string;
  code: string;
  wing: string;
  openMin: number;
  closeMin: number;
  status: string;
  description?: string;
}

export interface RoomVacancy {
  roomId: string;
  code: string;
  wing: string;
  nowFree: boolean;
  freeBlocks: Array<{ startMin: number; endMin: number }>;
  nextVacant: { startMin: number; endMin: number } | null;
  longestFreeMin: number;
  freeMinutesTotal: number;
  currentBlockEndMin: number | null;
  freeAllDay: boolean;
  freeFromNowMin: number;
}

export const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export const toHHMM = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
