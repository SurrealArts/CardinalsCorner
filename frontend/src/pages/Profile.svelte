<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { session } from "../lib/session";

  if (!session.user) location.hash = "#/login";
  let me = $state<any>(null);
  let name = $state("");
  let department = $state("");
  let current = $state("");
  let next = $state("");
  let msg = $state("");
  let error = $state("");

  onMount(async () => {
    me = await api("/auth/me");
    name = me.name;
    department = me.department ?? "";
  });

  async function save() {
    error = ""; msg = "";
    try {
      me = await api("/auth/profile", { method: "PATCH", body: JSON.stringify({ name, department }) });
      msg = "Profile saved.";
    } catch (e) { error = (e as Error).message; }
  }
  async function changePw() {
    error = ""; msg = "";
    try {
      await api("/auth/password", { method: "PATCH", body: JSON.stringify({ current, next }) });
      msg = "Password changed.";
      current = ""; next = "";
    } catch (e) { error = (e as Error).message; }
  }
</script>

<div class="card">
  <h1>Profile</h1>
  {#if me}
    <p class="muted">{me.email} · {me.role} (email and role are read-only)</p>
    <div class="row">
      <div class="field"><label>Name</label><input bind:value={name} /></div>
      <div class="field"><label>Department</label><input bind:value={department} /></div>
      <div class="field"><label>&nbsp;</label><button class="primary" onclick={save}>Save</button></div>
    </div>
    <h2>Change password</h2>
    <div class="row">
      <div class="field"><label>Current</label><input type="password" bind:value={current} /></div>
      <div class="field"><label>New (8+ chars)</label><input type="password" bind:value={next} /></div>
      <div class="field"><label>&nbsp;</label><button class="ghost" onclick={changePw}>Change</button></div>
    </div>
  {/if}
  {#if error}<div class="error">{error}</div>{/if}
  {#if msg}<p class="ok">{msg}</p>{/if}
</div>
