# Server-published session channel implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a server middleware publish a typed value that its paired client
middleware reads off `ctx`, so client guards stop hand-managing `localStorage`
auth-hint state.

**Architecture:** A `defineSessionChannel<T>()` handle is referenced by both
tiers of an existing middleware pair. On the server, `publish` writes into the
AsyncLocalStorage-backed request store (the same primitive
`server-deny-registry.ts` uses). The accumulated snapshot is serialized onto the
SSR document and onto an `X-HP-Channels` response header for loader and action
RPC. On the client it lands in an in-memory module store, never persisted, and
`read(ctx)` returns it.

**Tech Stack:** TypeScript, Preact, Hono, Vite (Babel-based transform plugin),
Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-server-published-session-channel-design.md`

## Global Constraints

- No em-dashes in prose, code comments, or commit messages.
- Never commit or push unless explicitly told to.
- The framework build `tsconfig` in every package excludes `src/**/__tests__/**`.
  Test files are typechecked only by `pnpm typecheck:tests`. Never remove that
  exclude.
- `packages/iso/src/internal/` core modules must not import `@preact/signals`.
  The core-signals-free invariant is measured by the size probe. Use `useState`
  for any forced re-render.
- New public exports must be added to `packages/iso/src/index.ts` and re-exported
  from `hono-preact`.
- Client-tier code must never assume `window` exists. Guard with `isBrowser()`
  from `packages/iso/src/is-browser.js`.
- Run `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
  before any `pnpm typecheck`, because cross-package types resolve through `dist/`.
- Run tests from the repo root with `pnpm exec vitest run <pattern>`.
  `pnpm --filter <pkg> test` is a silent no-op in this monorepo.

---

## File structure

**New files**

- `packages/iso/src/session-channel.ts`: the public `defineSessionChannel`
  factory and the `SessionChannel<T>` type. Public surface only.
- `packages/iso/src/internal/channel-registry.ts`: server side: the request
  slot, `publishToChannel`, `takeChannelSnapshot`.
- `packages/iso/src/internal/channel-store.ts`: client side: the in-memory
  snapshot store, `readChannel`, `applyChannelSnapshot`.
- `packages/iso/src/internal/channel-wire.ts`: the shared wire contract:
  the `ChannelSnapshot` type, the header name, encode/decode. Imported by both
  tiers so the two halves cannot drift.

**Modified files**

- `packages/server/src/render.tsx`: take the snapshot inside the request scope,
  thread it through `RootValue`, hand it to `assembleDocument`.
- `packages/server/src/document-shell.ts`: emit the snapshot as an inline
  bootstrap script.
- `packages/server/src/loaders-handler.ts`: set the response header on both the
  JSON and SSE paths.
- `packages/server/src/page-actions-handler.ts`: set the response header.
- `packages/iso/src/internal/loader-fetch.ts`: read the header off the response.
- `packages/vite/src/guard-strip.ts`: inject a stable channel id at the
  `defineSessionChannel()` call site.
- `packages/iso/src/index.ts`: export the public surface.
- `apps/site/src/demo/guard.ts`, `login.tsx`, `projects-shell.tsx`: migrate.

Splitting the wire contract into its own leaf is deliberate. The server and
client halves must agree on the header name and the snapshot encoding, and
`request-slot-key.ts` already documents why a shared contract gets its own
import-free leaf rather than living in either consumer.

---

## Task 1: The wire contract and the server registry

**Files:**
- Create: `packages/iso/src/internal/channel-wire.ts`
- Create: `packages/iso/src/internal/channel-registry.ts`
- Test: `packages/iso/src/internal/__tests__/channel-registry.test.ts`

**Interfaces:**
- Consumes: `globalRequestSlotKey`, `readRequestSlot`, `writeRequestSlot` from
  `./request-scoped-slot.js`; `runRequestScope` from `../cache.js`.
- Produces: `type ChannelSnapshot = Record<string, unknown>`;
  `CHANNEL_HEADER = 'X-HP-Channels'`; `encodeSnapshot(s): string`;
  `decodeSnapshot(raw: string | null): ChannelSnapshot | null`;
  `publishToChannel(id: string, value: unknown): void`;
  `takeChannelSnapshot(): ChannelSnapshot | null`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/iso/src/internal/__tests__/channel-registry.test.ts
import { describe, expect, it } from 'vitest';
import { runRequestScope } from '../../cache.js';
import { publishToChannel, takeChannelSnapshot } from '../channel-registry.js';
import { decodeSnapshot, encodeSnapshot } from '../channel-wire.js';

describe('channel registry', () => {
  it('accumulates publishes from separate channels into one snapshot', async () => {
    const snapshot = await runRequestScope(async () => {
      publishToChannel('a', { signedIn: true });
      publishToChannel('b', 3);
      return takeChannelSnapshot();
    });
    expect(snapshot).toEqual({ a: { signedIn: true }, b: 3 });
  });

  it('last write wins for the same channel', async () => {
    const snapshot = await runRequestScope(async () => {
      publishToChannel('a', 1);
      publishToChannel('a', 2);
      return takeChannelSnapshot();
    });
    expect(snapshot).toEqual({ a: 2 });
  });

  it('returns null when nothing published', async () => {
    const snapshot = await runRequestScope(async () => takeChannelSnapshot());
    expect(snapshot).toBeNull();
  });

  it('clears the slot so a second take sees nothing', async () => {
    const second = await runRequestScope(async () => {
      publishToChannel('a', 1);
      takeChannelSnapshot();
      return takeChannelSnapshot();
    });
    expect(second).toBeNull();
  });

  it('does not throw outside a request scope', () => {
    expect(() => publishToChannel('a', 1)).not.toThrow();
    expect(takeChannelSnapshot()).toBeNull();
  });

  it('round-trips a snapshot through the wire encoding', () => {
    const snapshot = { a: { signedIn: true } };
    expect(decodeSnapshot(encodeSnapshot(snapshot))).toEqual(snapshot);
  });

  it('decodes malformed input to null rather than throwing', () => {
    expect(decodeSnapshot('not json')).toBeNull();
    expect(decodeSnapshot(null)).toBeNull();
    expect(decodeSnapshot('[1,2]')).toBeNull();
    expect(decodeSnapshot('"a string"')).toBeNull();
  });
});
```

Check the exact name and signature of the request-scope helper in
`packages/iso/src/cache.ts` before running. `runRequestScope` is the name used
throughout `render.tsx`; if the exported spelling differs, use the real one
consistently in this test and every later task.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/channel-registry.test.ts`
Expected: FAIL, cannot resolve `../channel-registry.js`.

- [ ] **Step 3: Write the wire contract**

```ts
// packages/iso/src/internal/channel-wire.ts
//
// The contract both tiers agree on. Kept in its own import-free leaf for the
// same reason `request-slot-key.ts` is: the server registry and the client
// store both need it, and putting it in either one makes them import each
// other.

/**
 * Every channel's published value for one server round-trip, keyed by channel
 * id. `unknown` because the values are app-authored; only the channel handle
 * that published a key knows its type, and it asserts that type at `read`.
 */
