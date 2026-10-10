import { api } from "./api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF" | "STUDENT";
  department?: string | null;
}

let user: SessionUser | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

  async function dropLegacyToken() {
  try {
    localStorage.removeItem("cc_token");
  } catch {
    /* private mode */
  }
}

dropLegacyToken();

export const session = {
  get user() {
    return user;
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  async refresh() {
    try {
      user = await api<SessionUser>("/auth/me");
    } catch {
      user = null;
    }
    notify();
    return user;
  },
  async login(email: string, password: string) {
    // The server authenticates via httpOnly cookie; the response token is for
    // API clients only and is deliberately NOT stored in the browser.
    const res = await api<{ user: SessionUser; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    dropLegacyToken();
    user = res.user;
    notify();
    return user;
  },
  async logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    dropLegacyToken();
    user = null;
    notify();
  },
};
