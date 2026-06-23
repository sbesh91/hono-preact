# Realtime PR 5b: Cloudflare DO PubSubBackend for live loaders + `publish()` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make channel-driven SSE `live` loaders and `publish()` fan out cross-isolate on Cloudflare by backing the `PubSubBackend` seam with the hibernating `HonoPreactRealtimeDO` (read-only) PR 5a already ships.

**Architecture:** On Cloudflare, `subscribe(topic)` opens a worker→DO WebSocket to `idFromName(topic)` in a new `x-hp-kind: topic` mode; `publish(topic, msg)` POSTs to the same DO (`x-hp-kind: publish`) which fans the message out to its topic-subscriber sockets. The browser leg stays SSE (`/__loaders`); the client and all public APIs are unchanged. The DO binding is obtained from a `{ env, ctx }` runtime captured at the worker fetch boundary by the generated entry.

**Tech Stack:** TypeScript, Cloudflare Durable Objects (WebSocket Hibernation API), `@cloudflare/workers-types` (types only), Hono, vitest, `@cloudflare/vite-plugin` (workerd dev for the integration test).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-realtime-pr5b-cf-do-pubsub-design.md`. Every task implicitly includes it.
- Branch: `realtime-pr5b-cf-do-loaders` (already created off `origin/main`). Verify with `git branch --show-current` before any commit. Do NOT commit to any other branch.
- **No em-dashes** in prose, code comments, or commit messages. Use a comma, colon, parentheses, or two sentences.
- Every commit message ends with the trailer line: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **No public API changes.** `publish`, `route.liveLoader`, `defineChannel`, `loader.View` keep their exact signatures. The realtime program is unreleased, so internal seams (the runtime holder, door exports) are free to choose.
- **Node path unchanged.** `getPubSubBackend()` still defaults to `inProcessBackend`; the Node generated entry installs nothing. Do not touch `packages/iso/src/internal/pubsub.ts` behavior or `apps/example-node`.
- **Door isolation.** `cf-pubsub.ts` and `realtime-do.ts` use `@cloudflare/workers-types` for TYPES only and must not import any new `cloudflare:workers` runtime module. The CF-only door (`hono-preact/server/internal/cloudflare`) is the only place the generated CF entry imports them; the Node entry never does.
- **Prefer reshaping types over casts.** The one sanctioned cast is reading a binding off the untyped worker `env` (`env[realtimeBinding] as DurableObjectNamespace`), the same boundary `makeCfForwardConnector` already uses.
- Per-task: run the task's own tests. Before the final PR push, run the full 7-step gate from `CLAUDE.md` (build → format:check → typecheck → test:types → test:coverage → test:integration → `pnpm --filter site build`), plus `pnpm gen:agents-corpus`.

---

## File Structure

New:
- `packages/server/src/cf/cf-pubsub.ts` — the platform-free CF `PubSubBackend` + the `{ env, ctx }` runtime holder (`captureRealtimeRuntime`/`getRealtimeRuntime`). One responsibility: the worker side of DO-backed pub/sub.
- `packages/server/src/cf/__tests__/cf-pubsub.test.ts` — unit tests for the backend with a fake namespace/stub/runtime.
- `packages/vite/src/__tests__/fixtures/cf-pubsub/**` — a workerd fixture app with a `route.liveLoader` + a test `publish()` route.
- `packages/vite/src/__tests__/cf-pubsub.test.ts` — the workerd integration test (two SSE subscribers + a publish, cross-isolate fan-out).
- `apps/site/src/pages/demo/live-tally.server.ts` + `apps/site/src/pages/demo/live-tally.tsx` — the dogfood (a shared live counter).

Modified:
- `packages/server/src/cf/realtime-do-glue.ts` — add the platform-free `isTopicSubscriber` helper.
- `packages/server/src/cf/realtime-do.ts` — add the `x-hp-kind` `topic`/`publish` branch in `fetch` and the topic-subscriber guard in `webSocketMessage`/`webSocketClose`/`webSocketError`.
- `packages/server/src/internal-cloudflare.ts` — export `makeCfPubSubBackend`, `captureRealtimeRuntime`, `getRealtimeRuntime`.
- `packages/vite/src/adapter-cloudflare.ts` — in `wrapEntry`, install the CF pub/sub backend and wrap the default export with the env-capture fetch handler.
- `packages/vite/src/__tests__/adapter-cloudflare.test.ts` — assert the new emitted lines.
- `vitest.integration.config.ts` — add `cf-pubsub.test.ts` to the integration `include`.
- `apps/site/src/routes.ts` + the demo nav/index — register the dogfood page.
- The live-data docs page (Task 5) — a short "On Cloudflare" note.

---

## Task 1: CF PubSubBackend + runtime holder

**Files:**
- Create: `packages/server/src/cf/cf-pubsub.ts`
- Test: `packages/server/src/cf/__tests__/cf-pubsub.test.ts`

**Interfaces:**
- Consumes: `PubSubBackend` from `@hono-preact/iso/internal/runtime` (`{ publish(topic: string, message: unknown): void; subscribe(topic: string, onMessage: (m: unknown) => void): () => void }`).
- Produces: `makeCfPubSubBackend(getRuntime: () => RealtimeRuntime | undefined, realtimeBinding = 'HONO_PREACT_REALTIME'): PubSubBackend`; `captureRealtimeRuntime(env, ctx): void`; `getRealtimeRuntime(): RealtimeRuntime | undefined`; `__resetRealtimeRuntimeForTesting(): void`; `interface RealtimeRuntime { env: Record<string, unknown>; ctx: { waitUntil(p: Promise<unknown>): void } }`.

- [ ] **Step 1: Write the failing test** — `packages/server/src/cf/__tests__/cf-pubsub.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  makeCfPubSubBackend,
  captureRealtimeRuntime,
  getRealtimeRuntime,
  __resetRealtimeRuntimeForTesting,
  type RealtimeRuntime,
} from '../cf-pubsub.js';

// A fake hibernation-style WebSocket the fake DO stub hands back on a topic
// upgrade. The backend calls .accept() then listens for 'message'.
function fakeWs() {
  const listeners: Array<(ev: { data: unknown }) => void> = [];
  return {
    accepted: false,
    closed: false,
    accept() {
      this.accepted = true;
    },
    addEventListener(_type: 'message', cb: (ev: { data: unknown }) => void) {
      listeners.push(cb);
    },
    close() {
      this.closed = true;
    },
    // test helper: simulate a DO -> subscriber frame
    _emit(data: unknown) {
      for (const cb of listeners) cb({ data });
    },
  };
}

// A fake DurableObjectNamespace recording every stub.fetch and returning a
// fake socket for topic upgrades / a 204 for publishes.
function fakeNamespace() {
  const fetches: Array<{ topic: string; url: string; init?: RequestInit }> = [];
  const wsByTopic = new Map<string, ReturnType<typeof fakeWs>>();
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: (url: string, init?: RequestInit) => {
        fetches.push({ topic: id.name, url, init });
        const kind = (init?.headers as Record<string, string> | undefined)?.[
          'x-hp-kind'
        ];
        if (kind === 'topic') {
          const ws = fakeWs();
          wsByTopic.set(id.name, ws);
          return Promise.resolve({ webSocket: ws } as unknown as Response);
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    }),
  };
  return { ns, fetches, wsByTopic };
}

function runtimeWith(ns: unknown): RealtimeRuntime {
  return {
    env: { HONO_PREACT_REALTIME: ns },
    ctx: { waitUntil: vi.fn() },
  } as unknown as RealtimeRuntime;
}

afterEach(() => __resetRealtimeRuntimeForTesting());

describe('makeCfPubSubBackend', () => {
  it('subscribe opens an x-hp-kind:topic upgrade, accepts, and forwards parsed DO frames', async () => {
    const { ns, fetches, wsByTopic } = fakeNamespace();
    const backend = makeCfPubSubBackend(() => runtimeWith(ns));
    const received: unknown[] = [];

    const unsub = backend.subscribe('counter', (m) => received.push(m));
    await Promise.resolve(); // let the async upgrade resolve

    expect(fetches).toHaveLength(1);
    expect(fetches[0]!.topic).toBe('counter');
    const headers = fetches[0]!.init!.headers as Record<string, string>;
    expect(headers['x-hp-kind']).toBe('topic');
    expect(headers['Upgrade']).toBe('websocket');
    const ws = wsByTopic.get('counter')!;
    expect(ws.accepted).toBe(true);

    ws._emit(JSON.stringify({ count: 7 }));
    expect(received).toEqual([{ count: 7 }]);

    unsub();
    await Promise.resolve();
    expect(ws.closed).toBe(true);
  });

  it('publish POSTs the message x-hp-kind:publish and holds it with waitUntil', async () => {
    const { ns, fetches } = fakeNamespace();
    const rt = runtimeWith(ns);
    const backend = makeCfPubSubBackend(() => rt);

    backend.publish('counter', { count: 1 });
    await Promise.resolve();

    expect(fetches).toHaveLength(1);
    expect(fetches[0]!.topic).toBe('counter');
    expect(fetches[0]!.init!.method).toBe('POST');
    expect((fetches[0]!.init!.headers as Record<string, string>)['x-hp-kind']).toBe(
      'publish'
    );
    expect(fetches[0]!.init!.body).toBe(JSON.stringify({ count: 1 }));
    expect(rt.ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('throws a clear setup error when the binding is missing', () => {
    const backend = makeCfPubSubBackend(() => undefined);
    expect(() => backend.publish('counter', {})).toThrow(
      /require the HONO_PREACT_REALTIME Durable Object binding/
    );
  });

  it('honors a custom binding name', () => {
    const { ns } = fakeNamespace();
    const rt = { env: { MY_RT: ns }, ctx: { waitUntil: vi.fn() } } as unknown as RealtimeRuntime;
    const backend = makeCfPubSubBackend(() => rt, 'MY_RT');
    expect(() => backend.publish('counter', {})).not.toThrow();
  });

  it('captureRealtimeRuntime / getRealtimeRuntime round-trips', () => {
    const env = { HONO_PREACT_REALTIME: {} };
    const ctx = { waitUntil: vi.fn() };
    captureRealtimeRuntime(env, ctx);
    expect(getRealtimeRuntime()).toEqual({ env, ctx });
    __resetRealtimeRuntimeForTesting();
    expect(getRealtimeRuntime()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run cf-pubsub`
Expected: FAIL with `Cannot find module '../cf-pubsub.js'` (the source does not exist yet).

- [ ] **Step 3: Write the implementation** — `packages/server/src/cf/cf-pubsub.ts`

```ts
/// <reference types="@cloudflare/workers-types/latest" />
//
// The platform-free Cloudflare PubSubBackend: the worker side of DO-backed
// pub/sub for `live` loaders + cross-isolate publish(). Like realtime-do-glue.ts
// it uses @cloudflare/workers-types for TYPES only (erased at runtime) and
// imports NO `cloudflare:workers` runtime module, so it is unit-testable in
// plain vitest with a fake DurableObjectNamespace.

import type { PubSubBackend } from '@hono-preact/iso/internal/runtime';

/**
 * The per-request worker runtime the CF backend needs: the binding-carrying
 * `env` and the `ExecutionContext` (for waitUntil). The generated worker entry
 * captures this at the fetch boundary (captureRealtimeRuntime) on every request.
 */