export type ChannelSnapshot = Record<string, unknown>;

/**
 * The response header carrying a snapshot on loader and action RPC.
 *
 * A header rather than a body field because the loader RPC answers with either
 * a JSON body or an SSE stream, and the action body is a discriminated union a
 * sibling field would have to be intersected onto every arm. A header is
 * uniform across all of them and reshapes no wire type.
 */
export const CHANNEL_HEADER = 'X-HP-Channels';

export function encodeSnapshot(snapshot: ChannelSnapshot): string {
  return JSON.stringify(snapshot);
}

/**
 * Parse a snapshot off the wire. Returns null for anything that is not a JSON
 * object, including `null`, arrays and primitives. This is a trust boundary in
 * the sense that the wire cannot prove the shape, so the check is structural
 * and total rather than a cast.
 */
export function decodeSnapshot(raw: string | null): ChannelSnapshot | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as ChannelSnapshot;
}
```

- [ ] **Step 4: Write the server registry**

```ts
// packages/iso/src/internal/channel-registry.ts
import {
  globalRequestSlotKey,
  readRequestSlot,
  writeRequestSlot,
} from './request-scoped-slot.js';
import type { ChannelSnapshot } from './channel-wire.js';

// `takeChannelSnapshot` clears the slot, so `undefined` is a value this slot
// genuinely holds and belongs in its type. Mirrors `server-deny-registry.ts`.
const REGISTRY_KEY = globalRequestSlotKey<ChannelSnapshot | undefined>(
  '@hono-preact/channel-registry'
);

/**
 * Record a channel's published value for the current request. Last write wins:
 * unlike the deny registry there is no severity ordering here, and a middleware
 * that publishes twice means the later value.
 *
 * A no-op outside a request scope, which is what makes an accidental
 * module-scope publish inert rather than a crash.
 */
export function publishToChannel(id: string, value: unknown): void {
  const current = readRequestSlot(REGISTRY_KEY);
  writeRequestSlot(REGISTRY_KEY, { ...(current ?? {}), [id]: value });
}

/**
 * Take ownership of this request's snapshot, clearing it. Must be called while
 * still inside the request scope: the AsyncLocalStorage store backing it is not
 * live once the scope's promise is awaited by the caller. This is the same
 * constraint `takeServerDeny` documents, and the same reason `render.tsx`
 * threads the result out through its return value rather than reading it later.
 */
export function takeChannelSnapshot(): ChannelSnapshot | null {
  const snapshot = readRequestSlot(REGISTRY_KEY);
  writeRequestSlot(REGISTRY_KEY, undefined);
  return snapshot ?? null;
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/channel-registry.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/channel-wire.ts \
        packages/iso/src/internal/channel-registry.ts \
        packages/iso/src/internal/__tests__/channel-registry.test.ts
git commit -m "feat(iso): request-scoped channel registry and wire contract"
```

---

## Task 2: The client store and the public channel handle

**Files:**
- Create: `packages/iso/src/internal/channel-store.ts`
- Create: `packages/iso/src/session-channel.ts`
- Test: `packages/iso/src/internal/__tests__/channel-store.test.ts`
- Test: `packages/iso/src/__tests__/session-channel.test.ts`

**Interfaces:**
- Consumes: `ChannelSnapshot` from `./channel-wire.js`; `publishToChannel` from
  `./channel-registry.js`; `ServerCtx`, `ClientPageCtx` from
  `../define-middleware.js`.
- Produces: `applyChannelSnapshot(s: ChannelSnapshot | null): void`;
  `readChannelValue(id: string): unknown`; `resetChannelStore(): void`;
  `defineSessionChannel<T>(): SessionChannel<T>` where
  `SessionChannel<T> = { readonly __channelId: string; publish(ctx: ServerCtx, value: T): void; read(ctx: ClientPageCtx): T | undefined }`.

- [ ] **Step 1: Write the failing store test**

```ts
// packages/iso/src/internal/__tests__/channel-store.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyChannelSnapshot,
  readChannelValue,
  resetChannelStore,
} from '../channel-store.js';

