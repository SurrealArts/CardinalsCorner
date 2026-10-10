<script lang="ts">
  import Router from "svelte-spa-router";
  import { onMount } from "svelte";
  import { session } from "./lib/session";
  import Login from "./pages/Login.svelte";
  import Dashboard from "./pages/Dashboard.svelte";
  import Reserve from "./pages/Reserve.svelte";
  import Records from "./pages/Records.svelte";
  import Reports from "./pages/Reports.svelte";
  import Profile from "./pages/Profile.svelte";
  import SyncLab from "./pages/SyncLab.svelte";

  const routes = {
    "/": Dashboard,
    "/login": Login,
    "/reserve": Reserve,
    "/records": Records,
    "/reports": Reports,
    "/profile": Profile,
    "/sync-lab": SyncLab,
  };

  let user = $state(session.user);
  // NOTE: never remount <Router> on session updates (e.g. {#key ...}): pages
  // like Dashboard refresh the session in onMount, and remounting would
  // destroy/recreate the page in a loop — killing open dropdowns and wiping
  // page state. The nav below re-renders from `user` alone; pages stay mounted.
  onMount(() => {
    session.refresh();
    return session.subscribe(() => {
      user = session.user;
    });
  });
</script>

<header class="topbar">
  <a class="brand" href="#/">♦ Cardinal's Corner</a>
  <nav>
    {#if user}
      <a href="#/">Dashboard</a>
      <a href="#/reserve">Reserve</a>
      {#if user.role === "ADMIN"}
        <a href="#/records">Records</a>
        <a href="#/reports">Reports</a>
        <a href="#/sync-lab">Sync Lab</a>
      {/if}
      <a href="#/profile">{user.name} ({user.role})</a>
      <button
        onclick={() => {
          session.logout();
          location.hash = "#/login";
        }}>Sign out</button
      >
    {:else}
      <a href="#/login">Sign in</a>
    {/if}
  </nav>
</header>

<main>
  <Router {routes} />
</main>

<style>
  :global(:root) {
    --cardinal: #c8102e;
    --gold: #fcb514;
    --ink: #1c1a1a;
    --muted: #6f6a6a;
    --line: #e8e2e2;
    --bg: #faf7f5;
  }
  :global(body) {
    margin: 0;
    font-family: Inter, system-ui, sans-serif;
    background: var(--bg);
    color: var(--ink);
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.7rem 1.2rem;
    background: var(--cardinal);
    color: white;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .brand {
    color: white;
    font-weight: 800;
    text-decoration: none;
    font-size: 1.1rem;
  }
  nav {
    display: flex;
    gap: 0.8rem;
    align-items: center;
  }
  nav a {
    color: #ffe9ec;
    text-decoration: none;
    font-size: 0.92rem;
  }
  nav a:hover {
    color: white;
    text-decoration: underline;
  }
  nav button {
    background: white;
    color: var(--cardinal);
    border: 0;
    border-radius: 6px;
    padding: 0.35rem 0.7rem;
    cursor: pointer;
    font-weight: 600;
  }
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.4rem 1rem 3rem;
  }
  :global(.card) {
    background: white;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 1rem 1.2rem;
    margin-bottom: 1rem;
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
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    font-size: 0.92rem;
  }
  :global(button.primary) {
    background: var(--cardinal);
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.5rem 0.9rem;
    cursor: pointer;
    font-weight: 600;
  }
  :global(button.ghost) {
    background: white;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.5rem 0.9rem;
    cursor: pointer;
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
    color: var(--muted);
    font-weight: 600;
  }
  :global(.field .spacer) {
    font-size: 0.78rem;
    font-weight: 600;
    visibility: hidden;
    user-select: none;
  }
  :global(.ok) {
    color: #137333;
    font-weight: 700;
  }
  :global(.bad) {
    color: var(--cardinal);
    font-weight: 700;
  }
  :global(.muted) {
    color: var(--muted);
  }
  :global(.error) {
    background: #fdecea;
    border: 1px solid #f5c6c1;
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    margin: 0.6rem 0;
  }
</style>