export interface RealtimeRuntime {
  env: Record<string, unknown>;
  ctx: { waitUntil(promise: Promise<unknown>): void };
}

let captured: RealtimeRuntime | undefined;

/** Stash the request runtime so the CF backend can reach the DO binding. */
export function captureRealtimeRuntime(
  env: Record<string, unknown>,
  ctx: { waitUntil(promise: Promise<unknown>): void }
): void {
  captured = { env, ctx };
}

/** The latest captured runtime (undefined before the first request). */
export function getRealtimeRuntime(): RealtimeRuntime | undefined {
  return captured;
}

/** Test-only: clear the captured runtime between tests. */
export function __resetRealtimeRuntimeForTesting(): void {
  captured = undefined;
}

// The DO publish/subscribe request URLs + the discriminator header. Kept in
// sync with the DO fetch branch in realtime-do.ts. The host is irrelevant (the
// stub routes by id, not URL), so a fixed placeholder origin is used.
const PUBLISH_URL = 'https://do/__hp_publish';
const SUBSCRIBE_URL = 'https://do/__hp_sub';

/**
 * Build the Cloudflare DO-backed PubSubBackend.
 *
 *  - subscribe(topic): opens a worker->DO WebSocket to idFromName(topic) in
 *    `x-hp-kind: topic` mode; each DO frame is parsed and handed to onMessage.
 *    The returned unsubscribe closes the socket (even mid-open).
 *  - publish(topic, msg): POSTs the message to idFromName(topic) in
 *    `x-hp-kind: publish` mode; the DO fans it out to its topic subscribers.
 *    Held with ctx.waitUntil so it survives the action response returning.
 *
 * A missing runtime or binding throws the same setup error the room connector
 * uses, naming the configured binding.
 */
