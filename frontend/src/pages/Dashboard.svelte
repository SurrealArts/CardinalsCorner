<script lang="ts">
  import { onMount } from "svelte";
  import { api, toHHMM, type RoomVacancy } from "../lib/api";

  // Public vacant-room browser: pick a date, search by code, filter by
  // vacancy duration, browse the five buildings. Status badges are live
  // vacancy for the chosen date (now when the date is today).
  const BUILDINGS = [
    { wing: "S", label: "SOUTH", name: "South Building", color: "#fbc638", inkDark: true },
    { wing: "SW", label: "SOUTHWEST", name: "Southwest Building", color: "#ea7b2d", inkDark: true },
    { wing: "W", label: "WEST", name: "West Building", color: "#da3022", inkDark: false },
    { wing: "NW", label: "NORTHWEST", name: "Northwest Building", color: "#7c3aed", inkDark: false },
    { wing: "N", label: "NORTH", name: "North Building", color: "#22b3da", inkDark: true },
  ];
  const OTHER_WINGS = ["NB", "SB", "AV", "SMART", "OTHER"];
  const PREVIEW = 3;

  type Filter = "now" | "1h" | "2h" | "3h" | "custom" | "day";
  const FILTERS: Array<{ key: Filter; label: string }> = [
    { key: "now", label: "Vacant now" },
    { key: "1h", label: "1 hour" },
    { key: "2h", label: "2 hours" },
    { key: "3h", label: "3 hours" },
    { key: "custom", label: "Custom" },
    { key: "day", label: "Whole day" },
  ];

  let search = $state("");
  let date = $state(new Date().toISOString().slice(0, 10));
  let activeWing = $state("");
  let filter = $state<Filter | null>(null);
  let customMin = $state(120);
  let rooms = $state<RoomVacancy[]>([]);
  let roomsChecked = $state(0);
  let roomsFreeNow = $state(0);
  let error = $state("");
  let busy = $state(false);

  async function run() {
    error = "";
    busy = true;
    try {
      const q = new URLSearchParams({ date, at: "now" });
      const t = await api<{ roomsChecked: number; roomsFreeNow: number; rooms: RoomVacancy[] }>(
        `/vacancy/tally?${q}`
      );
      rooms = t.rooms;
      roomsChecked = t.roomsChecked;
      roomsFreeNow = t.roomsFreeNow;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function qualifies(r: RoomVacancy): boolean {
    if (filter == null) return true;
    switch (filter) {
      case "now": return r.nowFree;
      case "1h": return r.freeFromNowMin >= 60;
      case "2h": return r.freeFromNowMin >= 120;
      case "3h": return r.freeFromNowMin >= 180;
      case "custom": return r.freeFromNowMin >= customMin;
      case "day": return r.freeAllDay;
    }
  }

  const matches = (r: RoomVacancy) =>
    !search.trim() || r.code.toLowerCase().includes(search.trim().toLowerCase());

  const forWing = (wing: string) => rooms.filter((r) => r.wing === wing && matches(r) && qualifies(r));
  const otherRooms = () => rooms.filter((r) => OTHER_WINGS.includes(r.wing) && matches(r) && qualifies(r));
  const shownBuildings = () =>
    activeWing ? BUILDINGS.filter((b) => b.wing === activeWing) : BUILDINGS;

  function pillStyle(b: (typeof BUILDINGS)[number], active: boolean) {
    return active
      ? `background:${b.color};border-color:${b.color};color:${b.inkDark ? "#222" : "#fff"}`
      : `background:var(--card);border-color:${b.color};color:${b.color}`;
  }

  function untilText(r: RoomVacancy): string {
    if (r.currentBlockEndMin == null) return "";
    return r.nowFree ? `Vacant until ${toHHMM(r.currentBlockEndMin)}` : `Occupied until ${toHHMM(r.currentBlockEndMin)}`;
  }

  onMount(run);
</script>

<form
  class="searchbar"
  onsubmit={(e) => {
    e.preventDefault();
    run();
  }}
>
  <div class="seg">
    <label for="q-rooms">Rooms</label>
    <input id="q-rooms" bind:value={search} placeholder="Available rooms" />
  </div>
  <div class="seg">
    <label for="q-date">Date</label>
    <input id="q-date" type="date" bind:value={date} onchange={run} />
  </div>
  <button class="primary" type="submit" disabled={busy}>SEARCH ⌕</button>
</form>

<div class="filters">
  {#each FILTERS as f}
    <button
      class="chip"
      class:active={filter === f.key}
      onclick={() => (filter = filter === f.key ? null : f.key)}
    >
      {f.label}
    </button>
  {/each}
  {#if filter === "custom"}
    <div class="custom">
      <label for="custom-min">Minutes</label>
      <input id="custom-min" type="number" min="15" step="15" bind:value={customMin} />
    </div>
  {/if}
</div>

<div class="head">
  <div>
    <h1>Mapúa Room Schedules</h1>
    <p class="total"><strong>{roomsFreeNow} of {roomsChecked} vacant now</strong>{busy ? " · updating…" : ""}</p>
  </div>
</div>
{#if error}<div class="error">{error}</div>{/if}

<div class="pills" role="tablist" aria-label="Buildings">
  {#each BUILDINGS as b}
    <button
      class="pill"
      style={pillStyle(b, activeWing === b.wing)}
      onclick={() => (activeWing = activeWing === b.wing ? "" : b.wing)}
    >
      {b.label}
    </button>
  {/each}
</div>

{#each shownBuildings() as b}
  {@const list = forWing(b.wing)}
  {@const free = list.filter((r) => r.nowFree).length}
  {@const preview = activeWing === b.wing ? list : list.slice(0, PREVIEW)}
  <section class="building">
    <span class="tag" style={`background:${b.color};color:${b.inkDark ? "#222" : "#fff"}`}>
      {b.label} BUILDING
    </span>
    <span class="bcount muted">{free} of {list.length} vacant</span>
    <div class="cards">
      {#each preview as r}
        <a class="roomcard" href={`#/room/${r.roomId}`}>
          <span class={r.nowFree ? "badge vacant" : "badge occupied"}>
            {r.nowFree ? "VACANT" : "OCCUPIED"}
          </span>
          <span class="code">{r.code}</span>
          <span class="until">{untilText(r)}</span>
          <span class="sub muted">{b.name}</span>
        </a>
      {/each}
      {#if !activeWing && list.length > PREVIEW}
        <button class="roomcard seeall" onclick={() => (activeWing = b.wing)}>
          <span class="stack" aria-hidden="true"><i></i><i></i></span>
          <span class="code">See All</span>
          <span class="sub muted">{list.length} rooms</span>
        </button>
      {/if}
      {#if list.length === 0}
        <p class="muted">No rooms match{search ? ` "${search}"` : ""} in {b.name}.</p>
      {/if}
    </div>
  </section>
{/each}

{#if !activeWing && otherRooms().length > 0}
  {@const others = otherRooms()}
  <section class="building">
    <span class="tag" style="background:var(--card);color:var(--ink);border:2px solid var(--ink)">MORE ROOMS</span>
    <span class="bcount muted">{others.filter((r) => r.nowFree).length} of {others.length} vacant</span>
    <div class="cards">
      {#each others.slice(0, 8) as r}
        <a class="roomcard" href={`#/room/${r.roomId}`}>
          <span class={r.nowFree ? "badge vacant" : "badge occupied"}>
            {r.nowFree ? "VACANT" : "OCCUPIED"}
          </span>
          <span class="code">{r.code}</span>
          <span class="until">{untilText(r)}</span>
          <span class="sub muted">{r.wing}</span>
        </a>
      {/each}
    </div>
  </section>
{/if}

<style>
  .searchbar {
    display: flex;
    align-items: stretch;
    gap: 0.2rem;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.35rem 0.35rem 0.35rem 1.2rem;
    box-shadow: 0 8px 24px rgba(34, 34, 34, 0.06);
    margin-bottom: 1rem;
    max-width: 760px;
  }
  .seg {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex: 1;
    min-width: 0;
    padding: 0 1rem;
  }
  .seg + .seg {
    border-left: 2px solid var(--line);
  }
  .seg label {
    font-weight: 700;
    font-size: 0.85rem;
  }
  .seg input {
    border: 0;
    padding: 0.1rem 0;
    font-size: 0.85rem;
    color: var(--slate);
    background: transparent;
    width: 100%;
  }
  .seg input:focus {
    outline: none;
  }
  .filters {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 1.2rem;
  }
  .chip {
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--slate);
    border-radius: 999px;
    padding: 0.4rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .chip.active {
    background: var(--brand);
    border-color: var(--brand);
    color: white;
  }
  .custom {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .custom label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--slate);
  }
  .custom input {
    width: 70px;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    font-size: 0.85rem;
  }
  .head h1 {
    font-size: 1.9rem;
  }
  .total {
    font-size: 1.05rem;
    margin: 0 0 1rem;
    color: var(--slate);
  }
  .total strong {
    color: var(--ink);
    font-weight: 800;
  }
  .pills {
    display: flex;
    gap: 0.8rem;
    justify-content: space-between;
    margin: 0.4rem 0 1.6rem;
    flex-wrap: wrap;
  }
  .pill {
    flex: 1 1 120px;
    border: 2px solid;
    border-radius: 999px;
    padding: 0.65rem 1rem;
    font-family: var(--heading);
    font-weight: 800;
    font-size: 1rem;
    letter-spacing: 0.05em;
    cursor: pointer;
    box-shadow: 0 8px 20px rgba(34, 34, 34, 0.12);
  }
  .building {
    position: relative;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 22px;
    padding: 2.2rem 1.4rem 1.2rem;
    margin-bottom: 1.6rem;
    box-shadow: 0 8px 24px rgba(34, 34, 34, 0.05);
  }
  .tag {
    position: absolute;
    top: -1rem;
    left: 1.2rem;
    font-family: var(--heading);
    font-weight: 800;
    letter-spacing: 0.04em;
    padding: 0.45rem 1.1rem;
    border-radius: 999px;
    box-shadow: 0 6px 16px rgba(34, 34, 34, 0.15);
  }
  .bcount {
    position: absolute;
    top: 0.9rem;
    right: 1.3rem;
    font-size: 0.82rem;
    font-weight: 600;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
  }
  @media (max-width: 640px) {
    .cards {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  .roomcard {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    border: 1px solid #d9d2cb;
    border-radius: 16px;
    padding: 0.9rem 1rem 1rem;
    text-decoration: none;
    color: var(--ink);
    background: var(--surface-2);
    box-shadow: 0 8px 20px rgba(34, 34, 34, 0.08);
    min-height: 150px;
  }
  a.roomcard:hover {
    border-color: var(--brand);
    box-shadow: 0 8px 22px rgba(218, 48, 34, 0.15);
  }
  .badge {
    align-self: flex-start;
    display: inline-block;
    box-sizing: border-box;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    line-height: 1.25;
    border: 2px solid transparent;
    border-radius: 999px;
    padding: 0.25rem 0.7rem;
    margin-bottom: auto;
  }
  .badge.occupied {
    border-color: var(--occupied);
    color: var(--occupied);
    background: var(--card);
  }
  .badge.vacant {
    border-color: var(--vacant);
    background: var(--vacant);
    color: white;
  }
  .code {
    font-family: var(--heading);
    font-weight: 800;
    font-size: 1.35rem;
  }
  .until {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--slate);
  }
  .sub {
    font-size: 0.85rem;
  }
  .seeall {
    align-items: center;
    justify-content: center;
    text-align: center;
    cursor: pointer;
    font-family: inherit;
  }
  .stack {
    position: relative;
    width: 64px;
    height: 52px;
    margin-bottom: auto;
  }
  .stack i {
    position: absolute;
    width: 44px;
    height: 44px;
    border: 2px solid #cfc8c0;
    border-radius: 12px;
    background: var(--card);
    box-shadow: 0 6px 14px rgba(34, 34, 34, 0.12);
  }
  .stack i:first-child {
    top: 0;
    left: 2px;
  }
  .stack i:last-child {
    bottom: 0;
    right: 0;
  }
</style>
