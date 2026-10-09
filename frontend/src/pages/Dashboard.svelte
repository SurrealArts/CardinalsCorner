<script lang="ts">
  import { onMount } from "svelte";
  import { api, toMin, type Availability, type Room } from "../lib/api";
  import { session } from "../lib/session";

  let rooms = $state<Room[]>([]);
  let search = $state("");
  let wing = $state("");
  let minCapacity = $state("");
  let date = $state("2026-10-20");
  let start = $state("13:00");
  let end = $state("14:30");
  let selected = $state<string[]>([]);
  let results = $state<Availability[]>([]);
  let mine = $state<any[]>([]);
  let error = $state("");
  let busy = $state(false);

  if (!session.user) location.hash = "#/login";

  async function load() {
    error = "";
    const q = new URLSearchParams({ search, wing, minCapacity, status: "ACTIVE" });
    rooms = await api<Room[]>(`/rooms?${q}`);
  }

  async function compare() {
    error = "";
    busy = true;
    try {
      results = await api<Availability[]>("/availability/compare", {
        method: "POST",
        body: JSON.stringify({ roomIds: selected, date, startMin: toMin(start), endMin: toMin(end) }),
      });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(0, 6);
  }

  onMount(async () => {
    await session.refresh();
    await load();
    mine = await api<any[]>("/reservations/mine").catch(() => []);
  });
</script>

<div class="card">
  <h1>Dashboard</h1>
  <p class="muted">{rooms.length} active rooms · Intramuros · select up to 6 rooms to compare side-by-side</p>
  <div class="row">
    <div class="field"><label>Search code</label><input bind:value={search} placeholder="SW305" oninput={load} /></div>
    <div class="field"><label>Wing</label>
      <select bind:value={wing} onchange={load}>
        <option value="">All</option><option>S</option><option>SW</option><option>W</option><option>N</option><option>NW</option><option>NB</option><option>SB</option><option>AV</option><option>SMART</option><option>OTHER</option>
      </select>
    </div>
    <div class="field"><label>Min capacity</label><input type="number" min="0" bind:value={minCapacity} onchange={load} /></div>
    <div class="field"><label>Date</label><input type="date" bind:value={date} /></div>
    <div class="field"><label>Start</label><input type="time" bind:value={start} /></div>
    <div class="field"><label>End</label><input type="time" bind:value={end} /></div>
    <div class="field"><label>&nbsp;</label><button class="primary" onclick={compare} disabled={busy || selected.length === 0}>Compare selected ({selected.length})</button></div>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</div>

{#if results.length > 0}
  <div class="card">
    <h2>Comparison — {date} {start}–{end}</h2>
    <table>
      <thead><tr><th>Room</th><th>Status</th><th>Details</th><th></th></tr></thead>
      <tbody>
        {#each results as r}
          <tr>
            <td><strong>{r.code}</strong></td>
            <td class={r.available ? "ok" : "bad"}>{r.available ? "Available" : "Occupied"}</td>
            <td>
              {#if r.conflicts.length === 0}<span class="muted">No conflicts</span>{/if}
              {#each r.conflicts as c}<div>• {c.label}</div>{/each}
            </td>
            <td><a href={`#/reserve?room=${r.roomId}&date=${date}&start=${start}&end=${end}`}>Request</a></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<div class="card">
  <h2>Rooms</h2>
  <table>
    <thead><tr><th></th><th>Code</th><th>Wing</th><th>Type</th><th>Cap</th><th></th></tr></thead>
    <tbody>
      {#each rooms.slice(0, 100) as r}
        <tr>
          <td><input type="checkbox" checked={selected.includes(r.id)} onchange={() => toggle(r.id)} aria-label={`select ${r.code}`} /></td>
          <td><strong>{r.code}</strong></td>
          <td>{r.wing}</td>
          <td>{r.roomType}</td>
          <td>{r.capacity}</td>
          <td><a href={`#/reserve?room=${r.id}&date=${date}&start=${start}&end=${end}`}>Request</a></td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if rooms.length > 100}<p class="muted">Showing 100 of {rooms.length} — refine search.</p>{/if}
</div>

<div class="card">
  <h2>My requests</h2>
  {#if mine.length === 0}<p class="muted">No requests yet.</p>{/if}
  <table>
    <thead><tr><th>Date</th><th>Room</th><th>Time</th><th>Status</th><th>Reason</th></tr></thead>
    <tbody>
      {#each mine as m}
        <tr><td>{m.date}</td><td>{m.room?.code}</td><td>{m.startMin}–{m.endMin}</td><td>{m.status}</td><td class="muted">{m.reason ?? ""}</td></tr>
      {/each}
    </tbody>
  </table>
</div>