export function makeCfPubSubBackend(
  getRuntime: () => RealtimeRuntime | undefined,
  realtimeBinding = 'HONO_PREACT_REALTIME'
): PubSubBackend {
  function namespace(): DurableObjectNamespace {
    const rt = getRuntime();
    // Sanctioned env-binding read: bindings live on the untyped worker env, the
    // same boundary makeCfForwardConnector reads (c.env[binding]).
    const ns = rt?.env[realtimeBinding] as DurableObjectNamespace | undefined;
    if (!ns) {
      throw new Error(
        `hono-preact: live data and rooms on Cloudflare require the ${realtimeBinding} ` +
          'Durable Object binding. Add it to wrangler.jsonc (see the rooms docs).'
      );
    }
    return ns;
  }

  return {
    publish(topic, message) {
      const rt = getRuntime();
      const ns = namespace();
      const stub = ns.get(ns.idFromName(topic));
      const done = stub
        .fetch(PUBLISH_URL, {
          method: 'POST',
          headers: { 'x-hp-kind': 'publish' },
          body: JSON.stringify(message),
        })
        .then(
          () => undefined,
          (err: unknown) => {
            console.error('hono-preact: pub/sub publish failed', err);
          }
        );
      // Keep the fan-out alive after the action response returns.
      rt?.ctx.waitUntil(done);
    },

    subscribe(topic, onMessage) {
      const ns = namespace();
      const stub = ns.get(ns.idFromName(topic));
      let socket: WebSocket | null = null;
      let closed = false;

      const opening = stub
        .fetch(SUBSCRIBE_URL, {
          headers: {
            Upgrade: 'websocket',
            'x-hp-kind': 'topic',
            'x-hp-topic': topic,
          },
        })
        .then(
          (res: Response) => {
            if (closed) return;
            const ws = res.webSocket;
            if (!ws) {
              throw new Error(
                'hono-preact: DO topic subscribe did not return a WebSocket'
              );
            }
            ws.accept();
            ws.addEventListener('message', (ev: MessageEvent) => {
              try {
                onMessage(
                  typeof ev.data === 'string' ? JSON.parse(ev.data) : null
                );
              } catch {
                // A malformed DO frame is dropped (the live-loader wake path
                // ignores the payload anyway; a re-run reads fresh state).
                onMessage(null);
              }
            });
            socket = ws;
          },
          (err: unknown) => {
            console.error('hono-preact: pub/sub subscribe failed', err);
          }
        );

      return () => {
        closed = true;
        void opening.then(() => {
          socket?.close();
          socket = null;
        });
      };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run cf-pubsub`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/cf/cf-pubsub.ts packages/server/src/cf/__tests__/cf-pubsub.test.ts
git commit -m "feat(realtime): Cloudflare DO-backed PubSubBackend (worker side)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Cloudflare door exports + adapter wrapEntry wiring

**Files:**
- Modify: `packages/server/src/internal-cloudflare.ts`
- Modify: `packages/vite/src/adapter-cloudflare.ts:95-122` (the `wrapEntry` return)
- Test: `packages/vite/src/__tests__/adapter-cloudflare.test.ts`

**Interfaces:**
- Consumes: `makeCfPubSubBackend`, `captureRealtimeRuntime`, `getRealtimeRuntime` (Task 1); `installPubSubBackend` from `hono-preact/internal/runtime`.
- Produces: the generated CF entry now installs the pub/sub backend and wraps the default export to capture `{ env, ctx }`.

- [ ] **Step 1: Write the failing test** — add to `packages/vite/src/__tests__/adapter-cloudflare.test.ts` (inside the existing `describe('cloudflareAdapter', ...)`)

```ts
  it('wrapEntry installs the CF pub/sub backend off the captured runtime', () => {
    const tail = cloudflareAdapter().wrapEntry(ctx);
    expect(tail).toContain(
      `import { installPubSubBackend } from 'hono-preact/internal/runtime';`
    );
    expect(tail).toContain('captureRealtimeRuntime');
    expect(tail).toContain('getRealtimeRuntime');
    // The install is emitted across lines (installPubSubBackend(\n  make...\n));
    // assert the call name and the contiguous inner call separately, matching
    // how the existing makeCfForwardConnector assertion is written.
    expect(tail).toContain('installPubSubBackend(');
    expect(tail).toContain(
      'makeCfPubSubBackend(getRealtimeRuntime, "HONO_PREACT_REALTIME")'
    );
  });

  it('wrapEntry wraps the default export to capture { env, ctx } at the fetch boundary', () => {
    const tail = cloudflareAdapter().wrapEntry(ctx);
    expect(tail).toContain('captureRealtimeRuntime(env, ctx);');
    expect(tail).toContain('return coreApp.fetch(request, env, ctx);');
    // The bare `export default coreApp;` is replaced by the wrapper.
    expect(tail).not.toContain('export default coreApp;');
  });

  it('wrapEntry threads a custom binding into the pub/sub backend too', () => {
    const tail = cloudflareAdapter({ realtimeBinding: 'MY_REALTIME' }).wrapEntry(ctx);
    expect(tail).toContain(
      'makeCfPubSubBackend(getRealtimeRuntime, "MY_REALTIME")'
    );
  });
```

NOTE: the existing test `'wrapEntry re-exports the core app module default'` asserts `tail` contains `export default coreApp;`. Update that assertion to the new wrapper: replace `expect(tail).toContain('export default coreApp;');` with `expect(tail).toContain('return coreApp.fetch(request, env, ctx);');`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run adapter-cloudflare`
Expected: FAIL (the new `installPubSubBackend` / `captureRealtimeRuntime` strings are absent; the updated default-export assertion fails).

- [ ] **Step 3a: Add the door exports** — `packages/server/src/internal-cloudflare.ts`, after the existing `export { ... } from './cf/realtime-do.js';` block, add:

```ts
export {
  makeCfPubSubBackend,
  captureRealtimeRuntime,
  getRealtimeRuntime,
} from './cf/cf-pubsub.js';
```

- [ ] **Step 3b: Update `wrapEntry`** — `packages/vite/src/adapter-cloudflare.ts`. In the import block, add `makeCfPubSubBackend, captureRealtimeRuntime, getRealtimeRuntime` to the existing `from 'hono-preact/server/internal/cloudflare'` import, and add a new import for `installPubSubBackend`. Then add the backend install line and replace the bare default export with the capture wrapper. The emitted return becomes (changed/added lines shown in context):

```ts
      return (
        `import coreApp, { serverImports as __hpServerImports } from ${JSON.stringify(
          ctx.coreAppModuleId
        )};\n` +
        `import {\n` +
        `  HonoPreactRealtimeDO as __HonoPreactRealtimeDO,\n` +
        `  makeCfForwardConnector,\n` +
        `  makeCfPubSubBackend,\n` +
        `  captureRealtimeRuntime,\n` +
        `  getRealtimeRuntime,\n` +
        `  installRoomRegistry,\n` +
        `  buildRoomRegistry,\n` +
        `} from 'hono-preact/server/internal/cloudflare';\n` +
        `import {\n` +
        `  installRealtimeConnector,\n` +
        `  installPubSubBackend,\n` +
        `} from 'hono-preact/internal/runtime';\n` +
        `\n` +
        `installRoomRegistry(() => buildRoomRegistry(__hpServerImports));\n` +
        `installRealtimeConnector(\n` +
        `  makeCfForwardConnector((c) => c.env?.[${JSON.stringify(
          realtimeBinding
        )}], ${JSON.stringify(realtimeBinding)})\n` +
        `);\n` +
        `// Cross-isolate pub/sub for live loaders + publish() rides the same DO\n` +
        `// binding (read-only topic subscriptions + a publish fan-out POST).\n` +
        `installPubSubBackend(\n` +
        `  makeCfPubSubBackend(getRealtimeRuntime, ${JSON.stringify(
          realtimeBinding
        )})\n` +
        `);\n` +
        `\n` +
        `// Re-export the Durable Object class under the name wrangler.jsonc binds.\n` +
        `export class ${realtimeClass} extends __HonoPreactRealtimeDO {}\n` +
        `\n` +
        `// Capture the per-request { env, ctx } at the fetch boundary so the CF\n` +
        `// pub/sub backend can reach the DO binding (env) and keep publish fan-out\n` +
        `// alive past the response (ctx.waitUntil). The binding is per-request on\n` +
        `// workerd, not a module global, so it must be captured from fetch().\n` +
        `export default {\n` +
        `  fetch(request, env, ctx) {\n` +
        `    captureRealtimeRuntime(env, ctx);\n` +
        `    return coreApp.fetch(request, env, ctx);\n` +
        `  },\n` +
        `};\n`
      );
```

(Delete the old trailing `export default coreApp;\n` line; everything else in `wrapEntry` is unchanged.)

- [ ] **Step 4: Run the tests + build to verify**

Run: `pnpm exec vitest run adapter-cloudflare`
Expected: PASS (existing tests + 3 new).

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: builds clean (the door re-export + the iso `installPubSubBackend` import resolve).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/internal-cloudflare.ts packages/vite/src/adapter-cloudflare.ts packages/vite/src/__tests__/adapter-cloudflare.test.ts
git commit -m "feat(realtime): install the CF pub/sub backend + env capture in the generated entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: DO topic/publish branch + workerd integration test

**Files:**
- Modify: `packages/server/src/cf/realtime-do-glue.ts` (add `isTopicSubscriber`)
- Modify: `packages/server/src/cf/realtime-do.ts:116-209`
- Test (unit): `packages/server/src/cf/__tests__/realtime-do.test.ts` (add `isTopicSubscriber` cases)
- Create (fixture): `packages/vite/src/__tests__/fixtures/cf-pubsub/**`
- Create (integration): `packages/vite/src/__tests__/cf-pubsub.test.ts`
- Modify: `vitest.integration.config.ts`

**Interfaces:**
- Consumes: `installPubSubBackend` wiring (Task 2) so the fixture worker installs the CF backend; `makeCfPubSubBackend` (Task 1).
- Produces: a DO that, on `x-hp-kind: topic`, accepts a tagged receive-only subscriber, and on `x-hp-kind: publish`, fans the POST body out to `getWebSockets('topic')`; topic subscribers never run the room engine.

- [ ] **Step 1: Write the failing unit test for `isTopicSubscriber`** — add to `packages/server/src/cf/__tests__/realtime-do.test.ts` (import it from `'../realtime-do-glue.js'`):

```ts
import { isTopicSubscriber } from '../realtime-do-glue.js';

describe('isTopicSubscriber', () => {
  it('true only for a { kind: "topic" } attachment', () => {
    expect(isTopicSubscriber({ kind: 'topic' })).toBe(true);
    expect(isTopicSubscriber({ connId: 'c1', moduleKey: 'm', name: 'n' })).toBe(false);
    expect(isTopicSubscriber(null)).toBe(false);
    expect(isTopicSubscriber(undefined)).toBe(false);
    expect(isTopicSubscriber('topic')).toBe(false);
    expect(isTopicSubscriber({ kind: 'room' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run realtime-do`
Expected: FAIL with `isTopicSubscriber is not a function` / import error.

- [ ] **Step 3a: Add `isTopicSubscriber`** — append to `packages/server/src/cf/realtime-do-glue.ts`:

```ts
/**
 * True when a hibernation socket's attachment marks it as a live-loader topic
 * subscriber (`{ kind: 'topic' }`), as opposed to a room connection (whose
 * attachment is a RoomConnAttachment with no `kind`). Topic subscribers are
 * receive-only and never run the room engine.
 */
export function isTopicSubscriber(attachment: unknown): boolean {
  return (
    typeof attachment === 'object' &&
    attachment !== null &&
    (attachment as { kind?: unknown }).kind === 'topic'
  );
}
```

- [ ] **Step 3b: Add the DO branches** — `packages/server/src/cf/realtime-do.ts`.

Import the helper: add `isTopicSubscriber` to the existing `import { makeCfRoomTransport, makeDOConnState, parseHeaderJson } from './realtime-do-glue.js';`.

At the TOP of `fetch(request)` (before `const moduleKey = ...`), insert:

```ts
    const kind = request.headers.get('x-hp-kind') ?? 'room';

    // Cross-isolate publish (PR 5b): fan the POST body out to this topic's
    // subscriber sockets, then return 204. No upgrade, no engine.
    if (kind === 'publish') {
      const body = await request.text();
      for (const ws of this.ctx.getWebSockets('topic')) {
        ws.send(body);
      }
      return new Response(null, { status: 204 });
    }

    // A worker-held live-loader subscription (PR 5b). Accept it for hibernation,
    // tag it 'topic' (so publish selects it via getWebSockets('topic')), and
    // mark its attachment so the message/close/error handlers skip the room
    // engine. Receive-only: it never sends to the DO.
    if (kind === 'topic') {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server, ['topic']);
      server.serializeAttachment({ kind: 'topic' });
      return new Response(null, { status: 101, webSocket: client });
    }

    // kind === 'room': the existing PR 5a path below, unchanged.
```

At the TOP of each of `webSocketMessage`, `webSocketClose`, `webSocketError`, insert a guard before the existing `const att = ws.deserializeAttachment() ...` line:

```ts
    // Topic subscribers (PR 5b) are receive-only and carry no room state; skip
    // the room engine for them.
    if (isTopicSubscriber(ws.deserializeAttachment())) return;
```

(The existing room logic in each handler is unchanged after the guard. Update the DO class docstring's "no pub/sub; that is PR 5b" line to note that read-only topic subscriptions + a publish fan-out POST now ride the same DO.)

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm exec vitest run realtime-do`
Expected: PASS.

- [ ] **Step 5: Create the integration fixture.** Copy `packages/vite/src/__tests__/fixtures/cf-room/{vite.config.ts,src/Layout.tsx,src/pages/home.tsx}` verbatim into `packages/vite/src/__tests__/fixtures/cf-pubsub/` (same relative paths). Then create these fixture files:

`packages/vite/src/__tests__/fixtures/cf-pubsub/wrangler.jsonc`:

```jsonc
{
  "name": "cf-pubsub",
  "main": "node_modules/.vite/hono-preact/server-entry.tsx",
  "compatibility_date": "2026-02-22",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      { "name": "HONO_PREACT_REALTIME", "class_name": "HonoPreactRealtimeDO" }
    ]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["HonoPreactRealtimeDO"] }]
}
```

`packages/vite/src/__tests__/fixtures/cf-pubsub/src/state.ts` (plain module: shared state + channel, imported by both the `.server` loader and the test `publish` route so neither needs a `.server` cross-import):

```ts
import { defineChannel } from 'hono-preact';

// Shared in-memory demo state + the typed channel the live loader subscribes to
// and the test publish route publishes on. A plain (non-`.server`) module so it
// is importable from both src/data.server.ts and src/api.ts.
export const state = { count: 0 };
export const tallyChannel = defineChannel('cf-pubsub-tally')();
```

`packages/vite/src/__tests__/fixtures/cf-pubsub/src/data.server.ts`:

```ts
import { serverRoute } from 'hono-preact';
import { state, tallyChannel } from './state.js';

const route = serverRoute('/');

// A channel-driven live loader: re-pushes the count on every publish to the
// tally channel. On Cloudflare its subscription rides a worker->DO topic socket
// (PR 5b); a publish from any isolate fans out to it through the DO.
export const serverLoaders = {
  count: route.liveLoader<{ count: number }>({
    topic: () => tallyChannel.key(),
    load: async () => ({ count: state.count }),
  }),
};
```

`packages/vite/src/__tests__/fixtures/cf-pubsub/src/api.ts` (the test-only publish trigger; mounted ahead of the framework):

```ts
import { Hono } from 'hono';
import { publish } from 'hono-preact';
import { state, tallyChannel } from './state.js';

const app = new Hono();

// Test-only: bump the shared count and publish. On Cloudflare this runs in the
// action/edge isolate; the publish must reach every live-loader subscription
// (held in other isolates) cross-isolate through the DO.
app.get('/__test_publish', (c) => {
  state.count += 1;
  publish(tallyChannel.key());
  return c.text('ok');
});

export default app;
```

`packages/vite/src/__tests__/fixtures/cf-pubsub/src/routes.ts` (a single leaf carrying `server` so `serverImports` discovers `data.server.ts`):

```ts
import { defineRoutes } from 'hono-preact';

export default defineRoutes([
  {
    path: '/',
    view: () => import('./pages/home.js'),
    server: () => import('./data.server.js'),
  },
]);
```

- [ ] **Step 6: Write the failing integration test** — `packages/vite/src/__tests__/cf-pubsub.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// End-to-end Cloudflare DO pub/sub integration test (PR 5b). A fixture app using
// cloudflareAdapter() is served through the @cloudflare/vite-plugin workerd dev
// server (same mechanism as cf-room.test.ts). Two SSE `live`-loader
// subscriptions (POST /__loaders) each open a worker->DO topic socket; a publish
// (GET /__test_publish, which calls the framework publish()) must fan out to
// BOTH subscriptions through the DO, proving cross-isolate fan-out.

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, 'fixtures/cf-pubsub');

// The loader wire identity (see loaders-handler + loader-fetch): module key
// 'src/data' (deriveModuleKey of src/data.server.ts at the fixture root), loader
// name 'count' (the serverLoaders property), location for the '/' route.
const MODULE_KEY = 'src/data';
const LOADER_NAME = 'count';
const LOADERS_RPC_PATH = '/__loaders';

function serverPort(server: ViteDevServer): number {
  const addr = server.httpServer!.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

/**
 * Open an SSE `live`-loader subscription and yield each parsed `message` event's
 * data object ({ count }). Returns a reader with nextChunk() and close().
 */
async function openLiveLoader(port: number) {
  const res = await fetch(`http://localhost:${port}${LOADERS_RPC_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module: MODULE_KEY,
      loader: LOADER_NAME,
      location: { path: '/', pathParams: {}, searchParams: {} },
    }),
  });
  if (!res.body) throw new Error('no SSE body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const queue: Array<{ count: number }> = [];
  let waiters: Array<(v: { count: number }) => void> = [];

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        // SSE frames are separated by a blank line; a `message` event is the
        // default (a bare `data:` line, no explicit `event:`).
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = frame
            .split('\n')
            .find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const isMessage = !frame
            .split('\n')
            .some((l) => l.startsWith('event:') && !l.includes('message'));
          if (!isMessage) continue;
          try {
            const parsed = JSON.parse(dataLine.slice('data:'.length).trim());
            if (parsed && typeof parsed.count === 'number') {
              if (waiters.length) waiters.shift()!(parsed);
              else queue.push(parsed);
            }
          } catch {
            /* ignore non-JSON keepalive frames */
          }
        }
      }
    } catch {
      /* stream aborted on close */
    }
  })();

  return {
    nextChunk(timeoutMs = 8_000): Promise<{ count: number }> {
      if (queue.length) return Promise.resolve(queue.shift()!);
      return new Promise((res2, rej) => {
        const t = setTimeout(() => rej(new Error('chunk timeout')), timeoutMs);
        waiters.push((v) => {
          clearTimeout(t);
          res2(v);
        });
      });
    },
    async close() {
      waiters = [];
      await reader.cancel().catch(() => {});
    },
  };
}

