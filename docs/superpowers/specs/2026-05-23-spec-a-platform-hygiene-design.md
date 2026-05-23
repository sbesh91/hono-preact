# Spec A: platform hygiene

Part of the [web standards adoption roadmap](./2026-05-23-web-standards-adoption-roadmap.md).

## Summary

Modernize four places where the framework currently does work the platform now offers directly:

1. **Loader and action timeouts** via `AbortSignal.any` + `AbortSignal.timeout`, with a structured timeout outcome.
2. **`useOptimistic` View Transitions**: opt-in `startViewTransition` wrapping of the settle and revert paths.
3. **`URL.parse()`** in place of `try { new URL }` at every recoverable parse site.
4. **`TransformStream`-based SSE codec** for the loader/action stream path, removing the `hono/streaming` dependency on that path.

No new subsystem. Two of the four changes (1, 2) add opt-in API surface; the other two (3, 7) are internal-only. Wire formats and public types are preserved except for the addition of one outcome variant.

## Goals

- Make cancellation and time pressure explicit and observable from user code.
- Stop paraphrasing platform primitives we can call directly.
- Establish the patterns (feature detection, opt-in flags, additive outcomes) that Specs B through E will reuse.

## Non-goals

- Client-side request timeouts on the loader/action `fetch`. The server enforces; the client observes.
- Per-route or per-layout default timeout overrides.
- SSE compression.
- Alternative wire formats (NDJSON, json-seq, WebTransport).
- Any items belonging to Specs B, C, D, E.

## Architecture overview

Two themes:

1. **Cancellation and time pressure** are made explicit and observable. Loaders and actions get composed `AbortSignal`s with a default 30 s deadline, exposed to user code through the existing `ctx.signal`. Timeouts surface as a structured outcome through the same path that already carries `redirect` / `deny`, so consumers branch on `error.kind === 'timeout'` instead of inferring from message strings.

2. **The framework stops paraphrasing the platform.** `URL.parse()` replaces try/catch around `new URL` wherever the framework parses recoverable input. `TransformStream` + `TextDecoderStream` replace the hand-rolled SSE codec; `hono/streaming` stops being a dependency on the loader/action stream path. `document.startViewTransition` becomes an opt-in pass-through wrapper for `useOptimistic` settle/revert.

The outcome envelope grows one new variant; nothing else in the public type surface changes shape.

## Detailed design

### 1. Cancellation and timeouts

**Public API additions.**

```ts
// packages/iso/src/define-loader.ts
defineLoader(fn, { timeoutMs?: number | false, /* existing options */ })

// packages/iso/src/define-action.ts
defineAction(fn, { timeoutMs?: number | false, /* existing options */ })
```

`timeoutMs` defaults to `30_000`. Passing `false` opts out (no timeout, only the request signal aborts). Passing a number sets a per-call deadline. The option lives next to the existing `params` / `cache` / `use` config.

**Outcome envelope grows one variant** in `packages/iso/src/outcomes.ts`:

```ts
type TimeoutOutcome = { __outcome: 'timeout', kind: 'timeout', timeoutMs: number };
export function isTimeout(o: unknown): o is TimeoutOutcome;
```

Added to the `Outcome` union alongside `redirect`, `deny`, `render`. Server-side serialization stays JSON; client-side `useData()` / `useAction()` expose it through their existing `error` slot, distinguishable via `isTimeout(error)`.

**Signal composition** in `packages/server/src/loaders-handler.ts` and `actions-handler.ts`:

```ts
const deadline = timeoutMs === false ? undefined : AbortSignal.timeout(timeoutMs);
const signal = deadline
  ? AbortSignal.any([c.req.raw.signal, deadline])
  : c.req.raw.signal;
const ctx: LoaderCtx = { c, location, signal };
```

When the deadline fires, the loader's own `await fetch(..., { signal })` rejects with `DOMException('TimeoutError')`. The handler catches, inspects `signal.reason`, and returns a `TimeoutOutcome` instead of the generic loader-failed error. Same flow for actions.

**Resolution timing.** The resolved `timeoutMs` is attached to the loader/action stub's metadata at `defineLoader` / `defineAction` time, so handlers read it from the stub rather than re-resolving defaults per request.

**Browser side does not enforce its own timeout.** The fetch to `/__loaders` carries only the user's optional `AbortSignal`. Adding client-side timeouts would couple browser code to server config; the simpler path is server enforces, client observes.

