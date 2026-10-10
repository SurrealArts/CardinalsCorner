<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { session } from "../lib/session";

  // Invisible admin page (unlinked from the nav): the single backend auth for
  // schedule maintenance — new terms and per-term CSV schedule imports.
  let user = $state(session.user);
  let email = $state("");
  let password = $state("");
  let error = $state("");
  let notice = $state("");
  let busy = $state(false);

  let terms = $state<any[]>([]);
  let newTerm = $state({ name: "", startDate: "", endDate: "", periodMin: 90, dayStartMin: "07:30", dayEndMin: "21:00" });
  let editingTermId = $state("");
  let termFilter = $state("");
  let csv = $state("room_code,course,section,professor,weekday,start,end,term_name\nSW305,ECEA101,B14,\"Dela Cruz, J.\",Tue,13:00,14:30,1T-2026-2027");
  let importResult = $state("");

  let schedSearch = $state("");
  let schedPage = $state(1);
  const SCHED_LIMIT = 50;
  let schedTotal = $state(0);
  let schedules = $state<any[]>([]);

  let users = $state<any[]>([]);
  let resettingId = $state("");
  let newPw = $state("");
  let accountsMsg = $state("");

  async function loadUsers() {
    users = await api<any[]>("/users").catch(() => []);
  }

  async function resetPassword(id: string) {
    error = "";
    accountsMsg = "";
    try {
      const r = await api<{ ok: boolean; revoked: number }>(`/users/${id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword: newPw }),
      });
      accountsMsg = `Password reset. ${r.revoked} other session(s) signed out. Relay the new password securely.`;
      resettingId = "";
      newPw = "";
      await loadUsers();
    } catch (e) {
      await handleError(e);
    }
  }

  async function revokeAll(id: string) {
    error = "";
    accountsMsg = "";
    try {
      const r = await api<{ revoked: number }>(`/users/${id}/revoke-sessions`, { method: "POST" });
      accountsMsg = `${r.revoked} session(s) signed out.`;
    } catch (e) {
      await handleError(e);
    }
  }

  async function refreshAll() {
    try {
      terms = await api<any[]>("/terms");
    } catch {
      user = null;
      return;
    }
    if (!termFilter && terms[0]) termFilter = terms[0].id;
    await loadSchedules();
    if (user?.role === "ADMIN") await loadUsers();
  }

  async function loadSchedules() {
    if (!termFilter) { schedules = []; schedTotal = 0; return; }
    try {
      const q = new URLSearchParams({ termId: termFilter, page: String(schedPage), limit: String(SCHED_LIMIT) });
      if (schedSearch.trim()) q.set("search", schedSearch.trim());
      const r = await api<{ total: number; items: any[] }>(`/schedules?${q}`);
      schedules = r.items;
      schedTotal = r.total;
    } catch {
      schedules = [];
      schedTotal = 0;
    }
  }

  const schedPages = $state({ from: 0, to: 0, total: 0, max: 0 });

  async function schedGo(page: number) {
    schedPage = page;
    await loadSchedules();
    syncSchedMeta();
  }
  function syncSchedMeta() {
    const pages = Math.max(1, Math.ceil(schedTotal / SCHED_LIMIT));
    schedPages.total = schedTotal;
    schedPages.max = pages;
    const window = 4;
    const from = Math.max(1, Math.min(schedPage - window, pages - window * 2));
    schedPages.from = Math.min(schedPage - 2, from);
    schedPages.to = Math.min(schedPage + 2, pages);
  }
  $effect(() => { syncSchedMeta(); });

  async function handleError(e: unknown) {
    error = (e as Error).message;
    await session.refresh();
    user = session.user;
  }

  async function login(e: Event) {
    e.preventDefault();
    error = "";
    busy = true;
    try {
      await session.login(email, password);
      user = session.user;
      await refreshAll();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const toHHMM = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

  async function createTerm() {
    error = "";
    try {
      const body = {
        name: newTerm.name,
        startDate: newTerm.startDate,
        endDate: newTerm.endDate,
        periodMin: Number(newTerm.periodMin),
        dayStartMin: toMin(newTerm.dayStartMin),
        dayEndMin: toMin(newTerm.dayEndMin),
      };
      const t = editingTermId
        ? await api<any>(`/terms/${editingTermId}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<any>("/terms", { method: "POST", body: JSON.stringify(body) });
      termFilter = t.id;
      cancelEdit();
      await refreshAll();
    } catch (e) {
      await handleError(e);
    }
  }

  function editSelected() {
    const t = terms.find((x) => x.id === termFilter);
    if (!t) return;
    newTerm = {
      name: t.name,
      startDate: t.startDate.slice(0, 10),
      endDate: t.endDate.slice(0, 10),
      periodMin: t.periodMin,
      dayStartMin: toHHMM(t.dayStartMin),
      dayEndMin: toHHMM(t.dayEndMin),
    };
    editingTermId = t.id;
  }

  function cancelEdit() {
    editingTermId = "";
    newTerm = { name: "", startDate: "", endDate: "", periodMin: 90, dayStartMin: "07:30", dayEndMin: "21:00" };
  }

  async function runImport() {
    error = "";
    importResult = "";
    try {
      const termName = terms.find((t) => t.id === termFilter)?.name;
      const r = await api<{ created: number; errors: string[]; warnings?: string[] }>("/schedules/import", {
        method: "POST",
        body: JSON.stringify({ csv, termName }),
      });
      const warn = r.warnings?.length ? ` ${r.warnings.length} warning(s): ${r.warnings.slice(0, 5).join(" | ")}` : "";
      importResult = `Imported ${r.created} schedule(s), ${r.errors.length} error(s).${r.errors.length ? " " + r.errors.slice(0, 10).join(" | ") : ""}${warn}`;
      await refreshAll();
    } catch (e) {
      await handleError(e);
    }
  }

  async function removeSchedule(id: string) {
    error = "";
    try {
      await api(`/schedules/${id}`, { method: "DELETE" });
      await loadSchedules();
      syncSchedMeta();
    } catch (e) {
      await handleError(e);
    }
  }

  onMount(() => {
    try {
      const flag = sessionStorage.getItem("cc_expired");
      sessionStorage.removeItem("cc_expired");
      if (flag === "idle") notice = "Signed out for inactivity. Please sign in again.";
      else if (flag) notice = "Session ended. Please sign in again.";
    } catch {
      /* private mode */
    }
    session.refresh().then(() => {
      user = session.user;
      if (user) refreshAll();
    });
    return session.subscribe(() => {
      user = session.user;
    });
  });
</script>

{#if !user}
  <div class="card">
    <h1>Admin sign in</h1>
    {#if notice}<p class="muted">{notice}</p>{/if}
    <form onsubmit={login}>
      <div class="row">
        <div class="field"><label for="a-email">Email</label><input id="a-email" type="email" bind:value={email} required /></div>
        <div class="field"><label for="a-pw">Password</label><input id="a-pw" type="password" bind:value={password} required /></div>
      </div>
      <p><button class="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></p>
    </form>
    {#if error}<div class="error">{error}</div>{/if}
  </div>
{:else if user.role !== "ADMIN"}
  <div class="card">
    <h1>Not authorized</h1>
    <p><button class="ghost" onclick={() => { session.logout(); user = null; }}>Sign out</button></p>
  </div>
{:else}
  <div class="card">
    <h1>Schedule maintenance</h1>
    <p class="muted">Signed in as {user.name} · <button class="ghost" onclick={() => { session.logout(); user = null; location.hash = "#/"; }}>Sign out</button></p>
    {#if error}<div class="error">{error}</div>{/if}
  </div>

  <div class="card">
    <h2>Terms</h2>
    <table>
      <thead><tr><th>Name</th><th>Start</th><th>End</th><th>Period</th><th>Day start</th><th>Day end</th></tr></thead>
      <tbody>
        {#each terms as t}
          <tr>
            <td><strong>{t.name}</strong></td>
            <td>{t.startDate.slice(0, 10)}</td>
            <td>{t.endDate.slice(0, 10)}</td>
            <td>{t.periodMin} min</td>
            <td>{toHHMM(t.dayStartMin)}</td>
            <td>{toHHMM(t.dayEndMin)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="card">
    <h2>{editingTermId ? "Edit term" : "New term"}</h2>
    <div class="row">
      <div class="field"><label for="a-tname">Name</label><input id="a-tname" bind:value={newTerm.name} placeholder="2T-2026-2027" /></div>
      <div class="field"><label for="a-tfrom">Starts</label><input id="a-tfrom" type="date" bind:value={newTerm.startDate} /></div>
      <div class="field"><label for="a-tto">Ends</label><input id="a-tto" type="date" bind:value={newTerm.endDate} /></div>
      <div class="field"><label for="a-period">Period (min)</label><input id="a-period" type="number" min="20" max="240" bind:value={newTerm.periodMin} /></div>
      <div class="field"><label for="a-daystart">Earliest class</label><input id="a-daystart" type="time" bind:value={newTerm.dayStartMin} /></div>
      <div class="field"><label for="a-dayend">Latest class end</label><input id="a-dayend" type="time" bind:value={newTerm.dayEndMin} /></div>
      <div class="field"><span class="spacer" aria-hidden="true">&nbsp;</span>
        <span class="row">
          <button class="primary" onclick={createTerm}>{editingTermId ? "Save term" : "Add term"}</button>
          {#if editingTermId}<button class="ghost" onclick={cancelEdit}>Cancel</button>
          {:else}<button class="ghost" onclick={editSelected}>Edit selected</button>{/if}
        </span>
      </div>
    </div>
    <div class="row" style="margin-top:.8rem">
      <div class="field"><label for="a-term">Working term</label>
        <select id="a-term" bind:value={termFilter} onchange={async () => { schedPage = 1; await refreshAll(); }}>
          {#each terms as t}<option value={t.id}>{t.name}</option>{/each}
        </select>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>CSV schedule import</h2>
    <p class="muted">Header: <code>room_code,course,section,professor,weekday,start,end[,term_name]</code>.
      Rows without <code>term_name</code> go to the selected term above.
      Sanitized: course like <code>ECEA101</code>, section like <code>B14</code>, weekday 0–6 or Mon…Sun,
      times within the term's earliest/latest. Verified against existing schedules
      and within the batch for overlaps. Durations differing from the term's period length are accepted with a warning.</p>
    <textarea rows="6" style="width:100%" bind:value={csv} aria-label="Schedule CSV"></textarea>
    <p><button class="primary" onclick={runImport}>Import</button></p>
    {#if importResult}<p>{importResult}</p>{/if}
  </div>

  <div class="card">
    <h2>Schedules in term ({schedTotal})</h2>
    <div class="row">
      <div class="field"><label for="s-search">Search</label>
        <input id="s-search" bind:value={schedSearch} placeholder="Course, section, professor, room…" onchange={async () => { schedPage = 1; await loadSchedules(); syncSchedMeta(); }} />
      </div>
    </div>
    <table>
      <thead><tr><th>Room</th><th>Day</th><th>Time</th><th>Course</th><th>Professor</th><th></th></tr></thead>
      <tbody>
        {#each schedules as s}
          <tr>
            <td>{s.room?.code}</td>
            <td>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][s.weekday]}</td>
            <td>{toHHMM(s.startMin)}–{toHHMM(s.endMin)}</td>
            <td>{s.course} {s.section}</td>
            <td>{s.professor}</td>
            <td><button class="ghost" onclick={() => removeSchedule(s.id)}>Delete</button></td>
          </tr>
        {/each}
        {#if schedules.length === 0}
          <tr><td colspan="6" class="muted">No schedules match.</td></tr>
        {/if}
      </tbody>
    </table>
    {#if schedTotal > SCHED_LIMIT}
      <div class="pager">
        <button class="ghost" disabled={schedPage <= 1} onclick={() => schedGo(schedPage - 1)}>← Prev</button>
        <span>Page {schedPage} of {schedPages.max} · {schedTotal} schedules</span>
        <button class="ghost" disabled={schedPage >= schedPages.max} onclick={() => schedGo(schedPage + 1)}>Next →</button>
      </div>
    {/if}
  </div>

  <div class="card">
    <h2>Accounts</h2>
    <p class="muted">Password resets sign out all other sessions. Relay new passwords through a secure channel.</p>
    {#if accountsMsg}<p class="ok">{accountsMsg}</p>{/if}
    <table>
      <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Active</th><th></th></tr></thead>
      <tbody>
        {#each users as u}
          <tr>
            <td>{u.email}</td>
            <td>{u.name}</td>
            <td>{u.role}</td>
            <td>{u.active ? "yes" : "no"}</td>
            <td>
              <span class="row">
                <button class="ghost" onclick={() => { resettingId = u.id; newPw = ""; accountsMsg = ""; }}>Reset password</button>
                <button class="ghost" onclick={() => revokeAll(u.id)}>Sign out everywhere</button>
              </span>
              {#if resettingId === u.id}
                <span class="row" style="margin-top:.4rem">
                  <input type="password" placeholder="New password (8+ chars)" bind:value={newPw} aria-label={`New password for ${u.email}`} />
                  <button class="primary" onclick={() => resetPassword(u.id)}>Save</button>
                  <button class="ghost" onclick={() => { resettingId = ""; newPw = ""; }}>Cancel</button>
                </span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .pager {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    justify-content: center;
    margin-top: 0.8rem;
    font-size: 0.85rem;
    color: var(--slate);
  }
  .pager button:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