describe('Cloudflare adapter: DO pub/sub (two live-loader subscribers, cross-isolate publish)', () => {
  let server: ViteDevServer;
  let originalCwd: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(fixtureRoot);
    server = await createServer({ root: fixtureRoot, server: { port: 0 } });
    await server.listen();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    process.chdir(originalCwd);
  });

  it('a publish() fans out to BOTH live-loader subscriptions through the DO', async () => {
    const port = serverPort(server);

    const a = await openLiveLoader(port);
    const b = await openLiveLoader(port);

    // Each subscription pushes its initial value first (the load() one-shot).
    expect((await a.nextChunk()).count).toBe(0);
    expect((await b.nextChunk()).count).toBe(0);

    // Let both worker->DO topic subscriptions register before publishing.
    await new Promise<void>((res) => setTimeout(res, 500));

    // Trigger publish() in the api isolate; it must reach BOTH subscriptions
    // through the DO (cross-isolate fan-out), re-running their load() -> count 1.
    const pub = await fetch(`http://localhost:${port}/__test_publish`);
    expect(pub.status).toBe(200);

    expect((await a.nextChunk()).count).toBe(1);
    expect((await b.nextChunk()).count).toBe(1);

    await a.close();
    await b.close();
  }, 60_000);
});
```

- [ ] **Step 7: Register the integration test** — `vitest.integration.config.ts`, add to `test.include`:

```ts
      'packages/vite/src/__tests__/cf-pubsub.test.ts',