describe('channel store', () => {
  beforeEach(() => resetChannelStore());

  it('reads back an applied snapshot', () => {
    applyChannelSnapshot({ a: { signedIn: true } });
    expect(readChannelValue('a')).toEqual({ signedIn: true });
  });

  it('returns undefined for a channel never published', () => {
    applyChannelSnapshot({ a: 1 });
    expect(readChannelValue('b')).toBeUndefined();
  });

  it('replaces rather than merges, so a dropped key clears', () => {
    applyChannelSnapshot({ a: 1, b: 2 });
    applyChannelSnapshot({ a: 1 });
    expect(readChannelValue('b')).toBeUndefined();
  });

  it('ignores a null snapshot so a response without the header is not a logout', () => {
    applyChannelSnapshot({ a: 1 });
    applyChannelSnapshot(null);
    expect(readChannelValue('a')).toBe(1);
  });
});
```

The third and fourth cases are the load-bearing pair and are easy to get
backwards. A round-trip that ran the chain and published nothing for channel
`b` MUST clear `b`, because that is how logout propagates with no app code. A
response that carried no header at all is not evidence of anything, because
some responses never run a route-node chain, so it must leave the store alone.
Replace-on-snapshot plus ignore-on-null is exactly that distinction.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/channel-store.test.ts`
Expected: FAIL, cannot resolve `../channel-store.js`.

- [ ] **Step 3: Write the client store**

```ts
// packages/iso/src/internal/channel-store.ts
import type { ChannelSnapshot } from './channel-wire.js';

// In-memory and deliberately NOT persisted. A cold load always arrives with a
// server-authored snapshot in the SSR bootstrap, so there is nothing to carry
// across sessions and therefore nothing that can go stale across them. Putting
// this in localStorage would reintroduce the exact drift #398 exists to remove.
let current: ChannelSnapshot = {};

/**
 * Install the snapshot from a server round-trip.
 *
 * REPLACES rather than merges. A round-trip whose chain published nothing for a
 * channel means that channel has no value now, which is how a logout clears a
 * session hint without the app writing any code. Merging would make a published
 * value permanent for the life of the page.
 *
 * A `null` snapshot means the response carried no header at all, which is not
 * the same statement: plenty of responses never run a route-node chain. Those
 * leave the store untouched.
 */
export function applyChannelSnapshot(snapshot: ChannelSnapshot | null): void {
  if (snapshot === null) return;
  current = snapshot;
}

export function readChannelValue(id: string): unknown {
  return current[id];
}

/** Test-only reset. Not exported from the package index. */
export function resetChannelStore(): void {
  current = {};
}
```

- [ ] **Step 4: Run the store test and verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/channel-store.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing handle test**

```ts
// packages/iso/src/__tests__/session-channel.test.ts
import { describe, expect, it } from 'vitest';
import type { ServerPageCtx, ClientPageCtx } from '../define-middleware.js';
import { runRequestScope } from '../cache.js';
import { defineSessionChannel } from '../session-channel.js';
import { takeChannelSnapshot } from '../internal/channel-registry.js';
import {
  applyChannelSnapshot,
  resetChannelStore,
} from '../internal/channel-store.js';

// Neither tier's implementation touches anything on the ctx beyond its type, so
// a minimal cast-free stand-in is enough. If a future change starts reading a
// ctx field, this stub must grow rather than be cast away.
const clientCtx = { scope: 'page', location: {} } as unknown as ClientPageCtx;
const serverCtx = { scope: 'page' } as unknown as ServerPageCtx;

describe('defineSessionChannel', () => {
  it('gives each channel a distinct id', () => {
    expect(defineSessionChannel().__channelId).not.toBe(
      defineSessionChannel().__channelId
    );
  });

  it('publishes into the request snapshot under its own id', async () => {
    const channel = defineSessionChannel<{ signedIn: boolean }>();
    const snapshot = await runRequestScope(async () => {
      channel.publish(serverCtx, { signedIn: true });
      return takeChannelSnapshot();
    });
    expect(snapshot).toEqual({ [channel.__channelId]: { signedIn: true } });
  });

  it('reads back the value the server published', async () => {
    resetChannelStore();
    const channel = defineSessionChannel<{ signedIn: boolean }>();
    const snapshot = await runRequestScope(async () => {
      channel.publish(serverCtx, { signedIn: true });
      return takeChannelSnapshot();
    });
    applyChannelSnapshot(snapshot);
    expect(channel.read(clientCtx)).toEqual({ signedIn: true });
  });

  it('reads undefined before any round-trip has published', () => {
    resetChannelStore();
    expect(defineSessionChannel<number>().read(clientCtx)).toBeUndefined();
  });

  it('does not leak one channel value into another', async () => {
    resetChannelStore();
    const a = defineSessionChannel<number>();
    const b = defineSessionChannel<number>();
    const snapshot = await runRequestScope(async () => {
      a.publish(serverCtx, 1);
      return takeChannelSnapshot();
    });
    applyChannelSnapshot(snapshot);
    expect(a.read(clientCtx)).toBe(1);
    expect(b.read(clientCtx)).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run it and verify it fails**

Run: `pnpm exec vitest run packages/iso/src/__tests__/session-channel.test.ts`
Expected: FAIL, cannot resolve `../session-channel.js`.

- [ ] **Step 7: Write the channel handle**

```ts
// packages/iso/src/session-channel.ts
import type { ClientPageCtx, ServerCtx } from './define-middleware.js';
import { publishToChannel } from './internal/channel-registry.js';
import { readChannelValue } from './internal/channel-store.js';

