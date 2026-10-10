<script lang="ts">
  // No imports needed — this component is rendered inside App.svelte's shared topbar
</script>

<div class="notfound">
  <h1>404</h1>
  <p class="muted">The page you're looking for doesn't exist.</p>
  <a class="btn" href="#/">Back to Mapúa Room Schedules</a>
</div>

<style>
  .notfound {
    text-align: center;
    padding: 4rem 2rem;
  }
  .notfound h1 {
    font-size: 6rem;
    font-weight: 800;
    color: var(--brand);
    margin: 0 0 0.5rem;
  }
  .notfound p {
    font-size: 1.2rem;
    color: var(--slate);
    margin: 0 0 2rem;
  }
  .btn {
    display: inline-block;
    background: var(--brand);
    color: white;
    border: 0;
    border-radius: 999px;
    padding: 0.7rem 1.5rem;
    font-weight: 700;
    font-family: var(--heading);
    letter-spacing: 0.04em;
    text-decoration: none;
  }
  .btn:hover {
    background: var(--brand-dark);
  }
</style>