```

- [ ] **Step 8: Run the integration test to verify it fails, then passes**

Run: `pnpm exec vitest run --config vitest.integration.config.ts cf-pubsub`
Expected (before Step 3b is applied / if reverted): FAIL (the live-loader subscriptions never receive the second chunk because the DO does not fan out, or the topic upgrade runs the room path and errors). With Steps 3a/3b applied: PASS.

(If the test fails after 3b: confirm the fixture worker actually installs the CF backend, i.e. Task 2 is merged; confirm `MODULE_KEY` matches `deriveModuleKey` for `src/data.server.ts` by reading the worker logs for the loader 404, and adjust if the derivation differs.)

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/cf/realtime-do.ts packages/server/src/cf/realtime-do-glue.ts packages/server/src/cf/__tests__/realtime-do.test.ts packages/vite/src/__tests__/fixtures/cf-pubsub packages/vite/src/__tests__/cf-pubsub.test.ts vitest.integration.config.ts
git commit -m "feat(realtime): DO topic-subscribe + publish fan-out, cross-isolate integration test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Dogfood — a live tally on apps/site

**Files:**
- Create: `apps/site/src/pages/demo/live-tally.server.ts`
- Create: `apps/site/src/pages/demo/live-tally.tsx`
- Modify: `apps/site/src/routes.ts` (register `/demo/live-tally`)
- Modify: the demo index/nav that lists demo pages (locate with the grep in Step 4)

**Interfaces:**
- Consumes: `defineChannel`, `serverRoute`, `publish`, `defineAction` (`hono-preact`); `loader.View` + `useAction` (the shipped live-loader consumption). The site's `wrangler.jsonc` already binds `HONO_PREACT_REALTIME` (PR 5a), so no deploy-config change.
- Produces: a `/demo/live-tally` page whose count fans out cross-isolate on workerd.

- [ ] **Step 1: Create the server module** — `apps/site/src/pages/demo/live-tally.server.ts` (mirrors `apps/example-node/src/pages/home.server.ts`):

```ts
import { defineChannel, defineAction, serverRoute, publish } from 'hono-preact';