/**
 * A typed value a server middleware publishes on each round-trip and its paired
 * client middleware reads.
 *
 * The type argument is explicit rather than inferred. `defineServerMiddleware`
 * infers its deny type because that type sits in the function's return position
 * and has to union across a whole `use` array; a channel payload is declared
 * once and read by one paired middleware, and this repo has already established
 * that a type-argument spelling is inference-dead.
 */
export type SessionChannel<T> = {
  /**
   * The cross-bundle identity of this channel. Public because the Vite plugin
   * rewrites it at the call site and the wire encoding is keyed by it, so a
   * debugging user who sees it on a response header can find its declaration.
   */
  readonly __channelId: string;
  /**
   * Publish from a server middleware. A no-op outside a request scope.
   *
   * Takes `ctx` although the request store is ambient, because the parameter is
   * what makes the tier obvious at the call site and what stops this from being
   * callable from client code that has no ctx to hand it.
   */
  publish(ctx: ServerCtx, value: T): void;
  /**
   * Read what the last server round-trip published, or `undefined` if no
   * round-trip has published on this channel. A guard treats `undefined` the
   * same way it treats an absent flag: not authorized.
   */
  read(ctx: ClientPageCtx): T | undefined;
};

// Fallback identity for the non-Vite paths: unit tests and the in-process
// `call()` path. Neither crosses a bundle boundary, so a per-instance counter
// is sufficient there. Under Vite the plugin rewrites the `defineSessionChannel()`
// call to pass a module-derived id, which is what makes the server and client
// bundles agree. See `packages/vite/src/guard-strip.ts`.
let fallbackId = 0;

export function defineSessionChannel<T>(id?: string): SessionChannel<T> {
  const channelId = id ?? `hp-channel-${++fallbackId}`;
  return {
    __channelId: channelId,
    publish(_ctx, value) {
      publishToChannel(channelId, value);
    },
    read(_ctx) {
      // The wire cannot prove the stored value matches `T`. The claim is made
      // once, here, by the handle that also owns the `publish` that produced
      // it, rather than at every call site. Same boundary discipline as
      // `decodeActionResponse` projecting a deny into its declared type.
      return readChannelValue(channelId) as T | undefined;
    },
  };
}
```

- [ ] **Step 8: Run it and verify it passes**

Run: `pnpm exec vitest run packages/iso/src/__tests__/session-channel.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add packages/iso/src/internal/channel-store.ts \
        packages/iso/src/session-channel.ts \
        packages/iso/src/internal/__tests__/channel-store.test.ts \
        packages/iso/src/__tests__/session-channel.test.ts
git commit -m "feat(iso): defineSessionChannel handle and client snapshot store"
```

---

## Task 3: SSR document transport

**Files:**
- Modify: `packages/server/src/render.tsx` (the `takeServerDeny` site around
  line 188, the `RootValue` type, and the `assembleDocument` call around line 282)
- Modify: `packages/server/src/document-shell.ts` (the `assembleDocument` options
  object at line 62)
- Modify: `packages/iso/src/internal/channel-store.ts`
- Test: `packages/server/src/__tests__/channel-ssr-transport.test.ts`

**Interfaces:**
- Consumes: `takeChannelSnapshot` from iso's internal barrel
  (`packages/iso/src/internal.ts`, the same barrel `render.tsx` already imports
  `takeServerDeny` from); `encodeSnapshot`, `ChannelSnapshot` from
  `channel-wire.js`.
- Produces: `assembleDocument` gains an optional `channels?: ChannelSnapshot | null`
  option; `hydrateChannelsFromDocument(): void` in `channel-store.ts`; the global
  `window.__HP_CHANNELS__`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/__tests__/channel-ssr-transport.test.ts
import { describe, expect, it } from 'vitest';
import { assembleDocument } from '../document-shell.js';

// Match the head shape the other document-shell tests build. Read one of them
// (`packages/server/src/__tests__/`) and copy its `head` stub rather than
// inventing a shape, because `HeadStatic` is hoofd's and is easy to get wrong.
const head = { title: '', tags: [] } as never;

describe('assembleDocument channel bootstrap', () => {
  it('emits the snapshot as a global before the body closes', () => {
    const html = assembleDocument({
      html: '<div>app</div>',
      head,
      channels: { a: { signedIn: true } },
    });
    expect(html).toContain('window.__HP_CHANNELS__');
    expect(html).toContain('{"a":{"signedIn":true}}');
  });

  it('emits nothing when no channel published', () => {
    const html = assembleDocument({ html: '<div>app</div>', head, channels: null });
    expect(html).not.toContain('__HP_CHANNELS__');
  });

  it('escapes a closing script tag in a published value', () => {
    const html = assembleDocument({
      html: '<div>app</div>',
      head,
      channels: { a: '</script><script>alert(1)</script>' },
    });
    expect(html).not.toContain('</script><script>alert(1)');
  });
});
```

The third case is not optional. The published value is app-authored and may
contain user data, so a raw `JSON.stringify` interpolated into an inline script
is a stored-XSS sink. This test is the guard against that.

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm exec vitest run packages/server/src/__tests__/channel-ssr-transport.test.ts`
Expected: FAIL, `channels` is not a known option.

- [ ] **Step 3: Add the option to `assembleDocument`**

Add to the options object at `packages/server/src/document-shell.ts:62`:

```ts
  /**
   * This request's published channel snapshot, emitted as an inline bootstrap
   * so the client store has a server-authored value before any client
   * middleware runs. `null` or omitted emits nothing.
   */
  channels?: ChannelSnapshot | null;
```

And, immediately before the `</body>` insertion point, emit:

```ts
const channelBootstrap =
  opts.channels && Object.keys(opts.channels).length > 0
    ? `<script>window.__HP_CHANNELS__=${serializeForScript(opts.channels)}</script>`
    : '';
