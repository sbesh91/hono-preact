# Streaming Loaders + Action Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship streaming loaders, typed action chunks, true streaming HTML SSR, and supporting cleanups per `docs/superpowers/specs/2026-05-11-streaming-loaders-and-actions-design.md`.

**Architecture:** Async generators are the author shape for streaming. SSE (`text/event-stream`) is the wire. The server runs the generator and frames each yield as a `data:` event; for actions, the generator's return value goes out as `event: result`. The client decodes SSE and pushes chunks into either a per-loader subscription (loaders) or an `onChunk` callback (actions). For SSR, the response stays open and chunks are flushed as `<script>__HP_STREAM__.push("loaderId", value)</script>` tags inline in the HTML body.

**Tech Stack:** TypeScript, Preact 10, Hono, Vite, preact-iso, vitest, happy-dom, Web Streams API.

---

## PR boundaries

The plan is organized into four PRs. Each is independently mergeable and produces working software:

- **PR 1 (Tasks 1-7):** Wire primitives + server handlers + typed action client + demo. End state: streaming actions work end-to-end with typed chunks and `event: result`. Static loaders unchanged.
- **PR 2 (Tasks 8-11):** Loader streaming on client. `loader.useData()` re-renders per chunk on client-driven loads; `loader.useError()` ships; `useReload()` cleaned up. End state: streaming loaders work for post-mount navigation/reload.
- **PR 3 (Tasks 12-13):** SSR streaming. Initial page load streams HTML for streaming loaders. End state: "streaming everywhere" complete.
- **PR 4 (Tasks 14-15):** New demo page + docs.

Each task ends with a commit. Each PR boundary marker indicates where to open a PR against `main`.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `packages/server/src/sse.ts` | SSE encoding primitives, generator-to-ReadableStream framer with keepalive + abort. |
| `packages/iso/src/internal/sse-decoder.ts` | Client-side SSE parser (async iterator over a fetch response body). |
| `packages/iso/src/internal/stream-registry.ts` | Per-loader subscription registry (push/end/error per mounted Loader). Used by both client-driven fetches and SSR-bootstrap drainage. |
| `packages/server/src/__tests__/sse.test.ts` | SSE primitives tests. |
| `packages/server/src/__tests__/render-stream.test.ts` | SSR streaming integration tests. |
| `apps/app/src/pages/live-stats.tsx` + `.server.ts` | Demo streaming-loader page (PR 4). |
| `apps/app/src/pages/docs/streaming.mdx` | Docs page (PR 4). |

**Modified files:**

| File | Change |
|---|---|
| `packages/server/src/loaders-handler.ts` | Detect generator/stream returns, emit SSE, validate `location`, bypass cache in dev. |
| `packages/server/src/actions-handler.ts` | Detect generator returns with `TResult` via `event: result`, emit SSE, bypass cache in dev, wrap ctx as `ActionCtx`. |
| `packages/iso/src/define-loader.ts` | `LoaderCtx` gains `signal`. Loader function type accepts generator / `ReadableStream<T>`. `LoaderRef.useError()` added. |
| `packages/iso/src/action.ts` | `ActionStub<TPayload, TResult, TChunk>`. `ActionCtx`. `useAction` consumes SSE; typed `onChunk(TChunk)`; `onSuccess(TResult)` from `event: result`. |
| `packages/iso/src/internal/loader.tsx` | Tracks last-good data + current error; subscribes to streaming SSE; pushes chunks; finalizes on stream close. |
| `packages/iso/src/reload-context.tsx` | Narrows `ReloadContextValue` to `{ reload, reloading }`. |
| `packages/iso/src/internal/contexts.ts` | Adds private `ActiveLoaderIdContext` so `action.ts` can read the active loader id without exposing it on `useReload()`. |
| `packages/server/src/render.tsx` | SSR pipeline: kept-open response, per-loader chunk flushing as `<script>` tags inline in the body, terminator on completion/error/abort. |
| `apps/app/src/pages/watched.server.ts` | `bulkImportWatched` migrates to async generator with typed chunks + return value. |
| `apps/app/src/pages/watched.tsx` | `onChunk` typed; manual newline-parsing removed. |
| `apps/app/src/pages/docs/loaders.mdx`, `actions.mdx` | Cross-links to the new streaming page. |
| Various `__tests__/*.test.ts(x)` | New cases for streaming, ctx.signal, typed chunks, error semantics. |

---

# PR 1: Wire primitives + server handlers + action client + demo migration

This PR makes the SSE wire format real, makes the server emit it for both loaders and actions, types action consumption end-to-end, and migrates the existing `bulkImportWatched` demo to async generators. Static loaders are unchanged; loader streaming is added in PR 2.

---

### Task 1: SSE encoding primitives

**Files:**
- Create: `packages/server/src/sse.ts`
- Create: `packages/server/src/__tests__/sse.test.ts`

- [ ] **Step 1: Write the failing test for `sseEncode`**

Create `packages/server/src/__tests__/sse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sseEncode, SSE_KEEPALIVE, sseEncodeError } from '../sse.js';

const decoder = new TextDecoder();

describe('sseEncode', () => {
  it('encodes a default data-only event', () => {
    const out = sseEncode({ data: '{"x":1}' });
    expect(decoder.decode(out)).toBe('data: {"x":1}\n\n');
  });

  it('encodes a named event', () => {
    const out = sseEncode({ event: 'result', data: '{"ok":true}' });
    expect(decoder.decode(out)).toBe('event: result\ndata: {"ok":true}\n\n');
  });
});

describe('SSE_KEEPALIVE', () => {
  it('is an SSE comment line', () => {
    expect(decoder.decode(SSE_KEEPALIVE)).toBe(': keepalive\n\n');
  });
});

describe('sseEncodeError', () => {
  it('encodes an Error as an event: error frame', () => {
    const out = sseEncodeError(new Error('boom'));
    expect(decoder.decode(out)).toBe('event: error\ndata: {"message":"boom","name":"Error"}\n\n');
  });

  it('falls back to String(value) for non-Error values', () => {
    const out = sseEncodeError('plain string');
    expect(decoder.decode(out)).toBe('event: error\ndata: {"message":"plain string","name":"Error"}\n\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/server/src/__tests__/sse.test.ts`
Expected: FAIL (`Cannot find module '../sse.js'`).

- [ ] **Step 3: Implement the encoder**

Create `packages/server/src/sse.ts`:

```ts
const ENCODER = new TextEncoder();

export function sseEncode(event: { event?: string; data: string }): Uint8Array {
  const prefix = event.event ? `event: ${event.event}\n` : '';
  return ENCODER.encode(`${prefix}data: ${event.data}\n\n`);
}

export const SSE_KEEPALIVE = ENCODER.encode(': keepalive\n\n');

export function sseEncodeError(err: unknown): Uint8Array {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : 'Error';
  return sseEncode({ event: 'error', data: JSON.stringify({ message, name }) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/server/src/__tests__/sse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write failing tests for the generator framer**

Append to `packages/server/src/__tests__/sse.test.ts`:

```ts
import { sseFromGenerator } from '../sse.js';

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

describe('sseFromGenerator', () => {
  it('emits each yield as a data event', async () => {
    async function* gen() {
      yield { a: 1 };
      yield { a: 2 };
    }
    const body = await readAll(sseFromGenerator(gen(), {}));
    expect(body).toBe('data: {"a":1}\n\ndata: {"a":2}\n\n');
  });

  it('emits the return value as event: result when emitResult is true', async () => {
    async function* gen() {
      yield { a: 1 };
      return { ok: true };
    }
    const body = await readAll(sseFromGenerator(gen(), { emitResult: true }));
    expect(body).toBe('data: {"a":1}\n\nevent: result\ndata: {"ok":true}\n\n');
  });

  it('omits the return value when emitResult is false', async () => {
    async function* gen() {
      yield { a: 1 };
      return { ignored: true };
    }
    const body = await readAll(sseFromGenerator(gen(), { emitResult: false }));
    expect(body).toBe('data: {"a":1}\n\n');
  });

  it('emits event: error when the generator throws', async () => {
    async function* gen(): AsyncGenerator<unknown, unknown, unknown> {
      yield { a: 1 };
      throw new Error('bad');
    }
    const body = await readAll(sseFromGenerator(gen(), {}));
    expect(body).toBe(
      'data: {"a":1}\n\nevent: error\ndata: {"message":"bad","name":"Error"}\n\n'
    );
  });

  it('closes the stream early when the abort signal fires', async () => {
    const ac = new AbortController();
    let cancelled = false;
    async function* gen() {
      try {
        yield 1;
        await new Promise((r) => setTimeout(r, 50));
        yield 2;
      } finally {
        cancelled = true;
      }
    }
    const stream = sseFromGenerator(gen(), { signal: ac.signal });
    const reader = stream.getReader();
    await reader.read();
    ac.abort();
    // Drain remaining
    while (!(await reader.read()).done) { /* drain */ }
    expect(cancelled).toBe(true);
  });
});
```

- [ ] **Step 6: Run framer tests to confirm failure**

Run: `pnpm vitest run packages/server/src/__tests__/sse.test.ts`
Expected: 5 new tests FAIL (`sseFromGenerator is not a function`).

- [ ] **Step 7: Implement the framer**

Append to `packages/server/src/sse.ts`:

```ts
export type SseFromGeneratorOptions = {
  emitResult?: boolean;
  signal?: AbortSignal;
};