// A shared, in-memory tally. The increment action publishes on the channel; the
// live loader re-pushes the new value to every connected tab. On Cloudflare the
// publish fans out cross-isolate through the realtime Durable Object (PR 5b), so
// two tabs on the deployed site update each other.
let count = 0;
const tallyChannel = defineChannel('site-live-tally')();
const route = serverRoute('/demo/live-tally');

export const serverLoaders = {
  count: route.liveLoader<{ count: number }>({
    topic: () => tallyChannel.key(),
    load: async () => ({ count }),
  }),
};

export const serverActions = {
  bump: defineAction<Record<string, never>, { count: number }>(async () => {
    count += 1;
    publish(tallyChannel.key());
    return { count };
  }),
};
```

- [ ] **Step 2: Create the page** — `apps/site/src/pages/demo/live-tally.tsx` (mirrors the `LiveCounter` in `apps/example-node/src/pages/home.tsx`; use the site's existing Tailwind class vocabulary as on `cursors-demo.tsx`):

```tsx
import { definePage, useAction } from 'hono-preact';
import { serverLoaders, serverActions } from './live-tally.server.js';

const countLoader = serverLoaders.count;

// Accumulating live view: the latest count pushed over the channel. Open two
// tabs and click Bump in one; both update live, fanned out cross-isolate
// through the Durable Object on Cloudflare.
const LiveTally = countLoader.View<number>(
  ({ data, status }) => {
    const bump = useAction(serverActions.bump);
    return (
      <div class="grid min-h-screen place-items-center bg-background px-4">
        <div class="w-full max-w-md rounded-2xl border border-border bg-surface-subtle p-8 shadow-sm space-y-4 text-center">
          <h1 class="text-xl font-bold text-foreground">Live tally</h1>
          <p class="text-sm text-muted">
            Open this page in a second tab and click Bump. Both update live,
            fanned out cross-isolate through the Durable Object.
          </p>
          <p class="text-5xl font-bold text-foreground tabular-nums">{data}</p>
          <div class="flex items-center justify-center gap-2 text-sm text-muted">
            <span
              class={[
                'inline-block w-2 h-2 rounded-full',
                status === 'open' ? 'bg-green-500' : 'bg-amber-400',
              ].join(' ')}
            />
            <span>{status === 'open' ? 'Connected' : 'Connecting...'}</span>
          </div>
          <button
            type="button"
            class="rounded-md bg-accent text-accent-foreground px-4 py-2 font-medium hover:bg-accent-hover disabled:opacity-60"
            disabled={bump.pending}
            onClick={() => bump.mutate({})}
          >
            Bump
          </button>
          <footer class="border-t border-border pt-4 text-xs text-muted">
            Powered by{' '}
            <a href="/docs/live-data" class="underline hover:text-foreground">
              live loaders + publish
            </a>
            .{' '}
            <a href="/demo" class="underline hover:text-foreground">
              Back to demo
            </a>
          </footer>
        </div>
      </div>
    );
  },
  {
    initial: 0,
    reduce: (_acc, chunk) => chunk.count,
    fallback: (
      <div class="grid min-h-screen place-items-center bg-background px-4 text-sm text-muted">
        Connecting to live tally...
      </div>
    ),
  }
);
LiveTally.displayName = 'LiveTally';

