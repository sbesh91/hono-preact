# Presence Keyed Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `useRoom` an additive, granular presence API (`memberIds` / `member(id)`) so a consumer can bind one member and have a presence update re-render only that member's row, with zero new bytes for apps that do not opt into signals.

**Architecture:** A structural reactive-value seam in core (`ReadonlyReactive<T>`, a `RosterStore` contract, and a registration point) that names a reactive value without importing `@preact/signals`. `useRoom` keeps its `useState` array as the source of truth for the existing `members` field and updates a roster store alongside it. Two store implementations satisfy the contract: a signals-free default (reads through to the array, coarse) and an opt-in signal-backed one (per-member signals, granular) registered when the `hono-preact/signals` entry is imported.

**Tech Stack:** Preact, `@preact/signals` (opt-in only), TypeScript, Vitest, happy-dom, pnpm workspaces.

## Global Constraints

- No em-dashes (U+2014) in prose, comments, or commit messages.
- No inline `as` casts where the type can be reshaped; acceptable only at the JSON/FormData/user-module boundaries.
- `build.target` stays `'esnext'`; no polyfills, current ESM only.
- `@preact/signals` must NOT be reachable from the core entry graph (`index.ts`). Only the `signals.ts` entry may import it.
- Public API is additive: `members`, `self`, `send`, `setPresence`, `status`, `close`, `closeInfo` on `UseRoomResult` are unchanged.
- Mirror law: the `useState` array stays the source of truth for `members`; signals are an added channel.
- `@preact/signals` version: `^2.9.4`.
- Run commands from the worktree root: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/phase1-presence`.
- `pnpm --filter <pkg> test` is a silent no-op; run tests with `pnpm exec vitest run <pattern>` from the root.

## File Structure

- `packages/iso/src/internal/reactive.ts` (create): `ReadonlyReactive<T>`, `RosterStore<S>`, `PresenceReactiveImpl`, registration functions. Core, no signals, no Preact.
- `packages/iso/src/internal/default-roster.ts` (create): `createDefaultRoster`, the signals-free store over a getter.
- `packages/iso/src/use-room.ts` (modify): add `memberIds`/`member` to the result type and body; create + update + dispose the store.
- `packages/iso/src/signals.ts` (create): the opt-in entry; registers the signal-backed store. Only file that imports `@preact/signals`.
- `packages/hono-preact/src/signals.ts` (create): thin public re-export for the `hono-preact/signals` subpath.
- `packages/iso/package.json`, `packages/hono-preact/package.json` (modify): `@preact/signals` dep + `./signals` export.
- `scripts/size-probe-config.mjs` (modify): `@preact/signals` in `EXTERNAL`; a `signals` feature bucket.
- Tests under `packages/iso/src/internal/__tests__/`.

---

### Task 1: The reactive-value seam

**Files:**
- Create: `packages/iso/src/internal/reactive.ts`
- Test: `packages/iso/src/internal/__tests__/reactive.test.ts`

**Interfaces:**
- Produces:
  - `type ReadonlyReactive<T> = { readonly value: T }`
  - `type RosterStore<S> = { snapshot(members: ReadonlyArray<PresenceMember<S>>): void; upsert(id: string, state: S): void; leave(id: string): void; readonly memberIds: ReadonlyReactive<readonly string[]>; member(id: string): ReadonlyReactive<PresenceMember<S> | undefined>; dispose(): void }`
  - `type PresenceReactiveImpl = { createRoster<S>(): RosterStore<S> }`
  - `registerPresenceReactiveImpl(impl: PresenceReactiveImpl | null): void`
  - `getPresenceReactiveImpl(): PresenceReactiveImpl | null`
- Consumes: `PresenceMember<S>` from `./room-envelope.js` (`{ id: string; state: S }`).

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/reactive.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  registerPresenceReactiveImpl,
  getPresenceReactiveImpl,
  type PresenceReactiveImpl,
} from '../reactive.js';

afterEach(() => registerPresenceReactiveImpl(null));

describe('presence reactive registration', () => {
  it('is null until an implementation registers', () => {
    expect(getPresenceReactiveImpl()).toBeNull();
  });

  it('returns the registered implementation and clears on null', () => {
    const impl = {
      createRoster: () => {
        throw new Error('unused');
      },
    } as unknown as PresenceReactiveImpl;
    registerPresenceReactiveImpl(impl);
    expect(getPresenceReactiveImpl()).toBe(impl);
    registerPresenceReactiveImpl(null);
    expect(getPresenceReactiveImpl()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/reactive.test.ts`