export function sseFromGenerator(
  gen: AsyncGenerator<unknown, unknown, unknown>,
  options: SseFromGeneratorOptions
): ReadableStream<Uint8Array> {
  const { emitResult = false, signal } = options;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const onAbort = () => {
        gen.return(undefined).catch(() => { /* swallow */ });
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          controller.close();
          return;
        }
        signal.addEventListener('abort', onAbort);
      }

      try {
        while (true) {
          const step = await gen.next();
          if (step.done) {
            if (emitResult && step.value !== undefined) {
              controller.enqueue(
                sseEncode({ event: 'result', data: JSON.stringify(step.value) })
              );
            }
            break;
          }
          controller.enqueue(sseEncode({ data: JSON.stringify(step.value) }));
        }
      } catch (err) {
        controller.enqueue(sseEncodeError(err));
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
        controller.close();
      }
    },
    cancel() {
      gen.return(undefined).catch(() => { /* swallow */ });
    },
  });
}
```

- [ ] **Step 8: Run all SSE tests, confirm passing**

Run: `pnpm vitest run packages/server/src/__tests__/sse.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/sse.ts packages/server/src/__tests__/sse.test.ts
git commit -m "feat(server): SSE encoder + generator-to-ReadableStream framer"
```

---

### Task 2: SSE decoder (client-side parser)

**Files:**
- Create: `packages/iso/src/internal/sse-decoder.ts`
- Create: `packages/iso/src/internal/__tests__/sse-decoder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/sse-decoder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readSSE } from '../sse-decoder.js';

const encoder = new TextEncoder();

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

