# Unify streaming consumption into `loader.View`

Date: 2026-06-18
Status: Design (revises PR #133 before merge)
Supersedes: the `loader.useStream` hook from `2026-06-18-route-persistent-live-data-design.md`.

## Problem

PR #133 added `loader.useStream({ reduce, initial })`, a bare hook that subscribes to a streaming/`live` loader and folds chunks into accumulated state. A live demo (the `/demo` activity bar) exposed a hydration bug: the bar, SSR'd inside the lazy `projects-shell` layout, renders **two overlapping `position:fixed` bars**, an orphaned empty SSR bar over the live one. Root-caused by local instrumentation: the SSR markup is never hydrated by the client instance; the client mounts a fresh instance into new DOM and orphans the SSR markup (Preact's expected Suspense+hydration behavior, `preactjs/preact#4442`, the class PR #63 addressed).

A client-only guard (`if (!isBrowser()) return null`) sidesteps it but is a band-aid. The real issue: `useStream` is a bare hook that renders *outside* the loader subsystem's hydration coordination, whereas every other loader consumer (`shellLoader.View(...)`) hydrates cleanly. The fix is to **unify streaming consumption into `loader.View`**, the framework's established consumption convention.

## Root cause (why `.View` hydrates and the bare hook does not)

`LoaderHost` (which `.View`/`.Boundary` render through) wraps its child in a `<Suspense>` and hydrates via a **`useId`-anchored, preload-backed synchronous reader**: on the client it finds the SSR-embedded first value (`getPreloadedData(id)`, keyed by the `useId()` that is deterministic across the prerender and hydrate passes), builds a reader that resolves synchronously, and the Suspense boundary commits to content that matches the SSR DOM. The SSR markup is adopted; no orphan.

The bare `useStream` hook has neither a Suspense boundary nor a `useId`-anchored element. It renders its "connecting" markup synchronously on SSR, then connects in a `useEffect` (client-only) and re-renders into a fresh instance, so inside the lazy layout the SSR markup is orphaned.

## The constraint that pins the design

`prerender` (`render.tsx`) uses `renderToStringAsync`, which **awaits** thrown Suspense promises. A `live` loader is an infinite generator; if its `LoaderHost` suspended on the server, `renderToStringAsync` would await forever and hang the document response. Therefore, **on SSR a live loader must render its fallback *directly*, never suspend and never run the loader fn.** Clean hydration still holds: SSR commits the fallback, the client's first render is also the fallback (suspended on the first-chunk fetch), so the DOM is adopted, then upgraded once the first chunk arrives. This mirrors `ShellView`, seeded with a fallback instead of server data.

## Design

`loader.View` becomes the single consumption path for all loaders, including streaming/`live`, by gaining an accumulating mode.

### `.View` API

```ts
// Existing (single-value) form, unchanged:
loader.View<P>(render: (args: P & { data: T; error; reload }) => ChildNode, opts?: { fallback?; errorFallback? })

// New (accumulating) form, selected by passing `initial` + `reduce`:
loader.View<Acc, P>(
  render: (args: P & { data: Acc; status: StreamStatus; error; reload }) => ChildNode,
  opts: { initial: Acc; reduce: (acc: Acc, chunk: T) => Acc; fallback?; errorFallback? }
): ComponentType<P>
```

When `initial`+`reduce` are present, `data` is the accumulated `Acc` (folded over every chunk) and the render args also carry `status: StreamStatus` (`'connecting' | 'open' | 'closed' | 'error'`). The worked example:

```tsx
const ActivityFeed = activityLoader.View<ActivityEvent[]>(
  ({ data, status }) => <BarUI events={data} connected={status === 'open'} />,
  {
    initial: [],
    reduce: (acc, e) => (acc[0]?.id === e.id ? acc : [e, ...acc].slice(0, MAX)),
    fallback: <ConnectingBar />,
  }
);
// rendered as <ActivityFeed /> in projects-shell.tsx. No isBrowser guard.
```

`StreamStatus` is retained (already exported). `UseStreamOptions` / `UseStreamResult` and the `useLoaderStream` hook are **removed** (their roles move into the `.View` opts and `LoaderHost`).

### `LoaderHost` / `useLoaderRunner` changes

1. **Live-aware SSR short-circuit (load-bearing).** For a `loaderRef.live` loader, on `!isBrowser()` `LoaderHost` renders the `fallback` **directly** (synchronous, no reader, no thrown promise, no loader run), with the same `useId`-anchored element structure it uses on the client so hydration adopts it. On the client it takes the existing no-preload fetch branch (`runLoader` → `/__loaders` SSE), suspends until the first chunk, then resolves.
2. **Accumulation.** `useLoaderRunner` accepts optional `{ initial, reduce }`. `onChunk` already observes every chunk (the coalescing today is only `setOverrideData` overwriting the latest); replace the overwrite with a functional fold (`setOverrideData(prev => reduce(prev ?? initial, chunk))`), and seed/fold the first value the same way, so no chunk is lost.
3. **Status.** Derive `status` (`connecting` before first chunk, `open` after, `closed` on stream end, `error` on error) and thread it through `LoaderHost` → the render args.

### Guard rework

The Task 1 `live` guards (`define-loader.ts`: `.View`/`.Boundary`/`useData` throw for live) were added to keep the infinite generator from running during SSR. That safety is now provided by the SSR short-circuit (#1 above), so:

- `.View` / `.Boundary` **no longer throw** for live loaders, they host them.
- `.View` for a live loader **requires** `initial`+`reduce` (a live loader has no single "latest" value to render); calling the single-value form on a live loader is the new error.
- `useData()` continues to throw for live loaders (accumulation-only).

### Demo + cleanup

- `apps/site/src/components/demo/ActivityBar.tsx`: consume via `activityLoader.View({ initial, reduce, fallback })`; remove the `useStream` call and the `isBrowser`/`typeof window` guard.
- `projects-shell.tsx`: render the resulting `<ActivityFeed />` (unchanged placement).
- Remove `packages/iso/src/internal/use-loader-stream.tsx` and its test; drop the `useStream` export and `UseStreamOptions`/`UseStreamResult` from the barrel (keep `StreamStatus`).
- Update `live-loaders.mdx` and the v0.8 release note (if kept) to document `.View` accumulation instead of `useStream`.

## Load-bearing assumption to verify FIRST

The entire design rests on: **a live `LoaderHost` that renders its fallback directly on SSR, then suspends-until-first-chunk on the client, hydrates cleanly (one bar, no orphan) inside the lazy layout.** This must be verified empirically (the running `/demo` harness, the same way the bug was found) as the first implementation step, before building the full API. If SSR-direct-fallback still orphans, the approach needs rethinking (e.g. coordinating the fallback element's `useId` anchor explicitly). Everything else is mechanical.

## Non-goals

- No change to the SSR streaming handoff for finite loaders (preload + `__HP_STREAM__` registry) — live loaders simply never participate in it (no SSR run).
- No reconnect/backoff/replay semantics beyond what the transport already does.
- No change to the `/__loaders` transport or the server `loaders-handler` (a live loader is already handled as a normal async-generator SSE stream with `timeoutMs: false`).

## Testing

- **Hydration regression (the headline).** An SSR+hydration test (or the documented manual `/demo` verification) proving a live `.View` consumer inside a lazy layout produces exactly one DOM element (no orphan) and accumulates. A pure unit test cannot capture the lazy+Suspense+hydration interaction; pair a focused `renderToStringAsync` + `hydrate` test with the manual harness check.
- **Accumulation.** Every chunk reaches `reduce` (no coalescing loss); `status` transitions connecting → open → closed/error. Port the existing `use-loader-stream` accumulation tests onto the `.View` path.
- **Guard.** `.View` single-value form on a live loader throws; `.View` with `initial`+`reduce` hosts it; `useData` still throws for live.
- **SSR safety.** A live loader's fn is never invoked during `renderToStringAsync` (no hang); SSR commits the fallback.
- Full 7-step CI mirror (incl. `test:types`).

## Open questions

- **`.View` overload typing.** Selecting the accumulating form by the presence of `initial`+`reduce` needs a clean TS overload so `data` is `Acc` (streaming) vs `T` (single-value). Resolve the overload signature during implementation; avoid an `as` cast.
- **`status` for the single-value form.** Keep it streaming-only (don't add `status` to the existing render args) to avoid churn, or expose it uniformly. Proposed: streaming-only.
- **Naming of the fallback-while-connecting vs error.** Reuse `fallback`/`errorFallback`; `fallback` doubles as the connecting state.