```

with, in the same file:

```ts
/**
 * Serialize a value for interpolation into an inline `<script>`.
 *
 * `JSON.stringify` alone is a stored-XSS sink here: a published value is
 * app-authored and may carry user data, and a `</script>` inside a string
 * closes the tag the parser is in. Escaping `<` covers that and the `<!--`
 * case; escaping the line separators covers the two code points that are legal
 * in JSON strings but terminate a JavaScript line.
 */
function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
```

Read the surrounding function first: `assembleDocument` already warns when
`</head>` is missing, so follow whatever insertion helper it uses for the body
rather than doing a bare string concat.

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm exec vitest run packages/server/src/__tests__/channel-ssr-transport.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Thread the snapshot through `render.tsx`**

Add `channels: ChannelSnapshot | null` to the `RootValue` type. In the `inner`
callback, beside the existing `const serverDeny = takeServerDeny();`, add:

```ts
            // Taken here for the same reason as the deny above: the
            // AsyncLocalStorage store backing it is not live once this scope's
            // promise is awaited by the caller.
            const channels = takeChannelSnapshot();
```

Return it on the `{ kind: 'value', ... }` object, then pass
`channels: rootResult.channels` into the `assembleDocument` call.

Export `takeChannelSnapshot` from `packages/iso/src/internal.ts` alongside
`takeServerDeny` so `render.tsx` can import it from the same barrel.

- [ ] **Step 6: Read the bootstrap on the client**

In `packages/iso/src/internal/channel-store.ts`, add:

```ts
import { isBrowser } from '../is-browser.js';
import { decodeSnapshot, type ChannelSnapshot } from './channel-wire.js';

/**
 * Seed the store from the SSR bootstrap global. Called once during client boot,
 * before any client middleware chain runs, so a guard on the initial load reads
 * a server-authored value rather than an empty store.
 */
export function hydrateChannelsFromDocument(): void {
  if (!isBrowser()) return;
  const raw = (globalThis as { __HP_CHANNELS__?: unknown }).__HP_CHANNELS__;
  if (raw === undefined) return;
  // Re-encode and run the same total decoder the header path uses, so one
  // structural check covers both transports and neither can accept a shape the
  // other rejects.
  applyChannelSnapshot(decodeSnapshot(JSON.stringify(raw)));
}
```

Call it from the client entry boot, next to wherever the loader preload data is
read. Grep for `getPreloadedData` to find that seam.

- [ ] **Step 7: Verify the whole suite is green**

Run: `pnpm exec vitest run packages/server packages/iso`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(server): carry the channel snapshot on the SSR document"
```

---

## Task 4: RPC header transport

**Files:**
- Modify: `packages/server/src/loaders-handler.ts` (the `c.json(result)` return
  around line 470, and the SSE response construction)
- Modify: `packages/server/src/page-actions-handler.ts`
- Modify: `packages/iso/src/internal/loader-fetch.ts` (after the `fetch` at
  line 61, covering both the `res.json()` path at 169 and the SSE path at 72)
- Test: `packages/server/src/__tests__/channel-rpc-transport.test.ts`
- Test: `packages/iso/src/internal/__tests__/loader-fetch-channels.test.ts`

**Interfaces:**
- Consumes: `CHANNEL_HEADER`, `encodeSnapshot`, `decodeSnapshot` from
  `channel-wire.js`; `takeChannelSnapshot` from `channel-registry.js`;
  `applyChannelSnapshot` from `channel-store.js`.
- Produces: no new exports. Both RPC handlers set `CHANNEL_HEADER` on their
  response; `fetchLoaderData` applies the decoded snapshot.

- [ ] **Step 1: Write the failing server test**

```ts
// packages/server/src/__tests__/channel-rpc-transport.test.ts
import { describe, expect, it } from 'vitest';
import { CHANNEL_HEADER } from '@hono-preact/iso/internal';

describe('RPC channel header', () => {
  it('sets the header on the loader JSON response when a chain published', async () => {
    // Build the loaders handler the way the existing loaders-handler tests do.
    // Read `packages/server/src/__tests__/` for the established harness and
    // reuse it rather than constructing a Hono app from scratch here.
    const res = await callLoadersRpcWithPublishingGuard();
    expect(res.headers.get(CHANNEL_HEADER)).toBe('{"demo":{"signedIn":true}}');
  });

  it('sets the header on the SSE response too', async () => {
    const res = await callStreamingLoadersRpcWithPublishingGuard();
    expect(res.headers.get(CHANNEL_HEADER)).toBe('{"demo":{"signedIn":true}}');
  });

  it('omits the header when nothing published', async () => {
    const res = await callLoadersRpcWithNoGuard();
    expect(res.headers.get(CHANNEL_HEADER)).toBeNull();
  });

  it('sets the header on an action response', async () => {
    const res = await callActionRpcWithPublishingGuard();
    expect(res.headers.get(CHANNEL_HEADER)).toBe('{"demo":{"signedIn":true}}');
  });
});
```

The SSE case is the one most likely to be skipped and is the one that matters
most. The header must be set when the `Response` is constructed, before the
stream body starts, so it cannot be added after the first chunk flushes.

