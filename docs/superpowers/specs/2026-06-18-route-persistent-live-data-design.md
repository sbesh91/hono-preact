# Route-persistent live data: layout persistence + a `live` loader mode

Date: 2026-06-18
Status: Design (validated by prototype spike)
Supersedes the framing of issue #127 (route-independent typed streaming).

## Problem

The persistent demo activity bar (#125) needs a live, server-driven stream
(activity events) and must survive navigation. It was built with a hand-written
`apps/site/src/api.ts` SSE endpoint plus a native `EventSource` because the
bar is mounted via `<Persist>`, which renders it in `PersistHost` **outside the
router**. Outside the router there is no `LocationProvider`, no typed
loader/action RPC, and no declarative scope, so the bar reimplements transport
(URL + `JSON.parse` cast) and tracks its own active-route scope by monkeypatching
`history.pushState`/`popstate`.

Issue #127 proposed a new route-independent streaming primitive (`defineStream` +
`useEventStream`) to close this gap. A prototype spike showed that framing is
larger than necessary: the root problem is that `<Persist>` deliberately escapes
the router, and **escaping the router is exactly what makes typed server comms
hard**. Putting persistent UI *back inside the router* via a scoped layout
dissolves most of the gap.

## Key insight

`<Persist>` was built to keep DOM + JS state alive across navigation by rendering
into a second Preact root (`#__hp_persist_root`, appended to `document.body`) fed
by a module-level registry. But this framework's router **already** preserves a
layout's DOM and state across intra-scope navigation, by design: layout groups
register a shared component reference + `FlatRoute.key` for the bare and wildcard
paths so preact-iso does not remount the layout when the URL crosses between its
children (`packages/iso/src/define-routes.tsx`, `getOrCreateLazyView` /
`makeLayoutGroupComponent`). A component the layout renders as a sibling of
`{children}` therefore persists across the layout's scope, *inside* the router,
with full `LocationProvider` context.

So "persistent UI" = "a UI element in a scoped layout". The layout's route
pattern is the persistence scope (a root/`*` layout for app-wide; a prefix layout
like `/demo/projects` for scoped). This is the model the rest of this spec builds
on.

## Prototype evidence

A throwaway spike (worktree `persist-as-layout-spike`) validated the model:

1. **Persistence works as a layout child (deterministic test).**
   `packages/iso/src/__tests__/spike-layout-child-persist.test.tsx` uses the real
   `defineRoutes`/`Routes` + preact-iso. A component the layout renders alongside
   `{children}` survives intra-scope navigation with **zero remounts** (its
   `useState` and a live "connection" resource both persist), tears down cleanly
   on scope exit (no leaked connections), and remounts fresh on re-entry. (The
   framework already had a sibling test proving a layout's *own* state survives
   intra-group nav; this extends it to the child-component + scope-exit case.)

2. **A typed streaming loader replaces the EventSource (typecheck clean).**
   Moving the activity stream to a streaming loader on `projects-shell.server.ts`
   and consuming it via `serverLoaders.activity.useData()` compiles with **no
   URL, no `EventSource`, no `JSON.parse` cast** — the value is typed
   `ActivityEvent` straight from the generator's yield. Because the loader lives
   on the *layout* module, its location (`deriveLayoutLocation` → `/demo/projects`)
   is stable across `/demo/projects/**`, so the loader runner does not refetch on
   intra-scope navigation: the subscription connects once and persists.

3. **Actions need nothing.** A layout module's `serverActions` are already merged
   into every descendant page's action map via the ancestor walk
   (`collectServerRoutes` / `makePageActionResolvers`). A persistent component in
   the layout POSTs to the current page URL like any action and is gated by the
   layout's own `use`. The `/__actions`-reserved-endpoint / global-exposure
   question only existed because separate-root `Persist` had no meaningful page
   URL to POST to; in the layout model it evaporates.

Two gaps the spike surfaced are what this spec actually builds:

- **Infinite streams vs SSR.** A streaming async-generator loader consumed via
  `.View`/`.Boundary` runs during SSR, and `packages/server/src/render.tsx` only
  closes the streamed document response once **every** generator returns. An
  infinite activity stream never returns, so the document would never finish. The
  spike worked around this with a manual `typeof window` client-only guard +
  `timeoutMs: false`. There is no first-class opt-out today (`DefineLoaderOpts`
  has only `cache`/`params`/`timeoutMs`/`use`).
