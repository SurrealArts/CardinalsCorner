<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { session } from "../lib/session";

  if (!session.user) location.hash = "#/login";
  if (session.user && session.user.role !== "ADMIN") location.hash = "#/";

  let tab = $state<"rooms" | "queue" | "import">("queue");
  let queue = $state<any[]>([]);
  let rooms = $state<any[]>([]);
  let search = $state("");
  let reason = $state("");
  let csv = $state("room_code,course_label,weekday,start,end,term_name\nSW305,CPE106L-4 A1,Mon,13:00,14:30,2026-1Q");
  let importResult = $state("");
  let error = $state("");

  async function loadQueue() {
    queue = await api<any[]>("/reservations/queue/all?status=PENDING");
  }
  async function loadRooms() {
    rooms = await api<any[]>(`/rooms?search=${encodeURIComponent(search)}&status=ALL`);
  }
  async function decide(id: string, action: "approve" | "reject") {
    error = "";
    try {
      await api(`/reservations/${id}/${action}`, { method: "POST", body: JSON.stringify(action === "reject" ? { reason } : {}) });
      await loadQueue();
    } catch (e) {
      error = (e as Error).message;
    }
  }
  async function runImport() {
    error = "";
    importResult = "";
    try {
      const r = await api<{ created: number; errors: string[] }>("/schedules/import", { method: "POST", body: JSON.stringify({ csv }) });
      importResult = `Imported ${r.created} schedule(s). ${r.errors.length} error(s). ${r.errors.join(" | ")}`;
      await loadRooms();
    } catch (e) {
      error = (e as Error).message;
    }
  }
  onMount(async () => {
    await loadQueue();
    await loadRooms();
  });
</script>

<div class="card">
  <h1>Records management</h1>
  <p class="row">
    <button class={tab === "queue" ? "primary" : "ghost"} onclick={() => (tab = "queue")}>Request queue</button>
    <button class={tab === "rooms" ? "primary" : "ghost"} onclick={() => (tab = "rooms")}>Rooms</button>
    <button class={tab === "import" ? "primary" : "ghost"} onclick={() => (tab = "import")}>Schedule import</button>
  </p>
  {#if error}<div class="error">{error}</div>{/if}
</div>

{#if tab === "queue"}
  <div class="card">
    <h2>Pending requests ({queue.length})</h2>
    <div class="field"><label for="rec-reason">Rejection reason (required to reject)</label><input id="rec-reason" bind:value={reason} placeholder="e.g. Room reserved forMake-up class" /></div>
    <table>
      <thead><tr><th>Date</th><th>Room</th><th>Time</th><th>By</th><th>Purpose</th><th></th></tr></thead>
      <tbody>
        {#each queue as q}
          <tr>
            <td>{q.date}</td><td>{q.room?.code}</td><td>{q.startMin}–{q.endMin}</td>
            <td>{q.requester?.name}<br /><span class="muted">{q.requester?.email}</span></td>
            <td>{q.purpose} ({q.participantCount})</td>
            <td class="row"><button class="primary" onclick={() => decide(q.id, "approve")}>Approve</button><button class="ghost" onclick={() => decide(q.id, "reject")}>Reject</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if queue.length === 0}<p class="muted">Queue is empty.</p>{/if}
  </div>
{:else if tab === "rooms"}
  <div class="card">
    <h2>Rooms</h2>
    <div class="row"><div class="field"><label for="rec-search">Search</label><input id="rec-search" bind:value={search} oninput={loadRooms} /></div></div>
    <table>
      <thead><tr><th>Code</th><th>Wing</th><th>Type</th><th>Cap</th><th>Status</th></tr></thead>
      <tbody>
        {#each rooms.slice(0, 100) as r}<tr><td>{r.code}</td><td>{r.wing}</td><td>{r.roomType}</td><td>{r.capacity}</td><td>{r.status}</td></tr>{/each}
      </tbody>
    </table>
  </div>
{:else}
  <div class="card">
    <h2>Per-term schedule import</h2>
    <p class="muted">For site admin / Registrar / IT. Paste CSV with header <code>room_code,course_label,weekday,start,end,term_name</code>. Weekday accepts 0–6 or Mon..Sat; times accept HH:MM or minutes.</p>
    <textarea rows="6" style="width:100%" bind:value={csv}></textarea>
    <p><button class="primary" onclick={runImport}>Import</button></p>
    {#if importResult}<p>{importResult}</p>{/if}
  </div>
{/if}