Replace the four `call*` helpers with the real harness from the neighbouring
`loaders-handler` and `page-actions-handler` tests. Do not invent a harness.

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm exec vitest run packages/server/src/__tests__/channel-rpc-transport.test.ts`
Expected: FAIL, header is null on every case.

- [ ] **Step 3: Set the header in both handlers**

In each handler, after the route-node chain has run and while still inside the
request scope, take the snapshot and set it:

```ts
const channels = takeChannelSnapshot();
if (channels) c.header(CHANNEL_HEADER, encodeSnapshot(channels));
```

For the SSE path, set it on the `Response` the streaming helper builds, not
after. Grep for where the loader SSE `Response` is constructed in
`loaders-handler.ts` and add the header to its init.

Omitting the header when nothing published is deliberate and must not be
"tidied" into always sending `{}`. An absent header means "this response says
nothing about channels" and leaves the client store alone; `{}` means "every
channel is now empty" and would clear a live session hint on any response whose
route ran no publishing chain. That distinction is what
`applyChannelSnapshot(null)` implements.

- [ ] **Step 4: Write the failing client test**

```ts
// packages/iso/src/internal/__tests__/loader-fetch-channels.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_HEADER } from '../channel-wire.js';
import {
  readChannelValue,
  resetChannelStore,
} from '../channel-store.js';
import { fetchLoaderData } from '../loader-fetch.js';

afterEach(() => {
  vi.unstubAllGlobals();
  resetChannelStore();
});

function stubFetch(headers: Record<string, string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ results: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json', ...headers },
      })
    )
  );
}

describe('fetchLoaderData channel header', () => {
  it('applies a snapshot from the response header', async () => {
    stubFetch({ [CHANNEL_HEADER]: '{"demo":{"signedIn":true}}' });
    await runFetchLoaderData();
    expect(readChannelValue('demo')).toEqual({ signedIn: true });
  });

  it('leaves the store alone when the response carries no header', async () => {
    resetChannelStore();
    stubFetch({ [CHANNEL_HEADER]: '{"demo":1}' });
    await runFetchLoaderData();
    stubFetch({});
    await runFetchLoaderData();
    expect(readChannelValue('demo')).toBe(1);
  });

  it('clears a channel the new snapshot omits', async () => {
    stubFetch({ [CHANNEL_HEADER]: '{"demo":1}' });
    await runFetchLoaderData();
    stubFetch({ [CHANNEL_HEADER]: '{}' });
    await runFetchLoaderData();
    expect(readChannelValue('demo')).toBeUndefined();
  });
});
```

Write `runFetchLoaderData` as a thin wrapper calling `fetchLoaderData` with the
argument shape its signature at `loader-fetch.ts:49` requires. Read that
signature and the existing `loader-fetch` tests first.

The third case is the logout path. If it does not pass, a user who signs out
keeps a live client hint until they reload, which is the bug this whole change
exists to prevent.

- [ ] **Step 5: Run it and verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-fetch-channels.test.ts`
Expected: FAIL on the first and third cases.

- [ ] **Step 6: Read the header in `loader-fetch.ts`**

Immediately after the `fetch` resolves at line 61, before the `res.ok` branch,
so both the JSON and the SSE paths are covered by one read:

```ts
    // Applied before the body is examined, and before the `res.ok` bail, so a
    // denied or errored round-trip still updates the store. A 401 is exactly
    // the response that should clear a stale session hint.
    applyChannelSnapshot(decodeSnapshot(res.headers.get(CHANNEL_HEADER)));
```

Do the same in the action fetch path. Grep for `decodeActionResponse` to find
where the action response is received on the client.

- [ ] **Step 7: Run both test files and verify they pass**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-fetch-channels.test.ts packages/server/src/__tests__/channel-rpc-transport.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: carry channel snapshots on loader and action RPC responses"
```

---

## Task 5: Stable channel ids from the Vite plugin

**Files:**
- Modify: `packages/vite/src/guard-strip.ts`
- Test: `packages/vite/src/__tests__/channel-id-injection.test.ts`

**Interfaces:**
- Consumes: the existing Babel parse/traverse plumbing and
  `ISO_PACKAGE_SOURCES` in `guard-strip.ts`.
- Produces: `defineSessionChannel()` call sites rewritten to
  `defineSessionChannel("<module>#<n>")` in both bundles.

This is the highest-risk task in the plan. The spec names channel identity as
the main implementation risk: the server and client bundles construct separate
objects, so a runtime counter cannot make them agree. Do this one carefully and
do not batch it with another task.

- [ ] **Step 1: Write the failing test**

```ts
// packages/vite/src/__tests__/channel-id-injection.test.ts
import { describe, expect, it } from 'vitest';
// Reuse the transform harness the neighbouring guard-strip-plugin tests use.
// Read `packages/vite/src/__tests__/guard-strip-plugin.test.ts` and copy its
// setup rather than building a new one.
import { transformWith } from './helpers/transform.js';

