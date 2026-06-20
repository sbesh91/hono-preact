# Realtime PR 2: pub/sub backend + channel-driven live loaders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing `live` loaders (shipped in #133) a typed, fan-out-capable source: a server-side pub/sub backend, a typed `publish(topic)`, and `route.liveLoader({ topic, load })` that re-runs `load` whenever an action publishes the channel. Dogfood a visible live counter in the Node example app.

**Architecture:** A process-global in-process `PubSubBackend` lives in iso with a runtime `installPubSubBackend` seam (PR 5 swaps in a Durable-Object backend through it; the Vite adapter is build-time only and is NOT touched). `route.liveLoader` desugars to `defineLoader(route, async function*(){ yield load(); for await (const _ of subscribeTopic(topic, signal)) yield load(); }, { live: true })`, reusing the entire shipped live-loader consumption path (`loader.View` accumulating form, the `/__loaders` SSE transport, SSR-skips-live). PR 2 also promotes PR 1's `defineChannel` to the public surface (it was deferred) and documents the trio. This is the second of a 5-PR program (spec: `docs/superpowers/specs/2026-06-20-first-class-realtime-design.md`).

**Tech Stack:** TypeScript, Babel AST (Vite plugins), Vitest (`vitest run`, `--typecheck.only`), Preact, `@hono/node-server` (example-node).

## Global Constraints

- **No em-dashes** in prose, code comments, or commit messages.
- **Casts are a smell.** In new SOURCE code the only sanctioned cast is the typed-`globalThis` accessor for the process-global registry, and it must mirror the EXISTING pattern in `packages/iso/src/define-loader.ts` (the `SHARED_CACHES_KEY` globalThis Symbol accessor, ~line 230). Do not invent a new cast style; copy that one. Everywhere else in source, reshape. TESTS may use a single documented stub cast where constructing a third-party type (Hono `Context`) cleanly is impractical, and only for a field the code under test does not read.
- **Reuse the shipped live-loader path.** `route.liveLoader` MUST produce a normal `{ live: true }` `LoaderRef<T, true>` via `defineLoader`; do not add a parallel loader pipeline. Consumption stays the existing accumulating `loader.View(render, { initial, reduce })`.
- **`publish` is server-only at runtime** but lives in iso (actions import from `hono-preact`, which re-exports iso). It must not throw if imported on the client; it simply operates on the (empty) client-side registry, which is never published to in practice.
- **Coarse re-run, coalesced.** `subscribeTopic` coalesces bursts: N publishes during one `load()` collapse to at most one extra re-run. The published message payload is NOT used by `route.liveLoader` (it re-runs `load`); the payload type exists only for `publish`/`Topic` type-safety.
- **`.server` contract unchanged.** `route.liveLoader(...)` lives inside `serverLoaders`. `server-loader-validation.ts` validates export NAMES only (verified), so it needs no change; `module-key-plugin.ts` + `server-loaders-parser.ts` DO need to recognize the new call and thread the module key into its single options-object argument.
- **Node engine floor** `^22.18.0 || >=24.11.0`; "Unsupported engine" WARN on Node 24.10 is expected.
- **Pre-merge gate** (mirror `.github/workflows/ci.yml`): framework build, `pnpm format:check`, `pnpm typecheck`, `pnpm test:types`, `pnpm test:coverage`, `pnpm test:integration`, `pnpm --filter site build`. (PR 2 touches the public surface + site docs + example-node, so the last two matter this time.)
- Commits land on the current branch `realtime-pr2-pubsub-live-loaders` (based on `main` with PR 1 merged).

---

### Task 1: `PubSubBackend` interface + in-process backend + install seam

**Files:**
- Create: `packages/iso/src/internal/pubsub.ts`
- Modify: `packages/iso/src/internal-runtime.ts` (export `installPubSubBackend`)
- Test: `packages/iso/src/internal/__tests__/pubsub.test.ts`

**Interfaces:**
- Produces (from `internal/pubsub.ts`): `interface PubSubBackend { publish(topic: string, message: unknown): void; subscribe(topic: string, onMessage: (message: unknown) => void): () => void }`; `inProcessBackend: PubSubBackend`; `getPubSubBackend(): PubSubBackend`; `installPubSubBackend(backend: PubSubBackend): void`.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/pubsub.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  inProcessBackend,
  getPubSubBackend,
  installPubSubBackend,
} from '../pubsub.js';

afterEach(() => installPubSubBackend(inProcessBackend)); // restore default