Expected: FAIL, cannot resolve `../reactive.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/iso/src/internal/reactive.ts`:

```ts
import type { PresenceMember } from './room-envelope.js';

/**
 * A value that can be read reactively. Core names this shape WITHOUT importing
 * `@preact/signals`, so the dependency stays opt-in. A `Signal` satisfies it
 * structurally; the signals-free default satisfies it with a getter.
 */
export type ReadonlyReactive<T> = { readonly value: T };

/**
 * The internal contract for a room's roster, satisfied by both the signals-free
 * default and the opt-in signal-backed implementation. `useRoom` drives it with
 * the same wire deltas it applies to its `members` array; the granular reads
 * (`memberIds` / `member`) are exposed on the hook result.
 */
export type RosterStore<S> = {
  /** Replace the whole roster (connect / reconnect snapshot). */
  snapshot(members: ReadonlyArray<PresenceMember<S>>): void;
  /** Add or update one member. The store decides join vs update by whether the
   * id is already known, matching `useRoom`'s existing upsert semantics. */
  upsert(id: string, state: S): void;
  /** Remove one member. */
  leave(id: string): void;
  /** Membership ids; changes on join/leave only. */
  readonly memberIds: ReadonlyReactive<readonly string[]>;
  /** One member's entry; in signal mode, changes only when THAT member changes. */
  member(id: string): ReadonlyReactive<PresenceMember<S> | undefined>;
  /** Release retained reactive state. Called from `useRoom`'s effect cleanup. */
  dispose(): void;
};

/** Factory for the granular store, registered by the opt-in signals entry. */
export type PresenceReactiveImpl = {
  createRoster<S>(): RosterStore<S>;
};

let presenceImpl: PresenceReactiveImpl | null = null;

/** Install (or clear, with `null`) the signal-backed roster implementation. */
export function registerPresenceReactiveImpl(
  impl: PresenceReactiveImpl | null
): void {
  presenceImpl = impl;
}

/** The registered implementation, or null when the signals entry is unused. */
export function getPresenceReactiveImpl(): PresenceReactiveImpl | null {
  return presenceImpl;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/reactive.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter '@hono-preact/iso' exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/reactive.ts packages/iso/src/internal/__tests__/reactive.test.ts
git commit -m "feat(iso): reactive-value seam for granular presence

A structural ReadonlyReactive<T>, a RosterStore contract, and a
registration point that let core name a reactive value without importing
@preact/signals. Mirrors the loader reactive-cell pattern."
```

---

### Task 2: The signals-free default roster

**Files:**
- Create: `packages/iso/src/internal/default-roster.ts`
- Test: `packages/iso/src/internal/__tests__/default-roster.test.ts`

**Interfaces:**
- Consumes: `ReadonlyReactive`, `RosterStore` from `./reactive.js`; `PresenceMember` from `./room-envelope.js`.
- Produces: `createDefaultRoster<S>(getMembers: () => ReadonlyArray<PresenceMember<S>>): RosterStore<S>`.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/default-roster.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDefaultRoster } from '../default-roster.js';
import type { PresenceMember } from '../room-envelope.js';