**Streaming loaders.** The timeout applies to *time-to-completion* of the stream, not time-to-first-chunk. Users wanting long-running streams pass `timeoutMs: false`. Documented; no clever heuristics.

**Runtime caveats.** Node `AbortSignal.any` memory-leak (`nodejs/node#57736`) and workerd `AbortSignal.timeout` `DOMException` (`workerd#1020`) are both fixed in current supported releases. The plan calls out a smoke test on both runtimes; no defensive code in the framework.

### 2. View Transitions in `useOptimistic`

**Public API additions.**

```ts
useOptimistic<S, A>(reducer, initial, { transition?: boolean })
useOptimisticAction<...>(action, { transition?: boolean, /* existing options */ })
```

`transition` defaults to `false`. When `true`, the **settle** (success → reconcile authoritative state) and **revert** (error → drop optimistic entry) paths are wrapped in `document.startViewTransition`. The initial `mutate()` path is **not** wrapped: optimistic UI's whole point is a same-frame paint, and `startViewTransition` defers the next render by at least one frame.

**Implementation site** in `packages/iso/src/optimistic.ts`. Illustrative pseudocode (actual function shape will be threaded through the existing internals during the plan):

```ts
function commit(reason: 'mutate' | 'settle' | 'revert', next: QueueEntry[]) {
  const wantsTransition =
    options.transition === true &&
    reason !== 'mutate' &&
    typeof document !== 'undefined' &&
    typeof document.startViewTransition === 'function';

  if (wantsTransition) {
    document.startViewTransition(() => { queue.current = next; rerender(); });
  } else {
    queue.current = next;
    rerender();
  }
}
```

Feature detection is per-call and runtime-only.

**`useOptimisticAction`** composes over `useOptimistic` and forwards `transition`.

**SSR behavior.** Server render path skips the branch entirely (no `document`). No SSR API change.

**No CSS shipped by the framework.** View Transitions default to a cross-fade with no consumer action. Consumers wanting bespoke animation use standard `::view-transition-*` pseudo-elements and `view-transition-name`. The framework documents the pattern, not the styling.

**Concurrency.** `startViewTransition` queues if one is already in flight. The framework does not coalesce; Preact's batching already collapses multiple state updates into one commit, so we get one transition per commit.

### 3. `URL.parse()` adoption

**Scope.** Every site in the framework that currently does `try { new URL(input) } catch { return null }` or equivalent. Concrete sites identified during planning:

- Link prefetch resolver (wherever an `href` is turned into a comparable location).
- `serializeLocationForCache` and adjacent location-parsing helpers in `packages/iso/src/internal/`.
- `/__loaders` and `/__actions` query-string parsing in the server handlers.

The plan re-verifies the site list with `grep` before editing.

**The change is mechanical:**

```ts
// before
let url: URL | null = null;
try { url = new URL(href, base); } catch {}
if (!url) return null;

// after
const url = URL.parse(href, base);
if (!url) return null;
```

Available in Node 22+, workerd, Deno, Bun, all evergreen browsers (Baseline 2025). No fallback or polyfill.

### 7. TransformStream SSE codec

**Server encoder** in `packages/server/src/sse.ts`:

```ts
function sseEncodeTransform<T>() {
  const encoder = new TextEncoder();
  return new TransformStream<SSEFrame<T>, Uint8Array>({
    transform(frame, controller) {
      const lines: string[] = [];
      if (frame.event) lines.push(`event: ${frame.event}`);
      if (frame.id) lines.push(`id: ${frame.id}`);
      lines.push(`data: ${JSON.stringify(frame.data)}`);
      controller.enqueue(encoder.encode(lines.join('\n') + '\n\n'));
    },
  });
}

function sseGeneratorResponse<T>(gen: AsyncGenerator<SSEFrame<T>>) {
  const source = ReadableStream.from(gen);
  return new Response(source.pipeThrough(sseEncodeTransform()), {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  });
}
```

Observers (`defineStreamObserver` hooks) become additional `TransformStream`s in the pipe, instead of inline branches in the generator loop. Backpressure is implicit through `pipeThrough`. Abort propagates via `ReadableStream.from(gen)` cancellation, which calls the generator's `return()`.

**Client decoder** in `packages/iso/src/internal/sse-decoder.ts`:

```ts
function lineSplitTransform() {
  let buffer = '';
  return new TransformStream<string, string>({
    transform(chunk, controller) {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        controller.enqueue(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    },
    flush(controller) { if (buffer) controller.enqueue(buffer); },
  });
}

async function* readSSE(body: ReadableStream<Uint8Array>) {
  const lines = body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(lineSplitTransform());
  for await (const frame of lines) yield parseSSEFrame(frame);
}
```

**Wire format is preserved byte-for-byte.** The SSE format (`event: ...\ndata: ...\n\n`) is unchanged, so client/server can be deployed independently. This is what makes PR2 safe to ship as internal-only.

**`hono/streaming` is removed** from the loader/action stream path. Still used elsewhere if Hono needs it; this is a per-file change, not a workspace-wide dep removal.

## Testing strategy

**Cancellation and timeouts.**

- Unit: `isTimeout(makeTimeoutOutcome(30000))` is `true`; type narrows correctly.
- Integration: a loader that `await new Promise(() => {})` against a 50 ms timeout produces a `TimeoutOutcome` on the wire, not a generic error. Same for actions.
- `ctx.signal.reason` is `DOMException('TimeoutError')` inside the loader when the timeout fires.
- `timeoutMs: false` disables the deadline; loader hangs until the request signal aborts.
- Per-call override shadows the default.
- Cross-runtime smoke: same integration tests on Node + workerd via the existing matrix.

**`useOptimistic` View Transitions.**

- jsdom does not implement `startViewTransition`. Tests assert the feature-detected `false` branch runs synchronously when `document.startViewTransition` is absent.
- A second suite injects a stub `startViewTransition` onto `document` and asserts settle/revert paths invoke it; mutate path does not.
- `useOptimistic({ transition: false })` (default) never touches `document`.
- SSR test: `useOptimistic({ transition: true })` rendered under `prerender` does not throw and does not reference `document`.

**`URL.parse()`.** Pure refactor; existing tests cover behavior. Add one regression test per replaced site asserting malformed input returns `null` (no thrown exception).

**SSE codec.**

- **Wire-format snapshot:** capture current server output for a representative stream (one start frame, two data frames, one end frame). The new encoder must produce byte-identical output. This is the gate that lets PR2 ship without client/server coupling.
- Encoder unit tests: each `SSEFrame` shape round-trips through the encode → decode pipeline.
- Backpressure: a slow consumer pauses; encoder honors the pause.
- Abort: cancelling the response stream calls the source generator's `return()`.
- Observer integration: `defineStreamObserver` `onChunk` / `onEnd` / `onAbort` fire correctly when implemented as `TransformStream`s in the pipe.

**Verification before completion.** Each PR runs the full test suite on Node and workerd before claiming done. PR2's diff captures the SSE wire-format snapshot.

## Delivery

**PR1 — public API** (no version bump):

- `timeoutMs` option on `defineLoader` / `defineAction`, with 30 s default applied at handler entry.
- `TimeoutOutcome` variant + `isTimeout` guard.
- `transition?: boolean` option on `useOptimistic` / `useOptimisticAction`.
- `URL.parse()` swap across identified sites.
- Docs (`apps/site`) updated in the same PR: a "Timeouts" section under loaders/actions and a "View Transitions" note on `useOptimistic`. Following the site's existing convention, docs describe current behavior only, with no "replaces the old behavior" or migration-breadcrumb language.

**PR2 — internal cleanup** (no version bump):

- TransformStream-based SSE encoder + decoder.
- `hono/streaming` import removed from the loader/action stream path.
- Wire-format snapshot test added.
- No docs change; no public API touched.

**Release.** No `v0.3.0` cut at the end of Spec A. Specs B, C, D, E all merge to `main` first. Once A through E are in, `v0.3.0` is cut as a single coordinated release with `create-hono-preact@0.3.0` lockstep.

## Risk register

- **Default 30 s timeout breaking a long-running loader.** Mitigation: prominently document the default and the `timeoutMs: false` opt-out. The timeout outcome is distinguishable from a generic failure so users diagnose quickly.
- **SSE wire-format drift between PR1 and PR2.** Mitigation: PR2's snapshot test captures PR1's output verbatim. If PR1 changes anything observable on the wire (none of items 1, 2, 3 should), update the snapshot in PR1.
- **`AbortSignal.any` runtime regressions.** Mitigation: existing Node + workerd test matrix. Both relevant runtime bugs are fixed in supported releases; no defensive code.
