<script lang="ts">
  import { onMount } from "svelte";
  import { api, toMin, type Availability, type Room } from "../lib/api";
  import { session } from "../lib/session";

  const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
  let rooms = $state<Room[]>([]);
  let roomId = $state(params.get("room") ?? "");
  let date = $state(params.get("date") ?? "2026-10-20");
  let start = $state(params.get("start") ?? "13:00");
  let end = $state(params.get("end") ?? "14:30");
  let count = $state(10);
  let purpose = $state("");
  let check = $state<Availability | null>(null);
  let message = $state("");
  let error = $state("");

  if (!session.user) location.hash = "#/login";

  onMount(async () => {
    rooms = await api<Room[]>("/rooms?status=ACTIVE").catch(() => []);
  });

  async function checkAvail() {
    error = "";
    message = "";
    try {
      check = await api<Availability>(`/availability?roomId=${roomId}&date=${date}&startMin=${toMin(start)}&endMin=${toMin(end)}`);
      message = check.available ? "Interval is available — you may submit the request." : "Interval has conflicts — see details.";
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function submit() {
    error = "";
    message = "";
    try {
      const r = await api("/reservations", {
        method: "POST",
        body: JSON.stringify({ roomId, date, startMin: toMin(start), endMin: toMin(end), participantCount: count, purpose }),
      });
      message = `Request submitted (Pending). ID ${(r as { id: string }).id}. Approval is required — pending does not hold the room.`;
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<div class="card">
  <h1>Reservation request</h1>
  <p class="muted">Check availability first, then submit. Approval is required; pending does not hold the room.</p>
  <div class="row">
    <div class="field"><label for="r-room">Room</label>
      <select id="r-room" bind:value={roomId}>
        <option value="">— choose —</option>
        {#each rooms.slice(0, 300) as r}<option value={r.id}>{r.code} (cap {r.capacity})</option>{/each}
      </select>
    </div>
    <div class="field"><label for="r-date">Date</label><input id="r-date" type="date" bind:value={date} /></div>
    <div class="field"><label for="r-start">Start</label><input id="r-start" type="time" bind:value={start} /></div>
    <div class="field"><label for="r-end">End</label><input id="r-end" type="time" bind:value={end} /></div>
    <div class="field"><label for="r-count">Participants</label><input id="r-count" type="number" min="1" bind:value={count} /></div>
  </div>
  <div class="field" style="margin-top:.6rem"><label for="r-purpose">Activity purpose</label><textarea id="r-purpose" rows="3" bind:value={purpose} placeholder="e.g. CPE106L-4 project meeting"></textarea></div>
  <p class="row">
    <button class="ghost" onclick={checkAvail}>Check availability</button>
    <button class="primary" onclick={submit}>Submit request</button>
  </p>
  {#if error}<div class="error">{error}</div>{/if}
  {#if message}<p>{message}</p>{/if}
  {#if check}
    <h3>Availability result</h3>
    {#if check.conflicts.length === 0}
      <p class="ok">Available</p>
    {:else}
      {#each check.conflicts as c}<div>• <strong>{c.kind}</strong>: {c.label}</div>{/each}
    {/if}
    <h4>Occupied intervals that day</h4>
    {#if check.occupied.length === 0}<p class="muted">Nothing scheduled.</p>{/if}
    {#each check.occupied as o}<div class="muted">• {o.startMin}–{o.endMin}: {o.label}</div>{/each}
  {/if}
</div>
