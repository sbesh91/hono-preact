# Streaming Loaders + Action Parity

**Date:** 2026-05-11
**Status:** Draft
**Implements:** §5 of `2026-05-09-v0.1-framework-direction.md`, plus the relevant punch-list items in `docs/design-concerns-2026-04-25.md` (item #5; items #1, #2, #7 are already cleared or scoped elsewhere).

## TL;DR

Loaders can stream values over time. Actions can stream typed progress chunks alongside a final result. Both are authored as async generators; the framework owns the wire format (SSE), the server-side rendering machinery, the client-side subscription protocol, and the chunk decoding. From the user's side, the only new vocabulary is `function*`.

A streaming loader:

```ts
// src/pages/dashboard.server.ts
import { defineLoader } from 'hono-preact';

export const loader = defineLoader<DashboardView>(async function* (ctx) {
  yield await initialSnapshot(ctx);
  for await (const view of subscribeToMetrics(ctx.signal)) {
    yield view;
  }
});
```

A streaming action:

```ts
// src/pages/watched.server.ts
import { defineAction } from 'hono-preact';

export const serverActions = {
  bulkImport: defineAction(async function* (ctx, payload: { source: string }) {
    const items = await fetchItems(payload.source);
    for (let i = 0; i < items.length; i++) {
      await importItem(items[i]);
      yield { count: i + 1, total: items.length };  // chunk: typed Progress
    }
    return { imported: items.length };               // final: typed Result
  }),
};
```

Consumption stays in each primitive's natural shape:

```tsx
function Dashboard() {
  const view = loader.useData();             // declarative; latest snapshot
  const err  = loader.useError();            // declarative; current error or null
  return <>{err && <Banner />}<Metrics data={view} /></>;
}

function BulkImportButton() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const { mutate, data, pending } = useAction(serverActions.bulkImport, {
    onChunk: (p) => setProgress(p),          // imperative; per-yield event
    onSuccess: (r) => console.log(r.imported),
  });
  return <button onClick={() => mutate({ source: 'foo' })}>{progress?.count ?? 'go'}</button>;
}
```

On initial page load, the loader's first chunk paints in the SSR response, and subsequent chunks stream out as further HTML fragments that update the live subtree without a re-fetch. On client-driven navigation or reload, the same SSE stream drives the same subscription.

## Why this shape

Five decisions, each driven by what the long-term framework user gets (not by what is fastest to ship).

### 1. `useData()` always returns `T`

Whether the loader is static or streaming, `loader.useData()` returns `T`. The mental model (a loader is the data the page renders, right now) stays intact. A loader that becomes streaming is a server-side change; no consumer code moves. Alternatives that change the return type (a tuple, a `{ data, done }`, a separate hook) tax every static-loader consumer to serve a streaming-loader concern.

The lossy-last-wins risk (a stream emitting independent events rather than refined state) is escapable: the loader yields full state per tick, or, for true append semantics (LLM tokens, log lines), the consumer wraps `useData()` with a `useState`+`useEffect` accumulator. Userland flexibility, framework primitive stays simple.

### 2. SSR streams HTML on initial load

Three options were on the table for SSR:

- **Block**: server awaits the entire stream, renders once. Identical to Remix `defer` in effect. Weak differentiator.
- **Snapshot-on-first-chunk**: server renders with the first chunk and discards the rest; client refetches to continue streaming. Loses continued streaming on direct-URL loads.
- **True streaming HTML**: server flushes shell with first chunk, then flushes HTML patches that target the loader's subtree as further chunks arrive. Continued streaming on first paint.

The use cases motivating "streaming everywhere" are direct-URL loads of long-running data (chat, dashboard, log tail, live search). Snapshot-and-refetch degrades exactly these. True streaming HTML is what the user expects when they read the pitch. The public API doesn't change between snapshot and streaming SSR; only what the server flushes does. So the API doesn't lock us in either way. We're picking the right server-side behavior.

### 3. Wire format is SSE

Server-Sent Events (`text/event-stream`), not NDJSON.

SSE buys us, on day one, three things any non-toy streaming app needs:

- **Mid-stream errors as a typed frame** (`event: error\ndata: {...}`), instead of inventing per-app magic keys (`{"__error": ...}`) that every consumer has to filter from its data path.
- **Keepalive over edge runtimes** via comment lines (`: keepalive\n\n`). CF Workers and similar will close quiet connections after some idle interval; SSE makes this transparent. NDJSON requires inventing a per-app sentinel.
- **Multi-channel events on one connection** via the `event:` field. Today we only need `data` and `error`; the protocol leaves room for `progress`, `heartbeat`, future types without breaking shape.

The user-facing API does not expose SSE concepts. `yield T` becomes `data: <json>\n\n` under the hood; that is a framework concern. The wire format choice is permanent infrastructure with permanent benefits; the framework-author cost is a one-time parser of ~30 lines plus a one-time encoder helper.

### 4. Async generators are the author shape

The user writes a function. They `yield` values of `T` (loader) or values of `TChunk` and optionally `return` a `TResult` (action). The framework JSON-encodes each yielded value, frames it as SSE, writes it to the response, and decodes it client-side.

For sources the user already has as a `ReadableStream<T>` (e.g., piping from `fetch().body` through a `TransformStream`), `defineLoader` and `defineAction` also accept a `Promise<ReadableStream<T>>` return; the framework adapts it. The async generator is the showcase; `ReadableStream<T>` is the escape hatch.

Static loaders (`async (ctx) => T`) and non-streaming actions (`async (ctx, payload) => TResult`) keep their current shape. The streaming additions are purely additive.

TypeScript infers the chunk and result types from the function signature with zero explicit generics in the common case. `AsyncGenerator<TYield, TReturn>` carries both, and the framework's `useAction` and `useData` types thread them through.

### 5. Errors read off the loader, not off `useReload()`

A mid-stream loader error is a loader concern, not a reload concern. `loader.useError(): Error | null` is the declarative read; it returns the loader's current error state (or `null`). For imperative side effects (toast, log, retry), a `useEffect` on `loader.useError()` is the natural pattern; the framework does not add a callback option on `useData()` (it would be a two-line `useEffect` in framework code, and would create two ways to do the same thing).

`useReload()` is cleaned up at the same time. Today's return shape is `{ reload, reloading, error, loaderId }`; `error` and `loaderId` are not read by any consumer (verified across packages, apps, tests, docs). They are removed. `useReload(): { reload, reloading }` becomes purely an imperative reload API.

### 6. Actions stay imperative, with typed chunks

Loaders are state; actions are events. The shape of each should match its semantic. `useData()` is declarative because *the data is what the page renders*. `useAction()`'s `onChunk` is imperative because *progress chunks are events that happen during a user-triggered mutation*.

The C1 shape (`onChunk(chunk: TChunk)`, `onSuccess(result: TResult)`, `onError(err: Error)`) is the action's natural API. Today `onChunk` is `(chunk: string) => void` and the user manually parses (`watched.tsx:25-34`); with typed inference from the generator, `onChunk: (p: Progress) => setProgress(p)` is one line. The final `TResult` (the generator's `return` value) flows to `useAction.data` and `onSuccess`.