describe('channel id injection', () => {
  it('injects a module-derived id at the call site', async () => {
    const out = await transformWith(
      `import { defineSessionChannel } from 'hono-preact';
       const a = defineSessionChannel();`,
      '/src/demo/guard.ts'
    );
    expect(out).toContain('defineSessionChannel("/src/demo/guard.ts#0")');
  });

  it('numbers multiple channels in one module by declaration order', async () => {
    const out = await transformWith(
      `import { defineSessionChannel } from 'hono-preact';
       const a = defineSessionChannel();
       const b = defineSessionChannel();`,
      '/src/demo/guard.ts'
    );
    expect(out).toContain('"/src/demo/guard.ts#0"');
    expect(out).toContain('"/src/demo/guard.ts#1"');
  });

  it('produces the same id in the server and client bundles', async () => {
    const src = `import { defineSessionChannel } from 'hono-preact';
                 const a = defineSessionChannel();`;
    const server = await transformWith(src, '/src/demo/guard.ts', { ssr: true });
    const client = await transformWith(src, '/src/demo/guard.ts', { ssr: false });
    const id = /defineSessionChannel\("([^"]+)"\)/;
    expect(src.match(id)).toBeNull();
    expect(server.match(id)?.[1]).toBe(client.match(id)?.[1]);
  });

  it('leaves a same-named function from another package alone', async () => {
    const out = await transformWith(
      `import { defineSessionChannel } from 'some-other-lib';
       const a = defineSessionChannel();`,
      '/src/demo/guard.ts'
    );
    expect(out).not.toContain('/src/demo/guard.ts#0');
  });

  it('does not disturb the existing middleware strips in the same module', async () => {
    const out = await transformWith(
      `import { defineSessionChannel, defineServerMiddleware } from 'hono-preact';
       const a = defineSessionChannel();
       const m = defineServerMiddleware(async (ctx, next) => { await next(); });`,
      '/src/demo/guard.ts',
      { ssr: false }
    );
    expect(out).toContain('"/src/demo/guard.ts#0"');
    expect(out).toContain("runs: 'server'");
  });
});
```

The third case is the whole point of this task: an id that differs between
bundles means every `read` returns `undefined` and every guard bounces to login.
The fifth guards the interaction with the strips already in this file.

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm exec vitest run packages/vite/src/__tests__/channel-id-injection.test.ts`
Expected: FAIL, no id injected.

- [ ] **Step 3: Implement the injection**

In `guard-strip.ts`, add a visitor that runs in BOTH bundles (not in either
strip list, which are per-bundle). It must resolve the callee through the same
binding logic the existing strips use, so a renamed import
(`import { defineSessionChannel as c }`) and a namespace import are both handled;
reuse that resolver rather than matching the bare identifier.

For each matched `CallExpression` with no arguments, in source order within the
module, replace it with `defineSessionChannel("<id>")` where `<id>` is the
module id plus `#` plus the zero-based index.

Use the module id Vite hands the transform, normalized the same way the rest of
this plugin normalizes ids. The id must be stable between the server and client
transforms of the same file, so it must not include any bundle-specific prefix
or query string. Strip any `?` suffix.

If a call already has an argument, leave it alone: a user who passed an explicit
id owns it.

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm exec vitest run packages/vite/src/__tests__/channel-id-injection.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the existing guard-strip suite still passes**

Run: `pnpm exec vitest run packages/vite`
Expected: PASS, no regressions in `guard-strip-plugin.test.ts` or
`guards-bundle.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(vite): inject stable cross-bundle ids at defineSessionChannel call sites"
```

---

## Task 6: Public surface and docs

**Files:**
- Modify: `packages/iso/src/index.ts`
- Modify: `packages/iso/src/internal.ts`
- Modify: `packages/hono-preact/src/index.ts` (confirm the re-export path; grep
  for how `defineClientMiddleware` is re-exported and follow it exactly)
- Create: `apps/site/src/pages/docs/` page for the channel, following the
  docs layout of the existing middleware page
- Test: `packages/iso/src/__tests__/session-channel.test-d.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 5.
- Produces: `defineSessionChannel` and `type SessionChannel` exported from
  `hono-preact`.

- [ ] **Step 1: Write the failing type test**

```ts
// packages/iso/src/__tests__/session-channel.test-d.ts
import { assertType, describe, expectTypeOf, it } from 'vitest';
import { defineSessionChannel, type SessionChannel } from '../session-channel.js';
import type { ClientPageCtx, ServerCtx } from '../define-middleware.js';