describe('readSSE', () => {
  it('parses single data events', async () => {
    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(streamOf('data: {"a":1}\n\ndata: {"a":2}\n\n'))) {
      events.push(ev);
    }
    expect(events).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'message', data: '{"a":2}' },
    ]);
  });

  it('parses named events', async () => {
    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(streamOf('event: result\ndata: {"ok":true}\n\n'))) {
      events.push(ev);
    }
    expect(events).toEqual([{ event: 'result', data: '{"ok":true}' }]);
  });

  it('ignores comment lines', async () => {
    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(streamOf(': keepalive\n\ndata: {"a":1}\n\n'))) {
      events.push(ev);
    }
    expect(events).toEqual([{ event: 'message', data: '{"a":1}' }]);
  });

  it('handles chunk boundaries in the middle of an event', async () => {
    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(streamOf('data: {"a":', '1}\n\n'))) {
      events.push(ev);
    }
    expect(events).toEqual([{ event: 'message', data: '{"a":1}' }]);
  });

  it('handles CRLF line endings', async () => {
    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(streamOf('data: {"a":1}\r\n\r\n'))) {
      events.push(ev);
    }
    expect(events).toEqual([{ event: 'message', data: '{"a":1}' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/sse-decoder.test.ts`
Expected: FAIL (`Cannot find module '../sse-decoder.js'`).

- [ ] **Step 3: Implement the decoder**

Create `packages/iso/src/internal/sse-decoder.ts`:

```ts
export type SSEEvent = { event: string; data: string };

export async function* readSSE(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let dataLines: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        // Flush any final pending event without trailing blank line
        if (dataLines.length) yield { event, data: dataLines.join('\n') };
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);

        if (line === '') {
          if (dataLines.length) {
            yield { event, data: dataLines.join('\n') };
          }
          event = 'message';
          dataLines = [];
        } else if (line.startsWith(':')) {
          // SSE comment / keepalive, ignore
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        // Other fields (id:, retry:) are ignored in v0.1
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/sse-decoder.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/sse-decoder.ts packages/iso/src/internal/__tests__/sse-decoder.test.ts
git commit -m "feat(iso): SSE decoder as async generator over a fetch response"
```

---

### Task 3: `loadersHandler` emits SSE for streaming returns + validates `location` + bypasses cache in dev

**Files:**
- Modify: `packages/server/src/loaders-handler.ts`
- Modify: `packages/server/src/__tests__/loaders-handler.test.ts`

- [ ] **Step 1: Add failing tests for streaming + location validation + dev cache**

Append to `packages/server/src/__tests__/loaders-handler.test.ts` (look up the existing helper named `makeApp`, `post`, or similar: match its style):

```ts
describe('loadersHandler: streaming', () => {
  it('frames a generator-returning loader as SSE', async () => {
    const app = makeApp({
      './pages/x.server.ts': {
        __moduleKey: 'x',
        default: async function* () {
          yield { tick: 1 };
          yield { tick: 2 };
        },
      },
    });

    const res = await post(app, {
      module: 'x',
      location: { path: '/x', pathParams: {}, searchParams: {} },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const body = await res.text();
    expect(body).toContain('data: {"tick":1}');
    expect(body).toContain('data: {"tick":2}');
  });

  it('frames a ReadableStream<T>-returning loader as SSE', async () => {
    const app = makeApp({
      './pages/x.server.ts': {
        __moduleKey: 'x',
        default: async () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({ tick: 1 });
              controller.close();
            },
          }),
      },
    });

    const res = await post(app, {
      module: 'x',
      location: { path: '/x', pathParams: {}, searchParams: {} },
    });
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const body = await res.text();
    expect(body).toContain('data: {"tick":1}');
  });
});

describe('loadersHandler: location validation', () => {
  it('rejects missing location', async () => {
    const app = makeApp({ './pages/x.server.ts': { __moduleKey: 'x', default: async () => ({}) } });
    const res = await post(app, { module: 'x' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/location/);
  });

  it('rejects location missing path or pathParams', async () => {
    const app = makeApp({ './pages/x.server.ts': { __moduleKey: 'x', default: async () => ({}) } });
    const res = await post(app, { module: 'x', location: { searchParams: {} } });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pnpm vitest run packages/server/src/__tests__/loaders-handler.test.ts`
Expected: new tests FAIL (existing pass).

- [ ] **Step 3: Update the handler to validate location and frame streams**

Replace the body of `packages/server/src/loaders-handler.ts`:

```ts
import type { MiddlewareHandler } from 'hono';
import { runRequestScope } from '@hono-preact/iso/internal';
import { sseFromGenerator, sseEncode, sseEncodeError } from './sse.js';

type GlobModule = {
  default?: unknown;
  __moduleKey?: unknown;
  [key: string]: unknown;
};
type LazyGlob = Record<string, () => Promise<unknown>>;
type EagerGlob = Record<string, GlobModule>;

type SerializedLocation = {
  path: string;
  pathParams: Record<string, string>;
  searchParams: Record<string, string>;
};

type LoaderFn = (props: {
  location: SerializedLocation;
  signal: AbortSignal;
}) => Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>;

async function buildLoadersMap(
  glob: LazyGlob | EagerGlob
): Promise<Record<string, LoaderFn>> {
  const result: Record<string, LoaderFn> = {};
  for (const [, moduleOrLoader] of Object.entries(glob)) {
    const mod =
      typeof moduleOrLoader === 'function'
        ? await (moduleOrLoader as () => Promise<GlobModule>)()
        : (moduleOrLoader as GlobModule);
    const key = mod.__moduleKey;
    if (typeof key === 'string' && typeof mod.default === 'function') {
      result[key] = mod.default as LoaderFn;
    }
  }
  return result;
}

function validateLocation(loc: unknown): SerializedLocation | null {
  if (typeof loc !== 'object' || loc === null) return null;
  const o = loc as Record<string, unknown>;
  if (typeof o.path !== 'string') return null;
  if (typeof o.pathParams !== 'object' || o.pathParams === null) return null;
  if (typeof o.searchParams !== 'object' || o.searchParams === null) return null;
  return {
    path: o.path,
    pathParams: o.pathParams as Record<string, string>,
    searchParams: o.searchParams as Record<string, string>,
  };
}

function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown, unknown, unknown> {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function' &&
    typeof (value as { next?: unknown }).next === 'function'
  );
}

function readableStreamToSse(stream: ReadableStream<unknown>): ReadableStream<Uint8Array> {
  // Convert a ReadableStream<T> (where T is JSON-encodable) into an SSE Uint8Array stream.
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(sseEncode({ data: JSON.stringify(value) }));
        }
      } catch (err) {
        controller.enqueue(sseEncodeError(err));
      } finally {
        controller.close();
      }
    },
    cancel() {
      reader.cancel().catch(() => { /* swallow */ });
    },
  });
}

export function loadersHandler(glob: LazyGlob | EagerGlob): MiddlewareHandler {
  let cachedMapPromise: Promise<Record<string, LoaderFn>> | null = null;

  return async (c) => {
    const loadersMapPromise =
      import.meta.env.DEV
        ? buildLoadersMap(glob)
        : (cachedMapPromise ??= buildLoadersMap(glob).catch((err) => {
            cachedMapPromise = null;
            return Promise.reject(err);
          }));

    let loadersMap: Record<string, LoaderFn>;
    try {
      loadersMap = await loadersMapPromise;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to load loaders: ${message}` }, 503);
    }

    let body: { module: unknown; location: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { module, location } = body;
    if (typeof module !== 'string') {
      return c.json(
        { error: 'Request body must include string field: module' },
        400
      );
    }

    const validatedLocation = validateLocation(location);
    if (!validatedLocation) {
      return c.json(
        {
          error:
            'Request body must include object field: location with shape { path: string, pathParams: object, searchParams: object }',
        },
        400
      );
    }

    const loader = loadersMap[module];
    if (!loader) {
      return c.json({ error: `Module '${module}' not found` }, 404);
    }

    const signal = c.req.raw.signal;

    try {
      const result = await runRequestScope(() =>
        Promise.resolve(loader({ location: validatedLocation, signal }))
      );

      if (isAsyncGenerator(result)) {
        return new Response(sseFromGenerator(result, { emitResult: false, signal }), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      if (result instanceof ReadableStream) {
        return new Response(readableStreamToSse(result as ReadableStream<unknown>), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  };
}
```

- [ ] **Step 4: Run tests to confirm streaming and validation now pass**

Run: `pnpm vitest run packages/server/src/__tests__/loaders-handler.test.ts`
Expected: PASS for all (existing + new streaming + new validation tests).

- [ ] **Step 5: Verify full test suite still green**

Run: `pnpm vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/loaders-handler.ts packages/server/src/__tests__/loaders-handler.test.ts
git commit -m "feat(server): loadersHandler frames generators as SSE + validates location + dev cache bypass"
```

---

### Task 4: `actionsHandler` frames generators with `event: result`, threads `ActionCtx`, dev cache bypass

**Files:**
- Modify: `packages/server/src/actions-handler.ts`
- Modify: `packages/server/src/__tests__/actions-handler.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/server/src/__tests__/actions-handler.test.ts`:

```ts
describe('actionsHandler: streaming', () => {
  it('frames a generator action as SSE with event: result', async () => {
    const app = makeApp({
      './pages/x.server.ts': {
        __moduleKey: 'x',
        serverActions: {
          go: async function* () {
            yield { count: 1 };
            yield { count: 2 };
            return { imported: 2 };
          },
        },
      },
    });

    const res = await post(app, { module: 'x', action: 'go', payload: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const body = await res.text();
    expect(body).toContain('data: {"count":1}');
    expect(body).toContain('data: {"count":2}');
    expect(body).toContain('event: result\ndata: {"imported":2}');
  });

  it('frames thrown errors mid-generator as event: error', async () => {
    const app = makeApp({
      './pages/x.server.ts': {
        __moduleKey: 'x',
        serverActions: {
          go: async function* () {
            yield { count: 1 };
            throw new Error('boom');
          },
        },
      },
    });

    const res = await post(app, { module: 'x', action: 'go', payload: {} });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('data: {"count":1}');
    expect(body).toContain('event: error');
    expect(body).toContain('"message":"boom"');
  });

  it('passes ctx with c and signal to the action function', async () => {
    let observed: { hasC: boolean; hasSignal: boolean } = { hasC: false, hasSignal: false };
    const app = makeApp({
      './pages/x.server.ts': {
        __moduleKey: 'x',
        serverActions: {
          probe: async (ctx: { c: unknown; signal: AbortSignal }, _payload: unknown) => {
            observed = {
              hasC: typeof ctx.c === 'object' && ctx.c !== null,
              hasSignal: ctx.signal instanceof AbortSignal,
            };
            return { ok: true };
          },
        },
      },
    });

    await post(app, { module: 'x', action: 'probe', payload: {} });
    expect(observed.hasC).toBe(true);
    expect(observed.hasSignal).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pnpm vitest run packages/server/src/__tests__/actions-handler.test.ts`
Expected: new streaming tests FAIL (or partially pass with the existing bare-stream code).

- [ ] **Step 3: Update the actions handler**

Modify `packages/server/src/actions-handler.ts`. Replace the body after the guards block (the `try { const result = await runRequestScope(...) }` block) with:

```ts
    const signal = c.req.raw.signal;
    const actionCtx = { c, signal };

    let result: unknown;
    try {
      result = await runRequestScope(() =>
        (fn as (ctx: unknown, payload: unknown) => Promise<unknown>)(actionCtx, payload)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }

    if (isAsyncGenerator(result)) {
      return new Response(sseFromGenerator(result, { emitResult: true, signal }), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    if (result instanceof ReadableStream) {
      return new Response(readableStreamToSse(result as ReadableStream<unknown>), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return c.json(result);
```

Add imports at the top:

```ts
import { sseFromGenerator, sseEncode, sseEncodeError } from './sse.js';
```

Add the `isAsyncGenerator` and `readableStreamToSse` helpers near the top of the file (copy them from `loaders-handler.ts`: extract into a shared module in a follow-up if duplication bites, or extract now):

```ts
function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown, unknown, unknown> {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function' &&
    typeof (value as { next?: unknown }).next === 'function'
  );
}

function readableStreamToSse(stream: ReadableStream<unknown>): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(sseEncode({ data: JSON.stringify(value) }));
        }
      } catch (err) {
        controller.enqueue(sseEncodeError(err));
      } finally {
        controller.close();
      }
    },
    cancel() {
      reader.cancel().catch(() => { /* swallow */ });
    },
  });
}
```

Apply the dev-cache bypass to the actions-map resolution (mirror the loaders-handler pattern):

```ts
  let cachedMapPromise: Promise<Record<string, ModuleEntry>> | null = null;

  return async (c) => {
    const actionsMapPromise =
      import.meta.env.DEV
        ? buildActionsMap(glob)
        : (cachedMapPromise ??= buildActionsMap(glob).catch((err) => {
            cachedMapPromise = null;
            return Promise.reject(err);
          }));
    // ...
```

- [ ] **Step 4: Run actions tests to confirm pass**

Run: `pnpm vitest run packages/server/src/__tests__/actions-handler.test.ts`
Expected: PASS (existing + new streaming tests).

- [ ] **Step 5: Run full server-package tests**

Run: `pnpm vitest run packages/server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/actions-handler.ts packages/server/src/__tests__/actions-handler.test.ts
git commit -m "feat(server): actionsHandler frames generators as SSE with event: result + ActionCtx + dev cache bypass"
```

---

### Task 5: Extract shared helpers into `packages/server/src/sse.ts`

The `isAsyncGenerator` and `readableStreamToSse` helpers now duplicate across both handlers. Move them to `sse.ts` before they drift.

**Files:**
- Modify: `packages/server/src/sse.ts`
- Modify: `packages/server/src/loaders-handler.ts`
- Modify: `packages/server/src/actions-handler.ts`

- [ ] **Step 1: Move helpers into `sse.ts`**

Append to `packages/server/src/sse.ts`:

```ts
export function isAsyncGenerator(
  value: unknown
): value is AsyncGenerator<unknown, unknown, unknown> {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function' &&
    typeof (value as { next?: unknown }).next === 'function'
  );
}

export function readableStreamToSse(
  stream: ReadableStream<unknown>
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(sseEncode({ data: JSON.stringify(value) }));
        }
      } catch (err) {
        controller.enqueue(sseEncodeError(err));
      } finally {
        controller.close();
      }
    },
    cancel() {
      reader.cancel().catch(() => { /* swallow */ });
    },
  });
}
```

- [ ] **Step 2: Delete the duplicated copies from both handlers**

In `packages/server/src/loaders-handler.ts` and `packages/server/src/actions-handler.ts`, remove the local `isAsyncGenerator` and `readableStreamToSse` definitions; import them from `./sse.js`:

```ts
import {
  sseFromGenerator,
  sseEncode,
  sseEncodeError,
  isAsyncGenerator,
  readableStreamToSse,
} from './sse.js';
```

- [ ] **Step 3: Run all server tests to confirm pass**

Run: `pnpm vitest run packages/server`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/sse.ts packages/server/src/loaders-handler.ts packages/server/src/actions-handler.ts
git commit -m "refactor(server): hoist isAsyncGenerator + readableStreamToSse into sse.ts"
```

---

### Task 6: Typed `useAction` consumption (typed `onChunk`, `TResult` from `event: result`)

**Files:**
- Modify: `packages/iso/src/action.ts`
- Modify: `packages/iso/src/__tests__/action.test.tsx`

- [ ] **Step 1: Write the failing test for typed `onChunk` + `event: result`**

Append to `packages/iso/src/__tests__/action.test.tsx` (match the file's existing test style; helpers below assume vitest + happy-dom + a `mockFetch` fixture: adapt to whatever the existing tests use):

```ts
describe('useAction: streaming via SSE', () => {
  it('routes each data event to onChunk and the event:result to onSuccess/data', async () => {
    const chunks: Array<{ count: number }> = [];
    let final: { imported: number } | null = null;

    const sse =
      'data: {"count":1}\n\n' +
      'data: {"count":2}\n\n' +
      'event: result\ndata: {"imported":2}\n\n';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(sse, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const stub = { __module: 'x', __action: 'go' } as ActionStub<unknown, { imported: number }, { count: number }>;

    function Probe() {
      const { mutate } = useAction(stub, {
        onChunk: (c) => { chunks.push(c); },
        onSuccess: (r) => { final = r; },
      });
      return <button data-testid="go" onClick={() => mutate({})}>go</button>;
    }

    const { findByTestId } = render(<Probe />);
    fireEvent.click(await findByTestId('go'));
    await waitFor(() => expect(final).not.toBeNull());

    expect(chunks).toEqual([{ count: 1 }, { count: 2 }]);
    expect(final).toEqual({ imported: 2 });
  });

  it('routes event: error to onError and rejects the mutate', async () => {
    const sse =
      'data: {"count":1}\n\n' +
      'event: error\ndata: {"message":"boom","name":"Error"}\n\n';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(sse, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
    );

    const stub = { __module: 'x', __action: 'go' } as ActionStub<unknown, unknown, { count: number }>;
    let caught: Error | null = null;
    let chunks = 0;

    function Probe() {
      const { mutate } = useAction(stub, {
        onChunk: () => { chunks++; },
        onError: (err) => { caught = err; },
      });
      return <button data-testid="go" onClick={() => mutate({})}>go</button>;
    }

    const { findByTestId } = render(<Probe />);
    fireEvent.click(await findByTestId('go'));
    await waitFor(() => expect(caught).not.toBeNull());
    expect(caught?.message).toBe('boom');
    expect(chunks).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pnpm vitest run packages/iso/src/__tests__/action.test.tsx`
Expected: new tests FAIL (the existing `onChunk(chunk: string)` branch will deliver framed bytes-as-text, not parsed objects, AND there's no `event:result` parsing).

- [ ] **Step 3: Update `ActionStub` types**

In `packages/iso/src/action.ts`, update the types:

```ts
export type ActionStub<TPayload, TResult, TChunk = never> = {
  readonly __module: string;
  readonly __action: string;
  readonly __phantom?: readonly [TPayload, TResult, TChunk];
  useAction<TSnapshot = unknown>(
    options?: UseActionOptions<TPayload, TResult, TChunk, TSnapshot>
  ): UseActionResult<TPayload, TResult>;
};

export type ActionCtx = {
  c: unknown;
  signal: AbortSignal;
};

export type ActionFn<TPayload, TResult, TChunk = never> =
  | ((ctx: ActionCtx, payload: TPayload) => Promise<TResult>)
  | ((ctx: ActionCtx, payload: TPayload) => Promise<ReadableStream<TChunk>>)
  | ((ctx: ActionCtx, payload: TPayload) => AsyncGenerator<TChunk, TResult, unknown>);

export function defineAction<TPayload, TResult, TChunk = never>(
  fn: ActionFn<TPayload, TResult, TChunk>
): ActionStub<TPayload, TResult, TChunk> {
  return fn as unknown as ActionStub<TPayload, TResult, TChunk>;
}

export type UseActionOptions<TPayload, TResult, TChunk = never, TSnapshot = unknown> = {
  invalidate?: 'auto' | false | ReadonlyArray<LoaderRef<unknown>>;
  onMutate?: (payload: TPayload) => TSnapshot;
  onChunk?: (chunk: TChunk) => void;
  onError?: (err: Error, snapshot: TSnapshot) => void;
  onSuccess?: (data: TResult, snapshot: TSnapshot) => void;
};
```

- [ ] **Step 4: Replace the streaming branch of `useAction` with SSE-aware decoding**

In the `mutate` callback of `useAction`, replace the existing streaming branch (lines 103-119 in `action.ts`):

```ts
      const contentType = response.headers.get('Content-Type') ?? '';
      if (contentType.includes('text/event-stream') && response.body) {
        const { readSSE } = await import('./internal/sse-decoder.js');
        let resultValue: TResult | undefined;
        let streamError: Error | null = null;
        for await (const ev of readSSE(response.body)) {
          if (ev.event === 'message') {
            try {
              currentOptions?.onChunk?.(JSON.parse(ev.data) as TChunk);
            } catch {
              // malformed JSON in stream: skip
            }
          } else if (ev.event === 'result') {
            try {
              resultValue = JSON.parse(ev.data) as TResult;
            } catch {
              // malformed
            }
          } else if (ev.event === 'error') {
            try {
              const parsed = JSON.parse(ev.data) as { message?: string; name?: string };
              streamError = new Error(parsed.message ?? 'Streamed error');
              if (parsed.name) streamError.name = parsed.name;
            } catch {
              streamError = new Error('Streamed error');
            }
          }
        }

        if (streamError) {
          throw streamError;
        }
        if (resultValue !== undefined) {
          setData(resultValue);
          currentOptions?.onSuccess?.(resultValue, snapshot as TSnapshot);
        } else {
          currentOptions?.onSuccess?.(undefined as unknown as TResult, snapshot as TSnapshot);
        }
      } else {
        const result = (await response.json()) as TResult;
        setData(result);
        currentOptions?.onSuccess?.(result, snapshot as TSnapshot);
      }
```

- [ ] **Step 5: Update `useAction` generic signature**

```ts
export function useAction<TPayload, TResult, TChunk = never, TSnapshot = unknown>(
  stub: ActionStub<TPayload, TResult, TChunk>,
  options?: UseActionOptions<TPayload, TResult, TChunk, TSnapshot>
): UseActionResult<TPayload, TResult> {
  // ... body unchanged except for the streaming branch above
}
```

- [ ] **Step 6: Run action tests, confirm pass**

Run: `pnpm vitest run packages/iso/src/__tests__/action.test.tsx`
Expected: PASS (existing + new).

- [ ] **Step 7: Run full test suite to surface fallout from `ActionStub` type changes**

Run: `pnpm vitest run`
Expected: PASS, or surface a few sites that need a `TChunk` annotation.

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src/action.ts packages/iso/src/__tests__/action.test.tsx
git commit -m "feat(iso): typed onChunk + event:result via SSE decoder; ActionStub gains TChunk; ActionCtx wraps c+signal"
```

---

### Task 7: Demo migration: `bulkImportWatched` to async generator + typed `onChunk`

**Files:**
- Modify: `apps/app/src/pages/watched.server.ts`
- Modify: `apps/app/src/pages/watched.tsx`

- [ ] **Step 1: Migrate the action**

Replace the `bulkImportWatched` block in `apps/app/src/pages/watched.server.ts`:

```ts
  bulkImportWatched: defineAction(async function* (ctx) {
    const target = (await getMovies()).results.slice(0, 20);
    for (let i = 0; i < target.length; i++) {
      if (ctx.signal.aborted) return { imported: i };
      await markWatched(target[i].id);
      yield { count: i + 1, total: target.length };
      await new Promise((r) => setTimeout(r, 150));
    }
    return { imported: target.length };
  }),
```

- [ ] **Step 2: Migrate the consumer**

Replace the `bulkImport` `useAction` block in `apps/app/src/pages/watched.tsx`:

```tsx
  const { mutate: bulkImport, pending: importing } = useAction(
    serverActions.bulkImportWatched,
    {
      onChunk: (progress) => setProgress(progress),
      invalidate: [moviesListLoader],
      onSuccess: () => {
        setProgress(null);
        reload.reload();
      },
    }
  );
```

The local `progress` state already has the right shape (`{ count, total } | null`); the only change is that `onChunk` receives a typed `Progress` directly without the manual split-and-parse logic.

- [ ] **Step 3: Run app build to verify the migration types-check**

Run: `pnpm -r build`
Expected: PASS.

- [ ] **Step 4: Start the dev server and verify the bulk-import button works**

```bash
pnpm --filter app dev
```

Open `/watched`, click "Bulk-import next 20", confirm the progress counter ticks up and the table refreshes when the import completes.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/watched.server.ts apps/app/src/pages/watched.tsx
git commit -m "feat(app): bulkImportWatched migrates to async generator + typed onChunk"
```

---

### PR 1 boundary

At this point: server emits SSE for streaming returns. Actions stream end-to-end with typed chunks and typed final results. The demo's bulk-import flow is the integration test.

```bash
git checkout -b feat/streaming-actions-and-wire
git push -u origin feat/streaming-actions-and-wire
gh pr create --title "feat: SSE wire + streaming-action parity (spec §5 PR 1)" --body "$(cat <<'EOF'
## Summary
Implements PR 1 of \`docs/superpowers/specs/2026-05-11-streaming-loaders-and-actions-design.md\`:
- SSE encoder / decoder primitives
- \`loadersHandler\` and \`actionsHandler\` frame generators as SSE; actions emit \`event: result\` for return values
- \`useAction\` consumes SSE; typed \`onChunk\`; typed \`TResult\` from \`event: result\`
- \`ActionStub\` gains \`TChunk\` generic; \`ActionCtx\` wraps \`{ c, signal }\`
- \`loadersHandler\` validates request \`location\` shape (punch list #5)
- Both handlers bypass cache in \`import.meta.env.DEV\` (punch list #6)
- Demo: \`bulkImportWatched\` migrates to async generator + typed \`onChunk\`

## Test plan
- [x] \`pnpm vitest run\`: all packages green
- [x] \`pnpm -r build\`: types check
- [ ] Reviewer: \`pnpm --filter app dev\`, open \`/watched\`, click "Bulk-import next 20", confirm progress + completion + table refresh

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Wait for review, merge, then start PR 2 from `main`.

---

# PR 2: Loader streaming on client

This PR adds streaming-loader support on the client side: `loader.useData()` re-renders on each chunk, `loader.useError()` exposes errors declaratively, and `useReload()` is cleaned up. Initial-load SSR still consumes the generator to completion server-side and renders once (PR 3 changes that).

---

### Task 8: `useReload()` cleanup + `ActiveLoaderIdContext`

The change to `useAction`'s `invalidate-list` reader needs an internal context first, so do this before the cleanup.

**Files:**
- Modify: `packages/iso/src/internal/contexts.ts`
- Modify: `packages/iso/src/internal/loader.tsx`
- Modify: `packages/iso/src/action.ts`
- Modify: `packages/iso/src/reload-context.tsx`
- Modify: `packages/iso/src/internal/__tests__/loader.test.tsx`

- [ ] **Step 1: Add the internal context**

Append to `packages/iso/src/internal/contexts.ts`:

```ts
export const ActiveLoaderIdContext = createContext<symbol | null>(null);
```

- [ ] **Step 2: Have `internal/loader.tsx` provide both contexts**

In `packages/iso/src/internal/loader.tsx`, find the `LoaderHost` return and wrap the children in `ActiveLoaderIdContext.Provider` (keep `ReloadContext.Provider` too for now):

```tsx
import { ActiveLoaderIdContext } from './contexts.js';

// ... inside LoaderHost return:
return (
  <ActiveLoaderIdContext.Provider value={loaderRef.__id}>
    <ReloadContext.Provider
      value={{
        reload,
        reloading,
      }}
    >
      <Suspense fallback={fallback}>
        <DataReader
          reader={readerRef.current}
          overrideData={overrideData}
        >
          {children}
        </DataReader>
      </Suspense>
    </ReloadContext.Provider>
  </ActiveLoaderIdContext.Provider>
);
```

Note: the `ReloadContext` value now omits `error` and `loaderId`.

- [ ] **Step 3: Update `useAction` to read the active loader id from `ActiveLoaderIdContext`**

In `packages/iso/src/action.ts`, near the top of the `useAction` body, replace:

```ts
  const reloadCtx = useContext(ReloadContext);
```

with:

```ts
  const reloadCtx = useContext(ReloadContext);
  const activeLoaderId = useContext(ActiveLoaderIdContext);
```

Update the invalidate-list branch later in the function:

```ts
      } else if (Array.isArray(currentOptions?.invalidate)) {
        let invalidatedActive = false;
        for (const ref of currentOptions.invalidate) {
          ref.invalidate();
          if (activeLoaderId && ref.__id === activeLoaderId) {
            invalidatedActive = true;
          }
        }
        if (invalidatedActive) {
          reloadCtx?.reload();
        }
      }
```

Add the import:

```ts
import { ActiveLoaderIdContext } from './internal/contexts.js';
```

- [ ] **Step 4: Narrow `ReloadContextValue`**

In `packages/iso/src/reload-context.tsx`:

```ts
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

export type ReloadContextValue = {
  reload: () => void;
  reloading: boolean;
};

export const ReloadContext = createContext<ReloadContextValue | undefined>(
  undefined
);

export function useReload(): ReloadContextValue {
  const ctx = useContext(ReloadContext);
  if (!ctx)
    throw new Error('useReload must be called inside a route or <Page> with a loader');
  return ctx;
}
```

- [ ] **Step 5: Run the full test suite**

Run: `pnpm vitest run`
Expected: PASS, or surface tests that read `useReload().error`/`.loaderId`. There should be none (verified during spec drafting), but if so, update them now.

- [ ] **Step 6: Build to verify types**

Run: `pnpm -r build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/internal/contexts.ts packages/iso/src/internal/loader.tsx packages/iso/src/action.ts packages/iso/src/reload-context.tsx
git commit -m "refactor(iso): narrow useReload() to { reload, reloading }; action.ts reads active loader id from internal context"
```

---

### Task 9: `LoaderCtx` adds `signal`; `defineLoader` accepts generators / `ReadableStream<T>`

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Modify: `packages/iso/src/__tests__/define-loader.test.ts`
- Modify: any existing loader call sites whose tests construct a `LoaderCtx` fixture (search for `{ location: ` in test files).

- [ ] **Step 1: Add failing tests**

Append to `packages/iso/src/__tests__/define-loader.test.ts`:

```ts
describe('defineLoader: streaming acceptance', () => {
  it('accepts an async-generator loader', () => {
    const ref = defineLoader(async function* (_ctx) {
      yield { tick: 1 };
      yield { tick: 2 };
    });
    expect(typeof ref.fn).toBe('function');
  });

  it('accepts a ReadableStream<T>-returning loader', () => {
    const ref = defineLoader(async (_ctx) =>
      new ReadableStream<{ tick: number }>({
        start(c) { c.enqueue({ tick: 1 }); c.close(); },
      })
    );
    expect(typeof ref.fn).toBe('function');
  });

  it('passes ctx with location and signal', async () => {
    let seen: { hasLocation: boolean; hasSignal: boolean } | null = null;
    const ref = defineLoader(async (ctx) => {
      seen = {
        hasLocation: typeof ctx.location === 'object',
        hasSignal: ctx.signal instanceof AbortSignal,
      };
      return {};
    });
    const ac = new AbortController();
    await ref.fn({ location: { path: '/', pathParams: {}, searchParams: {} } as any, signal: ac.signal });
    expect(seen).toEqual({ hasLocation: true, hasSignal: true });
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm vitest run packages/iso/src/__tests__/define-loader.test.ts`
Expected: the signal test FAILS; the others may pass at the type level but should fail typechecking until we update the type.

- [ ] **Step 3: Update `LoaderCtx` and `Loader<T>` types**

In `packages/iso/src/define-loader.ts`:

```ts
export type LoaderCtx = {
  location: RouteHook;
  signal: AbortSignal;
};

export type Loader<T> =
  | ((ctx: LoaderCtx) => Promise<T>)
  | ((ctx: LoaderCtx) => Promise<ReadableStream<T>>)
  | ((ctx: LoaderCtx) => AsyncGenerator<T, void, unknown>);
```

The `LoaderRef<T>.fn` signature follows. No runtime change here; the runtime adaptation lives in `internal/loader.tsx` (Task 10).

- [ ] **Step 4: Update internal callers to pass `signal`**

Search `packages/iso/src` and `packages/server/src` for `loaderRef.fn({` and `loader({`. Three call sites should exist:
- `packages/iso/src/internal/loader.tsx`: the suspense-bound load and the reload path. Construct a per-mount `AbortController`; pass `ac.signal`; abort on unmount (`useEffect` cleanup).
- `packages/server/src/loaders-handler.ts`: already passes `signal: c.req.raw.signal` (Task 3).
- Server-side preload in `packages/server/src/render.tsx`: pass a fresh `AbortController` whose lifetime matches the request, or pass `c.req.raw.signal` directly. (Task 12 reworks render.tsx; for now, just thread a signal.)

In `packages/iso/src/internal/loader.tsx`, define a `useRef<AbortController | null>(null)` near the existing refs; on each new load (first render or location/loader change), abort the previous controller and allocate a new one; pass its signal to `loaderRef.fn({ location, signal })`.

Concretely, near the readerRef construction block:

```tsx
  const abortRef = useRef<AbortController | null>(null);
  // ... where the loader is invoked:
  if (abortRef.current) abortRef.current.abort();
  abortRef.current = new AbortController();
  const signal = abortRef.current.signal;
  // pass into loaderRef.fn({ location, signal })
```

And add a cleanup `useEffect`:

```tsx
  useEffect(() => () => {
    if (abortRef.current) abortRef.current.abort();
  }, []);
```

- [ ] **Step 5: Update test fixtures**

Search test files for places that call `loaderRef.fn({ location:` and add `signal: new AbortController().signal` (or pass a real abort signal if the test exercises abort behavior).

- [ ] **Step 6: Run tests, confirm pass**

Run: `pnpm vitest run packages/iso`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/internal/loader.tsx packages/iso/src/__tests__/define-loader.test.ts
git commit -m "feat(iso): LoaderCtx gains signal; Loader<T> accepts generator and ReadableStream<T>"
```

---

### Task 10: `loader.useError()` + last-good-on-error semantics

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Modify: `packages/iso/src/internal/loader.tsx`
- Modify: `packages/iso/src/internal/contexts.ts`
- Modify: `packages/iso/src/internal/__tests__/loader.test.tsx`

- [ ] **Step 1: Add a context for the loader's error state**

In `packages/iso/src/internal/contexts.ts`:

```ts
export const LoaderErrorContext = createContext<Error | null>(null);
```

- [ ] **Step 2: Write failing tests**

Append to `packages/iso/src/internal/__tests__/loader.test.tsx`:

```tsx
describe('Loader: useError() and last-good semantics', () => {
  it('returns null from useError() when the loader succeeds', async () => {
    const ref = defineLoader(async () => ({ msg: 'hi' }));
    let observed: Error | null | undefined = undefined;
    function Child() {
      observed = ref.useError();
      return null;
    }
    render(/* mount with LocationProvider and a Loader */);
    await waitFor(() => expect(observed).toBe(null));
  });

  it('returns the error after a post-first-chunk failure and keeps last-good data', async () => {
    let chunkIdx = 0;
    const ref = defineLoader(async function* () {
      yield { count: 1 };
      yield { count: 2 };
      throw new Error('mid-stream');
    });

    let data: { count: number } | null = null;
    let err: Error | null = null;
    function Child() {
      data = ref.useData();
      err = ref.useError();
      return null;
    }
    render(/* mount the streaming-loader page */);
    await waitFor(() => expect(err).not.toBeNull());
    expect(data).toEqual({ count: 2 });
    expect(err?.message).toBe('mid-stream');
  });
});
```

(These tests need integration scaffolding for the Loader component; if the existing test file has a `mountLoader` helper, use it; if not, follow the patterns in adjacent tests like `define-routes.test.tsx`.)

- [ ] **Step 3: Run tests to confirm failure**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/loader.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Add `useError()` to `LoaderRef`**

In `packages/iso/src/define-loader.ts`, extend `LoaderRef<T>`:

```ts
export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly fn: Loader<T>;
  readonly cache: LoaderCache<T>;
  useData(): T;
  useError(): Error | null;
  invalidate(): void;
}
```

And in `defineLoader`:

```ts
  const ref: LoaderRef<T> = {
    __id,
    fn,
    cache,
    useData() {
      const ctx = useContext(LoaderDataContext);
      if (!ctx) {
        throw new Error(
          'loader.useData() must be called inside a route page that has a loader.'
        );
      }
      return ctx.data as T;
    },
    useError() {
      return useContext(LoaderErrorContext);
    },
    invalidate() {
      cache.invalidate();
    },
  };
```

Add the import:

```ts
import { LoaderDataContext, LoaderErrorContext } from './internal/contexts.js';
```

- [ ] **Step 5: Wire `LoaderErrorContext.Provider` in `LoaderHost`**

In `packages/iso/src/internal/loader.tsx`:

```tsx
import { LoaderDataContext, LoaderIdContext, ActiveLoaderIdContext, LoaderErrorContext } from './contexts.js';

// ... inside LoaderHost return, nest LoaderErrorContext.Provider above DataReader:
return (
  <ActiveLoaderIdContext.Provider value={loaderRef.__id}>
    <ReloadContext.Provider value={{ reload, reloading }}>
      <LoaderErrorContext.Provider value={loadError}>
        <Suspense fallback={fallback}>
          <DataReader reader={readerRef.current} overrideData={overrideData}>
            {children}
          </DataReader>
        </Suspense>
      </LoaderErrorContext.Provider>
    </ReloadContext.Provider>
  </ActiveLoaderIdContext.Provider>
);
```

(The error context value is the existing `loadError` state; semantics extended in next step.)

- [ ] **Step 6: Implement last-good behavior**

Streaming consumption hasn't been wired yet (Task 11 does that); for now, ensure that when `loadError` is set, `useData()` returns the prior good value from `overrideData` rather than re-throwing. Specifically:

The current `DataReader` reads `overrideData !== undefined ? overrideData : reader.read()`. After a post-first-chunk error, we want `overrideData` to hold the last-good value and `loadError` to be set. The `Suspense` reader (`reader.read()`) should NOT throw on a post-first-chunk error.

To achieve this: track a `lastGoodRef` in `LoaderHost`. When the streaming reader emits a chunk, write to `lastGoodRef` and `overrideData`. When the stream errors AFTER the first chunk, set `loadError` but keep `overrideData`. When the stream errors BEFORE the first chunk, let the wrapPromise throw into Suspense (current behavior).

The implementation goes hand-in-hand with Task 11 (streaming subscription). For now, leave the synchronous error path as-is and confirm static loader tests still pass; the streaming-error case will be exercised by Task 11's tests.

- [ ] **Step 7: Run tests, confirm pass for static-loader useError**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/loader.test.tsx -t "useError() and last-good"`
Expected: the "returns null on success" test passes; the "post-first-chunk failure" test may remain failing until Task 11. Mark its assertion with `it.skip` or `it.fails` and add a TODO comment that Task 11 enables it.

Actually: leave both tests as-is and DO NOT mark skip. Task 11 below will enable the streaming-error case.

- [ ] **Step 8: Commit (partial: static case only)**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/internal/contexts.ts packages/iso/src/internal/loader.tsx packages/iso/src/internal/__tests__/loader.test.tsx
git commit -m "feat(iso): loader.useError() + LoaderErrorContext (static-loader case)"
```

---

### Task 11: Streaming loader subscription via SSE

**Files:**
- Modify: `packages/iso/src/internal/loader.tsx`
- Modify: `packages/iso/src/internal/__tests__/loader.test.tsx`

The Loader runtime needs a different code path when the loader is streaming: instead of awaiting a single value, it subscribes to a stream of values, updates `overrideData` on each, and tracks `loadError` if the stream emits an error frame mid-flight.

Today the Loader runs `loaderRef.fn({ location })` directly during the wrapPromise path. For streaming loaders running client-side, we need to call the loader via the `/__loaders` endpoint (so the server runs the generator and frames it as SSE), then consume the SSE stream from the response body.

For client-side fetches, this means: regardless of whether the loader is static or streaming, the client fetches via `/__loaders` and consumes the response. For static loaders the response is JSON (current path); for streaming loaders it's SSE.

On the SERVER side during SSR, the loader is invoked directly (no fetch); that's the existing pattern and Task 12 (SSR streaming) handles the streaming server-render path. This task focuses on **client-driven** loader runs (post-mount navigation, reload, invalidation).

- [ ] **Step 1: Add a client-side `fetchLoaderData` helper**

Create or extend a helper in `packages/iso/src/internal/loader.tsx` (or factor into a new file `packages/iso/src/internal/loader-fetch.ts` if you prefer):

```ts
import { readSSE } from './sse-decoder.js';

export type LoaderSubscription<T> = {
  next: Promise<T>;
  push: (value: T) => void;
  end: () => void;
  error: (err: Error) => void;
  done: boolean;
};

export async function fetchLoaderData<T>(
  moduleKey: string,
  location: { path: string; pathParams: Record<string, string>; searchParams: Record<string, string> },
  signal: AbortSignal,
  callbacks: {
    onChunk: (value: T) => void;
    onError: (err: Error) => void;
    onEnd: () => void;
  }
): Promise<T | undefined> {
  // Returns the FIRST chunk (for Suspense). Subsequent chunks call onChunk.
  const res = await fetch('/__loaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: moduleKey, location }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Loader fetch failed: ${res.status}`);
  }

  const contentType = res.headers.get('Content-Type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    return (await res.json()) as T;
  }

  if (!res.body) throw new Error('Streaming loader response has no body');

  let firstChunk: T | undefined;
  let firstChunkResolved = false;

  (async () => {
    try {
      for await (const ev of readSSE(res.body!)) {
        if (ev.event === 'message') {
          try {
            const value = JSON.parse(ev.data) as T;
            if (!firstChunkResolved) {
              firstChunk = value;
              firstChunkResolved = true;
              // first chunk returns via the awaited promise below
            } else {
              callbacks.onChunk(value);
            }
          } catch { /* malformed */ }
        } else if (ev.event === 'error') {
          try {
            const parsed = JSON.parse(ev.data) as { message?: string; name?: string };
            const err = new Error(parsed.message ?? 'Streamed error');
            if (parsed.name) err.name = parsed.name;
            callbacks.onError(err);
          } catch {
            callbacks.onError(new Error('Streamed error'));
          }
        }
      }
      callbacks.onEnd();
    } catch (err) {
      if (signal.aborted) return;
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  // Wait for the first chunk synchronously (it's the value Suspense resolves on).
  while (!firstChunkResolved) {
    await new Promise((r) => setTimeout(r, 0));
  }
  return firstChunk;
}
```

The `while (!firstChunkResolved)` loop is acceptable because the SSE iterator naturally yields control to the event loop; in practice the first chunk arrives within microseconds of the first read.

- [ ] **Step 2: Wire the helper into `LoaderHost`**

In `internal/loader.tsx`, find the path where the loader is invoked client-side. Today it's `loaderRef.fn({ location })` wrapped in `wrapPromise`. Replace with: detect environment (we're not in SSR), call `fetchLoaderData` with callbacks that update `overrideData` and `loadError` state. The `wrapPromise` still wraps the first-chunk promise.

The callbacks:

```ts
{
  onChunk: (value) => setOverrideData(value),
  onError: (err) => setLoadError(err),
  onEnd: () => { /* nothing to do */ },
}
```

`setLoadError` after at least one chunk arrived means we have a last-good value in `overrideData`. The post-first-chunk error case is now exercised: `useData()` reads `overrideData`, `useError()` reads `loadError`.

Note: this assumes module-key-based fetching. The existing static-loader test uses the loader fn directly. To keep static-loader tests working, the new code path needs to detect "are we in a test that supplies fn directly, or in a real client run?" The cleanest answer: keep `loaderRef.fn` callable for direct test invocation, AND add a separate fetch-via-endpoint path. The choice between them is: if `isBrowser() && fetch is defined`, use the fetch path; else (SSR or unit tests without a fetch mock) use the direct fn path.

Concretely:

```tsx
const useFetchPath = isBrowser() && typeof fetch === 'function' && loaderRef.__id !== undefined;
if (useFetchPath) {
  // call fetchLoaderData
} else {
  // call loaderRef.fn({ location, signal }) directly (existing path, now signal-aware)
}
```

- [ ] **Step 3: Run tests, including the previously-failing streaming-error test from Task 10**

Run: `pnpm vitest run packages/iso`
Expected: PASS, including the post-first-chunk-error test.

- [ ] **Step 4: Verify the static-loader paths still pass**

Run: `pnpm vitest run`
Expected: PASS.

- [ ] **Step 5: Add a streaming-loader integration test**

Create `packages/iso/src/internal/__tests__/loader-streaming.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';

// SSE response body builder
function sseResponse(...events: string[]): Response {
  return new Response(events.join('\n'), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('streaming loader: client-driven', () => {
  it('renders the first chunk, then re-renders on each subsequent chunk', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        sseResponse(
          'data: {"count":1}\n',
          'data: {"count":2}\n',
          'data: {"count":3}\n'
        )
      )
    );

    const ref = defineLoader<{ count: number }>(async () => ({ count: 0 }), {
      __moduleKey: 'test-stream',
    });

    let observed: number[] = [];
    function Page() {
      const { count } = ref.useData();
      observed.push(count);
      return <p data-testid="count">{count}</p>;
    }

    render(
      <LocationProvider>
        <Loader loader={ref} location={{ path: '/', pathParams: {}, searchParams: {} } as any}>
          <Page />
        </Loader>
      </LocationProvider>
    );

    await waitFor(() => expect(observed).toContain(3));
    expect(observed).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 6: Run streaming integration test**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/loader-streaming.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/internal/loader.tsx packages/iso/src/internal/__tests__/loader-streaming.test.tsx packages/iso/src/internal/__tests__/loader.test.tsx
git commit -m "feat(iso): client-driven streaming loaders re-render on each chunk + post-first-chunk error preserves last-good"
```

---

### PR 2 boundary

At this point: client-driven loader runs handle streaming. `loader.useData()` returns the latest chunk; `loader.useError()` returns the latest error or null; the page stays alive showing last-good after post-first-chunk failures. Initial-load SSR still consumes the entire generator before flushing HTML (changed in PR 3).

```bash
git checkout -b feat/streaming-loaders-client
git push -u origin feat/streaming-loaders-client
gh pr create --title "feat: client-side streaming loaders + useError() + useReload() cleanup (spec §5 PR 2)" --body "..."
```

---

# PR 3: SSR streaming

This PR makes the initial-load response stream loader chunks as inline `<script>__HP_STREAM__.push(...)</script>` tags interleaved with the HTML body, so direct-URL loads of streaming-loader pages get continued streaming without a follow-up fetch.

---

### Task 12: `__HP_STREAM__` bootstrap + client dispatcher

**Files:**
- Create: `packages/iso/src/internal/stream-registry.ts`
- Modify: `packages/iso/src/internal/loader.tsx` (subscribe to registry events for the loader's id)
- Modify: `packages/iso/src/index.ts` (export internal pieces if needed)

- [ ] **Step 1: Create the registry module**

Create `packages/iso/src/internal/stream-registry.ts`:

```ts
type StreamEvent =
  | { type: 'push'; loaderId: string; value: unknown }
  | { type: 'end'; loaderId: string }
  | { type: 'error'; loaderId: string; error: { message: string; name: string } };

type Subscriber = {
  push: (value: unknown) => void;
  end: () => void;
  error: (err: Error) => void;
};

const subscribers = new Map<string, Subscriber>();

export function subscribeToLoaderStream(loaderId: string, sub: Subscriber): () => void {
  subscribers.set(loaderId, sub);
  return () => {
    if (subscribers.get(loaderId) === sub) subscribers.delete(loaderId);
  };
}

function dispatch(ev: StreamEvent): void {
  const sub = subscribers.get(ev.loaderId);
  if (!sub) return;
  if (ev.type === 'push') sub.push(ev.value);
  else if (ev.type === 'end') sub.end();
  else if (ev.type === 'error') {
    const err = new Error(ev.error.message);
    err.name = ev.error.name;
    sub.error(err);
  }
}

// Install on window. Drain any queued events from the inline bootstrap.
export function installStreamRegistry(): void {
  if (typeof window === 'undefined') return;
  type Bootstrap = {
    queue?: StreamEvent[];
    push?: (id: string, value: unknown) => void;
    end?: (id: string) => void;
    error?: (id: string, err: { message: string; name: string }) => void;
  };
  const w = window as unknown as { __HP_STREAM__?: Bootstrap };
  const existing = w.__HP_STREAM__;
  const queue = existing?.queue ?? [];

  w.__HP_STREAM__ = {
    push(loaderId: string, value: unknown) {
      dispatch({ type: 'push', loaderId, value });
    },
    end(loaderId: string) {
      dispatch({ type: 'end', loaderId });
    },
    error(loaderId: string, error: { message: string; name: string }) {
      dispatch({ type: 'error', loaderId, error });
    },
  } as Bootstrap;

  // Drain any pre-hydration events.
  for (const ev of queue) dispatch(ev);
}
```

- [ ] **Step 2: Install the registry at client-entry boot**

Modify the framework's client entry (the virtual `virtual:hono-preact/client` module template, source location: `packages/vite/src/client-entry.ts`). After the LocationProvider mount but before any hydration, call `installStreamRegistry()`.

Look up the template body in the existing file; add:

```ts
import { installStreamRegistry } from '@hono-preact/iso/internal';
installStreamRegistry();
```

(Ensure `installStreamRegistry` is exported from `@hono-preact/iso/internal`; add the export in `packages/iso/src/internal.ts`.)

- [ ] **Step 3: Have `LoaderHost` subscribe via the registry during SSR-hydration**

In `internal/loader.tsx`, the SSR-hydration code path needs to:
- Use the SSR-preloaded data as the first chunk (already via `getPreloadedData(id)`).
- Subscribe to `__HP_STREAM__` for this loader's id; on push, set `overrideData`; on error, set `loadError`; on end, unsubscribe.

After the existing `getPreloadedData(id)` branch:

```tsx
if (preloaded !== null) {
  loaderRef.cache.set(preloaded);
  readerRef.current = { read: () => preloaded };
  // Subscribe for continued streaming pushed by the SSR response body.
  if (isBrowser()) {
    const unsub = subscribeToLoaderStream(id, {
      push: (value) => setOverrideData(value as T),
      end: () => {},
      error: (err) => setLoadError(err),
    });
    // Unsubscribe on unmount.
    abortRef.current = abortRef.current ?? new AbortController();
    abortRef.current.signal.addEventListener('abort', unsub);
  }
}
```

(Import `subscribeToLoaderStream` from `./stream-registry.js`.)

- [ ] **Step 4: Write a smoke test**

Append to `packages/iso/src/internal/__tests__/loader.test.tsx`:

```tsx
describe('SSR stream registry', () => {
  it('routes queued events to the matching subscription on hydration', async () => {
    // Simulate the bootstrap queue
    (window as any).__HP_STREAM__ = {
      queue: [
        { type: 'push', loaderId: 'L1', value: { count: 5 } },
      ],
    };

    const { installStreamRegistry, subscribeToLoaderStream } = await import('../stream-registry.js');
    let observed: unknown = null;
    subscribeToLoaderStream('L1', {
      push: (v) => { observed = v; },
      end: () => {},
      error: () => {},
    });
    installStreamRegistry();
    expect(observed).toEqual({ count: 5 });
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/loader.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/stream-registry.ts packages/iso/src/internal/loader.tsx packages/iso/src/internal.ts packages/vite/src/client-entry.ts packages/iso/src/internal/__tests__/loader.test.tsx
git commit -m "feat(iso): __HP_STREAM__ registry + client dispatcher + SSR hydration subscribes per loader id"
```

---

### Task 13: SSR pipeline streams chunks as inline `<script>` tags

**Files:**
- Modify: `packages/server/src/render.tsx`
- Create: `packages/server/src/__tests__/render-stream.test.ts`

This is the trickiest task. Today, `renderPage` does a single `prerender(node)` call that returns the full HTML string after all suspense boundaries resolve. To stream loader chunks INTO the response, we need to:

1. Render the page with the first chunk of each streaming loader (run each generator one step ahead before rendering).
2. Flush the rendered HTML up to `</body>` is *deferred*, keeping the response stream open.
3. As subsequent chunks arrive from any streaming loader, write `<script>window.__HP_STREAM__.push("<id>", <json>)</script>` (or `.end(...)` / `.error(...)`) inline.
4. When all streaming loaders have completed (or errored, or the request aborted), write the closing tags and close the response.

The SSR-side loader execution is currently inside the Suspense `wrapPromise`. The renderer needs a way to:
- Know which loaders are streaming.
- Hold their generators open after the initial render.

Approach: a per-request "streaming loaders" registry on the request scope (via `runRequestScope`). When `LoaderHost` runs server-side and the loader is a generator, it:
- Calls `.next()` to get the first chunk.
- Registers the remaining generator into the request-scoped registry under its `useId`-derived loader id.
- Preloads the first chunk into the HTML via the existing `getPreloadedData` mechanism.

After `prerender` returns the initial HTML:
- For each entry in the streaming registry, iterate `.next()` in parallel; write `<script>__HP_STREAM__.push("<id>", <json>)</script>` per chunk; write `.end()` or `.error()` on completion.
- When all entries are done, write `</body></html>` and close.

- [ ] **Step 1a: Expose `getRequestStore` from the cache module**

`runRequestScope` uses AsyncLocalStorage with a `Map<symbol, unknown>` as its store (see `packages/iso/src/cache.ts:12-47`); the accessor is currently private (`getRequestStore` at line 40). Export it so the streaming-ssr module can read/write per-request data the same way `createCache` does:

```ts
// packages/iso/src/cache.ts: change `function getRequestStore` to:
export function getRequestStore(): Map<symbol, unknown> | undefined {
  return alsInstance?.getStore();
}
```

And re-export from `packages/iso/src/internal.ts`:

```ts
export { runRequestScope, getRequestStore } from './cache.js';
```

- [ ] **Step 1b: Define the request-scoped registry**

Create `packages/iso/src/internal/streaming-ssr.ts`:

```ts
import { getRequestStore } from '../cache.js';

export type ServerLoaderStream = {
  loaderId: string;
  gen: AsyncGenerator<unknown, unknown, unknown>;
};

const REGISTRY_KEY = Symbol.for('@hono-preact/streaming-ssr-registry');

export function registerServerStreamingLoader(
  loaderId: string,
  gen: AsyncGenerator<unknown, unknown, unknown>
): void {
  const store = getRequestStore();
  if (!store) return; // not in a request scope (e.g., client)
  let list = store.get(REGISTRY_KEY) as ServerLoaderStream[] | undefined;
  if (!list) {
    list = [];
    store.set(REGISTRY_KEY, list);
  }
  list.push({ loaderId, gen });
}

export function takeServerStreamingLoaders(): ServerLoaderStream[] {
  const store = getRequestStore();
  if (!store) return [];
  const list = (store.get(REGISTRY_KEY) as ServerLoaderStream[] | undefined) ?? [];
  store.set(REGISTRY_KEY, []);
  return list;
}
```

Re-export from `packages/iso/src/internal.ts`:

```ts
export {
  registerServerStreamingLoader,
  takeServerStreamingLoaders,
} from './internal/streaming-ssr.js';
export type { ServerLoaderStream } from './internal/streaming-ssr.js';
```

- [ ] **Step 2: Have `LoaderHost` server-side path register the generator**

In `internal/loader.tsx`, in the SSR branch (not browser), when `loaderRef.fn` returns an async generator: take the first chunk, preload it via the existing mechanism, register the rest. The existing `getPreloadedData` mechanism preloads by `useId`: pass that same id as the loader id.

Pseudocode (adapt to the existing structure):

```tsx
if (!isBrowser()) {
  const result = loaderRef.fn({ location, signal });
  // ...
  if (isAsyncGenerator(awaitedResult)) {
    const gen = awaitedResult;
    const first = await gen.next();
    if (first.done) {
      readerRef.current = { read: () => undefined as unknown as T };
    } else {
      preloadData(id, first.value);
      registerServerStreamingLoader(id, gen);
      readerRef.current = { read: () => first.value as T };
    }
  }
}
```

- [ ] **Step 3: Rewrite `renderPage` to stream**

Replace `packages/server/src/render.tsx`'s `renderPage`:

```tsx
import { takeServerStreamingLoaders } from '@hono-preact/iso/internal';

export async function renderPage(
  c: Context,
  node: VNode,
  options?: { defaultTitle?: string }
): Promise<Response> {
  const dispatcher = createDispatcher();
  const previousEnv = env.current;
  env.current = 'server';

  let initialHtml: string;
  let lang: string | undefined;
  let title: string | undefined;
  let metas: Array<Record<string, string>> = [];
  let links: Array<Record<string, string>> = [];
  let streamingLoaders: ReturnType<typeof takeServerStreamingLoaders>;

  try {
    const prerendered = await runRequestScope(async () => {
      const out = await prerender(<HoofdProvider value={dispatcher}>{node}</HoofdProvider>);
      return { html: out.html, streamingLoaders: takeServerStreamingLoaders() };
    });
    initialHtml = prerendered.html;
    streamingLoaders = prerendered.streamingLoaders;
    ({ title, lang, metas = [], links = [] } = dispatcher.toStatic());
  } catch (e: unknown) {
    if (e instanceof GuardRedirect) return c.redirect(e.location);
    throw e;
  } finally {
    env.current = previousEnv;
  }

  const titleSource = title ?? options?.defaultTitle;
  const headTags = [
    titleSource != null ? `<title>${escapeHtml(titleSource)}</title>` : '',
    ...metas.map((m) => `<meta ${toAttrs(m)} />`),
    ...links.map((l) => `<link ${toAttrs(l)} />`),
  ]
    .filter(Boolean)
    .join('\n        ');

  const inner = initialHtml.replace('</head>', `${headTags}\n      </head>`);
  const startsWithHtml = /^\s*<html(\s|>)/i.test(inner);
  const fullHtml = startsWithHtml
    ? (lang != null
        ? inner.replace(/<html(\s|>)/i, `<html lang="${escapeHtml(lang)}"$1`)
        : inner)
    : `<html lang="${escapeHtml(lang ?? 'en-US')}">\n${inner}\n</html>`;

  // Split the document at the closing </body> so we can interleave stream events.
  const bodyCloseIdx = fullHtml.lastIndexOf('</body>');
  const beforeBody = bodyCloseIdx >= 0 ? fullHtml.slice(0, bodyCloseIdx) : fullHtml;
  const afterBody = bodyCloseIdx >= 0 ? fullHtml.slice(bodyCloseIdx) : '';

  // Inline bootstrap: install the queue before any chunk arrives.
  const bootstrap =
    '<script>window.__HP_STREAM__=window.__HP_STREAM__||{queue:[],push(...a){this.queue.push({type:"push",loaderId:a[0],value:a[1]})},end(id){this.queue.push({type:"end",loaderId:id})},error(id,e){this.queue.push({type:"error",loaderId:id,error:e})}};</script>';

  if (streamingLoaders.length === 0) {
    // No streaming loaders: preserve existing behavior.
    return c.html(`<!doctype html>${fullHtml}`);
  }

  const encoder = new TextEncoder();
  const signal = c.req.raw.signal;

  const responseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`<!doctype html>${beforeBody}\n${bootstrap}\n`));

      // Drive each streaming loader in parallel; emit script tags as chunks arrive.
      await Promise.all(
        streamingLoaders.map(async ({ loaderId, gen }) => {
          try {
            while (true) {
              const step = await gen.next();
              if (step.done) {
                controller.enqueue(
                  encoder.encode(
                    `<script>window.__HP_STREAM__.end(${JSON.stringify(loaderId)})</script>\n`
                  )
                );
                break;
              }
              controller.enqueue(
                encoder.encode(
                  `<script>window.__HP_STREAM__.push(${JSON.stringify(loaderId)},${JSON.stringify(step.value)})</script>\n`
                )
              );
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const name = err instanceof Error ? err.name : 'Error';
            controller.enqueue(
              encoder.encode(
                `<script>window.__HP_STREAM__.error(${JSON.stringify(loaderId)},${JSON.stringify({ message, name })})</script>\n`
              )
            );
          }
        })
      );

      controller.enqueue(encoder.encode(afterBody));
      controller.close();
    },
    cancel() {
      for (const { gen } of streamingLoaders) {
        gen.return(undefined).catch(() => { /* swallow */ });
      }
    },
  });

  signal.addEventListener('abort', () => {
    for (const { gen } of streamingLoaders) {
      gen.return(undefined).catch(() => { /* swallow */ });
    }
  });

  return new Response(responseStream, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
```

This requires `getCurrentRequestScope` / `takeServerStreamingLoaders` to actually exist; verify against the existing `internal/preload.ts` and `internal/contexts.ts` for the request-scope plumbing and adapt.

- [ ] **Step 4: Write the SSR streaming integration test**

Create `packages/server/src/__tests__/render-stream.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderPage } from '../render.js';
// ... pull in test harness for Hono context, Preact nodes with a streaming-loader page
// Build a minimal page that uses a streaming loader yielding 3 chunks, render it,
// read the response body, and assert:
// - body starts with <!doctype html>
// - body contains __HP_STREAM__.push("<id>",{"count":1}) twice (chunks 2 and 3)
// - body contains __HP_STREAM__.end("<id>")
// - body ends with </body></html>
```

(Use happy-dom for the renderer, mock fetch is not needed since we render directly. The test will likely need to import internals to register a streaming loader fixture.)

- [ ] **Step 5: Run the SSR streaming test**

Run: `pnpm vitest run packages/server/src/__tests__/render-stream.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `pnpm vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/render.tsx packages/server/src/__tests__/render-stream.test.ts packages/iso/src/internal/streaming-ssr.ts packages/iso/src/internal/loader.tsx packages/iso/src/internal.ts
git commit -m "feat(server): SSR streams loader chunks as inline __HP_STREAM__ script tags"
```

---

### PR 3 boundary

At this point: streaming loaders work on initial page load AND on client-driven loads. The differentiator pitch is real.

```bash
git checkout -b feat/streaming-loaders-ssr
git push -u origin feat/streaming-loaders-ssr
gh pr create --title "feat: SSR streaming for loaders (spec §5 PR 3)" --body "..."
```

---

# PR 4: Demo expansion + docs

---

### Task 14: New streaming-loader demo page (`/live-stats`)

**Files:**
- Create: `apps/app/src/pages/live-stats.tsx`
- Create: `apps/app/src/pages/live-stats.server.ts`
- Modify: `apps/app/src/routes.ts`

- [ ] **Step 1: Create the server module**

Create `apps/app/src/pages/live-stats.server.ts`:

```ts
import { defineLoader } from '@hono-preact/iso';

export type LiveStats = {
  tick: number;
  visitors: number;
  load: number;
};

export default defineLoader<LiveStats>(async function* (ctx) {
  let tick = 0;
  while (!ctx.signal.aborted) {
    tick++;
    yield {
      tick,
      visitors: 1000 + Math.floor(Math.random() * 50),
      load: Math.random(),
    };
    await new Promise((r) => setTimeout(r, 1000));
    if (tick >= 30) return; // cap for the demo
  }
});

export const loader = (await import('./live-stats.server.js')).default as ReturnType<typeof defineLoader<LiveStats>>;
```

(Adjust the export/import pattern to match the project's existing `defineLoader` export style; in some demo pages `default` is the raw fn, and `loader` is the wrapped ref. Read an adjacent `.server.ts` to confirm.)

- [ ] **Step 2: Create the page**

Create `apps/app/src/pages/live-stats.tsx`:

```tsx
import { definePage } from '@hono-preact/iso';
import { loader } from './live-stats.server.js';

function LiveStatsPage() {
  const stats = loader.useData();
  const error = loader.useError();

  return (
    <section class="p-1 space-y-3">
      <h1 class="text-xl font-semibold">Live stats</h1>
      {error && (
        <p class="text-yellow-700 bg-yellow-100 p-2">
          Live updates paused: {error.message}
        </p>
      )}
      <dl class="grid grid-cols-3 gap-4">
        <div>
          <dt class="text-sm text-gray-600">Tick</dt>
          <dd class="text-2xl">{stats.tick}</dd>
        </div>
        <div>
          <dt class="text-sm text-gray-600">Visitors</dt>
          <dd class="text-2xl">{stats.visitors}</dd>
        </div>
        <div>
          <dt class="text-sm text-gray-600">Load</dt>
          <dd class="text-2xl">{(stats.load * 100).toFixed(1)}%</dd>
        </div>
      </dl>
    </section>
  );
}

export default definePage(LiveStatsPage, {
  loader,
  fallback: <p class="p-1">Loading live stats…</p>,
});
```

- [ ] **Step 3: Register the route**

Modify `apps/app/src/routes.ts` to add:

```ts
{ path: '/live-stats', view: () => import('./pages/live-stats.js'), server: () => import('./pages/live-stats.server.js') },
```

- [ ] **Step 4: Run the dev server and verify**

```bash
pnpm --filter app dev
```

Open `/live-stats`. The page should:
- Render with `tick=1` immediately (first chunk paints on SSR).
- Tick up every second (continued streaming on first paint).
- Stop at tick 30.
- Navigate away mid-stream cleanly (no console errors).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/live-stats.tsx apps/app/src/pages/live-stats.server.ts apps/app/src/routes.ts
git commit -m "feat(app): /live-stats demo for streaming-loader on first paint"
```

---

### Task 15: `streaming.mdx` docs + cross-links

**Files:**
- Create: `apps/app/src/pages/docs/streaming.mdx`
- Modify: `apps/app/src/pages/docs/loaders.mdx`
- Modify: `apps/app/src/pages/docs/actions.mdx`
- Modify: `apps/app/src/pages/docs/index.mdx` (the sidebar index, if applicable)

Before writing the docs page, **read `.claude/skills/add-docs-page.md`** (per the user's local-skills memory: there is a local skill for adding doc pages that must be consulted first). Follow it for placement, frontmatter, sidebar registration.

- [ ] **Step 1: Read the local skill**

```bash
cat .claude/skills/add-docs-page.md
```

Follow its instructions for the rest of this task.

- [ ] **Step 2: Draft `streaming.mdx`**

Outline:
- **What streaming loaders are.** When to reach for one (live data, log tails, dashboards, chat tokens, progressive results). When NOT to (when a static loader is fine).
- **Author shape.** Async generator + `yield` per value of `T`. The `ctx.signal` for clean shutdown. Brief mention of `ReadableStream<T>` as an escape hatch.
- **Consumer shape.** `loader.useData()` returns the latest `T`. `loader.useError()` returns the current error or null. Both unchanged for static loaders.
- **Streaming actions.** Async generator yielding `TChunk`, returning `TResult`. `useAction({ onChunk: (c: TChunk) => ..., onSuccess: (r: TResult) => ... })`.
- **What happens on first paint.** Server runs the loader, paints with the first chunk, keeps streaming chunks as inline scripts in the HTML body.
- **Errors.** Pre-first-chunk → boundary. Post-first-chunk → `useError()` + last-good `useData()`.
- **Abort and cleanup.** Pass `ctx.signal` to upstream fetches/subscriptions. The framework aborts on client disconnect / navigation away.
- **Debugging.** SSE wire format. `curl -N` your endpoint to see frames.

- [ ] **Step 3: Add cross-links from `loaders.mdx` and `actions.mdx`**

In both pages, add a section near the top: "For streaming, see [Streaming](/docs/streaming)."

- [ ] **Step 4: Run the dev server and verify the docs page renders**

```bash
pnpm --filter app dev
```

Open `/docs/streaming`. Verify code blocks render, links work, sidebar entry is present.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/docs/streaming.mdx apps/app/src/pages/docs/loaders.mdx apps/app/src/pages/docs/actions.mdx apps/app/src/pages/docs/index.mdx
git commit -m "docs: add streaming.mdx + cross-links from loaders and actions"
```

---

### PR 4 boundary

```bash
git checkout -b docs/streaming-demo-and-page
git push -u origin docs/streaming-demo-and-page
gh pr create --title "feat: streaming-loader demo (/live-stats) + streaming.mdx docs (spec §5 PR 4)" --body "..."
```

---

## After all four PRs merge

Update the memory file `project_v01_sequencing.md` to mark item 5 (Streaming loaders + `<Form>` streaming parity) ✅ with the merge SHAs of all four PRs.

Verify integration end-to-end:

```bash
pnpm --filter app dev
```

- `/watched` → "Bulk-import next 20" streams typed progress, refreshes when done.
- `/live-stats` → first paint shows tick 1, subsequent ticks stream in on first paint AND on direct-URL revisit.
- Both pages work with JS disabled (loader runs to completion server-side and renders the final state; this is graceful degradation, not a feature: but worth verifying it doesn't blow up).
- DevTools network panel shows `text/event-stream` for `/__loaders` and `/__actions` requests.
- Disconnect mid-stream (browser stop button) and verify the server's generator cleans up (logs, no orphaned timers).
