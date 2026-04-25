# Streaming Action Responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `serverAction` handlers to return a `ReadableStream` for long-running operations, with `useAction` calling an `onChunk` callback for each streamed chunk.

**Architecture:** `actionsHandler` detects when an action returns a `ReadableStream` and pipes it as a `text/event-stream` response. `useAction` detects the `text/event-stream` content-type and routes chunks to `onChunk` instead of parsing a single JSON body. Normal JSON responses are unchanged.

**Tech Stack:** TypeScript, `@hono-preact/iso`, `@hono-preact/server`, vitest, Web Streams API (`ReadableStream`, `TextDecoder`)

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `packages/server/src/actions-handler.ts` | **Modify** | Detect `ReadableStream` return, pipe as SSE |
| `packages/iso/src/action.ts` | **Modify** | Add `onChunk` option; detect streaming response |
| `packages/server/src/__tests__/actions-handler.test.ts` | **Modify** | Add streaming test |

---

### Task 1: Stream passthrough in `actionsHandler`

**Files:**
- Modify: `packages/server/src/actions-handler.ts`
- Modify: `packages/server/src/__tests__/actions-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/server/src/__tests__/actions-handler.test.ts`:

```ts
it('pipes ReadableStream return value as text/event-stream', async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"progress":50}\n'));
      controller.enqueue(encoder.encode('{"progress":100}\n'));
      controller.close();
    },
  });

  const app = makeApp({
    './pages/movies.server.ts': {
      serverActions: { process: async () => stream },
    },
  });

  const res = await post(app, { module: 'movies', action: 'process', payload: {} });
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('text/event-stream');
  const body = await res.text();
  expect(body).toContain('{"progress":50}');
  expect(body).toContain('{"progress":100}');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vitest run packages/server/src/__tests__/actions-handler.test.ts
```

Expected: FAIL — response Content-Type is `application/json`, not `text/event-stream`

- [ ] **Step 3: Add stream detection after calling the action**

In `packages/server/src/actions-handler.ts`, replace:

```ts
try {
  const result = await (fn as (ctx: unknown, payload: unknown) => Promise<unknown>)(
    c,
    payload
  );
  return c.json(result);
} catch (err) {
```

with:

```ts
try {
  const result = await (fn as (ctx: unknown, payload: unknown) => Promise<unknown>)(
    c,
    payload
  );
  if (result instanceof ReadableStream) {
    return new Response(result as ReadableStream<Uint8Array>, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
  return c.json(result);
} catch (err) {
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
vitest run packages/server/src/__tests__/actions-handler.test.ts
```

Expected: PASS (all existing + 1 new test)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/actions-handler.ts packages/server/src/__tests__/actions-handler.test.ts
git commit -m "feat(server): actionsHandler pipes ReadableStream actions as text/event-stream"
```

---

### Task 2: `onChunk` option in `useAction`

**Files:**
- Modify: `packages/iso/src/action.ts`

- [ ] **Step 1: Add `onChunk` to `UseActionOptions`**

In `packages/iso/src/action.ts`, update `UseActionOptions`:

```ts
export type UseActionOptions<TPayload, TResult> = {
  invalidate?: 'auto' | false;
  onMutate?: (payload: TPayload) => unknown;
  onError?: (err: Error, snapshot: unknown) => void;
  onSuccess?: (data: TResult) => void;
  onChunk?: (chunk: string) => void;
};
```

- [ ] **Step 2: Update the `mutate` callback to handle streaming**

Inside the `try` block of the `mutate` callback in `useAction`, replace:

```ts
const result = (await response.json()) as TResult;
setData(result);
currentOptions?.onSuccess?.(result);

if (currentOptions?.invalidate === 'auto') {
  reloadCtx?.reload();
}
```

with:

```ts
const contentType = response.headers.get('Content-Type') ?? '';
if (contentType.includes('text/event-stream')) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      currentOptions?.onChunk?.(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  currentOptions?.onSuccess?.(undefined as unknown as TResult);
} else {
  const result = (await response.json()) as TResult;
  setData(result);
  currentOptions?.onSuccess?.(result);
}

if (currentOptions?.invalidate === 'auto') {
  reloadCtx?.reload();
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @hono-preact/iso build
```

Expected: exit 0, no type errors

- [ ] **Step 4: Run full test suite**

```bash
vitest run
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/action.ts
git commit -m "feat(iso): useAction supports onChunk callback for streaming action responses"
```

---

## Usage Example

A streaming action in a `.server.ts` file:

```ts
// src/pages/movies.server.ts
import { defineAction } from '@hono-preact/iso';

export const serverActions = {
  bulkImport: defineAction<{ url: string }, never>(async (_ctx, { url }) => {
    const source = await fetch(url);
    return new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        let count = 0;
        for await (const item of parseNDJSON(source.body!)) {
          await saveMovie(item);
          count++;
          controller.enqueue(enc.encode(JSON.stringify({ count }) + '\n'));
        }
        controller.close();
      },
    });
  }),
};
```

Client usage:

```ts
const [progress, setProgress] = useState(0);
const { mutate, pending } = useAction(serverActions.bulkImport, {
  onChunk: (chunk) => setProgress(JSON.parse(chunk).count),
  onSuccess: () => console.log('import complete'),
});
```
