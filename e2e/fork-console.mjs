/**
 * True for the browser's "Failed to load resource ... 404" console line caused
 * by the fork's own /api/tg/* probes (member identity, per-session info). The
 * single-user e2e server has no members layer, so those answer 404 on purpose.
 */
export function isForkProbe404(event) {
  if (!/status of 404/.test(event.text())) return false;
  try {
    return new URL(event.location().url || "http://x/").pathname.startsWith("/api/tg/");
  } catch {
    return false;
  }
}
