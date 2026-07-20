# SSR loader `deny()` renders the route's `errorFallback` at the deny status

Closes #287.

## Design revision (2026-07-20, during implementation)

One part of the design below did not survive contact with the renderer and was
dropped: **page-level `errorFallback` catching a loader deny that has no local
`errorFallback`, during SSR.** It is technically infeasible. `preact-render-to-string`
does not propagate a value thrown from within a suspended subtree (the loader's
`DataReader`) to an ancestor error boundary; the throw escapes straight out of
the render (confirmed with two isolated diagnostics, including a "trampoline"
that returns successfully from the retry and throws from a child, which also
escaped). Enabling `options.errorBoundaries` did not help and additionally broke
the loader's own Suspense mechanism, so it was removed. What ships:

- Loader deny **with a local `errorFallback`**: renders the branded fallback in
  a full document at the deny status, with the hydration bake. (The #287 repro,
  the demo board View, has a local `errorFallback`, so it is fully fixed.)
- Loader deny **without** a local `errorFallback` (whether or not a page-level
  `errorFallback` exists): bare text at the deny status, as today.
- Redirect during SSR: real 302. Deny headers ride the response. Middleware-scope
  deny: bare text. Client-side navigation is unchanged (the client boundary still
  catches loader errors as before).

Consequently the sections below describing the loader-deny tag (§2a), the
`ErrorBoundary` server-deny branch (§2), and the page-level row of the fallback
table are historical: that machinery was built and then reverted. The rest
(the per-request registry, the `data-loader-deny` hydration channel, the
`DataReader` local-fallback bake, the client seed and re-wrap, and the
`renderPage` status application) shipped as described.

## Problem

When a page loader throws `deny()` during SSR, the response short-circuits to a
bare text body at the correct HTTP status (`GET /demo/projects/nope` →
`404` with a 24-byte `No project named 'nope'.`). No document shell, no styles,
no navigation. Client-side navigation to the same URL renders the board View's
`errorFallback` (branded panel, "Try again", back link). Deep links and crawlers
therefore see unbranded text.

### Why it's bare text today

`RouteBoundary` (`packages/iso/src/internal/route-boundary.tsx:30-37`)
deliberately **rethrows** outcomes (`if (isOutcome(error)) throw error`) so a
loader `deny()` unwinds past every boundary and out of `prerender`. That is how
`renderPage`'s outer catch learns the real HTTP status. `translateRootOutcome`
(`packages/server/src/outcome-translation.ts:33-36`) then emits
`c.text(outcome.message, outcome.status)` — right status, unbranded body.

Simply catching the deny in-tree gives the branded body back but at HTTP 200,
which is the exact pre-#284 regression the issue calls out. **Any fix must
preserve both halves: a full branded document AND the deny status.** The
precedent already exists for actions: a `deny()` from a server action re-renders
the page and re-wraps the finished document at the deny status
(`packages/server/src/page-actions-handler.ts:503-534`).

## Goal

On an SSR loader `deny()`, render the route's `errorFallback` into a full
document at the deny's status (and headers), matching client-navigation output.
Hydrate cleanly: no DOM mismatch, no redundant refetch.

### Non-goals / deliberate scope boundaries

- **Middleware-scope denies stay bare text.** A page-scope server *middleware*
  `throw deny(...)` has no associated `errorFallback` (no route render ran);
  `render-honocontext.test.tsx:66-104` locks in bare text for that path and
  stays green.
- **Redirect / render outcomes still rethrow.** A loader `redirect()` during SSR
  must become a real 302, never a rendered fallback.
- **Plain (non-deny) loader errors are untouched.** They already render the
  fallback at HTTP 200 with a hydration flash today; this change does not alter
  or fix that pre-existing behavior. Only `deny` gets the hydration bake.
- **No local fallback + no page fallback → bare text** (today's terminal
  behavior, unchanged).

## Fallback resolution (which `errorFallback` renders)

Mirror the client's boundary routing:

| Situation | SSR result | HTTP status | Hydration |
| --- | --- | --- | --- |
| Loader declares its own `errorFallback` | that loader's fallback, in-shell | deny status | **baked** (coldError seed, no refetch) |
| No local fallback; page/route declares `errorFallback` | page fallback, in-shell | deny status | refetch on hydrate (accepted flash) |
| No fallback anywhere | bare text (unchanged) | deny status | n/a |
| Middleware-scope deny | bare text (unchanged) | deny status | n/a |

## Architecture

Two independent mechanisms, cleanly separated:

- The **boundary change** (`ErrorBoundary`) makes a deny render the nearest
  fallback and records the status. This alone covers **both** the loader-local
  and page-level fallback cases (branded doc at the deny status).
