<script lang="ts">
  import { session } from "../lib/session";
  let email = $state("student@mapua.edu.ph");
  let password = $state("");
  let error = $state("");
  let busy = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    error = "";
    busy = true;
    try {
      await session.login(email, password);
      location.hash = "#/";
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="card">
  <h1>Sign in</h1>
  <p class="muted">Use your university account. Accounts are created by an administrator.</p>
  <form onsubmit={submit}>
    <div class="row">
      <div class="field">
        <label for="email">University email</label>
        <input id="email" type="email" bind:value={email} required />
      </div>
      <div class="field">
        <label for="pw">Password</label>
        <input id="pw" type="password" bind:value={password} required />
      </div>
    </div>
    <p><button class="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></p>
  </form>
  {#if error}<div class="error">{error}</div>{/if}
  <p class="muted">Demo seeds: admin@mapua.edu.ph / Admin123! · staff@mapua.edu.ph / Staff123! · student@mapua.edu.ph / Student123!</p>
</div>
