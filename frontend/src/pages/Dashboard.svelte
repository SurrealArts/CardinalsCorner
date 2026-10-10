<script lang="ts">
  import { onMount } from "svelte";
  import { api, toHHMM, type Room, type RoomVacancy } from "../lib/api";

  // Public schedule catalog: no sign-in. Pick a date, filter rooms, compare
  // up to 6 side-by-side with occupied classes and free blocks.
  let rooms = $state<Room[]>([]);
  let search = $state("");
  let wing = $state("");
  let typeFilter = $state("");
  let date = $state(new Date().toISOString().slice(0, 10));
  let selected = $state<string[]>([]);
  let results = $state<RoomVacancy[]>([]);
  let error = $state("");
  let busy = $state(false);

  async function load() {
    error = "";
    try {
      const q = new URLSearchParams({ search, wing, type: typeFilter, status: "ACTIVE" });
      rooms = await api<Room[]>(`/rooms?${q}`);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function compare() {
    error = "";
    busy = true;
    try {
      const q = new URLSearchParams({ date, roomIds: selected.join(","), at: "now" });
      results = await api<RoomVacancy[]>(`/vacancy?${q}`);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(0, 6);
  }

  const fmtRange = (s: number, e: number) => `${toHHMM(s)}–${toHHMM(e)}`;

  onMount(load);
</script>

<div class="card">
  <h1>Class schedules</h1>
  <p class="muted">{rooms.length} rooms · Intramuros · select up to 6 rooms to compare side-by-side</p>
  <div class="row">
    <div class="field"><label for="f-search">Search code</label><input id="f-search" bind:value={search} placeholder="SW305" oninput={load} /></div>
    <div class="field"><label for="f-wing">Wing</label>
      <select id="f-wing" bind:value={wing} onchange={load}>
        <option value="">All</option><option>S</option><option>SW</option><option>W</option><option>N</option><option>NW</option><option>NB</option><option>SB</option><option>AV</option><option>SMART</option><option>OTHER</option>
      </select>
    </div>
    <div class="field"><label for="f-cap">Type</label><input id="f-cap" bind:value={typeFilter} placeholder="classroom" oninput={load} /></div>
    <div class="field"><label for="f-date">Date</label><input id="f-date" type="date" bind:value={date} /></div>
    <div class="field"><span class="spacer" aria-hidden="true">&nbsp;</span><button class="primary" onclick={compare} disabled={busy || selected.length === 0}>Compare selected ({selected.length})</button></div>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</div>

{#if results.length > 0}
  <div class="card">
    <h2>Comparison — {date}</h2>
    <table>
      <thead><tr><th>Room</th><th>Now</th><th>Next vacant</th><th>Free blocks</th></tr></thead>
      <tbody>
        {#each results as r}
          <tr>
            <td><strong><a href={`#/room/${r.roomId}`}>{r.code}</a></strong></td>
            <td class={r.nowFree ? "ok" : "bad"}>{r.nowFree ? "Vacant" : "Occupied"}</td>
            <td>{r.nextVacant ? fmtRange(r.nextVacant.startMin, r.nextVacant.endMin) : "—"}</td>
            <td>{r.freeBlocks.map((b) => fmtRange(b.startMin, b.endMin)).join(", ") || "—"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<div class="card">
  <h2>Rooms</h2>
    <table>
    <thead><tr><th></th><th>Code</th><th>Wing</th><th>Type</th></tr></thead>
    <tbody>
      {#each rooms.slice(0, 100) as r}
        <tr>
          <td><input type="checkbox" checked={selected.includes(r.id)} onchange={() => toggle(r.id)} aria-label={`select ${r.code}`} /></td>
          <td><strong><a href={`#/room/${r.id}`}>{r.code}</a></strong></td>
          <td>{r.wing}</td>
          <td>{r.roomType}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if rooms.length > 100}<p class="muted">Showing 100 of {rooms.length} — refine search.</p>{/if}
</div>