- The **hydration bake** is an add-on that only the loader-local case receives:
  the denying loader's `<Envelope>` carries a deny marker so the client seeds a
  coldError phase and skips the refetch.

### 1. Per-request server deny side-channel

New `packages/iso/src/internal/server-deny-registry.ts`, mirroring
`streaming-ssr.ts` exactly (`getRequestStore()` + a `Symbol.for(...)` key):

```ts
export type ServerDenyRecord = {
  status: ErrorStatusCode;
  headers: Record<string, string> | undefined;
};

// First-write-wins: the first deny encountered in prerender depth-order sets
// the response. Subsequent denies are ignored (a page renders one document).
export function recordServerDeny(record: ServerDenyRecord): void;
export function takeServerDeny(): ServerDenyRecord | null;
```

Only `status` + `headers` are recorded — those are response concerns. `message`
is a hydration concern carried separately by the anchor (below). Exported via
`packages/iso/src/internal.ts` so `@hono-preact/server` can read it.

### 2. `ErrorBoundary` gains server-deny handling (page-level + general)

`packages/iso/src/internal/route-boundary.tsx`. Today the boundary rethrows all
outcomes. New behavior — but it must render a fallback ONLY for a deny that
originated from a **loader**, never a middleware-scope deny. On the client a
middleware deny is applied by `PageMiddlewareHost` (navigation), never rendered
by an `errorFallback`; letting a page-level `errorFallback` catch a middleware
deny on the server would be a new SSR/client divergence. Loader denies are
tagged (§2a) so the boundary can tell them apart:

```ts
static getDerivedStateFromError(error: unknown) {
  if (isOutcome(error)) {
    // A LOADER deny (tagged) on the server may render this boundary's fallback.
    // Everything else — the client, redirect/render outcomes, or an untagged
    // middleware deny — unwinds so the outer handler translates it (bare text).
    if (!isBrowser() && isLoaderDeny(error)) {
      return { error: toError(error), deny: error };
    }
    throw error;
  }
  return { error: toError(error), deny: null };
}

componentDidCatch(error: unknown) {
  // Only rethrow outcomes we are NOT handling (client, or non-deny). A
  // server-side deny we intend to render must not be rethrown by the sibling
  // hook. (No-op if the server renderer never fires this hook.)
  if (isOutcome(error) && (isBrowser() || !isDeny(error))) throw error;
}

render() {
  const { error, deny } = this.state;
  if (!error) return this.props.children;
  const f = this.props.fallback;
  if (deny) {
    if (f == null) throw deny;      // no fallback here: unwind to an outer boundary
    recordServerDeny({ status: deny.status, headers: deny.headers });
  }
  // ...render fallback with the coerced `error` as today...
}
```

`recordServerDeny` is called from `render()` (server-only path, single pass,
first-write-wins), consistent with the codebase's existing side-effect-in-render
pattern (`LoaderHost` already calls `registerServerStreamingLoader` from its
server render). The coerced `Error(message)` handed to the fallback matches what
client-nav's `loaderHttpError` produces, so SSR and client-nav fallbacks receive
identical input.

This change is inert on the client (the `!isBrowser()` guard) and inert for
non-deny outcomes (still rethrown). Client boundaries never see raw outcomes
anyway — client-nav decodes a deny envelope to an `Error` before it reaches any
boundary.

### 2a. Loader-deny tag