describe('default roster (signals-free)', () => {
  it('reads memberIds and member(id) through the getter', () => {
    let arr: ReadonlyArray<PresenceMember<{ x: number }>> = [];
    const store = createDefaultRoster(() => arr);

    expect(store.memberIds.value).toEqual([]);
    expect(store.member('a').value).toBeUndefined();

    arr = [
      { id: 'a', state: { x: 1 } },
      { id: 'b', state: { x: 2 } },
    ];
    expect(store.memberIds.value).toEqual(['a', 'b']);
    expect(store.member('a').value).toEqual({ id: 'a', state: { x: 1 } });
    expect(store.member('z').value).toBeUndefined();
  });

  it('treats delta methods as no-ops (the array is the source)', () => {
    let arr: ReadonlyArray<PresenceMember<number>> = [{ id: 'a', state: 1 }];
    const store = createDefaultRoster(() => arr);

    store.snapshot([{ id: 'x', state: 9 }]);
    store.upsert('a', 2);
    store.leave('a');
    // None of the above changed anything: the getter still returns `arr`.
    expect(store.memberIds.value).toEqual(['a']);
    expect(store.member('a').value).toEqual({ id: 'a', state: 1 });

    arr = [{ id: 'a', state: 2 }];
    expect(store.member('a').value).toEqual({ id: 'a', state: 2 });
  });

  it('dispose does not throw', () => {
    const store = createDefaultRoster<number>(() => []);
    expect(() => store.dispose()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/default-roster.test.ts`
Expected: FAIL, cannot resolve `../default-roster.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/iso/src/internal/default-roster.ts`:

```ts
import type { PresenceMember } from './room-envelope.js';
import type { ReadonlyReactive, RosterStore } from './reactive.js';

/**
 * The signals-free roster store. The roster data already lives in `useRoom`'s
 * `useState` array; this reads through a getter to it, so the delta methods are
 * no-ops. Reads do not subscribe, so a consumer re-renders coarsely through its
 * parent (which re-rendered when `setMembers` fired), the same granularity as
 * today. Zero new bytes; `@preact/signals` is never imported on this path.
 *
 * This exists so `room.memberIds` / `room.member(id)` are always present on the
 * result and return correct values whether or not the signals entry is
 * imported; importing it upgrades the same reads to granular signals.
 */
export function createDefaultRoster<S>(
  getMembers: () => ReadonlyArray<PresenceMember<S>>
): RosterStore<S> {
  const memberIds: ReadonlyReactive<readonly string[]> = {
    get value() {
      return getMembers().map((m) => m.id);
    },
  };

  const member = (
    id: string
  ): ReadonlyReactive<PresenceMember<S> | undefined> => ({
    get value() {
      return getMembers().find((m) => m.id === id);
    },
  });

  return {
    snapshot() {},
    upsert() {},
    leave() {},
    memberIds,
    member,
    dispose() {},
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/default-roster.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter '@hono-preact/iso' exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/default-roster.ts packages/iso/src/internal/__tests__/default-roster.test.ts
git commit -m "feat(iso): signals-free default roster store

Reads memberIds/member through a getter to useRoom's existing array;
delta methods are no-ops. Coarse (no auto-subscribe), zero new bytes."
```

---

### Task 3: Wire the store into `useRoom`

**Files:**
- Modify: `packages/iso/src/use-room.ts`
- Test: `packages/iso/src/internal/__tests__/use-room-roster.test.tsx`

**Interfaces:**
- Consumes: `createDefaultRoster` (`./internal/default-roster.js`), `getPresenceReactiveImpl`, `ReadonlyReactive`, `RosterStore` (`./internal/reactive.js`).
- Produces: `UseRoomResult<R>` gains `memberIds: ReadonlyReactive<readonly string[]>` and `member: (id: string) => ReadonlyReactive<PresenceMember<State<R> | undefined> | undefined>`.

**Context for the implementer:** `useRoom` is in `packages/iso/src/use-room.ts`. Its result type is `UseRoomResult<R>` (around line 104). The body's `onRawMessage` (around line 185) applies wire deltas with `setMembers`; you add store calls beside them. The hook has no top-level `useEffect` today; you add one for `dispose`. Import `useEffect` and `useRef` from `preact/hooks` (the file already imports `useCallback, useState`).

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/use-room-roster.test.tsx`. This drives the hook through a fake WebSocket by exercising the module's roster wiring via the public `useRoom` with a stubbed transport. Use the existing pattern from `ws-lifecycle` tests: stub the global `WebSocket`.

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/preact';
import { defineChannel } from '../../define-channel.js';
import { defineRoom } from '../../define-room.js';
import { useRoom } from '../../use-room.js';

// A minimal fake WebSocket that captures the instance so the test can push
// frames and fire lifecycle events.
class FakeWS {
  static last: FakeWS | null = null;
  onopen: (() => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWS.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

const channel = defineChannel('demo')<{ x: number }>();
const room = defineRoom(channel, () => {});

afterEach(() => {
  cleanup();
  FakeWS.last = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useRoom roster store wiring (default impl)', () => {
  it('exposes memberIds and member(id) tracking the wire snapshot and deltas', async () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);

    const { result } = renderHook(() =>
      useRoom(room, { key: {}, presence: { x: 0 } })
    );

    await act(async () => {
      FakeWS.last!.open();
      FakeWS.last!.message({
        t: 'snapshot',
        self: 'me',
        members: [{ id: 'me', state: { x: 0 } }],
      });
    });

    expect(result.current.memberIds.value).toEqual(['me']);
    expect(result.current.member('me').value).toEqual({
      id: 'me',
      state: { x: 0 },
    });
    // members array is unchanged behaviour.
    expect(result.current.members.map((m) => m.id)).toEqual(['me']);

    await act(async () => {
      FakeWS.last!.message({
        t: 'presence',
        op: 'join',
        from: 'peer',
        state: { x: 5 },
      });
    });
    expect(result.current.memberIds.value).toEqual(['me', 'peer']);
    expect(result.current.member('peer').value).toEqual({
      id: 'peer',
      state: { x: 5 },
    });

    await act(async () => {
      FakeWS.last!.message({
        t: 'presence',
        op: 'leave',
        from: 'peer',
        state: undefined,
      });
    });
    expect(result.current.memberIds.value).toEqual(['me']);
    expect(result.current.member('peer').value).toBeUndefined();
  });

  it('renders an empty roster on first render (SSR parity)', () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
    const { result } = renderHook(() =>
      useRoom(room, { key: {}, presence: { x: 0 } })
    );
    expect(result.current.memberIds.value).toEqual([]);
    expect(result.current.member('anyone').value).toBeUndefined();
    expect(result.current.members).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/use-room-roster.test.tsx`
Expected: FAIL, `result.current.memberIds` is undefined (the field does not exist yet).

- [ ] **Step 3: Add the result-type fields**

In `packages/iso/src/use-room.ts`, add to `UseRoomResult<R>` (after the `members` field, before `self`):

```ts
  /** Membership ids as a reactive value; changes on join/leave only. Read
   * `.value`. With the `hono-preact/signals` entry imported this is a granular
   * signal; otherwise it reads coarsely through `members`. */
  memberIds: ReadonlyReactive<readonly string[]>;
  /** One member's entry as a reactive value. With the signals entry imported,
   * `.value` changes only when THAT member's presence changes. Read `.value`. */
  member: (
    id: string
  ) => ReadonlyReactive<PresenceMember<State<R> | undefined> | undefined>;
```

- [ ] **Step 4: Add imports**

In `packages/iso/src/use-room.ts`, change the hooks import and add the store imports:

```ts
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
```

and near the other internal imports:

```ts
import { createDefaultRoster } from './internal/default-roster.js';
import {
  getPresenceReactiveImpl,
  type ReadonlyReactive,
  type RosterStore,
} from './internal/reactive.js';
```

- [ ] **Step 5: Create the store and wire deltas**

In the `useRoom` body, immediately after the `const [selfId, setSelfId] = useState...` line, add:

```ts
  // Track the latest members array so the signals-free default store can read
  // through to it.
  const membersRef = useRef(members);
  membersRef.current = members;

  // The granular roster store: the signal-backed impl when the signals entry is
  // imported, otherwise the signals-free default over the members array. Created
  // once per hook instance.
  const storeRef = useRef<RosterStore<State<R> | undefined> | null>(null);
  if (storeRef.current === null) {
    const impl = getPresenceReactiveImpl();
    storeRef.current = impl
      ? impl.createRoster<State<R> | undefined>()
      : createDefaultRoster<State<R> | undefined>(() => membersRef.current);
  }
  const store = storeRef.current;

  useEffect(() => () => store.dispose(), [store]);
```

Then inside `onRawMessage`, add store calls beside the existing `setMembers` calls:

- In the `env.t === 'snapshot'` branch, after `setMembers(env.members);` add:
  ```ts
        store.snapshot(env.members);
  ```
- In the `env.op === 'leave'` branch, after the `setMembers((prev) => prev.filter(...))` call add:
  ```ts
          store.leave(env.from);
  ```
- In the `else` (join | update) branch, after the `setMembers((prev) => upsertMember(...))` call add:
  ```ts
          store.upsert(env.from, env.state);
  ```

- [ ] **Step 6: Return the new fields**

In the `return { ... }` object of `useRoom`, add after `members,`:

```ts
    memberIds: store.memberIds,
    member: store.member,
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/use-room-roster.test.tsx`
Expected: PASS (2 tests). If `renderHook` is unavailable in the installed `@testing-library/preact`, render a probe component instead: a component that calls `useRoom` and writes `result` to an outer `let`, wrapped in `render(...)`.

- [ ] **Step 8: Typecheck and run the full room test file**

Run: `pnpm --filter '@hono-preact/iso' exec tsc --noEmit`
Expected: no errors.
Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/ packages/iso/src/__tests__/`
Expected: all pass (the existing room/socket tests still green: `members` behaviour is unchanged).

- [ ] **Step 9: Commit**

```bash
git add packages/iso/src/use-room.ts packages/iso/src/internal/__tests__/use-room-roster.test.tsx
git commit -m "feat(iso): expose granular memberIds/member on useRoom

Additive: members/self/send/setPresence/status/close/closeInfo unchanged.
useRoom keeps its useState array as the source of truth and updates a
roster store alongside it (default signals-free store here), disposing on
unmount. First render is an empty roster for SSR parity."
```

---

### Task 4: The opt-in signal-backed store

**Files:**
- Create: `packages/iso/src/signals.ts`
- Modify: `packages/iso/package.json` (add `@preact/signals` dep + `./signals` export)
- Modify: `scripts/size-probe-config.mjs` (add `@preact/signals` to `EXTERNAL`; add a `signals` bucket)
- Test: `packages/iso/src/internal/__tests__/signal-roster.test.ts`

**Interfaces:**
- Consumes: `registerPresenceReactiveImpl`, `RosterStore`, `ReadonlyReactive` (`./internal/reactive.js`); `PresenceMember` (`./internal/room-envelope.js`); `signal`, `computed` (`@preact/signals`).
- Produces: `installPresenceSignals(): void` (also called at module top level as the import side effect).

- [ ] **Step 1: Install the dependency**

Run:
```bash
pnpm --filter '@hono-preact/iso' add @preact/signals@^2.9.4
```
Expected: `@preact/signals` added to `packages/iso/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `packages/iso/src/internal/__tests__/signal-roster.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import {
  getPresenceReactiveImpl,
  registerPresenceReactiveImpl,
} from '../reactive.js';
import { installPresenceSignals } from '../../signals.js';

afterEach(() => registerPresenceReactiveImpl(null));

describe('signal-backed roster', () => {
  it('registers an implementation on install', () => {
    installPresenceSignals();
    expect(getPresenceReactiveImpl()).not.toBeNull();
  });

  it('tracks snapshot, upsert, and leave', () => {
    installPresenceSignals();
    const store = getPresenceReactiveImpl()!.createRoster<{ x: number }>();

    store.snapshot([{ id: 'a', state: { x: 1 } }]);
    expect(store.memberIds.value).toEqual(['a']);
    expect(store.member('a').value).toEqual({ id: 'a', state: { x: 1 } });

    store.upsert('b', { x: 2 });
    expect(store.memberIds.value).toEqual(['a', 'b']);

    store.upsert('a', { x: 9 });
    expect(store.member('a').value).toEqual({ id: 'a', state: { x: 9 } });

    store.leave('a');
    expect(store.memberIds.value).toEqual(['b']);
    expect(store.member('a').value).toBeUndefined();
  });

  it('returns a STABLE signal per id (identity preserved across calls)', () => {
    installPresenceSignals();
    const store = getPresenceReactiveImpl()!.createRoster<number>();
    store.upsert('a', 1);
    expect(store.member('a')).toBe(store.member('a'));
  });

  it('an update to one member does NOT change the memberIds identity', () => {
    // The granularity invariant at the store level: updating a member touches
    // only that member's signal, never the ids signal. If `upsert` rewrote
    // `memberIds` on every call, this reference check would fail.
    installPresenceSignals();
    const store = getPresenceReactiveImpl()!.createRoster<number>();
    store.snapshot([{ id: 'a', state: 1 }]);
    const idsBefore = store.memberIds.value;
    store.upsert('a', 2); // existing member update
    expect(store.memberIds.value).toBe(idsBefore);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/signal-roster.test.ts`
Expected: FAIL, cannot resolve `../../signals.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/iso/src/signals.ts`:

```ts
import { signal, computed, type Signal } from '@preact/signals';
import type { PresenceMember } from './internal/room-envelope.js';
import {
  registerPresenceReactiveImpl,
  type ReadonlyReactive,
  type RosterStore,
} from './internal/reactive.js';

/**
 * The opt-in signals entry (the `hono-preact/signals` subpath). Importing this
 * module installs the signal-backed roster: `member(id)` becomes a per-member
 * signal, so a presence update patches one bound row instead of re-rendering
 * every consumer. This is the ONLY module that imports `@preact/signals`; apps
 * that never import it pay no signal bytes.
 */
function createSignalRoster<S>(): RosterStore<S> {
  const ids = signal<readonly string[]>([]);
  const byId = new Map<string, Signal<PresenceMember<S>>>();
  // A single stable reactive for any id not currently present. The keyed-list
  // consumption pattern only ever calls `member(id)` for ids in `memberIds`, so
  // this is a correctness fallback, not a hot path.
  const absent = computed<PresenceMember<S> | undefined>(() => undefined);

  return {
    snapshot(members) {
      byId.clear();
      for (const m of members) byId.set(m.id, signal(m));
      ids.value = members.map((m) => m.id);
    },
    upsert(id, state) {
      const existing = byId.get(id);
      if (existing) {
        // Existing member: touch ONLY this member's signal, never `ids`.
        existing.value = { id, state };
        return;
      }
      byId.set(id, signal({ id, state }));
      ids.value = [...ids.value, id];
    },
    leave(id) {
      if (byId.delete(id)) {
        ids.value = ids.value.filter((x) => x !== id);
      }
    },
    memberIds: ids,
    member(id): ReadonlyReactive<PresenceMember<S> | undefined> {
      return byId.get(id) ?? absent;
    },
    dispose() {
      byId.clear();
      ids.value = [];
    },
  };
}

/** Register the signal-backed roster. Called on import; exported so a test can
 * re-install after clearing the registration. */
export function installPresenceSignals(): void {
  registerPresenceReactiveImpl({
    createRoster: <S>() => createSignalRoster<S>(),
  });
}

installPresenceSignals();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/signal-roster.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Add the iso `./signals` export**

In `packages/iso/package.json`, add to `exports` (after `"./page"`):

```json
    "./signals": {
      "types": "./dist/signals.d.ts",
      "import": "./dist/signals.js"
    },
```

- [ ] **Step 7: Wire the size probe**

In `scripts/size-probe-config.mjs`:
- Add `'@preact/signals'` and `'@preact/signals/*'` to the `EXTERNAL` array (peers a consumer installs; measure the framework's own glue, not the library, matching how `preact`/`preact-iso` are treated).
- Add a `signals` bucket to `FEATURE_MODULES` after `realtime`:

```js
  // The opt-in presence-signals entry. @preact/signals itself is external
  // (a peer the app installs); this measures the framework's own glue.
  signals: ['signals.js'],
```

- [ ] **Step 8: Build iso and verify the size gate passes**

Run: `pnpm --filter '@hono-preact/iso' build`
Expected: build succeeds; `packages/iso/dist/signals.js` exists.
Run: `pnpm exec vitest run scripts/__tests__/`
Expected: PASS (the manifest-completeness gate accepts `signals.js` now that it is bucketed, and the temp-dist probe builds it with `@preact/signals` external).

- [ ] **Step 9: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/iso/src/signals.ts packages/iso/package.json pnpm-lock.yaml scripts/size-probe-config.mjs packages/iso/src/internal/__tests__/signal-roster.test.ts
git commit -m "feat(iso): opt-in signal-backed presence roster

Importing the signals entry installs per-member signals: an update
touches one member's signal, never the ids signal, so a bound row updates
alone. The only module importing @preact/signals; core stays clean.
@preact/signals is external in the size probe (a peer); signals.js is
bucketed so the manifest gate passes."
```

---

### Task 5: End-to-end granularity, public subpath, and verification

**Files:**
- Create: `packages/hono-preact/src/signals.ts`
- Modify: `packages/hono-preact/package.json` (add `@preact/signals` dep + `./signals` export)
- Test: `packages/iso/src/internal/__tests__/presence-granularity.test.tsx`

**Interfaces:**
- Consumes: `installPresenceSignals` and the store from `../../signals.js`; `@preact/signals` `signal`; `@testing-library/preact`.

- [ ] **Step 1: Write the failing granularity test**

Create `packages/iso/src/internal/__tests__/presence-granularity.test.tsx`. This proves the headline claim: a single member update re-renders one row, not its siblings or the container.

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { registerPresenceReactiveImpl } from '../reactive.js';
import { installPresenceSignals } from '../../signals.js';
import type { RosterStore } from '../reactive.js';

afterEach(() => {
  cleanup();
  registerPresenceReactiveImpl(null);
  vi.restoreAllMocks();
});

describe('presence granularity (signal impl)', () => {
  it('a single member update re-renders only that row', async () => {
    installPresenceSignals();
    const store = registeredRoster<number>();
    store.snapshot([
      { id: 'a', state: 1 },
      { id: 'b', state: 2 },
    ]);

    const renders: Record<string, number> = { a: 0, b: 0, list: 0 };

    function Row({ id }: { id: string }) {
      renders[id]++;
      const m = store.member(id);
      return <li data-testid={`row-${id}`}>{String(m.value?.state)}</li>;
    }
    function List() {
      renders.list++;
      return (
        <ul>
          {store.memberIds.value.map((id) => (
            <Row key={id} id={id} />
          ))}
        </ul>
      );
    }

    render(<List />);
    expect(screen.getByTestId('row-a').textContent).toBe('1');
    expect(screen.getByTestId('row-b').textContent).toBe('2');
    const listBefore = renders.list;
    const bBefore = renders.b;

    await act(async () => {
      store.upsert('a', 9); // update member a only
    });

    expect(screen.getByTestId('row-a').textContent).toBe('9');
    // The payoff: b's row and the list container did NOT re-render.
    expect(renders.b).toBe(bBefore);
    expect(renders.list).toBe(listBefore);
  });
});

function registeredRoster<S>(): RosterStore<S> {
  // Helper: build a roster from the just-installed impl.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { getPresenceReactiveImpl } = require('../reactive.js');
  return getPresenceReactiveImpl().createRoster<S>();
}
```

Note: if `require` is unavailable (ESM), import `getPresenceReactiveImpl` at the top from `../reactive.js` and call it inside the test instead of the helper.

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/presence-granularity.test.tsx`
Expected: PASS once the import is correct. If it FAILS with `renders.b` increased, the signal wiring is wrong (an update touched the container); fix `upsert` to touch only the member signal.

- [ ] **Step 3: Mutation-check the granularity test**

Temporarily edit `packages/iso/src/signals.ts` `upsert` so the existing-member branch also does `ids.value = [...ids.value]`. Run the granularity test.
Expected: FAIL (`renders.list` increased). This proves the test binds. Revert the edit.

- [ ] **Step 4: Add the public `hono-preact/signals` subpath**

Create `packages/hono-preact/src/signals.ts`:

```ts
// Public subpath: `hono-preact/signals`. Importing it installs the opt-in
// signal-backed presence roster. See packages/iso/src/signals.ts.
export { installPresenceSignals } from '@hono-preact/iso/signals';
import '@hono-preact/iso/signals';
```

In `packages/hono-preact/package.json`, add to `exports` (after `"./page"`):

```json
    "./signals": {
      "types": "./dist/signals.d.ts",
      "import": "./dist/signals.js"
    },
```

and add to `dependencies`:

```json
    "@preact/signals": "^2.9.4",
```

- [ ] **Step 5: Verify consolidation carries the entry**

Run: `pnpm --filter '@hono-preact/iso' --filter hono-preact build`
Expected: build succeeds; `packages/hono-preact/dist/signals.js` exists and re-exports from the consolidated iso signals module.

- [ ] **Step 6: Full pre-push verification**

Run each and confirm pass:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check   # if it fails: pnpm format, then re-check
pnpm typecheck
pnpm test:types
pnpm test
pnpm test:integration
pnpm --filter site build
```
Expected: all green. The realtime integration suite is unchanged (mirror law).

- [ ] **Step 7: Record the size cost in the umbrella charter**

Measure the `signals` bucket:
```bash
node scripts/measure-framework-size.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).sectionA;console.log('signals bucket marginal:', a.signals?.marginal, 'B gz; realtime:', a.realtime.total);});"
```
The umbrella charter (`docs/superpowers/specs/2026-07-22-signals-migration.md`) is on the `feat/signals-migration` branch, not this one. Do NOT edit it here; note the measured number in the PR description instead. The `@preact/signals` library cost (~3.3 kB gz, measured separately in the design doc) is the real per-opt-in-app cost; the bucket measures only the framework glue.

- [ ] **Step 8: Commit**

```bash
git add packages/hono-preact/src/signals.ts packages/hono-preact/package.json pnpm-lock.yaml packages/iso/src/internal/__tests__/presence-granularity.test.tsx
git commit -m "feat: hono-preact/signals subpath + granularity proof

Public opt-in entry that installs the signal-backed presence roster.
Component test proves a single member update re-renders one row, not its
siblings or the container; mutation-checked."
```

---

## Self-Review

**Spec coverage:**
- Reactive seam (spec §4) -> Task 1.
- Default impl (spec §5) -> Task 2.
- useRoom wiring, additive result, mirror law, dispose (spec §6, §8) -> Task 3.
- Signal-backed impl, opt-in, granularity (spec §5, §2) -> Task 4 (store) + Task 5 (component proof).
- SSR parity (spec §7) -> Task 3 Step 1 (empty-roster test).
- Public subpath -> Task 5.
- Testing plan (spec §10): roster store both impls (Tasks 2, 4), granularity mutation-checked (Task 5), default coarseness (Task 2), SSR parity (Task 3), dispose (Task 2 unit + Task 3 unmount), integration green (Task 5 Step 6), bundle recorded (Task 5 Step 7). Covered.
- `use-store-snapshot` comment update (spec §9): NOT a separate task because it is a one-line comment clarification with no behaviour change; fold it into Task 4 as an optional cleanup, or skip if the reviewer prefers a dedicated docs commit. Left out of the numbered tasks deliberately to avoid scope creep; call it out in the PR.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code. The one conditional (`renderHook` vs probe component in Task 3, `require` vs import in Task 5) gives an explicit fallback rather than a placeholder.

**Type consistency:** `RosterStore<S>` methods (`snapshot`/`upsert`/`leave`/`memberIds`/`member`/`dispose`) are identical across Tasks 1, 2, 4. `ReadonlyReactive<T>` is `{ readonly value: T }` throughout. `createDefaultRoster` signature matches its use in Task 3. `installPresenceSignals` matches across Tasks 4 and 5. `member` returns `ReadonlyReactive<PresenceMember<...> | undefined>` consistently.
