<script lang="ts">
  import { onMount } from "svelte";
  import { api, toHHMM, type RoomVacancy } from "../lib/api";

  // Full vacant-period tally across the catalog, with handy shortcuts:
  // Vacant now · Free for at least 1 hour · (next vacant period per room).
  let date = $state(new Date().toISOString().slice(0, 10));
  let wing = $state("");
  let minFreeMin = $state(0);
  let tally = $state<{ roomsChecked: number; roomsFreeNow: number; rooms: RoomVacancy[] } | null>(null);
  let error = $state("");
  let busy = $state(false);
  let shortcut = $state<string>("");

  async function run() {
    error = "";
    busy = true;
    try {
      const q = new URLSearchParams({ date, wing, at: "now", minFreeMin: String(minFreeMin) });
      tally = await api(`/vacancy/tally?${q}`);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function vacantNow() {
    shortcut = "now";
    minFreeMin = 0;
    date = new Date().toISOString().slice(0, 10);
    run();
  }
  function freeHour() {
    shortcut = "hour";
    minFreeMin = 60;
    run();
  }
  function allDay() {
    shortcut = "";
    minFreeMin = 0;
    run();
  }

  const fmtRange = (s: number, e: number) => `${toHHMM(s)}–${toHHMM(e)}`;
  const fmtDur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

  onMount(run);
</script>

<div class="card">
  <h1>Vacant periods</h1>
  <p class="row">
    <button class={shortcut === "now" ? "primary" : "ghost"} onclick={vacantNow}>Vacant now</button>
    <button class={shortcut === "hour" ? "primary" : "ghost"} onclick={freeHour}>Free for at least 1 hour</button>
    <button class={shortcut === "" ? "primary" : "ghost"} onclick={allDay}>Whole day</button>
  </p>
  <div class="row">
    <div class="field"><label for="t-date">Date</label><input id="t-date" type="date" bind:value={date} onchange={run} /></div>
    <div class="field"><label for="t-wing">Wing</label>
      <select id="t-wing" bind:value={wing} onchange={run}>
        <option value="">All</option><option>S</option><option>SW</option><option>W</option><option>N</option><option>NW</option><option>NB</option><option>SB</option><option>AV</option><option>SMART</option><option>OTHER</option>
      </select>
    </div>
    <div class="field"><label for="t-min">Min. free block (min)</label><input id="t-min" type="number" min="0" step="15" bind:value={minFreeMin} onchange={run} /></div>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
  {#if tally}<p class="muted">{tally.roomsFreeNow} of {tally.roomsChecked} rooms vacant now · {busy ? "updating…" : ""}</p>{/if}
</div>

{#if tally}
  <div class="card">
    <h2>Tally — {date}</h2>
    <table>
      <thead><tr><th>Room</th><th>Now</th><th>Free total</th><th>Next vacant period</th><th>Free blocks</th></tr></thead>
      <tbody>
        {#each tally.rooms as r}
          <tr>
            <td><strong><a href={`#/room/${r.roomId}`}>{r.code}</a></strong></td>
            <td class={r.nowFree ? "ok" : "bad"}>{r.nowFree ? "Vacant" : "Occupied"}</td>
            <td>{fmtDur(r.freeMinutesTotal)}</td>
            <td>{r.nextVacant ? fmtRange(r.nextVacant.startMin, r.nextVacant.endMin) : "—"}</td>
            <td>{r.freeBlocks.map((b) => fmtRange(b.startMin, b.endMin)).join(", ") || "—"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if tally.rooms.length === 0}<p class="muted">No rooms match — loosen the filters.</p>{/if}
  </div>
{/if}