New `packages/iso/src/internal/loader-deny-mark.ts`. A `Symbol.for(...)` key
declared as an optional field on `DenyOutcome` (no cast — the repo's type-cast
guidance: declare the symbol key on the value's type, narrow with `in`):

```ts
export const LOADER_DENY = Symbol.for('@hono-preact/loader-deny');

// Mutates the outcome in place so the tag rides it up the tree. Returns it for
// chaining a rethrow.
export function markLoaderDeny(o: DenyOutcome): DenyOutcome {
  o[LOADER_DENY] = true;
  return o;
}

export function isLoaderDeny(x: unknown): x is DenyOutcome {
  return isDeny(x) && (x as DenyOutcome)[LOADER_DENY] === true;
}
```

`DenyOutcome` (`outcomes.ts:45`) gains `readonly [LOADER_DENY]?: true`. Only
`DataReader` (§3), on the no-local-fallback rethrow, sets the tag. Middleware
denies (surfaced by `HostConsumer`/`PageMiddlewareHost`) are never tagged, so
they keep unwinding to bare text — preserving the non-goal and keeping
`render-honocontext.test.tsx:80-104` green for the right reason.

### 3. Loader-local interception + hydration bake

`packages/iso/src/internal/loader.tsx`. `DataReader` is server-only. Thread the
loader's own `errorFallback` into it and wrap `reader.read()`:

```ts
function DataReader({ reader, accumulate, errorFallback, children }) {
  let raw;
  try {
    raw = reader.read();
  } catch (e) {
    // Pending promise (suspense) or a non-deny throw: rethrow unchanged.
    if (!isDeny(e)) throw e;
    // Loader-local deny with a fallback: record status, render the fallback
    // wrapped in an Envelope carrying the deny marker so hydration seeds
    // coldError instead of refetching. No local fallback: TAG it as a loader
    // deny and rethrow so an outer (page-level) RouteBoundary can render its
    // own fallback (§2) — an untagged middleware deny would not.
    if (errorFallback == null) throw markLoaderDeny(e);
    recordServerDeny({ status: e.status, headers: e.headers });
    const err = toError(e);
    return (
      <LoaderDataContext.Provider value={{ status: 'error', error: err }}>
        <Envelope anchor={{ kind: 'deny', message: e.message }}>
          {typeof errorFallback === 'function'
            ? errorFallback(err, NOOP_RESET)
            : errorFallback}
        </Envelope>
      </LoaderDataContext.Provider>
    );
  }
  // ...existing success path (unchanged)...
}
```

`DataReader` intercepting the loader-local deny *before* the wrapping
`ErrorBoundary` (rendered at `loader.tsx:229` when `errorFallback != null`) is
what lets the bake reach the loader's `<Envelope>`. When the loader has no local
`errorFallback` (`body = content` at `loader.tsx:231`, no wrap), `DataReader`
rethrows and the deny bubbles to the page-level `RouteBoundary` handled by §2.

`NOOP_RESET`: on the server there is nothing to reset (no client runner);
`reload` is a browser affordance. The client's real `reload` is wired on
hydration.

### 4. `HydrationAnchor` deny marker

`packages/iso/src/internal/envelope.tsx`. Extend the already-"extensible"
discriminated union:

```ts
export type HydrationAnchor =
  | { kind: 'none' }
  | { kind: 'data'; value: unknown }
  | { kind: 'deny'; message: string };
```

To avoid colliding with a legitimately-baked object value in `data-loader`, the
deny marker is emitted on a **separate attribute**, `data-loader-deny`, and no
`data-loader` is written for the deny case. `Envelope` writes
`data-loader-deny={JSON.stringify({ message })}` when `anchor.kind === 'deny'`.

### 5. Client seed from the baked deny

- `packages/iso/src/internal/preload.ts`: add `getPreloadedDeny(id)` reading
  `data-loader-deny` → `{ present: false } | { present: true; message: string }`.
  (Its own reader, distinct from `getPreloadedData`, so a baked object value and
  a baked deny never alias.)
- `packages/iso/src/internal/use-loader-runner.tsx`: on mount, if
  `getPreloadedDeny(id)` is present, seed the runner directly into its cold
  `error` phase with `new Error(message)` and **skip the fetch** (parallel to
  how a baked value seeds `success`). Surface a `fromBakedDeny: true` marker on
  the view so `loader.tsx` knows to re-wrap in the matching `<Envelope>`.
  Schedule the usual `deletePreloadedData`-style cleanup (clear
  `data-loader-deny`) in an effect so a later re-mount can't read a stale
  marker.

### 6. Client coldError re-wrap for hydration parity

`packages/iso/src/internal/loader.tsx`, coldError branch (`:210-223`). Today:
`body = errorFallback(view.error, reload)` (bare). When `view.fromBakedDeny`,
wrap identically to the server:

```ts
body = view.fromBakedDeny ? (
  <Envelope anchor={{ kind: 'deny', message: view.error.message }}>
    {renderedFallback}
  </Envelope>
) : (
  renderedFallback
);
```

Pure client-navigation coldError (no baked deny) stays bare — unchanged. The
`<Envelope>` reads its id from `LoaderIdContext`, already provided at
`loader.tsx:235`, so the client re-mounts under the same `useId` and the
hydrated DOM equals the SSR DOM.

### 7. `renderPage` applies the recorded status

`packages/server/src/render.tsx`, after `prerender` resolves and **before** the
streaming / non-streaming split (`~:192`, inside the scope so the request store
is still live):

```ts
const deny = takeServerDeny();
if (deny) {
  applyOutcomeHeaders(c, deny.headers);
  c.status(deny.status);
}
```

- Non-streaming return (`c.html(...)`, `:261`) inherits `c`'s status.
- Streaming return (`streamDocumentResponse`, `:266`) threads the status into
  the `Response` it builds (new optional field on its options; defaults to 200).

Handling both branches covers a page that mixes a denied single-value loader
with live streaming loaders: the deny sets the document status while the other
loaders still stream.

### 8. Exports

`packages/iso/src/internal.ts`: export `recordServerDeny`, `takeServerDeny`,
`ServerDenyRecord`, and `getPreloadedDeny` (server + client entry points already
import from here).

## Data flow summary

```
loader throws deny(404)
        │  (server, during prerender)
        ▼
DataReader.read() throws  ──has local errorFallback?──┐
        │ yes                                          │ no
        ▼                                              ▼ markLoaderDeny + rethrow
recordServerDeny(404)                          bubbles up tree
render fallback in <Envelope kind:'deny'>              │
data-loader-deny={message}                             ▼
        │                                    RouteBoundary(page fb) + isLoaderDeny?
        │                              ┌── yes: recordServerDeny(404)
        │                              │        render page fallback (no bake)
        │                              └── no:  rethrow → translateRootOutcome
        │                                       → bare text @ 404 (unchanged)
        │                                 (a middleware deny is untagged → here)
        ▼
prerender resolves → renderPage: takeServerDeny() → c.status(404) + headers
        ▼
full branded document, HTTP 404
        ▼  (client hydrate)
getPreloadedDeny(id) present → seed coldError(Error(message)), skip fetch
render fallback in <Envelope kind:'deny'> → DOM matches SSR, no flash
```

## Testing

- **SSR loader deny with local `errorFallback`**: response is a full document
  (`<!doctype html>`, shell, styles) containing the fallback's branded markup,
  at the deny status, with deny headers applied. (New; the current only direct
  SSR-loader-deny coverage is absent.)
- **Hydration parity**: given the baked `data-loader-deny`, the client runner
  seeds coldError, does **not** issue a loader fetch, and the first client render
  equals the server DOM (no mismatch warning). Assert no fetch call.
- **Page-level fallback catches a loader deny** (loader has no local fallback,
  page does): page fallback renders in-shell at the deny status.
- **No fallback anywhere**: still bare text at the deny status (regression guard
  for the terminal path).
- **Redirect during SSR** still becomes a 302 (regression guard: not swallowed
  by the new deny handling).
- **Mixed streaming + deny**: a page with a denied single-value loader and a live
  streaming loader returns the streamed document at the deny status.
- **Middleware-scope deny stays bare text**: `render-honocontext.test.tsx:66-104`
  stays green (unchanged path).
- **`server-deny-registry` unit**: first-write-wins; `take` clears; no cross-
  request leakage (scoped to `getRequestStore`).

## Files touched

| File | Change |
| --- | --- |
| `packages/iso/src/internal/server-deny-registry.ts` | **new**: record/take + type |
| `packages/iso/src/internal/loader-deny-mark.ts` | **new**: `LOADER_DENY` symbol, `markLoaderDeny`, `isLoaderDeny` |
| `packages/iso/src/outcomes.ts` | `DenyOutcome` gains optional `[LOADER_DENY]?: true` |
| `packages/iso/src/internal/route-boundary.tsx` | server-deny handling in `ErrorBoundary` (tagged loader denies only) |
| `packages/iso/src/internal/loader.tsx` | `DataReader` deny interception + bake; client coldError re-wrap |
| `packages/iso/src/internal/envelope.tsx` | `HydrationAnchor` deny kind → `data-loader-deny` |
| `packages/iso/src/internal/preload.ts` | `getPreloadedDeny` |
| `packages/iso/src/internal/use-loader-runner.tsx` | seed coldError from baked deny; `fromBakedDeny` |
| `packages/iso/src/internal.ts` | exports |
| `packages/server/src/render.tsx` | `takeServerDeny` → status + headers on both return paths |
| `packages/server/src/stream-pump.ts` (or streaming response builder) | thread status into the streamed `Response` |
| tests | as above |

## Open risks

- **Envelope wrapping on the coldError path** changes the client DOM only for
  the baked-deny case; pure client-nav errors stay bare. Verify no existing test
  asserts a bare (Envelope-less) DOM for the baked-deny path.
- **`componentDidCatch` on the server**: preact-render-to-string may not invoke
  it; the guard is defensive either way. Confirm the boundary renders the
  fallback on the server (the codebase already relies on server error boundaries
  for plain loader errors, so this is established).
- **`c.status()` + `c.html()` interaction**: confirm `c.html` honors a prior
  `c.status(...)` rather than forcing 200 (Hono does; assert it in a test).