describe('inProcessBackend', () => {
  it('delivers a published message to every subscriber of the topic', () => {
    const got: unknown[] = [];
    const off1 = inProcessBackend.subscribe('t', (m) => got.push(['a', m]));
    const off2 = inProcessBackend.subscribe('t', (m) => got.push(['b', m]));
    inProcessBackend.publish('t', 42);
    off1();
    off2();
    expect(got).toEqual([
      ['a', 42],
      ['b', 42],
    ]);
  });

  it('isolates topics', () => {
    const got: unknown[] = [];
    const off = inProcessBackend.subscribe('a', (m) => got.push(m));
    inProcessBackend.publish('b', 1);
    inProcessBackend.publish('a', 2);
    off();
    expect(got).toEqual([2]);
  });

  it('stops delivery after unsubscribe', () => {
    const got: unknown[] = [];
    const off = inProcessBackend.subscribe('t', (m) => got.push(m));
    inProcessBackend.publish('t', 1);
    off();
    inProcessBackend.publish('t', 2);
    expect(got).toEqual([1]);
  });

  it('isolates a throwing subscriber from the others', () => {
    const got: unknown[] = [];
    const offBad = inProcessBackend.subscribe('t', () => {
      throw new Error('boom');
    });
    const offGood = inProcessBackend.subscribe('t', (m) => got.push(m));
    expect(() => inProcessBackend.publish('t', 1)).not.toThrow();
    offBad();
    offGood();
    expect(got).toEqual([1]);
  });
});