We do not add a declarative `action.useLastChunk()` hook. Local progress state via `useState` is the idiomatic shape and works for every progress UI pattern in practice.

## Public API

All new exports live in `@hono-preact/iso` and re-export from `hono-preact`. New surface is additive; nothing on the existing static-loader or non-streaming-action paths breaks.

### `defineLoader`

```ts
type LoaderCtx = {
  location: RouteHook;
  signal: AbortSignal;        // new; fires when the client disconnects
};

type LoaderFn<T> =
  | ((ctx: LoaderCtx) => Promise<T>)                       // static
  | ((ctx: LoaderCtx) => Promise<ReadableStream<T>>)        // streaming, escape hatch
  | ((ctx: LoaderCtx) => AsyncGenerator<T, void, unknown>); // streaming, showcase

function defineLoader<T>(fn: LoaderFn<T>, opts?: DefineLoaderOpts<T>): LoaderRef<T>;

interface LoaderRef<T> {
  readonly __id: symbol;
  readonly fn: LoaderFn<T>;
  readonly cache: LoaderCache<T>;
  useData(): T;
  useError(): Error | null;   // new
  invalidate(): void;
}
```

A generator-shaped loader is detected at runtime via `Symbol.asyncIterator`; a `ReadableStream<T>` is detected via `instanceof ReadableStream`. Static loaders take the existing fast path. The runtime never type-tests `T`; the framing happens at the per-yield boundary.

### `defineAction`

