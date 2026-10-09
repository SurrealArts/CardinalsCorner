<script lang="ts">
  import { api, toMin } from "../lib/api";
  import { session } from "../lib/session";

  if (!session.user) location.hash = "#/login";
  if (session.user && session.user.role !== "ADMIN") location.hash = "#/";

  let roomCode = $state("SW305");
  let date = $state("2026-10-20");
  let start = $state("13:00");
  let end = $state("14:30");
  let result = $state<any>(null);
  let error = $state("");

  const scenarios = [
    { label: "Registrar pushes new class", body: { roomCode: "SW305", termName: "2026-1Q", courseLabel: "CPE106L-4 A1", weekday: 2, startMin: 780, endMin: 870 } },
    { label: "IT closes room for maintenance", body: { roomCode: "SW305", date: "2026-10-21", startMin: 780, endMin: 975, reason: "Aircon maintenance" } },
    { label: "ILMO approves pending (via sync key)", body: { decision: "APPROVED" } },
  ];

  async function dryRun() {
    error = "";
    result = null;
    try {
      result = await api("/sync/dry-run", { method: "POST", body: JSON.stringify({ roomCode, date, startMin: toMin(start), endMin: toMin(end) }) });
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<div class="card">
  <h1>Sync Lab (simulator)</h1>
  <p class="muted">
    Non-centralized sources (Registrar, IT, ILMO, OSAAR) push schedule/closure/decision updates through the
    auth-required sync API (<code>X-Sync-Key</code> + <code>X-Sync-Source</code>). Use dry-run to preview
    conflicts without saving. Real sync calls use the same validation + conflict checks as the UI.
  </p>
  <div class="row">
    <div class="field"><label>Room code</label><input bind:value={roomCode} /></div>
    <div class="field"><label>Date</label><input type="date" bind:value={date} /></div>
    <div class="field"><label>Start</label><input type="time" bind:value={start} /></div>
    <div class="field"><label>End</label><input type="time" bind:value={end} /></div>
    <div class="field"><label>&nbsp;</label><button class="primary" onclick={dryRun}>Dry-run check</button></div>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
  {#if result}
    <p class={result.available ? "ok" : "bad"}>{result.available ? "Would succeed — no conflicts." : "Would be rejected — conflicts:"}</p>
    {#each result.conflicts as c}<div>• {c.kind}: {c.label}</div>{/each}
  {/if}
  <h2>Example payloads</h2>
  {#each scenarios as s}<pre class="muted">{s.label}: {JSON.stringify(s.body)}</pre>{/each}
  <p class="muted">Send with: <code>curl -X POST $BASE/api/sync/schedules/upsert -H "X-Sync-Key: $KEY" -H "X-Sync-Source: Registrar" -H "Content-Type: application/json" -d '…'</code></p>
</div>