export default definePage(LiveTally, {});
```

- [ ] **Step 3: Register the route** — in `apps/site/src/routes.ts`, add a leaf for `/demo/live-tally` following the existing demo-page pattern (a node with `path: '/demo/live-tally'`, `view: () => import('./pages/demo/live-tally.js')`, `server: () => import('./pages/demo/live-tally.server.js')`). Match the exact shape the neighboring demo routes use (e.g. the cursors-demo entry).

- [ ] **Step 4: Link it from the demo index.** Locate the demo landing list and add a link to `/demo/live-tally`:

Run: `rg -n "cursors|/demo/" apps/site/src/pages/demo/index.tsx`
Add a list entry/card for "Live tally" pointing at `/demo/live-tally`, matching the existing entries' markup.

- [ ] **Step 5: Verify the build + SSR**

Run: `pnpm --filter site build`
Expected: builds clean.

Run (dev SSR smoke, mirrors the cursors verification): start `pnpm --filter site dev`, then `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/demo/live-tally` -> `200`; `curl` the page and confirm it contains `Live tally` and `Connecting`. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages/demo/live-tally.server.ts apps/site/src/pages/demo/live-tally.tsx apps/site/src/routes.ts apps/site/src/pages/demo/index.tsx
git commit -m "feat(site): live tally demo dogfooding cross-isolate publish() + live loaders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Docs note — live data on Cloudflare

**Files:**
- Modify: the live-data docs page (locate in Step 1)

- [ ] **Step 1: Locate the page**

Run: `rg -l "live: true|liveLoader|publish\(|live data" apps/site/src/pages/docs`
The live-data / streaming-loaders docs page is the target (e.g. `apps/site/src/pages/docs/live-data.mdx` or the loaders page). Open it.

- [ ] **Step 2: Add a short "On Cloudflare" note** near where `publish()` / live loaders are introduced. Exact prose to add (no em-dashes):

```md
## On Cloudflare