```ts
type ActionCtx = {
  c: unknown;                 // hono context, unchanged
  signal: AbortSignal;        // new; fires when the client cancels
};

type ActionFn<TPayload, TResult, TChunk = never> =
  | ((ctx: ActionCtx, payload: TPayload) => Promise<TResult>)
  | ((ctx: ActionCtx, payload: TPayload) => Promise<ReadableStream<TChunk>>)
  | ((ctx: ActionCtx, payload: TPayload) => AsyncGenerator<TChunk, TResult, unknown>);

function defineAction<TPayload, TResult, TChunk = never>(
  fn: ActionFn<TPayload, TResult, TChunk>
): ActionStub<TPayload, TResult, TChunk>;

interface ActionStub<TPayload, TResult, TChunk> {
  readonly __module: string;
  readonly __action: string;
  useAction<TSnapshot = unknown>(
    options?: UseActionOptions<TPayload, TResult, TChunk, TSnapshot>
  ): UseActionResult<TPayload, TResult>;
}

type UseActionOptions<TPayload, TResult, TChunk, TSnapshot = unknown> = {
  invalidate?: 'auto' | false | ReadonlyArray<LoaderRef<unknown>>;
  onMutate?: (payload: TPayload) => TSnapshot;
  onChunk?: (chunk: TChunk) => void;             // typed (was string)
  onSuccess?: (data: TResult, snapshot: TSnapshot) => void;
  onError?: (err: Error, snapshot: TSnapshot) => void;
};
```

The `TChunk` generic defaults to `never`, so existing non-streaming actions don't need to be re-typed. For generator-shaped actions, both `TChunk` (yield type) and `TResult` (return type) are inferred from the function signature.

### `useReload`

```ts
// before
interface ReloadContextValue {
  reload: () => void;
  reloading: boolean;
  error: Error | null;        // removed
  loaderId: symbol | null;    // removed (consumers move to internal read)
}

// after
interface ReloadContextValue {
  reload: () => void;
  reloading: boolean;
}
```

The `loaderId` consumer inside `useAction`'s invalidate logic (`action.ts:132`) moves to reading from an internal context, not the public `useReload()` shape. `error` had no readers.

## Wire format

Both the loader endpoint (`POST /__loaders`) and the action endpoint (`POST /__actions`) respond with `Content-Type: text/event-stream` when the handler returns a stream or generator; with `application/json` otherwise.

The framing:

```
data: <json-encoded yield value>

data: <json-encoded yield value>

event: result
data: <json-encoded return value>

```

- Each `data:` event carries one JSON-encoded yielded value of `T` (loader) or `TChunk` (action).
- For actions, the generator's `return` value is sent as `event: result\ndata: <json>` at the end of the stream. Loaders have no `result` event (`useData()` already sees the latest yield as the value).
- On error: `event: error\ndata: {"message":"...","name":"..."}` is emitted, then the stream is closed. Stack traces are omitted from the wire by default; opt-in to include them via a runtime flag (out of scope for v0.1 launch).
- Keepalive: `: keepalive\n\n` is emitted every 30s during quiet periods. Configurable.

The client parser is a single async generator (`readSSE`) that yields `{ event, data }` objects to the consumer. The dispatcher per loader/action interprets the events.

## SSR streaming protocol

On initial page load, the server runs the route's loader. If the loader is static, behavior is unchanged from today: the value is preloaded into HTML via `getPreloadedData`. If the loader is streaming:

1. Server starts the generator. Reads the first yield.
2. Server renders the page HTML with that first value. Each loader subtree wraps in an element with `data-hp-loader="<loaderId>"`. The first yield's value is preloaded into the inline data registry, same shape as today's `getPreloadedData`.
3. Flushing the closing `</body>` is *deferred*; the response stays open while the generator runs.
4. As each subsequent yield arrives, the server writes a `<script>` tag to the response:
   ```html
   <script>__HP_STREAM__.push("<loaderId>", <json>)</script>
   ```
5. When the generator returns or errors, the server writes the appropriate terminator (`__HP_STREAM__.end("<loaderId>")` or `__HP_STREAM__.error("<loaderId>", <json>)`), closes `</body></html>`, and ends the response.

The client side:

- A tiny inline bootstrap (~10 lines) defines `window.__HP_STREAM__ = { queue: [], push(...args) { this.queue.push(['push', args]); }, ... }` *before* any chunks arrive. This guarantees no chunk is dropped even if it arrives before the client bundle.
- The client entry, on load, reads `__HP_STREAM__.queue`, hydrates the tree, then replaces `__HP_STREAM__` with the live dispatcher (which routes each event to the right loader subscription in the live tree). Queued events are drained in order.
- Each `LoaderRef` exposes a per-mount subscription internally. The dispatcher calls `subscription.push(value)`, `subscription.end()`, or `subscription.error(err)` based on the event type.

The HTML stream is sent with `Transfer-Encoding: chunked` (or HTTP/2 framing on edge runtimes that handle this transparently). Hono on CF Workers handles `ReadableStream` response bodies natively; no platform-specific code is needed.