describe('SessionChannel types', () => {
  it('reads back the declared type as optional', () => {
    const channel = defineSessionChannel<{ signedIn: boolean }>();
    expectTypeOf(channel.read).returns.toEqualTypeOf<
      { signedIn: boolean } | undefined
    >();
  });

  it('rejects publishing a value of the wrong type', () => {
    const channel = defineSessionChannel<{ signedIn: boolean }>();
    const ctx = {} as ServerCtx;
    // @ts-expect-error a number is not the declared payload
    channel.publish(ctx, 3);
  });

  it('rejects a client ctx on publish and a server ctx on read', () => {
    const channel = defineSessionChannel<number>();
    const clientCtx = {} as ClientPageCtx;
    // @ts-expect-error publish is the server tier
    channel.publish(clientCtx, 1);
  });

  it('is covariant in its payload for an erased consumer', () => {
    const channel = defineSessionChannel<{ signedIn: boolean }>();
    assertType<SessionChannel<{ signedIn: boolean }>>(channel);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm test:types`
Expected: FAIL on the unresolved import.

- [ ] **Step 3: Add the exports**

Add to `packages/iso/src/index.ts`:

```ts
export { defineSessionChannel } from './session-channel.js';
export type { SessionChannel } from './session-channel.js';
```

Add `takeChannelSnapshot`, `CHANNEL_HEADER`, `encodeSnapshot` to
`packages/iso/src/internal.ts` for the server package's use. Do NOT export
`resetChannelStore` from either barrel: it is test-only.

- [ ] **Step 4: Run the type test and verify it passes**

Run: `pnpm test:types`
Expected: PASS.

- [ ] **Step 5: Write the docs page**

Document, at minimum:

- The API of both methods, with the full `apps/site` guard as the worked example.
- That the published value ships to the client on every response and must not
  contain secrets.
- That a client guard remains a UX affordance and never a security boundary, and
  that the server guard stays authoritative. Match the wording the existing
  middleware docs already use for this.
- That the value is not persisted, and what `undefined` means.

Per *docs don't talk about historical changes*, describe what the API is. Do not
write "replaces the old localStorage approach".

Check whether the docs coverage gate applies: naming a type in a docs code span
opts every one of its members into the gate. Run `pnpm test` after writing the
page and fix anything the gate reports.

- [ ] **Step 6: Verify the full local CI sequence**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm typecheck:tests
pnpm test:types
pnpm test
```
Expected: all green. If `format:check` fails, run `pnpm format` and include the
result in the commit.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(iso): export defineSessionChannel and document the channel API"
```

---

## Task 7: Migrate `apps/site` and delete the shadow state

**Files:**
- Modify: `apps/site/src/demo/guard.ts`
- Modify: `apps/site/src/pages/demo/login.tsx:19-30` and its `onClick` at line 78
- Modify: `apps/site/src/pages/demo/projects-shell.tsx:15,70-89`

**Interfaces:**
- Consumes: `defineSessionChannel` from `hono-preact`.
- Produces: no exports. `DEMO_AUTHED_KEY` is deleted.

This task is the design's proof. If all three hand-managed write sites do not
disappear, the design has not solved #398.

- [ ] **Step 1: Rewrite the guard**

`apps/site/src/demo/guard.ts` becomes:

```ts
import {
  defineServerMiddleware,
  defineClientMiddleware,
  defineSessionChannel,
  redirect,
} from 'hono-preact';
import { currentUser } from './session.js';

// What the server guard tells the client guard on every round-trip. The real
// session truth stays in the HttpOnly signed cookie and the server guard below
// stays authoritative; this is a UX hint so intra-app navigation does not have
// to wait for an RPC to know it will be bounced.
const session = defineSessionChannel<{ signedIn: boolean }>();

// Server-side check (SSR / full reload + RPC requests for loaders/actions):
// validates the signed cookie and resolves the user. Declared once as `use` on
// the route tree node in routes.ts; the framework runs it for every render and
// every loader/action RPC under that subtree, so unauthenticated requests
// redirect the same way regardless of entry point.
const requireSessionServer = defineServerMiddleware(async (ctx, next) => {
  const user = await currentUser(ctx.c);
  if (!user) throw redirect('/demo/login');
  session.publish(ctx, { signedIn: true });
  await next();
});

// Client-side check (intra-app navigation): reads what the last server
// round-trip published. On a full reload the SSR bootstrap carries it; on a
// client navigation it is whatever the most recent loader or action RPC said.
// Logout clears it with no bookkeeping here, because the logout response runs
// this chain and publishes nothing.
const requireSessionClient = defineClientMiddleware(async (ctx, next) => {
  if (!session.read(ctx)?.signedIn) throw redirect('/demo/login');
  await next();
});

// requireSession is declared once as `use` on the /demo/projects route node in
// routes.ts. The dispatcher partitions server vs client members by their `runs`
// tag, so handing the same array to the route node gates both render and RPC
// paths without drift.
export const requireSession = [requireSessionServer, requireSessionClient];
```

- [ ] **Step 2: Delete the writer in `login.tsx`**

Remove the `DEMO_AUTHED_KEY` import at line 10, the `markAuthed` function and
its comment block at lines 19-30, and the `onClick={markAuthed}` at line 78.
Remove nothing else from the submit button.

- [ ] **Step 3: Delete the writers in `projects-shell.tsx`**

Remove the `DEMO_AUTHED_KEY` import at line 15, the self-heal `useEffect` at
lines 70-78, and the `try`/`catch` `removeItem` block inside the logout
`onSuccess` at lines 82-86. Keep the `navigate('/demo/login', { replace: true })`.

If `useEffect` is now unused in the file, drop it from the `preact/hooks` import.

- [ ] **Step 4: Verify no shadow state survives**

```bash
rg 'DEMO_AUTHED_KEY|demo:authed' apps/site packages
```
Expected: no matches. A match means the migration is incomplete.

- [ ] **Step 5: Verify in a real browser**

```bash
pnpm dev
```

Then, against the running app, confirm each of these by hand. `curl` cannot see
a dead client, so these must be done in a browser with the console open:

1. Visit `/demo/projects` signed out. Expect a redirect to `/demo/login`.
2. Sign in. Expect to land on `/demo/projects` with no bounce back to login.
3. Navigate between projects in-app. Expect no flash and no redirect.
4. Sign out, then use the browser Back button. Expect a redirect to
   `/demo/login`, not a rendered shell.
5. With `localStorage` cleared and the tab reloaded while signed in, expect the
   app to work. This is the case the old flag got wrong and is the clearest
   demonstration that the shadow state is gone.
6. Confirm no console errors in any of the above.

Case 4 is the logout propagation path and case 5 is the drift the design
removes. Neither is covered by a unit test; do not skip them.

- [ ] **Step 6: Run the smoke suite**

```bash
pnpm test:smoke
```
Expected: PASS. This change touches the module graph in `guard-strip` and the
client boot, which is the exact class of fault the smoke suite exists to catch
and no unit test can.

- [ ] **Step 7: Run the full local CI sequence**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm typecheck:tests
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(site): read the demo session hint from the server channel"
```

---

## Notes for the reviewer

- **Add the `run-smoke` label to the PR.** This change alters the client boot
  sequence and adds a `guard-strip` transform, both module-graph faults that a
  green unit suite cannot catch. The smoke suite is a required pre-merge gate.
- **The untransmitted server outcome is out of scope.** `DeferredHost` in
  `page-middleware-host.tsx` documents a related gap: a server middleware that
  renders an alternative is not transmitted to the client. The transport built
  here is the mechanism that would close it, and it was designed so it can, but
  closing it is a separate change. See the spec's "Not in scope" section.
- **No breaking changes.** Everything here is additive: one new export, one new
  optional `assembleDocument` option, one new response header. No existing
  signature changes.