- **Lossy accumulation.** `useData()` exposes only the *latest* chunk. Building a
  feed from it drops events that arrive between renders. A live feed wants
  fold-over-every-chunk (#127's `reduce`/`initial`).

## Design

Two orthogonal additions to the **existing loader pipeline** (no new
`defineStream` pipeline, no separate semantics for "streams" vs "loaders"), plus
documentation and the removal of `<Persist>`.

### A. `live` loader option

```ts
export const serverLoaders = {
  activity: defineLoader(activityStreamGenerator, { live: true }),
};
```

`live: true` means:

- **Client-only.** The loader is never invoked during SSR. The consumer renders
  its `initial`/`connecting` state on the server and establishes the subscription
  post-hydration. This is what structurally prevents the infinite-generator SSR
  document hang — the generator simply never runs server-side.
- **No timeout by default.** A subscription is long-lived, so the 30s loader
  timeout does not apply (equivalent to today's `timeoutMs: false`). An explicit
  `timeoutMs` still wins if the author wants one.
- **Streaming-only.** `live` on a single-value (non-generator/non-`ReadableStream`)
  loader is a config error; a subscription must be a stream.

It replaces the footgun combo the spike used (`typeof window` guard +
`timeoutMs: false`) with one declarative flag carrying the intent.

`DefineLoaderOpts` gains `live?: boolean`. The loader runner
(`use-loader-runner.tsx` / `loader.tsx`) skips invoking a `live` loader on the
server (`!isBrowser()`), and the SSR streaming collector
(`takeServerStreamingLoaders` in `render.tsx`) must never collect a `live`
loader, so it cannot enter the document stream.

### B. `useStream` accumulator

A consumption hook on the loader ref that folds **every** chunk, orthogonal to
`live` (valid on any streaming loader):

```ts
const { data, status } = activityLoader.useStream({
  reduce: (acc, chunk) => [chunk, ...acc].slice(0, 50),
  initial: [],
  // onChunk?: (chunk) => void   // optional side-effect per chunk
});
// data:   ActivityEvent[]   — typed from the generator's yield
// status: 'connecting' | 'open' | 'closed' | 'error'
// error?: Error
```

- Subscribes at the chunk level (every chunk reaches `reduce`/`onChunk`; nothing
  is coalesced away), unlike `useData()` which exposes only the latest value.
- **Status-driven, not Suspense-based.** A live subscription is better modeled as
  "connecting → open → (closed|error)" that the component branches on, than as a
  Suspense boundary. On the server it returns `initial` + `'connecting'`; the
  client hydrates that and upgrades, so there is no hydration mismatch.
- Inside a layout it reads the layout's stable location from
  `RouteLocationsContext` (keyed by `__moduleKey`), exactly as `LoaderHost` does,
  so it connects once and persists across intra-scope navigation. (Used outside
  any `RouteLocationsProvider` it would need an explicit input/location; that is
  out of scope here — see Non-goals.)
- Reuses the existing client transport (`loader-fetch.ts`'s `text/event-stream`
  reader and the `/__loaders` RPC path); it does not introduce a new wire format.

The loader pipeline keeps one `defineLoader` with two consumption styles matched
to intent: `.View`/`useData` for "data for render" (Suspense, latest value),
`useStream` for "subscription" (status, folded chunks). Same pipeline, one set of
addressing/typing rules.

### C. Persistence is layout placement (docs + dogfood)

Document the blessed pattern: persistent UI lives in a layout scoped to the
routes it should survive. The router's shared-component identity keeps it mounted
across intra-scope navigation and unmounts it on exit; a loader on the layout's
`server` module connects once (stable layout location) and persists across nav.
For app-wide persistence use a root (`*`) layout. Note the action property: a
layout module's `serverActions` reach every descendant page via the ancestor
merge, so persistent components fire actions through the normal page POST under
the layout's guards — no new surface.

Dogfood: migrate the demo activity bar off `<Persist>` into the `projects-shell`
layout (already prototyped) using `live` + `useStream`, and delete the
hand-written `apps/site/src/api.ts` SSE endpoint. The bar becomes a plain child
of `projects-shell.tsx` (sibling of the shell content), scoped to
`/demo/projects/**`, which is exactly its old `isApp` gate — minus the manual
history tracking.

### D. Remove `<Persist>` entirely

`Persist` / `PersistHost` / `PersistProps` are public (shipped since ~v0.4.0) but
have no users now that the demo migrates off them, and the common cases
(prefix-scoped, and app-wide via a root layout) are covered by layouts. Remove
rather than deprecate; document the removal as a breaking change in the next
version's **release notes** (changelog), not in the in-app docs (consistent with
the repo's no-migration-breadcrumbs convention).

Removal surface (enumerated against the spike):

- **Delete:** `packages/iso/src/persist.tsx`,
  `packages/iso/src/internal/persist-registry.ts`,
  `packages/iso/src/__tests__/persist.test.tsx`,
  `packages/iso/src/__tests__/persist-registry.test.ts`.
- **Edit (strip Persist):**
  - `packages/iso/src/index.ts` — remove `Persist`, `PersistHost`, `PersistProps`
    exports.
  - `packages/vite/src/client-entry.ts` — remove the `PersistHost` import and the
    `#__hp_persist_root` separate-root creation + `renderPreact(h(PersistHost,…))`
    block; drop the now-unused `render as renderPreact` import.
  - `packages/iso/src/__tests__/view-transitions-integration.test.tsx` — trim the
    "A+B+C+D fire together" test to A+B+C (drop the `Persist`/`PersistHost` "D"
    leg); View-Transitions coverage otherwise unchanged.
  - `packages/iso/src/__tests__/public-exports.test.ts` and
    `packages/vite/src/__tests__/client-entry.test.ts` — remove the
    Persist/`PersistHost`-mount assertions.
  - `apps/site/src/pages/docs/view-transitions.mdx` — remove the "Persistent
    elements" section; the "four primitives" framing becomes three.
  - `apps/site/src/styles/root.css` — update the one comment referencing the
    "Persist wrapper"; the `.demo-activity-bar` view-transition-name rules stay
    valid (the bar is still persistent, position:fixed UI).
- **Regenerate / verify:** `llms.txt` / `llms-full.txt` (generated from the export
  surface; the exports-coverage and appendix-sync drift gates should pass once the
  export and its doc section are both gone); refresh the committed client-size
  baseline (the runtime shrinks with `PersistHost` removed). The umbrella
  `hono-preact` consolidate picks up the reduced `iso` surface automatically.
- **Unrelated, do not touch:** `apps/site/wrangler.jsonc`'s `"persist": true`
  (wrangler observability log/trace state); the historical `docs/superpowers/**`
  specs/plans that mention Persist (past records).

## Known behavior & non-goals

- **Scope-exit blip.** The spike showed that leaving a layout scope transiently
  remounts the outgoing subtree (preact-iso renders the previous route during the
  swap to a top-level sibling), so a subscription briefly
  disconnects/reconnects/disconnects on the way out. Net teardown is clean (no
  leaked connections), and it only happens when the component is leaving anyway.
  Documented, not fixed.
- **Non-goals:** no detached / route-independent RPC (`/__actions` reserved
  endpoint, `DetachedScope`); persistent UI that genuinely cannot live in a layout
  is not supported. No reconnect/replay (`Last-Event-ID`, dedup) semantics for
  dropped long-lived streams beyond what the transport already does. No
  `useStream` outside a `RouteLocationsProvider` (explicit-input consumption) in
  this iteration.

## Testing strategy

- Promote the spike persistence test into a real regression test for the
  layout-child persistence guarantee (intra-scope persist, scope-exit teardown,
  re-entry fresh).
- `live` loader: a test that a `live` loader is not collected as an SSR streaming
  loader (does not enter the document stream) and that `useStream` returns
  `initial`/`'connecting'` on the server.
- `useStream`: a test that every chunk reaches `reduce` (no coalescing loss),
  status transitions connecting → open → closed/error, and accumulated `data`
  survives intra-scope navigation when used in a layout.
- Demo migration: update/retarget the existing `ActivityBar` tests to the loader +
  `useStream` shape (do not delete coverage).
- Full pre-push CI mirror (build dist, format, typecheck, test:coverage,
  test:integration, site build) per CLAUDE.md; the cross-package removal means the
  consuming packages' suites must run.

## Open questions

- Naming: `live` vs `subscription`/`stream` for the option; `useStream` vs
  `useSubscription` for the hook. Align with existing `define*` / `use*`
  conventions.
- `useStream` return shape: `{ data, status, error }` vs exposing a richer
  connection handle. Status enum values (`connecting`/`open`/`closed`/`error`).
- Whether `useStream` should also work on non-`live` finite streaming loaders
  (proposed: yes, it is orthogonal) and whether `.View` on a `live` loader should
  be a hard error (proposed: yes, to prevent the SSR-hang footgun).
```