For client-driven loader runs (post-mount reloads, post-navigation refetches), the protocol is the same SSE wire, but the response body is consumed by the client's `fetch()` parser, not by HTML injection. The same `subscription.push` / `end` / `error` calls drive the same subscription.

## Error semantics

Errors fall into two regimes:

**Pre-first-chunk error.** The generator throws (or the upstream returns an error) before any value has been yielded. There is no data to show. The loader's Suspense reader throws the error into the surrounding error boundary, same path as today's failed static loader. `useData()` is unreachable; `useError()` is irrelevant (the boundary owns recovery).

**Post-first-chunk error.** The generator yielded at least once, then threw. The page has live data. `useData()` continues to return the last successfully delivered chunk. `useError()` returns the error. Page stays alive showing best-known data; consumers that want to display the error do so declaratively or in `useEffect`.

For actions: errors at any point trigger `onError(err, snapshot)` and reject `mutate()`. The optimistic-state machinery already handles rollback via `onMutate` snapshots; no change needed.

For the SSE wire: server emits `event: error\ndata: {"message":"...","name":"..."}` and closes the stream. The client dispatcher routes this to the loader's subscription (post-first-chunk path) or to the action's `onError`.

## Abort semantics

`LoaderCtx.signal` and `ActionCtx.signal` are `AbortSignal`s that fire when the client side aborts. Concrete cases:

- **Client navigates away mid-stream.** The browser cancels the in-flight `fetch`; the server-side runtime fires the abort signal on the request. The framework propagates this to `ctx.signal`; the user's generator can check `ctx.signal.aborted` or pass the signal to nested `fetch`/`setTimeout`/`AbortController` consumers.
- **Client side mutation cancels** (a follow-up `mutate()` call before the previous completes, or a user-initiated cancel). Same signal mechanism.
- **The current page unmounts** (route change). Signal fires; generator cleans up.

If the user's generator does not check the signal, the runtime still closes the response after the next yield (no leaks, but possibly a wasted yield). Best practice: pass `ctx.signal` through to upstream operations.

## Punch list cleanups bundled in

From `docs/design-concerns-2026-04-25.md`:

- **#5: loader location validation.** `packages/server/src/loaders-handler.ts:65-67` only checks `module`. Add a shape check for `location` (must be an object with `path: string`, `pathParams: Record<string, string>`, `searchParams: Record<string, string>`); default missing fields to safe empty shapes. The change is small and benefits naturally from the surrounding streaming-handler rewrite.

Items already cleared (verify and note in the spec):

- **#1: `<Form>` streaming.** `<Form>` no longer fetches itself; it delegates to the `mutate` passed in (`packages/iso/src/form.tsx:23`). Streaming is automatic when `mutate` comes from `useAction`. No work needed.
- **#2: `<Form>` inline style.** Now uses `class="hp-form-fieldset"` (`form.tsx:28`). No work needed.
- **#7: `ActionGuardError` status cast.** Scoped to v0.1 item 6, not item 5. Out of scope here.

## Breaking changes

Two breaking changes are bundled. The framework is pre-launch (no published version yet), so they cost nothing externally; the migration is internal to the demo and tests.

1. **`ActionCtx` is now a wrapped object.** Action signatures change from `(ctx: unknown, payload) => ...` to `(ctx: ActionCtx, payload) => ...` where `ActionCtx = { c, signal }`. Actions that previously read from `ctx` directly (e.g., `(ctx as Context).req.header(...)`) move to `ctx.c.req.header(...)`. Actions that ignored `ctx` (the case for every action in the demo) need no source change beyond the type-name update if they spelled out the type.

2. **`useReload()` return shape narrows** from `{ reload, reloading, error, loaderId }` to `{ reload, reloading }`. Verified across the codebase: no consumer currently reads `error` or `loaderId`. The internal `action.ts` consumer of `loaderId` moves to a private context.

Both changes happen in the same PR as the streaming work, since the streaming-handler rewrite touches the action and loader entry points anyway.

## Out of scope

These are explicitly *not* part of this spec, even when adjacent:

- **Nested arbitrary Preact Suspense streaming.** The HTML-flush protocol covers loader subtrees only. Non-loader Suspense boundaries (e.g., user-authored `<Suspense>` wrapping a lazy component) are not part of the streaming protocol; they wait synchronously during SSR. Adding general Suspense streaming is a v0.2 design.
- **Retry-on-error UI primitives.** Users wire their own retry logic with `useError()` + `useReload().reload`. A framework-level `useRetry({ backoff })` is post-v0.1.
- **Resume on disconnect / Last-Event-ID.** SSE supports it; we don't expose it. A reconnecting loader is a userland pattern for now.
- **HMR cache invalidation for `.server.ts` edits** (punch list #6). Independent concern; the existing closure-lifetime cache stays as-is.
- **Multi-channel events on a single response** (e.g., `event: progress` alongside `event: data`). The wire format supports it; no user-facing primitive exposes it in v0.1.

## Testing surface

The spec implies new tests in:

- `packages/server/src/__tests__/loaders-handler.test.ts`: generator handling, ReadableStream<T> handling, SSE framing of yields, `event: result` for actions, `event: error` framing, location validation.
- `packages/iso/src/__tests__/define-loader.test.ts`: generator runtime detection, last-good snapshot on post-first-chunk error, `useError()` semantics.
- `packages/iso/src/__tests__/action.test.tsx`: typed `onChunk`, `data`/`onSuccess` from generator return, error propagation, abort signal.
- `packages/iso/src/internal/__tests__/loader.test.tsx`: streaming subscription, SSR-queued chunks draining, last-good behavior across renders.
- New: `packages/server/src/__tests__/sse.test.ts`: wire parser and encoder primitives, keepalive injection, malformed-frame tolerance.
- New: `packages/server/src/__tests__/render-stream.test.ts`: SSR with one streaming loader, with mixed static + streaming loaders, abort mid-stream, error mid-stream.

Integration test in `apps/app`: a streaming-loader demo page that uses the new shape end-to-end, served from the existing demo, verified by manual dev-server walkthrough (the spec does not require an e2e harness in v0.1).

## Migration of existing code

`apps/app/src/pages/watched.server.ts`:

```ts
// before
bulkImportWatched: defineAction<Record<string, never>, ReadableStream<Uint8Array<ArrayBuffer>>>(async () => {
  const target = (await getMovies()).results.slice(0, 20);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async start(controller) {
      let count = 0;
      for (const m of target) {
        await markWatched(m.id);
        count++;
        controller.enqueue(
          encoder.encode(JSON.stringify({ count, total: target.length }) + '\n')
        );
        await new Promise((r) => setTimeout(r, 150));
      }
      controller.close();
    },
  });
}),

// after
bulkImportWatched: defineAction(async function* (ctx) {
  const target = (await getMovies()).results.slice(0, 20);
  for (let i = 0; i < target.length; i++) {
    if (ctx.signal.aborted) return;
    await markWatched(target[i].id);
    yield { count: i + 1, total: target.length };
    await new Promise((r) => setTimeout(r, 150));
  }
  return { imported: target.length };
}),
```

`apps/app/src/pages/watched.tsx`:

```ts
// before: manual newline-splitting
onChunk: (chunk) => {
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    try {
      setProgress(JSON.parse(line) as { count: number; total: number });
    } catch { /* ignore malformed line */ }
  }
},

// after: typed callback
onChunk: (progress) => setProgress(progress),
```

A new demo page (e.g. `src/pages/live-stats.tsx` + `.server.ts`) exercises a streaming *loader* end-to-end. Its content can be a fake server-side timer that yields incrementing counts; the point is to demonstrate the loader-streaming path on initial paint.

## Documentation

The framework docs site (`apps/app/src/pages/docs/`) gets one new page, `streaming.mdx`, covering:

- Streaming loaders: when to reach for one, the async-generator shape, `loader.useError()`, the abort signal.
- Streaming actions: typed `onChunk`, `onSuccess` with the generator return, error handling, abort.
- The wire format at a high level (SSE, framework-owned), so readers can debug with curl.
- "Not for" notes: when a static loader is the right answer, when client-side WebSocket would be simpler than a streaming loader.

`loaders.mdx` and `actions.mdx` get short cross-links and updated examples; the existing static-loader content stays.

## Sequencing

This spec is implementation-ready. The plan that follows it (separate document) breaks it into:

1. SSE primitives (`packages/server/src/sse.ts` encoder + client decoder), with unit tests.
2. `loadersHandler` accepts generator / `ReadableStream<T>` returns, emits SSE, validates `location`.
3. `actionsHandler` accepts generator / `ReadableStream<TChunk>` returns, emits SSE with `event: result`.
4. Client-side `useAction` typed `onChunk` + `TResult` from generator return.
5. Client-side loader subscription: `useError()`, last-good-on-error, `useData()` re-renders per chunk.
6. SSR streaming: HTML response stays open, `__HP_STREAM__` registry, post-hydration drainage.
7. `useReload()` cleanup.
8. Demo migration (`watched.server.ts`, `watched.tsx`) + new streaming-loader demo page.
9. Docs page (`streaming.mdx`) + cross-links.

Each step is a green-tests-and-commit boundary. No step depends on a later step.
