<script lang="ts">
  import Router from "svelte-spa-router";
  import { onMount } from "svelte";
  import { session } from "./lib/session";
  import { theme } from "./lib/theme.svelte";
  import Dashboard from "./pages/Dashboard.svelte";
  import Room from "./pages/Room.svelte";
  import Admin from "./pages/Admin.svelte";
  import NotFound from "./pages/NotFound.svelte";
  import logoFull from "./assets/logo-full.svg";

  // Public catalog. The admin page is intentionally unlinked (no nav entry):
  // it is the single invisible backend auth for schedule maintenance.
  const routes = {
    "/": Dashboard,
    "/room/:id": Room,
    "/admin": Admin,
    "*": NotFound,
  };

  let user = $state(session.user);

  // Live Philippine-time clock for the ribbon.
  const manilaFmt = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  let clock = $state(Date.now());
  let clockText = $derived(`${manilaFmt.format(new Date(clock))} PHT`);
  // NOTE: never remount <Router> on session updates (e.g. {#key ...}): pages
  // like Dashboard refresh the session in onMount, and remounting would
  // destroy/recreate the page in a loop — killing open dropdowns and wiping
  // page state. The nav below re-renders from `user` alone; pages stay mounted.
  onMount(() => {
    theme.init();
    session.refresh();
    const unsub = session.subscribe(() => {
      user = session.user;
    });
    const tick = setInterval(() => (clock = Date.now()), 1000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  });
</script>

<header class="topbar">
  <a class="brand" href="#/" aria-label="Cardinal's Corner home">
    <img src={logoFull} alt="Cardinal's Corner" />
  </a>
  <nav>
    {#if user}
      <a href="#/admin">{user.name} ({user.role})</a>
      <button
        class="signout"
        onclick={() => {
          session.logout();
          location.hash = "#/";
        }}>Sign out</button
      >
    {/if}
    <span class="clock" title="Philippine Time">{clockText}</span>
    <button
      class="themetoggle"
      onclick={() => theme.toggle()}
      aria-label={theme.value === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme.value === "dark" ? "Light mode" : "Dark mode"}
    >
      {#if theme.value === "dark"}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      {/if}
    </button>
  </nav>
</header>

<main>
  <Router {routes} />
</main>

<style>
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 1.4rem;
    background: var(--card);
    border-bottom: 3px solid var(--brand);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .brand img {
    height: 52px;
    width: auto;
    display: block;
  }
  nav {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  nav a {
    color: var(--ink);
    text-decoration: none;
    font-weight: 700;
    font-size: 0.95rem;
    padding: 0.45rem 0.9rem;
    border-radius: 999px;
  }
  nav a:hover {
    background: var(--hover);
    color: var(--brand);
  }
  .themetoggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    cursor: pointer;
  }
  .themetoggle:hover {
    background: var(--hover);
    color: var(--brand);
  }
  .clock {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--slate);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.4rem 0.8rem;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 720px) {
    .clock {
      display: none;
    }
  }
  .signout {
    background: var(--ink);
    color: var(--bg);
    border: 0;
    border-radius: 999px;
    padding: 0.45rem 0.9rem;
    cursor: pointer;
    font-weight: 700;
  }
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.4rem 1rem 3rem;
  }
  :global(.card) {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 1.1rem 1.3rem;
    margin-bottom: 1.2rem;
    box-shadow: 0 8px 24px rgba(34, 34, 34, 0.06);
  }
  :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  :global(th, td) {
    border-bottom: 1px solid var(--line);
    padding: 0.45rem 0.5rem;
    text-align: left;
  }
  :global(input, select, textarea) {
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: 10px;
    font-size: 0.92rem;
    font-family: var(--body);
    background: var(--input-bg);
    color: var(--ink);
  }
  :global(button.primary) {
    background: var(--brand);
    color: white;
    border: 0;
    border-radius: 999px;
    padding: 0.55rem 1.2rem;
    cursor: pointer;
    font-weight: 700;
    font-family: var(--heading);
    letter-spacing: 0.04em;
  }
  :global(button.primary:hover) {
    background: var(--brand-dark);
  }
  :global(button.primary:disabled) {
    background: var(--mist);
    cursor: default;
  }
  :global(button.ghost) {
    background: var(--card);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.55rem 1.2rem;
    cursor: pointer;
    font-weight: 700;
  }
  :global(.row) {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    align-items: end;
  }
  :global(.field) {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  :global(.field label) {
    font-size: 0.78rem;
    color: var(--slate);
    font-weight: 700;
  }
  :global(.field .spacer) {
    font-size: 0.78rem;
    font-weight: 700;
    visibility: hidden;
    user-select: none;
  }
  :global(.ok) {
    color: var(--vacant);
    font-weight: 700;
  }
  :global(.bad) {
    color: var(--occupied);
    font-weight: 700;
  }
  :global(.muted) {
    color: var(--slate);
  }
  :global(.error) {
    background: var(--error-bg);
    border: 1px solid var(--error-line);
    padding: 0.6rem 0.8rem;
    border-radius: 12px;
    margin: 0.6rem 0;
  }
</style>
