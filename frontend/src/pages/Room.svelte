<script lang="ts">
  import { onMount } from "svelte";
  import { api, toHHMM, type Room } from "../lib/api";

  // Full-week class schedule for one room as a table: columns Mon–Sun,
  // rows by time. Row boundaries come from the server: the term's period
  // grid unioned with actual class edges, so every era renders exactly.
  let { params } = $props();

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const ORDER = [1, 2, 3, 4, 5, 6, 0];

  interface Cell {
    span: number;
    cls: any;
  }

  let room = $state<Room | null>(null);
  let terms = $state<any[]>([]);
  let termId = $state("");
  let term = $state<any>(null);
  let grid = $state<number[]>([]);
  let cells = $state<Record<number, Record<number, Cell | "busy">>>({});
  let error = $state("");

  // Present moment in Philippine time (schedules live in Asia/Manila).
  // Refreshed every 30s so the highlight tracks without a reload.
  const WD_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let nowTick = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (nowTick = Date.now()), 30000);
    return () => clearInterval(t);
  });
  function manilaParts(ts: number) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(new Date(ts));
      const get = (ty: string) => parts.find((p) => p.type === ty)?.value ?? "";
      return { wd: WD_MAP[get("weekday")] ?? -1, min: Number(get("hour")) * 60 + Number(get("minute")) };
    } catch {
      return { wd: -1, min: -1 };
    }
  }
  let nowInfo = $derived(manilaParts(nowTick));
  // Grid row containing the present minute (-1 when outside class hours).
  let nowRow = $derived.by(() => {
    for (let i = 0; i + 1 < grid.length; i++) {
      if (nowInfo.min >= grid[i] && nowInfo.min < grid[i + 1]) return i;
    }
    return -1;
  });

  function pickDefaultTerm(list: any[]) {
    const today = new Date().toISOString().slice(0, 10);
    const current = list.find((t) => t.startDate.slice(0, 10) <= today && today <= t.endDate.slice(0, 10));
    return (current ?? list[0])?.id ?? "";
  }

  async function loadRoom(id: string) {
    error = "";
    room = null;
    cells = {};
    grid = [];
    try {
      room = await api<Room>(`/rooms/${id}`);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function loadTimetable(id: string) {
    if (!termId) return;
    try {
      const t = await api<any>(`/rooms/${id}/timetable?${new URLSearchParams({ termId })}`);
      term = t.term;
      grid = t.grid;
      const map: Record<number, Record<number, Cell | "busy">> = {};
      for (const c of t.classes as any[]) {
        const from = grid.indexOf(c.startMin);
        const to = grid.indexOf(c.endMin);
        if (from === -1 || to <= from) continue;
        map[c.weekday] ??= {};
        map[c.weekday][from] = { span: to - from, cls: c };
        for (let i = from + 1; i < to; i++) map[c.weekday][i] = "busy";
      }
      cells = map;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  onMount(async () => {
    terms = await api<any[]>("/terms").catch(() => []);
    termId = pickDefaultTerm(terms);
    import("../lib/session").then(({ session }) => session.refresh());
  });

  // Room header loads immediately (even with no terms yet); the timetable
  // follows once a term is selected.
  $effect(() => {
    loadRoom(params.id);
  });
  $effect(() => {
    if (room && termId) loadTimetable(room.id);
  });
</script>

<p><a href="#/">← All rooms</a></p>

{#if room}
  <div class="card">
    <h1>{room.code}</h1>
    <p class="muted">
      {room.wing}{room.description ? ` · ${room.description}` : ""}{term
        ? ` · ${term.name} (${term.periodMin}-min periods)`
        : ""}
    </p>
    <div class="row">
      {#if terms.length > 0}
        <div class="field"><label for="r-term">Term</label>
          <select id="r-term" bind:value={termId}>
            {#each terms as t}<option value={t.id}>{t.name}</option>{/each}
          </select>
        </div>
      {:else}
        <p class="muted">No terms yet — schedules appear once a term is opened.</p>
      {/if}
    </div>
    {#if error}<div class="error">{error}</div>{/if}
  </div>

  <div class="card timescroll">
    <h2>Weekly schedule</h2>
    {#if !termId}
      <p class="muted">Select a term to view its classes.</p>
    {:else if grid.length < 2}
      <p class="muted">No classes scheduled this term.</p>
    {:else}
      <table class="ttable">
        <thead><tr><th class="timecol">Time</th>{#each DAYS as d, di}<th class={ORDER[di] === nowInfo.wd ? "nowcol" : ""}>{d}</th>{/each}</tr></thead>
        <tbody>
          {#each grid.slice(0, -1) as start, i}
            {@const end = grid[i + 1]}
            {@const h = Math.max(30, Math.round((end - start) * 0.55))}
            {@const isNowRow = i === nowRow}
            <tr style={`height:${h}px`} class={isNowRow ? "nowrow" : ""}>
              <td class="timecol muted">{toHHMM(grid[i])}–{toHHMM(end)}{#if isNowRow} <span class="nowchip">now</span>{/if}</td>
              {#each ORDER as wd}
                {@const cell = cells[wd]?.[i]}
                {@const isNowCol = wd === nowInfo.wd}
                {@const cls = isNowCol && isNowRow ? "nowcol nowcore" : isNowCol ? "nowcol" : ""}
                {#if cell === "busy"}{:else if cell}
                  <td rowspan={cell.span} class={cls}><strong>{cell.cls.course} {cell.cls.section}</strong><br /><span class="muted">{cell.cls.professor}</span></td>
                {:else}
                  <td class={cls}></td>
                {/if}
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{:else if error}
  <div class="card"><div class="error">{error}</div></div>
{:else}
  <div class="card"><p class="muted">Loading…</p></div>
{/if}

<style>
  /* Timetable: fixed layout, equal day columns, compact duration-proportional
     rows, centered content. min-width + horizontal scroll keeps it zoom-like
     on mobile (no reflow). */
  .timescroll {
    overflow-x: auto;
  }
  .timescroll :global(.ttable) {
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
    min-width: 880px;
    width: 100%;
  }
  .timescroll :global(.ttable th),
  .timescroll :global(.ttable td) {
    vertical-align: middle;
    overflow-wrap: anywhere;
  }
  .timescroll :global(.timecol) {
    width: 110px;
  }
  /* Present-moment highlight, calendar-style: soft highlighter wash over
     today's column and the current time row, gold rules enclosing both,
     and a deeper tint + "now" chip where they intersect. Kept pale. */
  .timescroll :global(.ttable th.nowcol),
  .timescroll :global(.ttable td.nowcol) {
    background: var(--now-wash);
    border-left: 2px solid var(--now-line);
    border-right: 2px solid var(--now-line);
  }
  .timescroll :global(.ttable tr.nowrow > td) {
    background: var(--now-wash);
    border-top: 1px solid var(--now-line);
    border-bottom: 1px solid var(--now-line);
  }
  .timescroll :global(.ttable td.nowcore) {
    background: var(--now-core);
    box-shadow: inset 0 0 0 2px var(--now-line);
  }
  .timescroll :global(.nowchip) {
    display: inline-block;
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    background: var(--now-line);
    color: #222;
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
    margin-left: 0.35rem;
    vertical-align: middle;
  }
</style>
