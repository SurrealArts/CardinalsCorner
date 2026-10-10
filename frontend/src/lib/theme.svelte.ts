// Color theme: defaults to the device mode, persists an explicit user
// choice in localStorage, and follows live device changes until the user
// picks a side. Apply via <html data-theme="light|dark"> (see the vars in
// app.css). index.html sets the initial attribute pre-paint to avoid a flash.
export type Theme = "light" | "dark";

const KEY = "cc-theme";
const mq = () =>
  typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

class ThemeState {
  value = $state<Theme>("light");
  private stored = false;

  init() {
    let initial: Theme = "light";
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") {
        initial = saved;
        this.stored = true;
      } else if (mq()?.matches) {
        initial = "dark";
      }
    } catch {
      if (mq()?.matches) initial = "dark";
    }
    this.value = initial;
    this.apply();
    mq()?.addEventListener("change", (e) => {
      if (!this.stored) {
        this.value = e.matches ? "dark" : "light";
        this.apply();
      }
    });
  }

  toggle() {
    this.value = this.value === "dark" ? "light" : "dark";
    this.stored = true;
    try {
      localStorage.setItem(KEY, this.value);
    } catch {
      /* private mode */
    }
    this.apply();
  }

  private apply() {
    document.documentElement.dataset.theme = this.value;
  }
}

export const theme = new ThemeState();