describe('install seam', () => {
  it('getPubSubBackend returns the in-process backend by default', () => {
    expect(getPubSubBackend()).toBe(inProcessBackend);
  });

  it('installPubSubBackend swaps the active backend', () => {
    const calls: string[] = [];
    const fake: typeof inProcessBackend = {
      publish: (t) => calls.push(`pub:${t}`),
      subscribe: () => () => undefined,
    };
    installPubSubBackend(fake);
    getPubSubBackend().publish('x', 0);
    expect(calls).toEqual(['pub:x']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/internal/__tests__/pubsub.test.ts`
Expected: FAIL, cannot resolve `../pubsub.js`.

- [ ] **Step 3: Implement `internal/pubsub.ts`**

First Read `packages/iso/src/define-loader.ts` around the `SHARED_CACHES_KEY` globalThis accessor (~line 230) and copy its exact typed-global pattern for the registry below (do not invent a different cast).

Create `packages/iso/src/internal/pubsub.ts`:

```ts
// Server-side topic pub/sub. The in-process backend is the default (used on
// Node, where publisher and subscriber share one process); a different backend
// (e.g. a Cloudflare Durable Object) is installed at runtime via
// installPubSubBackend. The Vite adapter is build-time only and does not supply
// this; it is a runtime seam.

/** A topic message bus. `subscribe` returns an unsubscribe function. */
export interface PubSubBackend {
  publish(topic: string, message: unknown): void;
  subscribe(topic: string, onMessage: (message: unknown) => void): () => void;
}

// Process-global registry so the bus survives HMR and multiple module
// evaluations, mirroring define-loader.ts's SHARED_CACHES_KEY accessor.
const REGISTRY_KEY = Symbol.for('@hono-preact/pubsub-inprocess');
type GlobalWithRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, Set<(message: unknown) => void>>;
};
function registry(): Map<string, Set<(message: unknown) => void>> {
  const g = globalThis as GlobalWithRegistry;
  return (g[REGISTRY_KEY] ??= new Map());
}

export const inProcessBackend: PubSubBackend = {
  publish(topic, message) {
    const subs = registry().get(topic);
    if (!subs) return;
    // Copy before iterating so an unsubscribe during dispatch is safe; isolate
    // each subscriber so one throwing listener does not starve the rest.
    for (const cb of [...subs]) {
      try {
        cb(message);
      } catch {
        // ignore a misbehaving subscriber
      }
    }
  },
  subscribe(topic, onMessage) {
    const reg = registry();
    let set = reg.get(topic);
    if (!set) {
      set = new Set();
      reg.set(topic, set);
    }
    set.add(onMessage);
    return () => {
      set.delete(onMessage);
      if (set.size === 0) reg.delete(topic);
    };
  },
};

let current: PubSubBackend = inProcessBackend;

/** Swap the active pub/sub backend (e.g. a Durable-Object backend on CF). */
export function installPubSubBackend(backend: PubSubBackend): void {
  current = backend;
}

/** The active backend. Internal helpers (publish, subscribeTopic) delegate here. */
export function getPubSubBackend(): PubSubBackend {
  return current;
}
```

- [ ] **Step 4: Export the install seam from the runtime door**

In `packages/iso/src/internal-runtime.ts`, add (next to the existing `env` / `installStreamRegistry` exports):

```ts
export { installPubSubBackend } from './internal/pubsub.js';
export type { PubSubBackend } from './internal/pubsub.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/internal/__tests__/pubsub.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Format, then commit**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/iso/src/internal/pubsub.ts packages/iso/src/internal/__tests__/pubsub.test.ts packages/iso/src/internal-runtime.ts
git commit -m "feat(iso): in-process PubSubBackend + installPubSubBackend runtime seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: typed `publish` + `subscribeTopic` async-iterable bridge

**Files:**
- Create: `packages/iso/src/pubsub.ts` (public `publish`)
- Create: `packages/iso/src/internal/subscribe-topic.ts` (the coalescing bridge)
- Test: `packages/iso/src/__tests__/pubsub.test.ts`
- Test: `packages/iso/src/internal/__tests__/subscribe-topic.test.ts`

**Interfaces:**
- Consumes: `getPubSubBackend` (Task 1); `Topic` from `packages/iso/src/define-channel.ts` (PR 1).
- Produces: `publish<P>(topic: Topic<P>, ...args: PublishArgs<P>): void`; `subscribeTopic(topic: string, signal: AbortSignal): AsyncGenerator<void, void, unknown>`.

- [ ] **Step 1: Write the failing `publish` test**

Create `packages/iso/src/__tests__/pubsub.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { publish } from '../pubsub.js';
import { defineChannel } from '../define-channel.js';
import {
  inProcessBackend,
  installPubSubBackend,
} from '../internal/pubsub.js';

afterEach(() => installPubSubBackend(inProcessBackend));

describe('publish', () => {
  it('delivers a payload to a subscriber of the channel topic', () => {
    const ch = defineChannel('board/:projectId')<{ n: number }>();
    const got: unknown[] = [];
    const off = inProcessBackend.subscribe('board/p1', (m) => got.push(m));
    publish(ch.key({ projectId: 'p1' }), { n: 7 });
    off();
    expect(got).toEqual([{ n: 7 }]);
  });

  it('a signal (void) channel publishes with no message argument', () => {
    const ping = defineChannel('ping')();
    const got: unknown[] = [];
    const off = inProcessBackend.subscribe('ping', (m) => got.push(m));
    publish(ping.key());
    off();
    expect(got).toEqual([undefined]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/pubsub.test.ts`
Expected: FAIL, cannot resolve `../pubsub.js`.

- [ ] **Step 3: Implement `publish`**

Create `packages/iso/src/pubsub.ts`:

```ts
import type { Topic } from './define-channel.js';
import { getPubSubBackend } from './internal/pubsub.js';

// A signal channel (Topic<void>) publishes with no message; a payload channel
// requires its message. Mirrors define-channel's KeyArgs conditional-rest shape.
type PublishArgs<P> = [P] extends [void] ? [] : [message: P];

/**
 * Publish to a typed channel topic. Call from a server action (or a server
 * agent) after a mutation; every live loader subscribed to the topic re-runs
 * its `load` and pushes fresh data.
 *
 *   publish(boardChannel.key({ projectId }), { taskId, to });
 *   publish(pingChannel.key());            // signal channel
 */
export function publish<P>(topic: Topic<P>, ...args: PublishArgs<P>): void {
  getPubSubBackend().publish(topic, args[0]);
}
```

- [ ] **Step 4: Run the `publish` test to verify it passes**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/pubsub.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing `subscribeTopic` test**

Create `packages/iso/src/internal/__tests__/subscribe-topic.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { subscribeTopic } from '../subscribe-topic.js';
import { inProcessBackend, installPubSubBackend } from '../pubsub.js';

afterEach(() => installPubSubBackend(inProcessBackend));

describe('subscribeTopic', () => {
  it('yields once per publish and ends on abort, unsubscribing', async () => {
    const ac = new AbortController();
    const gen = subscribeTopic('t', ac.signal);

    const first = gen.next(); // pending until a publish
    inProcessBackend.publish('t', 0);
    const r1 = await first;
    expect(r1).toEqual({ value: undefined, done: false });

    const second = gen.next();
    inProcessBackend.publish('t', 0);
    expect(await second).toEqual({ value: undefined, done: false });

    // abort ends the generator
    const third = gen.next();
    ac.abort();
    expect(await third).toEqual({ value: undefined, done: true });
  });

  it('coalesces a burst that arrives before the next pull into one wake', async () => {
    const ac = new AbortController();
    const gen = subscribeTopic('t', ac.signal);
    // burst before any pull
    inProcessBackend.publish('t', 0);
    inProcessBackend.publish('t', 0);
    inProcessBackend.publish('t', 0);
    const r1 = await gen.next();
    expect(r1.done).toBe(false); // one coalesced wake
    // no second wake is pending now; abort to end cleanly
    const next = gen.next();
    ac.abort();
    expect((await next).done).toBe(true);
  });

  it('removes its subscription on abort (no leak)', async () => {
    const ac = new AbortController();
    const gen = subscribeTopic('leak-topic', ac.signal);
    void gen.next();
    ac.abort();
    await gen.next();
    // After teardown, the registry has no subscribers for the topic, so a
    // fresh subscribe/publish on a sibling topic is unaffected; assert the
    // generator is done and a publish reaches zero of its (removed) callbacks.
    const seen: unknown[] = [];
    const off = inProcessBackend.subscribe('leak-topic', (m) => seen.push(m));
    inProcessBackend.publish('leak-topic', 1);
    off();
    expect(seen).toEqual([1]); // only the fresh subscriber, the gen's is gone
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/internal/__tests__/subscribe-topic.test.ts`
Expected: FAIL, cannot resolve `../subscribe-topic.js`.

- [ ] **Step 7: Implement `subscribeTopic`**

Create `packages/iso/src/internal/subscribe-topic.ts`:

```ts
import { getPubSubBackend } from './pubsub.js';

/**
 * Bridge a topic subscription into a coalescing async iterable for a live
 * loader's generator: each `yield` is a "something changed, re-run load" wake.
 * A burst of publishes that arrives between pulls collapses to a single wake
 * (coarse re-run). Tears down the subscription when `signal` aborts (the
 * request ended / client disconnected) and ends the iteration.
 */
export async function* subscribeTopic(
  topic: string,
  signal: AbortSignal
): AsyncGenerator<void, void, unknown> {
  let pending = false;
  let wake: (() => void) | null = null;
  const unsub = getPubSubBackend().subscribe(topic, () => {
    pending = true;
    wake?.();
    wake = null;
  });
  const onAbort = () => {
    wake?.();
    wake = null;
  };
  signal.addEventListener('abort', onAbort);
  try {
    while (!signal.aborted) {
      if (!pending) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (signal.aborted) break;
      pending = false;
      yield;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    unsub();
  }
}
```

- [ ] **Step 8: Run the `subscribeTopic` test to verify it passes**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/internal/__tests__/subscribe-topic.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Format, then commit**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/iso/src/pubsub.ts packages/iso/src/internal/subscribe-topic.ts packages/iso/src/__tests__/pubsub.test.ts packages/iso/src/internal/__tests__/subscribe-topic.test.ts
git commit -m "feat(iso): typed publish + coalescing subscribeTopic bridge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `route.liveLoader` + Vite module-key threading

**Files:**
- Modify: `packages/iso/src/server-route.ts` (add `liveLoader` to `RouteServer` + impl)
- Modify: `packages/vite/src/server-loaders-parser.ts` (recognize `.liveLoader`)
- Modify: `packages/vite/src/module-key-plugin.ts` (merge keys into the single options arg)
- Test: `packages/iso/src/__tests__/server-route.test-d.ts` (type contract; create if absent)
- Test: `packages/vite/src/__tests__/module-key-live-loader.test.ts`

**Interfaces:**
- Consumes: `defineLoader`, `LoaderRef`, `Loader`, `LoaderCtx`, `DefineLoaderOpts`, `LoaderCache` (`define-loader.ts`); `RouteParams`, `RegisteredPaths` (`internal/typed-routes.ts`); `Topic` (`define-channel.ts`); `subscribeTopic` (Task 2).
- Produces: `RouteServer<RouteId>.liveLoader<T>(opts): LoaderRef<T, true>`; `isLiveLoaderCall(call): boolean` (parser); `ParsedLoaderEntry.kind: 'loader' | 'liveLoader'`.

- [ ] **Step 1: Extend the parser**

In `packages/iso`'s sibling `packages/vite/src/server-loaders-parser.ts`:

1. Add `kind: 'loader' | 'liveLoader'` to `ParsedLoaderEntry`.

2. Add the recognizer below `isLoaderCall`:

```ts
/** A `route.liveLoader({...})` / `serverRoute(...).liveLoader({...})` call. */
export function isLiveLoaderCall(call: CallExpression): boolean {
  const callee = call.callee;
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'liveLoader'
  );
}
```

3. In `parseServerLoaders`, accept both call kinds and tag them. Replace the `if (!isLoaderCall(call)) continue;` block (and the `optsArg` computation) with:

```ts
const live = isLiveLoaderCall(call);
if (!isLoaderCall(call) && !live) continue;

// route.liveLoader takes a single options object; loaders take (fn, opts) or
// ('/r/:id', fn, opts).
let optsArg: ObjectExpression | null = null;
if (live) {
  optsArg =
    call.arguments[0]?.type === 'ObjectExpression'
      ? (call.arguments[0] as ObjectExpression)
      : null;
} else {
  const isRouteForm = call.arguments[0]?.type === 'StringLiteral';
  const optsCandidate = isRouteForm
    ? call.arguments[2]
    : call.arguments[1];
  optsArg =
    optsCandidate?.type === 'ObjectExpression'
      ? (optsCandidate as ObjectExpression)
      : null;
}

entries.push({ name: prop.key.name, call, optsArg, kind: live ? 'liveLoader' : 'loader' });
```

- [ ] **Step 2: Extend the module-key plugin to thread keys into the live-loader options object**

In `packages/vite/src/module-key-plugin.ts`, import `isLiveLoaderCall`:

```ts
import { isLoaderCall, isLiveLoaderCall, parseServerLoaders } from './server-loaders-parser.js';
```

In `visitCallWithName`, add this branch immediately after the `if (!isLoaderCall(node)) return;` guard is relaxed. Replace the guard `if (!isLoaderCall(node)) return;` with:

```ts
const isLive = isLiveLoaderCall(node);
if (!isLoaderCall(node) && !isLive) return;
```

Then, right after `if (args.length === 0) return;` and before `const isRouteForm = ...`, insert:

```ts
// route.liveLoader({ topic, load, ... }) carries a single options object that
// IS the opts; merge the keys into it rather than appending a second arg.
if (isLive) {
  mergeInto(args[0]);
  return;
}
```

(The legacy top-level fallthrough loop only calls `visitCallWithName` for non-`serverLoaders` `CallExpression` decls; `route.liveLoader` is only used inside `serverLoaders`, so it is reached via the `parseServerLoaders` loop, which now yields it.)

- [ ] **Step 3: Write the failing module-key test**

Create `packages/vite/src/__tests__/module-key-live-loader.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { moduleKeyPlugin } from '../module-key-plugin.js';

function transform(code: string, id: string) {
  const plugin = moduleKeyPlugin();
  // @ts-expect-error minimal Vite config stub for configResolved
  plugin.configResolved?.({ root: '/proj' });
  // @ts-expect-error transform signature
  return plugin.transform?.(code, id) as { code: string } | undefined;
}

describe('moduleKeyPlugin: route.liveLoader', () => {
  it('threads __moduleKey and __loaderName into the single options object', () => {
    const code = [
      `import { serverRoute, publish } from 'hono-preact';`,
      `const route = serverRoute('/board/:projectId');`,
      `export const serverLoaders = {`,
      `  feed: route.liveLoader({ topic: (c) => boardChannel.key({ projectId: c.location.pathParams.projectId }), load: async () => ({ n: 1 }) }),`,
      `};`,
    ].join('\n');
    const out = transform(code, '/proj/src/pages/board.server.ts');
    expect(out?.code).toContain('export const __moduleKey =');
    // merged INTO the object literal (not appended as a 2nd argument):
    expect(out?.code).toMatch(/liveLoader\(\{\s*__moduleKey:/);
    expect(out?.code).toContain(`__loaderName: "feed"`);
    // must NOT have become a two-arg call
    expect(out?.code).not.toMatch(/liveLoader\([^)]*\},\s*\{\s*__moduleKey/);
  });
});
```

- [ ] **Step 4: Run it to verify it fails, then passes after Steps 1-2 land**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/module-key-live-loader.test.ts`
Expected after Steps 1-2: PASS. (If the assertions fail, the merge targeted the wrong argument; re-check the `isLive` branch threads into `args[0]`.)

- [ ] **Step 5: Implement `route.liveLoader` in `server-route.ts`**

Replace `packages/iso/src/server-route.ts` with:

```ts
import {
  defineLoader,
  type DefineLoaderOpts,
  type Loader,
  type LoaderCache,
  type LoaderCtx,
  type LoaderRef,
} from './define-loader.js';
import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';
import type { Topic } from './define-channel.js';
import { subscribeTopic } from './internal/subscribe-topic.js';

/** Options for a channel-driven live loader bound to a route. */
export interface LiveLoaderOpts<T, TParams> {
  /** The channel topic this loader re-runs on. Build it with `channel.key(...)`. */
  topic: (ctx: LoaderCtx<TParams>) => Topic<unknown>;
  /** Produce the data. Runs on first connect and on every publish to `topic`. */
  load: (ctx: LoaderCtx<TParams>) => Promise<T>;
  cache?: LoaderCache<T>;
  use?: DefineLoaderOpts<T>['use'];
  timeoutMs?: number | false;
  // Threaded by the Vite module-key plugin; not set by hand.
  __moduleKey?: string;
  __loaderName?: string;
}

export interface RouteServer<RouteId extends string> {
  loader<T>(
    fn: Loader<T, RouteParams<RouteId>>,
    opts?: Omit<DefineLoaderOpts<T>, 'live'>
  ): LoaderRef<T, false>;

  /**
   * A channel-driven live loader. Yields `load(ctx)` once, then re-runs and
   * pushes it on every `publish` to `topic(ctx)`. Consume it via the
   * accumulating form: `ref.View(render, { initial, reduce })`.
   */
  liveLoader<T>(opts: LiveLoaderOpts<T, RouteParams<RouteId>>): LoaderRef<T, true>;
}

export function serverRoute<const RouteId extends RegisteredPaths>(
  route: RouteId
): RouteServer<RouteId> {
  return {
    loader: (fn, opts) => defineLoader(route, fn, opts),
    liveLoader: ({ topic, load, cache, use, timeoutMs, __moduleKey, __loaderName }) =>
      defineLoader(
        route,
        async function* (ctx) {
          yield await load(ctx);
          const t = topic(ctx);
          for await (const _ of subscribeTopic(t, ctx.signal)) {
            yield await load(ctx);
          }
        },
        { live: true, cache, use, timeoutMs, __moduleKey, __loaderName }
      ),
  };
}
```

(Confirm `DefineLoaderOpts` already declares `__moduleKey?`/`__loaderName?` and `use?`: it does, per `define-loader.ts:172-205`. If `timeoutMs`/`cache`/`use` are `undefined`, `defineLoader` applies its defaults; `live: true` already forces no-timeout by default.)

- [ ] **Step 6: Write the type contract for `route.liveLoader`**

Create (or append to) `packages/iso/src/__tests__/server-route.test-d.ts`:

```ts
// route.liveLoader returns a live LoaderRef: accumulating .View only.
import { expectTypeOf } from 'vitest';
import { serverRoute } from '../server-route.js';
import { defineChannel } from '../define-channel.js';

function _probes() {
  const route = serverRoute('/board/:projectId');
  const boardChannel = defineChannel('board/:projectId')<{ n: number }>();

  const ref = route.liveLoader({
    topic: (ctx) =>
      boardChannel.key({ projectId: ctx.location.pathParams.projectId }),
    load: async () => ({ count: 1 }),
  });

  // Live ref: useData and Boundary are never; accumulating View is available.
  expectTypeOf(ref.useData).toBeNever();
  ref.View<number[]>(
    (args) => {
      expectTypeOf(args.data).toEqualTypeOf<number[]>();
      return null;
    },
    { initial: [], reduce: (acc) => acc }
  );

  // ctx.location.pathParams.projectId is typed from the route pattern.
  route.liveLoader({
    topic: (ctx) => {
      expectTypeOf(ctx.location.pathParams.projectId).toEqualTypeOf<string>();
      return boardChannel.key({ projectId: ctx.location.pathParams.projectId });
    },
    load: async () => ({ count: 1 }),
  });
}

void _probes;
```

- [ ] **Step 7: Run type + unit tests**

Run: `pnpm exec vitest run --typecheck.only packages/iso/src/__tests__/server-route.test-d.ts`
Expected: `Test Files 1 passed`, `Type Errors no errors`.
Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/module-key-live-loader.test.ts src/__tests__/server-loader-validation-plugin.test.ts`
Expected: PASS (the new test + the unchanged validation suite).

- [ ] **Step 8: Format, then commit**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/iso/src/server-route.ts packages/iso/src/__tests__/server-route.test-d.ts packages/vite/src/server-loaders-parser.ts packages/vite/src/module-key-plugin.ts packages/vite/src/__tests__/module-key-live-loader.test.ts
git commit -m "feat: route.liveLoader (channel-driven live loader) + vite module-key threading

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Public surface + docs (promote `defineChannel`, add `publish`)

**Files:**
- Modify: `packages/iso/src/index.ts` (export `defineChannel`, `Channel`, `Topic`, `publish`)
- Modify: `packages/iso/src/__tests__/public-exports.test.ts` (assert the new runtime exports)
- Create: a docs page under `apps/site/src/pages/docs/` (follow the local skill)
- Modify: the docs nav + regenerate `llms.txt`/`llms-full.txt` as the local skill/site build require

**Interfaces:**
- Consumes: everything from Tasks 1-3 + PR 1's `defineChannel`/`Channel`/`Topic`.
- Produces: public `defineChannel`, `publish`, `route.liveLoader` (via the already-exported `serverRoute`), `Channel`, `Topic` types.

- [ ] **Step 1: Read the local docs skill FIRST**

Read `.claude/skills/add-docs-page.md` and follow it for the page + nav + any generation steps. (Per project convention, local skills are mandatory for this kind of task.)

- [ ] **Step 2: Add the public exports**

In `packages/iso/src/index.ts`, add:

```ts
export { defineChannel } from './define-channel.js';
export type { Channel, Topic } from './define-channel.js';
export { publish } from './pubsub.js';
export type { LiveLoaderOpts } from './server-route.js';
```

(`serverRoute`/`RouteServer` are already exported, so `route.liveLoader` becomes available automatically.)

- [ ] **Step 3: Update the public-exports test**

In `packages/iso/src/__tests__/public-exports.test.ts`, add assertions alongside the existing ones:

```ts
it('exports defineChannel and publish', () => {
  expect(typeof iso.defineChannel).toBe('function');
  expect(typeof iso.publish).toBe('function');
});
```

- [ ] **Step 4: Write the docs page (per the local skill)**

Create the page the local skill prescribes (e.g. `apps/site/src/pages/docs/realtime.mdx` or under the established docs area), covering exactly three APIs with one cohesive example (the live-counter shape from Task 6):

- `defineChannel('name/:param')<Payload>()` -> a typed channel; `channel.key(params)` -> a `Topic`.
- `publish(channel.key(params), message)` in a server action after a mutation.
- `route.liveLoader({ topic, load })` in `serverLoaders`, consumed via `loader.View(render, { initial, reduce })`.

Include the dividing-line note from the spec: live loaders are server->client over SSE; on Cloudflare cross-isolate fan-out requires the Durable-Object backend (a later release). Follow the no-migration-breadcrumbs convention (describe what is, not what changed). Add the nav entry the skill specifies.

- [ ] **Step 5: Run the docs/exports gates**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/public-exports.test.ts`
Expected: PASS.
Run: `pnpm --filter site build`
Expected: PASS, including the llms generation. If the llms exports-coverage step reports `defineChannel`/`publish` as undocumented, ensure the docs page from Step 4 covers them (the generator scans the docs corpus); re-run until green. If `apps/site/src/llms/generate-llms.ts` has an explicit allowlist for intentionally-undocumented exports, do NOT use it here (these are documented).

- [ ] **Step 6: Format, then commit**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add -A
git commit -m "feat(iso): export defineChannel/publish + realtime docs page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Node integration test (publish -> live loader re-runs)

**Files:**
- Create: `packages/iso/src/__tests__/live-loader-integration.test.ts`

**Interfaces:**
- Consumes: `serverRoute` (Task 3), `defineChannel` (PR 1), `publish` (Task 2), `inProcessBackend`/`installPubSubBackend` (Task 1).

- [ ] **Step 1: Write the integration test**

This drives the generator a `route.liveLoader` produces directly (no HTTP), proving: initial `load`, a re-run on `publish`, fan-out to two independent subscribers, and teardown on abort.

Create `packages/iso/src/__tests__/live-loader-integration.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { serverRoute } from '../server-route.js';
import { defineChannel } from '../define-channel.js';
import { publish } from '../pubsub.js';
import { inProcessBackend, installPubSubBackend } from '../internal/pubsub.js';
import type { LoaderCtx } from '../define-loader.js';

afterEach(() => installPubSubBackend(inProcessBackend));

const channel = defineChannel('counter')();

function makeCtx(signal: AbortSignal): LoaderCtx<Record<string, string>> {
  // Minimal ctx: the live generator only reads ctx.signal and (via topic/load) nothing else here.
  return {
    // c is unused by this loader; cast-free minimal stub is not possible for Context,
    // so the loader's load/topic must not touch ctx.c (they do not).
    c: undefined as never,
    location: { pathParams: {} } as LoaderCtx<Record<string, string>>['location'],
    signal,
  };
}

describe('channel-driven live loader (integration)', () => {
  it('yields initial load then re-runs on publish, and fans out to two subscribers', async () => {
    let count = 0;
    const route = serverRoute('/counter');
    const ref = route.liveLoader<{ count: number }>({
      topic: () => channel.key(),
      load: async () => ({ count }),
    });

    const acA = new AbortController();
    const acB = new AbortController();
    const a = ref.fn(makeCtx(acA.signal)) as AsyncGenerator<{ count: number }>;
    const b = ref.fn(makeCtx(acB.signal)) as AsyncGenerator<{ count: number }>;

    expect((await a.next()).value).toEqual({ count: 0 }); // initial
    expect((await b.next()).value).toEqual({ count: 0 });

    // both are now awaiting a publish
    const aNext = a.next();
    const bNext = b.next();
    count = 1;
    publish(channel.key());

    expect((await aNext).value).toEqual({ count: 1 }); // fan-out re-run
    expect((await bNext).value).toEqual({ count: 1 });

    // teardown
    acA.abort();
    acB.abort();
    expect((await a.next()).done).toBe(true);
    expect((await b.next()).done).toBe(true);
  });
});
```

(If the `LoaderCtx` stub proves awkward, type `makeCtx`'s return precisely against the imported `LoaderCtx` and keep `c` unused; the loader under test never reads `ctx.c`. Do not weaken the loader to accommodate the test.)

- [ ] **Step 2: Run it**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/live-loader-integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/iso/src/__tests__/live-loader-integration.test.ts
git commit -m "test(iso): integration test for channel-driven live loader fan-out

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Dogfood, a live counter in apps/example-node

**Files:**
- Modify: `apps/example-node/src/pages/home.server.ts`
- Modify: `apps/example-node/src/pages/home.tsx`

**Interfaces:**
- Consumes: `defineChannel`, `serverRoute`, `publish`, `defineAction`, `useAction` from `hono-preact`.

- [ ] **Step 1: Add the live counter to the server module**

Replace `apps/example-node/src/pages/home.server.ts` with:

```ts
import { defineChannel, defineAction, serverRoute, publish } from 'hono-preact';

// In-process demo state. The Node adapter runs one process, so publish from the
// action reaches the live loader's subscription (cross-isolate fan-out needs the
// Durable-Object backend, a later release).
let count = 0;
const counter = defineChannel('counter')();
const route = serverRoute('/');

export const serverLoaders = {
  // Existing non-live greeting (unchanged behavior).
  default: defineLoader(async () => ({
    message: 'Hello from the Node adapter loader',
    renderedAt: new Date().toISOString(),
  })),
  // New: a live loader that re-pushes the count on every publish.
  count: route.liveLoader<{ count: number }>({
    topic: () => counter.key(),
    load: async () => ({ count }),
  }),
};

export const serverActions = {
  echo: defineAction<{ text: string }, { echoed: string }>(
    async (_ctx, input) => ({ echoed: input.text })
  ),
  increment: defineAction<Record<string, never>, { count: number }>(
    async () => {
      count += 1;
      publish(counter.key());
      return { count };
    }
  ),
};
```

Add `defineLoader` to the import (it is still used by `default`):

```ts
import { defineChannel, defineLoader, defineAction, serverRoute, publish } from 'hono-preact';
```

- [ ] **Step 2: Render the live counter on the home page**

Replace `apps/example-node/src/pages/home.tsx` with:

```tsx
import { definePage, useAction } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders, serverActions } from './home.server.js';

const homeLoader = serverLoaders.default;
const countLoader = serverLoaders.count;

const HomePage: FunctionComponent = () => {
  const { message } = homeLoader.useData();
  return (
    <section>
      <h1>example-node</h1>
      <p>{message}</p>
      <LiveCounter />
      <a href="/about">About</a>
    </section>
  );
};
HomePage.displayName = 'HomePage';

// Accumulating live view: data is the latest count pushed over the channel.
// Open two tabs and click Increment in one; both update live.
const LiveCounter = countLoader.View<number>(
  ({ data, status }) => {
    const inc = useAction(serverActions.increment);
    return (
      <p>
        Live count: <strong>{data}</strong> ({status}){' '}
        <button type="button" disabled={inc.pending} onClick={() => inc.mutate({})}>
          Increment
        </button>
      </p>
    );
  },
  { initial: 0, reduce: (_acc, chunk) => chunk.count, fallback: <p>Live count: connecting...</p> }
);

const HomeView = homeLoader.View(() => <HomePage />, {
  fallback: <p>Loading...</p>,
});

export default definePage(HomeView, {});
```

(Confirm `useAction`'s returned shape: `mutate(input)` and `pending`. If the field names differ in this version, read `packages/iso/src/action.ts`'s `useAction` return and match them; do not guess.)

- [ ] **Step 3: Verify the example app builds and the wiring typechecks**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Run: `pnpm --filter example-node exec tsc --noEmit` (or `pnpm typecheck` which covers it)
Expected: clean. Optionally run `pnpm --filter example-node dev`, open two browser tabs at `/`, click Increment in one, and confirm both tabs' "Live count" update together (manual; the in-process bus fans out under `@hono/node-server`).

- [ ] **Step 4: Format, then commit**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add apps/example-node/src/pages/home.server.ts apps/example-node/src/pages/home.tsx
git commit -m "feat(example-node): dogfood a live counter (route.liveLoader + publish)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Pre-merge gate

**Files:** none (verification only).

- [ ] **Step 1: Build framework dist**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Expected: all build; `hono-preact` consolidates.

- [ ] **Step 2: format:check, typecheck, type tests**

Run: `pnpm format:check` -> PASS (else `pnpm format` and amend).
Run: `pnpm typecheck` -> PASS.
Run: `pnpm test:types` -> PASS (includes `server-route.test-d.ts`).

- [ ] **Step 3: Unit suite + integration + site build**

Run: `pnpm test:coverage` -> PASS (includes the new pubsub / subscribe-topic / live-loader-integration / module-key-live-loader tests). Note: a `measure-client-size` failure under the sandbox is a resource-loading artifact, re-run that one file with the sandbox disabled to confirm it passes.
Run: `pnpm test:integration` -> PASS.
Run: `pnpm --filter site build` -> PASS (llms generation includes the new docs).

- [ ] **Step 4: Final status review**

Run: `git status` (clean) and `git log --oneline main..HEAD` (the six feature commits). The PR is ready to open; run a deep PR review immediately after opening (the live-loader path reuses #133's consumption, so spec-parity focus is on the new source side and the module-key threading).

---

## Self-Review

**Spec coverage (PR 2 row):**
- Pub/sub backend + Node in-process impl + install seam: Task 1.
- `publish` + subscribe→async-iterable bridge: Task 2.
- `route.liveLoader` over the existing `{live:true}`/`.View` path: Task 3 (+ Vite threading so the client RPC path finds it).
- Public surface + docs (PR 1's deferred `defineChannel` promotion + `publish`): Task 4.
- Validation that publish re-runs a live loader with fan-out: Task 5.
- Visible dogfood (cards-move-on-their-own analog) under Node: Task 6 (live counter; site board deferred to PR 5's DO backend per the dogfood decision).
- Spec deviation recorded: backend is a runtime `installPubSubBackend` seam + default in-process backend, NOT an `adapter.pubsub` field, because the Vite adapter is build-time only (research-confirmed). No `@hono-preact/server` change.

**Placeholder scan:** none; each code step has full code or an exact command + expected output. Task 4's docs prose defers to the local `add-docs-page` skill (by design) but specifies exact content and the gate command.

**Type consistency:** `PubSubBackend`, `publish<P>(topic: Topic<P>, ...PublishArgs<P>)`, `subscribeTopic(topic, signal): AsyncGenerator<void>`, `LiveLoaderOpts<T, TParams>`, and `RouteServer.liveLoader<T>(opts): LoaderRef<T, true>` are used identically where defined and consumed; `getPubSubBackend`/`installPubSubBackend` names match across Tasks 1-2; the parser's `isLiveLoaderCall` + `ParsedLoaderEntry.kind` match the plugin's `isLive` branch in Task 3.
