// API base: VITE_API_URL in local dev, relative /api in production (same-origin).
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

export function getToken(): string | null {
  return localStorage.getItem("cc_token");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export interface Room {
  id: string;
  code: string;
  wing: string;
  roomType: string;
  capacity: number;
  openMin: number;
  closeMin: number;
  status: string;
  description?: string;
}

export interface Availability {
  roomId: string;
  code: string;
  available: boolean;
  conflicts: Array<{ kind: string; label: string; startMin: number; endMin: number }>;
  occupied: Array<{ startMin: number; endMin: number; label: string }>;
}

export const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export const toHHMM = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
