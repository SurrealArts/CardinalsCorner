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
    const res = await api<{ user: SessionUser; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem("cc_token", res.token);
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
    localStorage.removeItem("cc_token");
    user = null;
    notify();
  },
};
