/**
 * The seam between the RPC paths and the session-channel client store.
 *
 * Every loader and action response can carry a channel snapshot, so the three
 * RPC paths (`internal/loader-fetch.ts`, `action.ts`, `form.tsx`) have to do
 * *something* with each response's headers. Importing the store directly is
 * what made it unconditional: those three modules are always loaded, so an app
 * that never declares a channel still shipped the store, the wire decoder and
 * the document hydrate (#400, ~445 B gzip on every page of every app).
 *
 * This module is what they import instead. It holds one nullable function and
 * nothing else, so the always-loaded cost is a slot rather than a subsystem.
 * `defineSessionChannel` installs the real implementation when an application
 * actually declares a channel, which is also the only moment the store can
 * matter: with no channel declared there is nothing to publish and nothing to
 * read, so dropping a snapshot is not a loss of behavior.
 *
 * Deliberately import-free. Anything this module imports joins the
 * always-loaded graph with it, which is the cost the seam exists to remove.
 */

/** Consumes the headers of one RPC response. Installed by the store. */
type ChannelSink = (headers: Headers) => void;

let sink: ChannelSink | null = null;

// Whether a response carrying channel headers arrived while the seam was inert.
// Only possible when a channel is declared in a lazily-loaded chunk: the store
// misses those round-trips, so the SSR bootstrap it would otherwise seed from
// is no longer known to be current. See `channelHeadersMissed`.
let missed = false;

/**
 * Point the seam at the real store. Idempotent from the caller's side: the
 * store guards its own install, so repeated `defineSessionChannel()` calls
 * re-register nothing.
 */
export function installChannelSink(fn: ChannelSink): void {
  sink = fn;
}

/**
 * Whether any round-trip was dropped before the store installed.
 *
 * The store uses this to decide whether seeding from the SSR bootstrap is
 * still sound. It is not: a dropped round-trip may have published the very
 * thing the bootstrap now contradicts (a logout, say), and seeding would
 * reinstate the value the response cleared. An empty store instead reads as
 * `undefined`, which the documented client-guard contract treats as UNKNOWN
 * and defers to the server verdict on, rather than as a stale answer it acts on.
 */
export function channelHeadersMissed(): boolean {
  return missed;
}

/** Test-only. Restores the uninstalled state a fresh module graph starts in. */
export function clearChannelSink(): void {
  sink = null;
  missed = false;
}

/**
 * Hand one response's headers to the store, if a channel was ever declared.
 *
 * Takes `Headers` rather than the already-extracted header value so the header
 * name lives with the store instead of at three call sites, which keeps
 * `channel-wire.js` out of the always-loaded graph too.
 */
export function applyChannelHeaders(headers: Headers): void {
  if (sink === null) {
    missed = true;
    return;
  }
  sink(headers);
}
