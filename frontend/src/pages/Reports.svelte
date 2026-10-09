<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { session } from "../lib/session";

  if (!session.user) location.hash = "#/login";

  let terms = $state<any[]>([]);
  let termId = $state("");
  let wing = $state("");
  let from = $state("2026-10-01");
  let to = $state("2026-12-31");
  let report = $state<any>(null);
  let error = $state("");

  onMount(async () => {
    terms = await api<any[]>("/terms").catch(() => []);
    if (terms[0]) termId = terms[0].id;
  });

  async function generate() {
    error = "";
    try {
      report = await api(`/reports/summary?termId=${termId}&wing=${wing}&from=${from}&to=${to}`);
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<div class="card">
  <h1>Reports</h1>
  <p class="muted">Filtered occupancy summaries (scheduled time, not observed use) + reservation status counts.</p>
  <div class="row">
    <div class="field"><label>Term</label><select bind:value={termId}>{#each terms as t}<option value={t.id}>{t.name}</option>{/each}</select></div>
    <div class="field"><label>Wing</label><select bind:value={wing}><option value="">All</option><option>S</option><option>SW</option><option>W</option><option>N</option><option>NW</option><option>AV</option></select></div>
    <div class="field"><label>From</label><input type="date" bind:value={from} /></div>
    <div class="field"><label>To</label><input type="date" bind:value={to} /></div>
    <div class="field"><label>&nbsp;</label><span class="row"><button class="primary" onclick={generate}>Generate</button><button class="ghost" onclick={() => window.print()}>Print summary</button></span></div>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</div>

{#if report}
  <div class="card">
    <h2>Status counts</h2>
    <p>Pending: <strong>{report.statusCounts.PENDING}</strong> · Approved: <strong>{report.statusCounts.APPROVED}</strong> · Rejected: <strong>{report.statusCounts.REJECTED}</strong> · Cancelled: <strong>{report.statusCounts.CANCELLED}</strong></p>
    <h2>Room occupancy (approved minutes in range)</h2>
    <table>
      <thead><tr><th>Room</th><th>Capacity</th><th>Approved min</th></tr></thead>
      <tbody>
        {#each report.rooms.slice(0, 100) as r}<tr><td>{r.code}</td><td>{r.capacity}</td><td>{r.approvedMinutes}</td></tr>{/each}
      </tbody>
    </table>
  </div>
{/if}