Live loaders and `publish()` work the same on Cloudflare Workers. Cross-isolate
fan-out (a `publish()` in one request reaching a live loader streaming in another
isolate) is backed by the same `HONO_PREACT_REALTIME` Durable Object that powers
rooms, so no extra setup is needed once that binding is in your `wrangler.jsonc`
(see the rooms docs, "Cloudflare setup"). Your code does not change: `publish()`
and `route.liveLoader` are identical on Node and Cloudflare.
```

- [ ] **Step 3: Verify docs build + corpus**

Run: `pnpm --filter site build` -> clean.
Run: `pnpm gen:agents-corpus` -> regenerates `templates/agents/llms-full.txt`.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs packages/create-hono-preact/templates/agents/llms-full.txt
git commit -m "docs(realtime): note live loaders + publish work on Cloudflare via the realtime DO

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (before opening the PR)

Run the full 7-step gate in order (per `CLAUDE.md`):

1. `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
2. `pnpm gen:agents-corpus`
3. `pnpm format:check` (run `pnpm format` to fix if it fails)
4. `pnpm typecheck`
5. `pnpm test:types`
6. `pnpm test:coverage`
7. `pnpm test:integration` (includes the new `cf-pubsub.test.ts` and the unchanged `cf-room.test.ts`)
8. `pnpm --filter site build`

All green before pushing `realtime-pr5b-cf-do-loaders` and opening the PR.

---

## Notes for the implementer

- **The DO serves both rooms and topics.** The `x-hp-kind` header defaults to `'room'` when absent, so PR 5a's `makeCfForwardConnector` (which does not set it) keeps working unchanged. Only add the two new branches; do not alter the room path.
- **`getWebSockets('topic')`** selects subscribers for publish fan-out via the accept tag; the `{ kind: 'topic' }` attachment is what `isTopicSubscriber` reads in the message/close/error handlers. Both are set at accept time; they are independent on purpose (tag for selection, attachment for the handler guard).
- **The CF backend is receive-blind on the wire payload for live loaders** (`subscribeTopic`'s callback ignores the message and just wakes the generator, which re-runs `load` and reads fresh state). Delivering the parsed payload to `onMessage` is still correct and keeps the backend general.
- **Do not change** `packages/iso/src/internal/pubsub.ts`, `subscribe-topic.ts`, `server-route.ts`, `pubsub.ts`, or the SSE pump: PR 5b only supplies a new backend on CF and the DO endpoints it talks to.
- **Cloudflare door isolation:** `cf-pubsub.ts` must import only TYPES from `@cloudflare/workers-types` (via the `/// <reference ... />`) and the `PubSubBackend` type from `@hono-preact/iso/internal/runtime`; no `cloudflare:workers` runtime import (that stays confined to `realtime-do.ts`).
