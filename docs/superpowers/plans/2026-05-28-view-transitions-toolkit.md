# View Transitions toolkit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four-module View Transitions toolkit (Named elements, Lifecycle, Types+direction, Persist) per `docs/superpowers/specs/2026-05-28-view-transitions-toolkit-design.md`.

**Architecture:** Replace the current single-subscriber `__dispatchRouteChange` with a four-phase dispatcher backed by a history shim that classifies navigation direction. Layer public hooks (`useViewTransitionLifecycle`, `useViewTransitionTypes`, `useViewTransitionName`, `useViewTransitionClass`) and polymorphic components (`<ViewTransitionName>`, `<ViewTransitionGroup>`, `<Persist>`) on top. Add a single `<PersistHost />` auto-mounted by the framework's generated client entry to back the persistence registry.

**Tech Stack:** Preact 10, preact-iso, Vitest + happy-dom, TypeScript, pnpm workspaces.

---

## Conventions used in every task

- Tests live under `packages/iso/src/__tests__/` and use `// @vitest-environment happy-dom` when they touch DOM. Headless tests omit the directive (vitest defaults to node).
- Type-only imports use `import type`.
- Public exports go through `packages/iso/src/index.ts`; internal-but-advanced through `packages/iso/src/internal.ts`.
- After every task, run `pnpm --filter '@hono-preact/iso' test -- <test-file>` and `pnpm --filter '@hono-preact/iso' typecheck` before committing. The commit step lists these explicitly.
- Each phase ends with a "phase wrap" task that runs the full pre-push sequence from `CLAUDE.md` (six steps including `pnpm format:check` and the apps/site integration build) before a `feat:` commit for the phase.

---

## Phase 1: History shim + phase dispatcher rework

This is the foundational change. All later modules read from `lastDirection` and subscribe to phase sets. The phase dispatcher preserves the existing `__subscribeRouteChange` / `useRouteChange` behavior (via an `onAfterSwap` shim) so this phase does not break consumers.

**File map:**

- Create: `packages/iso/src/internal/history-shim.ts` — patches `history.pushState`/`replaceState`, listens to `popstate`, exposes `getNavDirection()` and `resetForTesting()`.
- Create: `packages/iso/src/internal/view-transition-event.ts` — `ViewTransitionEvent` class and `NavDirection` type.
- Modify: `packages/iso/src/internal/route-change.ts` — replace single subscriber set with four phase sets; rewrite `__dispatchRouteChange` to build an event and walk phases; preserve `__subscribeRouteChange` public signature as an `onAfterSwap` shim.
- Modify: `packages/iso/src/internal.ts` — export `installHistoryShim`, `getNavDirection`, the event type, the new `__subscribePhase` (internal-advanced).
- Test: `packages/iso/src/__tests__/history-shim.test.ts`
- Test: `packages/iso/src/__tests__/route-change.test.ts` (extend existing).
- Test: `packages/iso/src/__tests__/route-change-phases.test.ts` (new).

### Task 1.1: Define the `NavDirection` type and `ViewTransitionEvent` class

**Files:**
- Create: `packages/iso/src/internal/view-transition-event.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/view-transition-event.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ViewTransitionEvent,
  type NavDirection,
} from '../internal/view-transition-event.js';

describe('ViewTransitionEvent', () => {
  it('exposes to/from/direction passed at construction', () => {
    const event = new ViewTransitionEvent({
      to: '/posts',
      from: '/',
      direction: 'push',
    });
    expect(event.to).toBe('/posts');
    expect(event.from).toBe('/');
    expect(event.direction).toBe('push');
  });

  it('starts with an empty mutable types array', () => {
    const event = new ViewTransitionEvent({
      to: '/a',
      from: undefined,
      direction: 'initial',
    });
    expect(event.types).toEqual([]);
    event.types.push('foo');
    expect(event.types).toEqual(['foo']);
  });

  it('starts with transition === null', () => {
    const event = new ViewTransitionEvent({
      to: '/a',
      from: undefined,
      direction: 'initial',
    });
    expect(event.transition).toBeNull();
  });

  it('skip() flips an internal flag readable by the dispatcher', () => {
    const event = new ViewTransitionEvent({
      to: '/a',
      from: undefined,
      direction: 'initial',
    });
    expect(event._skipped).toBe(false);
    event.skip();
    expect(event._skipped).toBe(true);
  });

  it('set/get round-trips arbitrary keys', () => {
    const event = new ViewTransitionEvent({
      to: '/a',
      from: undefined,
      direction: 'initial',
    });
    const SYM = Symbol('test');
    event.set(SYM, { scrollY: 42 });
    event.set('s', 'hi');
    expect(event.get(SYM)).toEqual({ scrollY: 42 });
    expect(event.get('s')).toBe('hi');
    expect(event.get('missing')).toBeUndefined();
  });
});

const _typeCheck: NavDirection[] = [
  'initial',
  'push',
  'replace',
  'back',
  'forward',
];
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter '@hono-preact/iso' test -- view-transition-event
```

Expected: FAIL with "Cannot find module '../internal/view-transition-event.js'".

- [ ] **Step 3: Implement the event**

Create `packages/iso/src/internal/view-transition-event.ts`:

```ts
export type NavDirection =
  | 'initial'
  | 'push'
  | 'replace'
  | 'back'
  | 'forward';

export type ViewTransitionReason = 'skipped' | 'unsupported' | 'aborted';

interface ViewTransitionEventInit {
  to: string;
  from: string | undefined;
  direction: NavDirection;
}

export class ViewTransitionEvent {
  readonly to: string;
  readonly from: string | undefined;
  readonly direction: NavDirection;
  readonly types: string[] = [];
  transition: ViewTransition | null = null;
  reason: ViewTransitionReason | undefined = undefined;

  /** @internal */
  _skipped = false;

  private readonly stash = new Map<unknown, unknown>();

  constructor(init: ViewTransitionEventInit) {
    this.to = init.to;
    this.from = init.from;
    this.direction = init.direction;
  }

  skip(): void {
    this._skipped = true;
  }

  set(key: unknown, value: unknown): void {
    this.stash.set(key, value);
  }

  get<T = unknown>(key: unknown): T | undefined {
    return this.stash.get(key) as T | undefined;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter '@hono-preact/iso' test -- view-transition-event
```

Expected: PASS, 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/view-transition-event.ts \
        packages/iso/src/__tests__/view-transition-event.test.ts
git commit -m "feat(iso): ViewTransitionEvent + NavDirection types"
```

### Task 1.2: History shim — direction classification

**Files:**
- Create: `packages/iso/src/internal/history-shim.ts`
- Test: `packages/iso/src/__tests__/history-shim.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/history-shim.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  installHistoryShim,
  getNavDirection,
  resetHistoryShimForTesting,
} from '../internal/history-shim.js';

describe('history-shim', () => {
  beforeEach(() => {
    resetHistoryShimForTesting();
    history.replaceState(null, '', '/');
    installHistoryShim();
  });

  it('reports initial direction at install time', () => {
    expect(getNavDirection()).toBe('initial');
  });

  it('classifies pushState as push', () => {
    history.pushState(null, '', '/a');
    expect(getNavDirection()).toBe('push');
  });

  it('classifies replaceState as replace', () => {
    history.replaceState(null, '', '/a');
    expect(getNavDirection()).toBe('replace');
  });

  it('classifies popstate back as back and forward as forward', async () => {
    history.pushState(null, '', '/a');
    history.pushState(null, '', '/b');
    expect(getNavDirection()).toBe('push');

    await new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      history.back();
    });
    expect(getNavDirection()).toBe('back');

    await new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      history.forward();
    });
    expect(getNavDirection()).toBe('forward');
  });

  it('preserves the original pushState/replaceState behavior (URL updates)', () => {
    history.pushState(null, '', '/c');
    expect(location.pathname).toBe('/c');
    history.replaceState(null, '', '/d');
    expect(location.pathname).toBe('/d');
  });

  it('preserves caller-provided state object alongside the shim counter', () => {
    history.pushState({ foo: 'bar' }, '', '/e');
    expect((history.state as { foo: string }).foo).toBe('bar');
    expect((history.state as { __hpVtIdx: number }).__hpVtIdx).toBeTypeOf(
      'number'
    );
  });

  it('is idempotent — calling install twice does not double-patch', () => {
    installHistoryShim();
    history.pushState(null, '', '/again');
    // If double-patched the counter would jump by 2 on a single pushState.
    const first = (history.state as { __hpVtIdx: number }).__hpVtIdx;
    history.pushState(null, '', '/again2');
    const second = (history.state as { __hpVtIdx: number }).__hpVtIdx;
    expect(second - first).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter '@hono-preact/iso' test -- history-shim
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the history shim**

Create `packages/iso/src/internal/history-shim.ts`:

```ts
import type { NavDirection } from './view-transition-event.js';

interface ShimState {
  __hpVtIdx?: number;
}

let installed = false;
let counter = 0;
let lastDirection: NavDirection = 'initial';
let originalPush:
  | ((state: unknown, title: string, url?: string | URL | null) => void)
  | null = null;
let originalReplace:
  | ((state: unknown, title: string, url?: string | URL | null) => void)
  | null = null;
let popstateListener: ((e: PopStateEvent) => void) | null = null;

function readCounterFromState(): number {
  if (typeof history === 'undefined') return 0;
  const state = history.state as ShimState | null;
  return state?.__hpVtIdx ?? 0;
}

export function installHistoryShim(): void {
  if (installed) return;
  if (typeof history === 'undefined' || typeof window === 'undefined') return;

  installed = true;
  counter = readCounterFromState();
  lastDirection = 'initial';

  originalPush = history.pushState.bind(history);
  originalReplace = history.replaceState.bind(history);

  history.pushState = function patchedPush(
    state: unknown,
    title: string,
    url?: string | URL | null
  ): void {
    counter += 1;
    const merged: ShimState = {
      ...((state as ShimState | null) ?? {}),
      __hpVtIdx: counter,
    };
    originalPush!(merged, title, url);
    lastDirection = 'push';
  };

  history.replaceState = function patchedReplace(
    state: unknown,
    title: string,
    url?: string | URL | null
  ): void {
    const merged: ShimState = {
      ...((state as ShimState | null) ?? {}),
      __hpVtIdx: counter,
    };
    originalReplace!(merged, title, url);
    lastDirection = 'replace';
  };

  popstateListener = (e: PopStateEvent) => {
    const incoming = (e.state as ShimState | null)?.__hpVtIdx ?? 0;
    lastDirection =
      incoming < counter
        ? 'back'
        : incoming > counter
          ? 'forward'
          : 'replace';
    counter = incoming;
  };
  window.addEventListener('popstate', popstateListener, { capture: true });

  // Stamp the current entry so subsequent diffs are well-defined.
  if (
    (history.state as ShimState | null)?.__hpVtIdx === undefined
  ) {
    originalReplace(
      { ...((history.state as object | null) ?? {}), __hpVtIdx: counter },
      ''
    );
  }
}

export function getNavDirection(): NavDirection {
  return lastDirection;
}

/** Test-only reset. Do not call from production code. */
export function resetHistoryShimForTesting(): void {
  if (
    installed &&
    typeof history !== 'undefined' &&
    originalPush &&
    originalReplace
  ) {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
  }
  if (typeof window !== 'undefined' && popstateListener) {
    window.removeEventListener('popstate', popstateListener, {
      capture: true,
    });
  }
  installed = false;
  counter = 0;
  lastDirection = 'initial';
  originalPush = null;
  originalReplace = null;
  popstateListener = null;
}

/** Test-only direction setter. Do not call from production code. */
export function setNavDirectionForTesting(dir: NavDirection): void {
  lastDirection = dir;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter '@hono-preact/iso' test -- history-shim
```

Expected: PASS, 7/7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/history-shim.ts \
        packages/iso/src/__tests__/history-shim.test.ts
git commit -m "feat(iso): history shim for nav direction classification"
```

### Task 1.3: Phase dispatcher — rewrite `__dispatchRouteChange`

**Files:**
- Modify: `packages/iso/src/internal/route-change.ts`
- Test: `packages/iso/src/__tests__/route-change-phases.test.ts` (new)
- Test: `packages/iso/src/__tests__/route-change.test.ts` (existing tests must keep passing)

- [ ] **Step 1: Write the failing phase tests**

Create `packages/iso/src/__tests__/route-change-phases.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __dispatchRouteChange,
  __subscribePhase,
} from '../internal/route-change.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../internal/history-shim.js';
import type { ViewTransitionEvent } from '../internal/view-transition-event.js';

interface FakeViewTransition {
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  finished: Promise<void>;
  types?: { add(t: string): void };
}

function installFakeVt(opts: {
  withTypes?: boolean;
  failedFinish?: boolean;
} = {}): {
  startViewTransition: ReturnType<typeof vi.fn>;
  typeAdds: string[];
  resolveFinished: () => void;
  rejectFinished: (err: unknown) => void;
} {
  const typeAdds: string[] = [];
  let resolveFinished!: () => void;
  let rejectFinished!: (err: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  const startViewTransition = vi.fn((cb: () => void): FakeViewTransition => {
    cb();
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished,
      ...(opts.withTypes
        ? { types: { add: (t: string) => typeAdds.push(t) } }
        : {}),
    };
  });
  vi.stubGlobal('document', { startViewTransition });
  return { startViewTransition, typeAdds, resolveFinished, rejectFinished };
}

describe('__dispatchRouteChange phase dispatcher', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('walks phases in order: beforeTransition, beforeSwap, afterSwap, afterTransition', async () => {
    const { resolveFinished } = installFakeVt();
    const calls: string[] = [];
    const u1 = __subscribePhase('beforeTransition', () =>
      calls.push('beforeTransition')
    );
    const u2 = __subscribePhase('beforeSwap', () => calls.push('beforeSwap'));
    const u3 = __subscribePhase('afterSwap', () => calls.push('afterSwap'));
    const u4 = __subscribePhase('afterTransition', () =>
      calls.push('afterTransition')
    );

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual([
      'beforeTransition',
      'beforeSwap',
      'afterSwap',
      'afterTransition',
    ]);
    u1();
    u2();
    u3();
    u4();
  });

  it('fires multiple subscribers in registration order within a phase', async () => {
    const { resolveFinished } = installFakeVt();
    const order: string[] = [];
    const u1 = __subscribePhase('beforeTransition', () => order.push('one'));
    const u2 = __subscribePhase('beforeTransition', () => order.push('two'));

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(order).toEqual(['one', 'two']);
    u1();
    u2();
  });

  it('skip() in beforeTransition bypasses startViewTransition and fires afterTransition with reason "skipped"', async () => {
    const { startViewTransition } = installFakeVt();
    let observedReason: string | undefined;
    const u1 = __subscribePhase('beforeTransition', (e) => e.skip());
    const u2 = __subscribePhase('beforeSwap', () => {
      throw new Error('should not fire on skip');
    });
    const u3 = __subscribePhase('afterTransition', (e) => {
      observedReason = e.reason;
    });

    __dispatchRouteChange('/a', undefined);
    await Promise.resolve();

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(observedReason).toBe('skipped');
    u1();
    u2();
    u3();
  });

  it('fires afterTransition with reason "unsupported" when document.startViewTransition is missing', async () => {
    vi.stubGlobal('document', {});
    let observedReason: string | undefined;
    const u = __subscribePhase('afterTransition', (e) => {
      observedReason = e.reason;
    });

    __dispatchRouteChange('/a', undefined);
    await Promise.resolve();

    expect(observedReason).toBe('unsupported');
    u();
  });

  it('applies event.types via viewTransition.types.add when supported', async () => {
    const { typeAdds, resolveFinished } = installFakeVt({ withTypes: true });
    const u = __subscribePhase('beforeTransition', (e) => {
      e.types.push('custom-a');
      e.types.push('custom-b');
    });

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toEqual(expect.arrayContaining(['custom-a', 'custom-b']));
    u();
  });

  it('no-ops the types path when viewTransition.types is absent (older browsers)', async () => {
    const { resolveFinished } = installFakeVt({ withTypes: false });
    const u = __subscribePhase('beforeTransition', (e) => {
      e.types.push('would-not-apply');
    });

    expect(() => __dispatchRouteChange('/a', undefined)).not.toThrow();
    resolveFinished();
    await Promise.resolve();
    u();
  });

  it('sets event.transition only from beforeSwap onward', async () => {
    const { resolveFinished } = installFakeVt();
    let beforeTransitionEvent: ViewTransitionEvent | undefined;
    let beforeSwapEvent: ViewTransitionEvent | undefined;
    let afterTransitionEvent: ViewTransitionEvent | undefined;
    const u1 = __subscribePhase('beforeTransition', (e) => {
      beforeTransitionEvent = e;
    });
    const u2 = __subscribePhase('beforeSwap', (e) => {
      beforeSwapEvent = e;
    });
    const u3 = __subscribePhase('afterTransition', (e) => {
      afterTransitionEvent = e;
    });

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();
    await Promise.resolve();

    expect(beforeTransitionEvent!.transition).toBeNull();
    expect(beforeSwapEvent!.transition).not.toBeNull();
    expect(afterTransitionEvent!.transition).not.toBeNull();
    u1();
    u2();
    u3();
  });

  it('fires afterTransition with reason "aborted" when transition.finished rejects', async () => {
    const { rejectFinished } = installFakeVt();
    let observedReason: string | undefined;
    const u = __subscribePhase('afterTransition', (e) => {
      observedReason = e.reason;
    });

    __dispatchRouteChange('/a', undefined);
    rejectFinished(new Error('user navigation interrupted'));
    await Promise.resolve();
    await Promise.resolve();

    expect(observedReason).toBe('aborted');
    u();
  });

  it('passes the current direction from the history shim into the event', async () => {
    const { resolveFinished } = installFakeVt();
    setNavDirectionForTesting('back');
    let observed: string | undefined;
    const u = __subscribePhase('beforeTransition', (e) => {
      observed = e.direction;
    });

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(observed).toBe('back');
    u();
  });
});
```

- [ ] **Step 2: Extend the existing `route-change.test.ts` to keep the legacy API passing**

The existing file already asserts `__subscribeRouteChange` and `useRouteChange`. The dispatcher rewrite must keep both working. No changes to that file are needed yet — Step 4's implementation has to keep them passing.

- [ ] **Step 3: Run the new phase test to verify it fails**

```bash
pnpm --filter '@hono-preact/iso' test -- route-change-phases
```

Expected: FAIL with "__subscribePhase is not exported" or similar.

- [ ] **Step 4: Rewrite the dispatcher**

Replace the entire contents of `packages/iso/src/internal/route-change.ts` with:

```ts
import { flushSync } from 'preact/compat';
import {
  ViewTransitionEvent,
  type NavDirection,
} from './view-transition-event.js';
import { getNavDirection } from './history-shim.js';

export type PhaseName =
  | 'beforeTransition'
  | 'beforeSwap'
  | 'afterSwap'
  | 'afterTransition';

type PhaseSub = (event: ViewTransitionEvent) => void | Promise<void>;
type LegacySub = (to: string, from: string | undefined) => void;

const phaseSubs: Record<PhaseName, Set<PhaseSub>> = {
  beforeTransition: new Set(),
  beforeSwap: new Set(),
  afterSwap: new Set(),
  afterTransition: new Set(),
};

const legacySubs = new Set<LegacySub>();

export function __subscribePhase(
  phase: PhaseName,
  sub: PhaseSub
): () => void {
  phaseSubs[phase].add(sub);
  return () => {
    phaseSubs[phase].delete(sub);
  };
}

export function __subscribeRouteChange(sub: LegacySub): () => void {
  legacySubs.add(sub);
  return () => {
    legacySubs.delete(sub);
  };
}

function fireLegacy(to: string, from: string | undefined): void {
  for (const sub of legacySubs) sub(to, from);
}

function getStartViewTransition():
  | ((cb: () => void) => ViewTransition)
  | undefined {
  if (typeof document === 'undefined') return undefined;
  const fn = (
    document as { startViewTransition?: (cb: () => void) => ViewTransition }
  ).startViewTransition;
  return typeof fn === 'function' ? fn.bind(document) : undefined;
}

export function __dispatchRouteChange(
  to: string,
  from: string | undefined
): void {
  const direction: NavDirection = getNavDirection();
  const event = new ViewTransitionEvent({ to, from, direction });

  for (const sub of phaseSubs.beforeTransition) sub(event);

  // Legacy subscribers continue to fire once per nav. Slot them at the same
  // moment the new afterSwap phase fires (closest analog: "after DOM swap,
  // before browser starts animating new frame").
  const fireAfterSwap = () => {
    for (const sub of phaseSubs.afterSwap) sub(event);
    fireLegacy(to, from);
  };

  const fireAfterTransition = (reason?: 'skipped' | 'unsupported' | 'aborted') => {
    if (reason !== undefined) event.reason = reason;
    for (const sub of phaseSubs.afterTransition) sub(event);
  };

  if (event._skipped) {
    flushSync(() => {});
    fireAfterTransition('skipped');
    return;
  }

  const start = getStartViewTransition();
  if (!start) {
    flushSync(() => {});
    fireAfterTransition('unsupported');
    return;
  }

  const transition = start(() => {
    event.transition = transition;
    for (const sub of phaseSubs.beforeSwap) sub(event);
    flushSync(() => {});
    fireAfterSwap();
  });
  // Some browsers create the transition object _before_ the callback runs;
  // make sure event.transition is set even if the callback was synchronous
  // and already assigned it.
  event.transition = transition;

  // Apply event.types if the browser exposes them.
  const types = (transition as ViewTransition & {
    types?: { add(t: string): void };
  }).types;
  if (types && typeof types.add === 'function') {
    for (const t of event.types) types.add(t);
  }

  transition.finished.then(
    () => fireAfterTransition(),
    () => fireAfterTransition('aborted')
  );
}
```

- [ ] **Step 5: Run all route-change tests**

```bash
pnpm --filter '@hono-preact/iso' test -- route-change
```

Expected: PASS. The existing `__subscribeRouteChange`, the dispatch view-transitions tests, the `useRouteChange` tests, AND the new phase tests all green.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter '@hono-preact/iso' typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/internal/route-change.ts \
        packages/iso/src/__tests__/route-change-phases.test.ts
git commit -m "feat(iso): four-phase view-transition dispatcher"
```

### Task 1.4: Wire history shim into the generated client entry and the internal subpath

The history shim must run before preact-iso's `LocationProvider` mounts. The generated client entry already runs `installStreamRegistry()` before hydrate; we add `installHistoryShim()` next to it. We also export the new primitives from the internal subpath.

**Files:**
- Modify: `packages/vite/src/client-entry.ts`
- Modify: `packages/iso/src/internal.ts`
- Test: `packages/vite/src/__tests__/client-entry.test.ts` (extend if it exists; check first)
- Test: `packages/iso/src/__tests__/internal-exports.test.ts` (create if absent; otherwise extend)

- [ ] **Step 1: Check whether a client-entry generator test exists**

```bash
ls packages/vite/src/__tests__/client-entry.test.ts 2>/dev/null
```

If it exists, read it. Either way, add the `installHistoryShim()` assertion below.

- [ ] **Step 2: Write the failing test for the generated source**

If `packages/vite/src/__tests__/client-entry.test.ts` exists, add this test to it. Otherwise create it with:

```ts
import { describe, it, expect } from 'vitest';
import { generateClientEntrySource } from '../client-entry.js';

describe('generateClientEntrySource', () => {
  it('imports installHistoryShim from hono-preact/internal and calls it before installStreamRegistry', () => {
    const src = generateClientEntrySource({ routesAbsPath: '/abs/routes.tsx' });
    expect(src).toContain('installHistoryShim');
    expect(src).toContain('installStreamRegistry');
    const shimIdx = src.indexOf('installHistoryShim()');
    const streamIdx = src.indexOf('installStreamRegistry()');
    expect(shimIdx).toBeGreaterThan(-1);
    expect(streamIdx).toBeGreaterThan(-1);
    expect(shimIdx).toBeLessThan(streamIdx);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter '@hono-preact/vite' test -- client-entry
```

Expected: FAIL — `installHistoryShim` not in source.

- [ ] **Step 4: Update the generator and internal exports**

Edit `packages/vite/src/client-entry.ts`. In `generateClientEntrySource`, update the import line and the call sequence:

```ts
return (
    `import { h, hydrate } from 'preact';\n` +
    `import { LocationProvider } from 'preact-iso';\n` +
    `import { Routes } from 'hono-preact';\n` +
    `import { __dispatchRouteChange, installStreamRegistry, installHistoryShim } from 'hono-preact/internal';\n` +
    `import routes from '${opts.routesAbsPath}';\n` +
    `\n` +
    `installHistoryShim();\n` +
    `installStreamRegistry();\n` +
    `\n` +
    `let lastPath;\n` +
    `function onRouteChange(path) {\n` +
    `  const from = lastPath;\n` +
    `  lastPath = path;\n` +
    `  __dispatchRouteChange(path, from);\n` +
    `}\n` +
    `\n` +
    `hydrate(\n` +
    `  h(LocationProvider, null,\n` +
    `    h(Routes, { routes, onRouteChange })\n` +
    `  ),\n` +
    `  document.getElementById('app')\n` +
    `);\n`
);
```

Add a new exports block to `packages/iso/src/internal.ts` (Section 1 — advanced escape hatches), under the existing `__dispatchRouteChange` block:

```ts
export {
  installHistoryShim,
  getNavDirection,
} from './internal/history-shim.js';
export {
  __subscribePhase,
  type PhaseName,
} from './internal/route-change.js';
export {
  ViewTransitionEvent,
  type NavDirection,
  type ViewTransitionReason,
} from './internal/view-transition-event.js';
```

- [ ] **Step 5: Run the generator test**

```bash
pnpm --filter '@hono-preact/vite' test -- client-entry
```

Expected: PASS.

- [ ] **Step 6: Typecheck both packages**

```bash
pnpm --filter '@hono-preact/iso' typecheck && \
  pnpm --filter '@hono-preact/vite' typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/vite/src/client-entry.ts \
        packages/vite/src/__tests__/client-entry.test.ts \
        packages/iso/src/internal.ts
git commit -m "feat(vite): install history shim in generated client entry"
```

### Task 1.5: Phase 1 wrap — full pre-push verification

- [ ] **Step 1: Build framework packages**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
```

Expected: clean.

- [ ] **Step 2: Format check (run `pnpm format` if it fails, then re-stage)**

```bash
pnpm format:check
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Tests with coverage**

```bash
pnpm test:coverage
```

- [ ] **Step 5: Integration tests**

```bash
pnpm test:integration
```

- [ ] **Step 6: Site build**

```bash
pnpm --filter site build
```

- [ ] **Step 7: Commit any format fixes if needed**

If `format:check` produced edits, `git add` them and:

```bash
git commit -m "chore: pnpm format"
```

Phase 1 ends here. Open a PR titled "feat(iso): four-phase view-transition dispatcher + history shim". This phase ships standalone — all existing consumer behavior is preserved.

---

## Phase 2: Module B — `useViewTransitionLifecycle` public hook

**File map:**

- Create: `packages/iso/src/view-transition-lifecycle.ts`
- Modify: `packages/iso/src/index.ts` (add public exports)
- Test: `packages/iso/src/__tests__/view-transition-lifecycle.test.tsx`

### Task 2.1: Public hook + types

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/view-transition-lifecycle.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';
import { useViewTransitionLifecycle } from '../view-transition-lifecycle.js';
import { __dispatchRouteChange } from '../internal/route-change.js';
import { resetHistoryShimForTesting } from '../internal/history-shim.js';

function installFakeVt() {
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  const startViewTransition = vi.fn((cb: () => void) => {
    cb();
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished,
    };
  });
  vi.stubGlobal('document', { startViewTransition });
  return { resolveFinished };
}

describe('useViewTransitionLifecycle', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires all four phase callbacks for one navigation', async () => {
    const { resolveFinished } = installFakeVt();
    const calls: string[] = [];

    renderHook(() =>
      useViewTransitionLifecycle({
        onBeforeTransition: () => calls.push('beforeTransition'),
        onBeforeSwap: () => calls.push('beforeSwap'),
        onAfterSwap: () => calls.push('afterSwap'),
        onAfterTransition: () => calls.push('afterTransition'),
      })
    );

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual([
      'beforeTransition',
      'beforeSwap',
      'afterSwap',
      'afterTransition',
    ]);
  });

  it('unsubscribes on unmount', async () => {
    installFakeVt();
    const calls: string[] = [];
    const { unmount } = renderHook(() =>
      useViewTransitionLifecycle({
        onBeforeTransition: () => calls.push('hit'),
      })
    );

    __dispatchRouteChange('/a', undefined);
    expect(calls).toEqual(['hit']);

    unmount();
    __dispatchRouteChange('/b', '/a');
    expect(calls).toEqual(['hit']);
  });

  it('uses the latest callback reference (no churn on rerender)', () => {
    installFakeVt();
    const calls: string[] = [];
    const cbA = () => calls.push('A');
    const cbB = () => calls.push('B');

    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) =>
        useViewTransitionLifecycle({ onBeforeTransition: cb }),
      { initialProps: { cb: cbA } }
    );

    __dispatchRouteChange('/x', undefined);
    rerender({ cb: cbB });
    __dispatchRouteChange('/y', '/x');

    expect(calls).toEqual(['A', 'B']);
  });

  it('skip() in onBeforeTransition bypasses startViewTransition', async () => {
    const { resolveFinished } = installFakeVt();
    let reason: string | undefined;
    renderHook(() =>
      useViewTransitionLifecycle({
        onBeforeTransition: (e) => e.skip(),
        onBeforeSwap: () => {
          throw new Error('should not fire');
        },
        onAfterTransition: (e) => {
          reason = e.reason;
        },
      })
    );

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(reason).toBe('skipped');
  });

  it('stash via event.set/get carries data across phases', async () => {
    const { resolveFinished } = installFakeVt();
    const KEY = Symbol('scroll');
    let observed: number | undefined;
    renderHook(() =>
      useViewTransitionLifecycle({
        onBeforeSwap: (e) => e.set(KEY, 42),
        onAfterSwap: (e) => {
          observed = e.get<number>(KEY);
        },
      })
    );

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(observed).toBe(42);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter '@hono-preact/iso' test -- view-transition-lifecycle
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the hook**

Create `packages/iso/src/view-transition-lifecycle.ts`:

```ts
import { useEffect, useRef } from 'preact/hooks';
import { __subscribePhase } from './internal/route-change.js';
import type { ViewTransitionEvent } from './internal/view-transition-event.js';

export type ViewTransitionPhaseCallback = (
  event: ViewTransitionEvent
) => void | Promise<void>;

export interface ViewTransitionLifecycle {
  onBeforeTransition?: ViewTransitionPhaseCallback;
  onBeforeSwap?: ViewTransitionPhaseCallback;
  onAfterSwap?: ViewTransitionPhaseCallback;
  onAfterTransition?: ViewTransitionPhaseCallback;
}

export function useViewTransitionLifecycle(
  lifecycle: ViewTransitionLifecycle
): void {
  const ref = useRef(lifecycle);
  ref.current = lifecycle;

  useEffect(() => {
    const unsubs = [
      __subscribePhase('beforeTransition', (e) =>
        ref.current.onBeforeTransition?.(e)
      ),
      __subscribePhase('beforeSwap', (e) => ref.current.onBeforeSwap?.(e)),
      __subscribePhase('afterSwap', (e) => ref.current.onAfterSwap?.(e)),
      __subscribePhase('afterTransition', (e) =>
        ref.current.onAfterTransition?.(e)
      ),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, []);
}
```

- [ ] **Step 4: Add the public export**

Edit `packages/iso/src/index.ts`. After the existing `useRouteChange` export block, add:

```ts
export {
  useViewTransitionLifecycle,
  type ViewTransitionLifecycle,
  type ViewTransitionPhaseCallback,
} from './view-transition-lifecycle.js';
export type {
  ViewTransitionEvent,
  NavDirection,
  ViewTransitionReason,
} from './internal/view-transition-event.js';
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter '@hono-preact/iso' test -- view-transition-lifecycle
```

Expected: PASS, 5/5 tests.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter '@hono-preact/iso' typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/view-transition-lifecycle.ts \
        packages/iso/src/__tests__/view-transition-lifecycle.test.tsx \
        packages/iso/src/index.ts
git commit -m "feat(iso): useViewTransitionLifecycle hook"
```

### Task 2.2: Phase 2 wrap — pre-push

Repeat the six-step pre-push sequence from Task 1.5. Open a PR titled "feat(iso): useViewTransitionLifecycle public hook".

---

## Phase 3: Module C — types + direction

Default `nav-*` types fire from a default `beforeTransition` subscriber installed once at module load. Public hook is a thin wrapper around the same.

**File map:**

- Create: `packages/iso/src/view-transition-types.ts`
- Modify: `packages/iso/src/internal/route-change.ts` — install default-types subscriber on first call (idempotent).
- Modify: `packages/iso/src/index.ts` (public export).
- Modify: `packages/iso/src/internal.ts` (advanced export for `getNavDirection`).
- Test: `packages/iso/src/__tests__/view-transition-default-types.test.ts`
- Test: `packages/iso/src/__tests__/view-transition-types.test.tsx`

### Task 3.1: Default `nav-*` types

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/view-transition-default-types.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __dispatchRouteChange } from '../internal/route-change.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../internal/history-shim.js';

function installFakeVtWithTypes() {
  const typeAdds: string[] = [];
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  vi.stubGlobal('document', {
    startViewTransition(cb: () => void) {
      cb();
      return {
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        finished,
        types: { add: (t: string) => typeAdds.push(t) },
      };
    },
  });
  return { typeAdds, resolveFinished };
}

describe('default nav-* types', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes nav-initial and nav-same-origin on the first dispatch', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    setNavDirectionForTesting('initial');

    __dispatchRouteChange('/', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toContain('nav-initial');
    expect(typeAdds).toContain('nav-same-origin');
  });

  it('includes exactly one direction marker per dispatch', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    setNavDirectionForTesting('back');

    __dispatchRouteChange('/a', '/b');
    resolveFinished();
    await Promise.resolve();

    const markers = typeAdds.filter((t) => t.startsWith('nav-'));
    const dirMarkers = markers.filter((t) =>
      ['nav-push', 'nav-replace', 'nav-back', 'nav-forward', 'nav-initial'].includes(t)
    );
    expect(dirMarkers).toEqual(['nav-back']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter '@hono-preact/iso' test -- view-transition-default-types
```

Expected: FAIL — no `nav-*` types observed.

- [ ] **Step 3: Install the default-types subscriber**

Edit `packages/iso/src/internal/route-change.ts`. At the end of the file, append:

```ts
let defaultTypesInstalled = false;
let firstDispatchSeen = false;

function ensureDefaultTypes(): void {
  if (defaultTypesInstalled) return;
  defaultTypesInstalled = true;
  __subscribePhase('beforeTransition', (event) => {
    if (!firstDispatchSeen) {
      event.types.push('nav-initial');
      firstDispatchSeen = true;
    } else {
      event.types.push(`nav-${event.direction}`);
    }
    event.types.push('nav-same-origin');
  });
}

/** @internal Test-only reset for default-types installer. */
export function resetDefaultTypesForTesting(): void {
  defaultTypesInstalled = false;
  firstDispatchSeen = false;
}
```

Then call `ensureDefaultTypes()` at the top of `__dispatchRouteChange`, before the existing `getNavDirection()` line:

```ts
export function __dispatchRouteChange(
  to: string,
  from: string | undefined
): void {
  ensureDefaultTypes();
  const direction: NavDirection = getNavDirection();
  // ... rest unchanged
}
```

Also extend the test imports at the top of `view-transition-default-types.test.ts` to call the reset in `beforeEach` so the suite is hermetic. Edit the test:

```ts
import {
  __dispatchRouteChange,
  resetDefaultTypesForTesting,
} from '../internal/route-change.js';
```

And in `beforeEach`:

```ts
beforeEach(() => {
  vi.unstubAllGlobals();
  resetHistoryShimForTesting();
  resetDefaultTypesForTesting();
});
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter '@hono-preact/iso' test -- view-transition-default-types
```

Expected: PASS.

- [ ] **Step 5: Re-run the phase test suite to verify nothing else broke**

```bash
pnpm --filter '@hono-preact/iso' test -- route-change
```

Existing phase tests need a `resetDefaultTypesForTesting()` call in their `beforeEach`. Add the import to `route-change-phases.test.ts`:

```ts
import {
  __dispatchRouteChange,
  __subscribePhase,
  resetDefaultTypesForTesting,
} from '../internal/route-change.js';
```

And in `beforeEach`:

```ts
beforeEach(() => {
  vi.unstubAllGlobals();
  resetHistoryShimForTesting();
  resetDefaultTypesForTesting();
});
```

The existing tests that asserted exact `typeAdds` arrays may now include extra `nav-*` entries. Update those expectations to use `expect.arrayContaining([...])` for the types they care about.

Specifically, in `route-change-phases.test.ts`, the test "applies event.types via viewTransition.types.add when supported" expects `expect.arrayContaining(['custom-a', 'custom-b'])`. That already uses `arrayContaining`, so it stays green.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/route-change.ts \
        packages/iso/src/__tests__/view-transition-default-types.test.ts \
        packages/iso/src/__tests__/route-change-phases.test.ts
git commit -m "feat(iso): default nav-* view-transition types"
```

### Task 3.2: Public `useViewTransitionTypes` hook

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/view-transition-types.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';
import { useViewTransitionTypes } from '../view-transition-types.js';
import {
  __dispatchRouteChange,
  resetDefaultTypesForTesting,
} from '../internal/route-change.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../internal/history-shim.js';

function installFakeVtWithTypes() {
  const typeAdds: string[] = [];
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  vi.stubGlobal('document', {
    startViewTransition(cb: () => void) {
      cb();
      return {
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        finished,
        types: { add: (t: string) => typeAdds.push(t) },
      };
    },
  });
  return { typeAdds, resolveFinished };
}

describe('useViewTransitionTypes', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds a static string', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    renderHook(() => useViewTransitionTypes('posts-listing'));

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toContain('posts-listing');
  });

  it('adds a static array of strings', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    renderHook(() => useViewTransitionTypes(['a', 'b']));

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('calls a factory per nav with to/from/direction', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    setNavDirectionForTesting('back');
    renderHook(() =>
      useViewTransitionTypes((nav) => {
        if (nav.direction === 'back') return ['from-back'];
        return [];
      })
    );

    __dispatchRouteChange('/posts', '/posts/1');
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toContain('from-back');
  });

  it('factory returning null/undefined contributes nothing', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    renderHook(() => useViewTransitionTypes(() => null));

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    // Only the default nav-* should appear, no extra entries from the hook.
    const nonNav = typeAdds.filter((t) => !t.startsWith('nav-'));
    expect(nonNav).toEqual([]);
  });

  it('unsubscribes on unmount', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const { unmount } = renderHook(() => useViewTransitionTypes('one'));

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toContain('one');
    unmount();

    typeAdds.length = 0;
    __dispatchRouteChange('/posts/1', '/posts');
    await Promise.resolve();

    expect(typeAdds).not.toContain('one');
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter '@hono-preact/iso' test -- view-transition-types
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the hook**

Create `packages/iso/src/view-transition-types.ts`:

```ts
import { useEffect, useRef } from 'preact/hooks';
import { __subscribePhase } from './internal/route-change.js';
import type { NavDirection } from './internal/view-transition-event.js';

export interface ViewTransitionTypesNav {
  to: string;
  from: string | undefined;
  direction: NavDirection;
}

export type ViewTransitionTypesInput =
  | string
  | string[]
  | ((nav: ViewTransitionTypesNav) => string | string[] | null | undefined);

export function useViewTransitionTypes(input: ViewTransitionTypesInput): void {
  const ref = useRef(input);
  ref.current = input;

  useEffect(() => {
    return __subscribePhase('beforeTransition', (event) => {
      const v = ref.current;
      const resolved =
        typeof v === 'function'
          ? v({ to: event.to, from: event.from, direction: event.direction })
          : v;
      if (resolved == null) return;
      if (typeof resolved === 'string') event.types.push(resolved);
      else for (const t of resolved) event.types.push(t);
    });
  }, []);
}
```

- [ ] **Step 4: Public export**

Edit `packages/iso/src/index.ts`. After the `useViewTransitionLifecycle` export block, add:

```ts
export {
  useViewTransitionTypes,
  type ViewTransitionTypesInput,
  type ViewTransitionTypesNav,
} from './view-transition-types.js';
```

- [ ] **Step 5: Add `getNavDirection` to advanced exports**

Already added in Task 1.4. Verify it's exported from `packages/iso/src/internal.ts`. No change needed if present.

- [ ] **Step 6: Run test + typecheck**

```bash
pnpm --filter '@hono-preact/iso' test -- view-transition-types
pnpm --filter '@hono-preact/iso' typecheck
```

Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/view-transition-types.ts \
        packages/iso/src/__tests__/view-transition-types.test.tsx \
        packages/iso/src/index.ts
git commit -m "feat(iso): useViewTransitionTypes hook"
```

### Task 3.3: Phase 3 wrap — pre-push

Repeat the six-step sequence. PR title: "feat(iso): default nav-* types + useViewTransitionTypes".

---

## Phase 4: Module A — named elements at scale

**File map:**

- Create: `packages/iso/src/internal/merge-refs.ts`
- Create: `packages/iso/src/internal/use-render.ts`
- Create: `packages/iso/src/view-transition-name.ts` (hooks)
- Create: `packages/iso/src/view-transition-name.tsx` (components — separate file because of JSX)
- Modify: `packages/iso/src/index.ts`
- Modify: `packages/iso/src/internal.ts` (export `useRender` as an advanced utility)
- Test: `packages/iso/src/__tests__/use-render.test.tsx`
- Test: `packages/iso/src/__tests__/view-transition-name-hook.test.tsx`
- Test: `packages/iso/src/__tests__/view-transition-name-component.test.tsx`

### Task 4.1: `mergeRefs` helper

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/merge-refs.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mergeRefs } from '../internal/merge-refs.js';

describe('mergeRefs', () => {
  it('calls a function ref', () => {
    const fn = vi.fn();
    const merged = mergeRefs(fn);
    const node = {} as Element;
    merged(node);
    expect(fn).toHaveBeenCalledWith(node);
  });

  it('writes to an object ref', () => {
    const ref = { current: null as Element | null };
    const merged = mergeRefs(ref);
    const node = {} as Element;
    merged(node);
    expect(ref.current).toBe(node);
  });

  it('composes multiple refs of mixed shape', () => {
    const fn = vi.fn();
    const ref = { current: null as Element | null };
    const merged = mergeRefs(fn, ref, null, undefined);
    const node = {} as Element;
    merged(node);
    expect(fn).toHaveBeenCalledWith(node);
    expect(ref.current).toBe(node);
  });

  it('passes null on cleanup', () => {
    const fn = vi.fn();
    const ref = { current: null as Element | null };
    const merged = mergeRefs(fn, ref);
    merged({} as Element);
    merged(null);
    expect(fn).toHaveBeenLastCalledWith(null);
    expect(ref.current).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter '@hono-preact/iso' test -- merge-refs
```

- [ ] **Step 3: Implement**

Create `packages/iso/src/internal/merge-refs.ts`:

```ts
import type { Ref } from 'preact';

type AnyRef<T> = Ref<T> | null | undefined;

export function mergeRefs<T>(...refs: AnyRef<T>[]): (node: T | null) => void {
  return (node: T | null) => {
    for (const ref of refs) {
      if (ref == null) continue;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as { current: T | null }).current = node;
      }
    }
  };
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter '@hono-preact/iso' test -- merge-refs
```

Expected: PASS.

```bash
git add packages/iso/src/internal/merge-refs.ts \
        packages/iso/src/__tests__/merge-refs.test.ts
git commit -m "feat(iso): mergeRefs helper"
```

### Task 4.2: `useRender` polymorphic helper

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/use-render.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { h } from 'preact';
import { useRender } from '../internal/use-render.js';

function Wrap(props: {
  render?: Parameters<typeof useRender>[0]['render'];
  defaultTag?: string;
  className?: string;
}) {
  return useRender({
    render: props.render,
    defaultTag: props.defaultTag ?? 'div',
    props: { class: props.className ?? 'wrap' },
  });
}

describe('useRender', () => {
  it('renders the default tag with merged props', () => {
    const { container } = render(<Wrap className="x" />);
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('DIV');
    expect(el.getAttribute('class')).toBe('x');
  });

  it('accepts a render element and clones it with merged class', () => {
    const { container } = render(
      <Wrap className="x" render={<article class="card" />} />
    );
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('ARTICLE');
    expect(el.getAttribute('class')).toBe('card x');
  });

  it('accepts a render function and passes merged props', () => {
    const { container } = render(
      <Wrap
        className="x"
        render={(props) => h('section', { ...props, id: 'sec' })}
      />
    );
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('SECTION');
    expect(el.getAttribute('id')).toBe('sec');
    expect(el.getAttribute('class')).toBe('x');
  });

  it('accepts a render string and uses it as the tag', () => {
    const { container } = render(<Wrap className="x" render="aside" />);
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('ASIDE');
  });

  it('joins user class and framework class', () => {
    const { container } = render(
      <Wrap className="framework" render={<a class="user" />} />
    );
    const el = container.firstElementChild!;
    expect(el.getAttribute('class')).toBe('user framework');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter '@hono-preact/iso' test -- use-render
```

- [ ] **Step 3: Implement**

Create `packages/iso/src/internal/use-render.ts`:

```ts
import { cloneElement, h, type VNode } from 'preact';
import { mergeRefs } from './merge-refs.js';

type Props = Record<string, unknown>;

export type UseRenderRender =
  | VNode
  | string
  | ((props: Props) => VNode)
  | undefined;

interface UseRenderOptions {
  render?: UseRenderRender;
  defaultTag: string;
  props: Props;
  children?: unknown;
}

function joinClass(a: unknown, b: unknown): string | undefined {
  const parts: string[] = [];
  if (typeof a === 'string' && a.length > 0) parts.push(a);
  if (typeof b === 'string' && b.length > 0) parts.push(b);
  if (parts.length === 0) return undefined;
  return parts.join(' ');
}

function mergeProps(user: Props, framework: Props): Props {
  const out: Props = { ...user };
  for (const key of Object.keys(framework)) {
    if (key === 'class' || key === 'className') {
      const userClass = (user.class ?? user.className) as unknown;
      const merged = joinClass(userClass, framework[key]);
      if (merged !== undefined) out.class = merged;
      delete out.className;
    } else if (key === 'ref') {
      out.ref = mergeRefs(user.ref as never, framework.ref as never);
    } else {
      out[key] = framework[key];
    }
  }
  return out;
}

export function useRender(opts: UseRenderOptions): VNode {
  const { render, defaultTag, props, children } = opts;

  if (typeof render === 'function') {
    return render(mergeProps({}, props));
  }
  if (render && typeof render === 'object' && 'type' in render) {
    const merged = mergeProps((render.props ?? {}) as Props, props);
    const mergedChildren =
      children !== undefined ? children : (render.props as { children?: unknown })?.children;
    return cloneElement(render, merged, mergedChildren);
  }
  const tag = typeof render === 'string' ? render : defaultTag;
  return h(tag, props, children as never);
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter '@hono-preact/iso' test -- use-render
```

Expected: PASS.

```bash
git add packages/iso/src/internal/use-render.ts \
        packages/iso/src/__tests__/use-render.test.tsx
git commit -m "feat(iso): useRender polymorphic helper"
```

### Task 4.3: `useViewTransitionName` + `useViewTransitionClass` hooks

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/view-transition-name-hook.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import {
  useViewTransitionName,
  useViewTransitionClass,
} from '../view-transition-name.js';

function Probe({ name }: { name: string | null }) {
  const ref = useViewTransitionName(name);
  return <article ref={ref} />;
}

function ProbeClass({ cls }: { cls: string | string[] | null }) {
  const ref = useViewTransitionClass(cls);
  return <article ref={ref} />;
}

describe('useViewTransitionName', () => {
  it('writes view-transition-name to the live DOM node', () => {
    const { container } = render(<Probe name="hero" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero');
  });

  it('updates when name changes', () => {
    const { container, rerender } = render(<Probe name="hero" />);
    const el = container.firstElementChild as HTMLElement;
    rerender(<Probe name="hero-2" />);
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero-2');
  });

  it('clears when name becomes null', () => {
    const { container, rerender } = render(<Probe name="hero" />);
    const el = container.firstElementChild as HTMLElement;
    rerender(<Probe name={null} />);
    expect(el.style.getPropertyValue('view-transition-name')).toBe('');
  });

  it('composes with a consumer ref', () => {
    function Compose() {
      const consumerRef = useRef<HTMLElement | null>(null);
      const vtRef = useViewTransitionName('hero');
      return (
        <article
          ref={(node) => {
            consumerRef.current = node;
            vtRef(node);
          }}
        />
      );
    }
    const { container } = render(<Compose />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero');
  });
});

describe('useViewTransitionClass', () => {
  it('writes view-transition-class as a single string', () => {
    const { container } = render(<ProbeClass cls="card" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('view-transition-class')).toBe('card');
  });

  it('joins an array with spaces', () => {
    const { container } = render(<ProbeClass cls={['card', 'highlight']} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('view-transition-class')).toBe(
      'card highlight'
    );
  });

  it('clears when null', () => {
    const { container, rerender } = render(<ProbeClass cls="card" />);
    const el = container.firstElementChild as HTMLElement;
    rerender(<ProbeClass cls={null} />);
    expect(el.style.getPropertyValue('view-transition-class')).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter '@hono-preact/iso' test -- view-transition-name-hook
```

- [ ] **Step 3: Implement**

Create `packages/iso/src/view-transition-name.ts`:

```ts
import { useCallback, useLayoutEffect, useRef } from 'preact/hooks';

type NodeRef = HTMLElement | SVGElement;

function applyCssProp(
  node: NodeRef | null,
  property: string,
  value: string | null | undefined
): void {
  if (!node) return;
  if (value == null || value === '') {
    node.style.removeProperty(property);
  } else {
    node.style.setProperty(property, value);
  }
}

export function useViewTransitionName(
  name: string | null | undefined
): (node: Element | null) => void {
  const nodeRef = useRef<NodeRef | null>(null);
  const nameRef = useRef<string | null | undefined>(name);
  nameRef.current = name;

  // Sync when name changes on a node we already hold.
  useLayoutEffect(() => {
    applyCssProp(nodeRef.current, 'view-transition-name', name);
  }, [name]);

  // Stable ref callback — applies on attach, clears the previous node on swap.
  return useCallback((node: Element | null) => {
    if (nodeRef.current && nodeRef.current !== node) {
      nodeRef.current.style.removeProperty('view-transition-name');
    }
    nodeRef.current = node as NodeRef | null;
    applyCssProp(node as NodeRef | null, 'view-transition-name', nameRef.current);
  }, []);
}

export function useViewTransitionClass(
  cls: string | string[] | null | undefined
): (node: Element | null) => void {
  const value =
    cls == null ? null : Array.isArray(cls) ? cls.join(' ') : cls;

  const nodeRef = useRef<NodeRef | null>(null);
  const valueRef = useRef<string | null>(value);
  valueRef.current = value;

  useLayoutEffect(() => {
    applyCssProp(nodeRef.current, 'view-transition-class', value);
  }, [value]);

  return useCallback((node: Element | null) => {
    if (nodeRef.current && nodeRef.current !== node) {
      nodeRef.current.style.removeProperty('view-transition-class');
    }
    nodeRef.current = node as NodeRef | null;
    applyCssProp(node as NodeRef | null, 'view-transition-class', valueRef.current);
  }, []);
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter '@hono-preact/iso' test -- view-transition-name-hook
```

Expected: PASS, 7/7.

```bash
git add packages/iso/src/view-transition-name.ts \
        packages/iso/src/__tests__/view-transition-name-hook.test.tsx
git commit -m "feat(iso): useViewTransitionName + useViewTransitionClass hooks"
```

### Task 4.4: `<ViewTransitionName>` + `<ViewTransitionGroup>` components

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/view-transition-name-component.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import {
  ViewTransitionName,
  ViewTransitionGroup,
} from '../view-transition-name.js';

describe('<ViewTransitionName>', () => {
  it('renders a div with view-transition-name by default', () => {
    const { container } = render(
      <ViewTransitionName name="hero">child</ViewTransitionName>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('DIV');
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero');
    expect(el.textContent).toBe('child');
  });

  it('clones the render element and applies name to it', () => {
    const { container } = render(
      <ViewTransitionName
        name={`post-1`}
        render={<article class="card" />}
      >
        body
      </ViewTransitionName>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('ARTICLE');
    expect(el.getAttribute('class')).toBe('card');
    expect(el.style.getPropertyValue('view-transition-name')).toBe('post-1');
    expect(el.textContent).toBe('body');
  });

  it('supports render as a function', () => {
    const { container } = render(
      <ViewTransitionName
        name="hero"
        render={(props) => <a {...props} href="/x" />}
      >
        link
      </ViewTransitionName>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/x');
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero');
  });

  it('applies groupClass via view-transition-class', () => {
    const { container } = render(
      <ViewTransitionName name="hero" groupClass="post">
        x
      </ViewTransitionName>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero');
    expect(el.style.getPropertyValue('view-transition-class')).toBe('post');
  });

  it('does not touch the consumer style prop', () => {
    const { container } = render(
      <ViewTransitionName
        name="hero"
        render={<article style={{ color: 'red' }} />}
      >
        x
      </ViewTransitionName>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.color).toBe('red');
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero');
  });
});

describe('<ViewTransitionGroup>', () => {
  it('applies view-transition-class', () => {
    const { container } = render(
      <ViewTransitionGroup class="post" render={<article />}>
        x
      </ViewTransitionGroup>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('ARTICLE');
    expect(el.style.getPropertyValue('view-transition-class')).toBe('post');
  });

  it('accepts an array class', () => {
    const { container } = render(
      <ViewTransitionGroup class={['a', 'b']}>x</ViewTransitionGroup>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('view-transition-class')).toBe('a b');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter '@hono-preact/iso' test -- view-transition-name-component
```

- [ ] **Step 3: Implement the components**

Append to `packages/iso/src/view-transition-name.ts` (so component and hooks share a module):

```ts
import type { ComponentChildren, VNode } from 'preact';
import { useRender, type UseRenderRender } from './internal/use-render.js';
import { mergeRefs } from './internal/merge-refs.js';

export interface ViewTransitionNameProps {
  name: string | null | undefined;
  groupClass?: string | string[];
  render?: UseRenderRender;
  children?: ComponentChildren;
}

export function ViewTransitionName(props: ViewTransitionNameProps): VNode {
  const nameRef = useViewTransitionName(props.name);
  const classRef = useViewTransitionClass(props.groupClass);
  const ref = mergeRefs<Element>(nameRef, classRef);
  return useRender({
    render: props.render,
    defaultTag: 'div',
    props: { ref },
    children: props.children,
  });
}

export interface ViewTransitionGroupProps {
  class: string | string[];
  render?: UseRenderRender;
  children?: ComponentChildren;
}

export function ViewTransitionGroup(props: ViewTransitionGroupProps): VNode {
  const classRef = useViewTransitionClass(props.class);
  return useRender({
    render: props.render,
    defaultTag: 'div',
    props: { ref: classRef },
    children: props.children,
  });
}
```

- [ ] **Step 4: Add public exports**

Edit `packages/iso/src/index.ts`. Add:

```ts
export {
  useViewTransitionName,
  useViewTransitionClass,
  ViewTransitionName,
  ViewTransitionGroup,
  type ViewTransitionNameProps,
  type ViewTransitionGroupProps,
} from './view-transition-name.js';
```

Edit `packages/iso/src/internal.ts`. Under Section 1, export `useRender`:

```ts
export {
  useRender,
  type UseRenderRender,
} from './internal/use-render.js';
export { mergeRefs } from './internal/merge-refs.js';
```

- [ ] **Step 5: Run + typecheck**

```bash
pnpm --filter '@hono-preact/iso' test -- view-transition-name-component
pnpm --filter '@hono-preact/iso' typecheck
```

Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/view-transition-name.ts \
        packages/iso/src/__tests__/view-transition-name-component.test.tsx \
        packages/iso/src/index.ts \
        packages/iso/src/internal.ts
git commit -m "feat(iso): ViewTransitionName + ViewTransitionGroup components"
```

### Task 4.5: Phase 4 wrap — pre-push

Repeat the six-step sequence. PR title: "feat(iso): named-element View Transition primitives".

---

## Phase 5: Module D — `<Persist>` + `<PersistHost />`

**File map:**

- Create: `packages/iso/src/internal/persist-registry.ts`
- Create: `packages/iso/src/persist.tsx`
- Modify: `packages/iso/src/index.ts`
- Modify: `packages/vite/src/client-entry.ts` — auto-mount `<PersistHost />`.
- Modify: `packages/vite/src/__tests__/client-entry.test.ts`
- Test: `packages/iso/src/__tests__/persist.test.tsx`
- Test: `packages/iso/src/__tests__/persist-registry.test.ts`

### Task 5.1: Persist registry

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/persist-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  __persistRegistryWrite,
  __persistRegistryRead,
  __persistRegistrySubscribe,
  __persistRegistryResetForTesting,
} from '../internal/persist-registry.js';

describe('persist-registry', () => {
  beforeEach(() => {
    __persistRegistryResetForTesting();
  });

  it('round-trips an entry', () => {
    __persistRegistryWrite('player', {
      children: 'audio',
      viewTransitionName: undefined,
    });
    expect(__persistRegistryRead().get('player')).toEqual({
      children: 'audio',
      viewTransitionName: undefined,
    });
  });

  it('notifies subscribers on write', () => {
    const calls: number[] = [];
    const unsub = __persistRegistrySubscribe(() => calls.push(1));
    __persistRegistryWrite('a', { children: 'x', viewTransitionName: undefined });
    __persistRegistryWrite('a', { children: 'y', viewTransitionName: undefined });
    expect(calls.length).toBe(2);
    unsub();
    __persistRegistryWrite('a', { children: 'z', viewTransitionName: undefined });
    expect(calls.length).toBe(2);
  });

  it('does not clear entries on its own', () => {
    __persistRegistryWrite('a', { children: 'x', viewTransitionName: undefined });
    // No clear API exposed; entries are app-lifetime by design.
    expect(__persistRegistryRead().get('a')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to fail**

```bash
pnpm --filter '@hono-preact/iso' test -- persist-registry
```

- [ ] **Step 3: Implement**

Create `packages/iso/src/internal/persist-registry.ts`:

```ts
import type { ComponentChildren } from 'preact';

export interface PersistEntry {
  children: ComponentChildren;
  viewTransitionName: string | undefined;
}

let map = new Map<string, PersistEntry>();
const subs = new Set<() => void>();

export function __persistRegistryWrite(
  id: string,
  entry: PersistEntry
): void {
  // Replace the map reference so consumers using identity-checks can detect.
  const next = new Map(map);
  next.set(id, entry);
  map = next;
  for (const sub of subs) sub();
}

export function __persistRegistryRead(): ReadonlyMap<string, PersistEntry> {
  return map;
}

export function __persistRegistrySubscribe(sub: () => void): () => void {
  subs.add(sub);
  return () => {
    subs.delete(sub);
  };
}

/** Test-only. */
export function __persistRegistryResetForTesting(): void {
  map = new Map();
  subs.clear();
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter '@hono-preact/iso' test -- persist-registry
```

Expected: PASS.

```bash
git add packages/iso/src/internal/persist-registry.ts \
        packages/iso/src/__tests__/persist-registry.test.ts
git commit -m "feat(iso): persist registry"
```

### Task 5.2: `<Persist>` + `<PersistHost />`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/persist.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { Persist, PersistHost } from '../persist.js';
import { __persistRegistryResetForTesting } from '../internal/persist-registry.js';

describe('Persist + PersistHost', () => {
  beforeEach(() => {
    cleanup();
    __persistRegistryResetForTesting();
  });

  it('Persist renders inline on SSR (no portal) — children appear in place', () => {
    const { container } = render(
      <div data-page>
        <Persist id="player">
          <span data-id="audio">a</span>
        </Persist>
      </div>
    );
    expect(container.querySelector('[data-page] [data-id="audio"]')).not.toBeNull();
  });

  it('PersistHost renders entries from the registry', () => {
    render(
      <div>
        <Persist id="player">
          <span data-id="audio">a</span>
        </Persist>
        <PersistHost />
      </div>
    );

    // After Persist mounts, the registry has an entry; PersistHost renders it.
    const hosts = document.querySelectorAll('[data-hp-persist-slot]');
    expect(hosts.length).toBe(1);
    expect(hosts[0].getAttribute('data-hp-persist-slot')).toBe('player');
    expect(hosts[0].textContent).toBe('a');
  });

  it('applies viewTransitionName to the slot host element', () => {
    render(
      <div>
        <Persist id="player" viewTransitionName="player-shell">
          <span>a</span>
        </Persist>
        <PersistHost />
      </div>
    );
    const host = document.querySelector(
      '[data-hp-persist-slot="player"]'
    ) as HTMLElement;
    expect(host.style.getPropertyValue('view-transition-name')).toBe(
      'player-shell'
    );
  });

  it('updates registry when children change', () => {
    const { rerender } = render(
      <div>
        <Persist id="player">
          <span>a</span>
        </Persist>
        <PersistHost />
      </div>
    );
    let host = document.querySelector(
      '[data-hp-persist-slot="player"]'
    ) as HTMLElement;
    expect(host.textContent).toBe('a');

    rerender(
      <div>
        <Persist id="player">
          <span>b</span>
        </Persist>
        <PersistHost />
      </div>
    );
    host = document.querySelector(
      '[data-hp-persist-slot="player"]'
    ) as HTMLElement;
    expect(host.textContent).toBe('b');
  });

  it('does NOT clear the registry entry when Persist unmounts', () => {
    const { rerender } = render(
      <div>
        <Persist id="player">
          <span>a</span>
        </Persist>
        <PersistHost />
      </div>
    );
    expect(document.querySelector('[data-hp-persist-slot="player"]')).not.toBeNull();

    rerender(
      <div>
        <PersistHost />
      </div>
    );
    // Persist has unmounted; the host should still render the last entry.
    const host = document.querySelector(
      '[data-hp-persist-slot="player"]'
    ) as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.textContent).toBe('a');
  });
});
```

- [ ] **Step 2: Run to fail**

```bash
pnpm --filter '@hono-preact/iso' test -- persist
```

- [ ] **Step 3: Implement**

Create `packages/iso/src/persist.tsx`:

```tsx
import type { ComponentChildren, VNode } from 'preact';
import { Fragment, h } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import {
  __persistRegistryWrite,
  __persistRegistryRead,
  __persistRegistrySubscribe,
  type PersistEntry,
} from './internal/persist-registry.js';
import { useViewTransitionName } from './view-transition-name.js';
import { isBrowser } from './is-browser.js';

export interface PersistProps {
  id: string;
  viewTransitionName?: string;
  children?: ComponentChildren;
}

export function Persist(props: PersistProps): VNode {
  const browser = isBrowser();

  // Hook is called unconditionally; the effect short-circuits on the server
  // so SSR's render output (children inline) remains the only side effect.
  useLayoutEffect(() => {
    if (!browser) return;
    const entry: PersistEntry = {
      children: props.children,
      viewTransitionName: props.viewTransitionName,
    };
    __persistRegistryWrite(props.id, entry);
  });

  // SSR renders children inline so first paint matches steady state;
  // the client renders nothing inline because the host owns the DOM.
  return browser ? h(Fragment, null) : h(Fragment, null, props.children);
}

interface PersistSlotProps {
  id: string;
  entry: PersistEntry;
}

function PersistSlot(props: PersistSlotProps): VNode {
  const ref = useViewTransitionName(props.entry.viewTransitionName);
  return (
    <div data-hp-persist-slot={props.id} ref={ref}>
      {props.entry.children}
    </div>
  );
}

PersistSlot.displayName = 'PersistSlot';

export function PersistHost(): VNode {
  const [, setTick] = useState(0);

  // useLayoutEffect (not useEffect) so the subscription is in place before
  // sibling useEffects run; the trailing setTick re-reads the registry in case
  // a Persist sibling's useLayoutEffect already wrote between this render and
  // this subscribe (sibling order is render order, so Persist-before-Host or
  // Host-before-Persist are both possible).
  useLayoutEffect(() => {
    const unsub = __persistRegistrySubscribe(() => setTick((n) => n + 1));
    setTick((n) => n + 1);
    return unsub;
  }, []);

  const map = __persistRegistryRead();
  return (
    <Fragment>
      {Array.from(map.entries()).map(([id, entry]) => (
        <PersistSlot key={id} id={id} entry={entry} />
      ))}
    </Fragment>
  );
}
```

- [ ] **Step 4: Public exports**

Edit `packages/iso/src/index.ts`. Add:

```ts
export { Persist, PersistHost, type PersistProps } from './persist.js';
```

- [ ] **Step 5: Run + typecheck**

```bash
pnpm --filter '@hono-preact/iso' test -- persist
pnpm --filter '@hono-preact/iso' typecheck
```

Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/persist.tsx \
        packages/iso/src/__tests__/persist.test.tsx \
        packages/iso/src/index.ts
git commit -m "feat(iso): Persist + PersistHost"
```

### Task 5.3: Auto-mount `<PersistHost />` from the generated client entry

- [ ] **Step 1: Extend the client-entry test**

Add to `packages/vite/src/__tests__/client-entry.test.ts`:

```ts
it('mounts PersistHost into a stable container appended to body', () => {
  const src = generateClientEntrySource({ routesAbsPath: '/abs/routes.tsx' });
  expect(src).toContain('PersistHost');
  expect(src).toContain('__hp_persist_root');
});
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter '@hono-preact/vite' test -- client-entry
```

- [ ] **Step 3: Update the generator**

Edit `packages/vite/src/client-entry.ts`:

```ts
return (
    `import { h, hydrate, render as renderPreact } from 'preact';\n` +
    `import { LocationProvider } from 'preact-iso';\n` +
    `import { Routes, PersistHost } from 'hono-preact';\n` +
    `import { __dispatchRouteChange, installStreamRegistry, installHistoryShim } from 'hono-preact/internal';\n` +
    `import routes from '${opts.routesAbsPath}';\n` +
    `\n` +
    `installHistoryShim();\n` +
    `installStreamRegistry();\n` +
    `\n` +
    `let persistHost = document.getElementById('__hp_persist_root');\n` +
    `if (!persistHost) {\n` +
    `  persistHost = document.createElement('div');\n` +
    `  persistHost.id = '__hp_persist_root';\n` +
    `  document.body.appendChild(persistHost);\n` +
    `}\n` +
    `renderPreact(h(PersistHost, null), persistHost);\n` +
    `\n` +
    `let lastPath;\n` +
    `function onRouteChange(path) {\n` +
    `  const from = lastPath;\n` +
    `  lastPath = path;\n` +
    `  __dispatchRouteChange(path, from);\n` +
    `}\n` +
    `\n` +
    `hydrate(\n` +
    `  h(LocationProvider, null,\n` +
    `    h(Routes, { routes, onRouteChange })\n` +
    `  ),\n` +
    `  document.getElementById('app')\n` +
    `);\n`
);
```

- [ ] **Step 4: Run + typecheck**

```bash
pnpm --filter '@hono-preact/vite' test -- client-entry
pnpm --filter '@hono-preact/vite' typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/client-entry.ts \
        packages/vite/src/__tests__/client-entry.test.ts
git commit -m "feat(vite): auto-mount PersistHost in generated client entry"
```

### Task 5.4: Phase 5 wrap — pre-push

Repeat the six-step sequence. PR title: "feat(iso): Persist + PersistHost for stateful elements across navigation".

---

## Phase 6: Documentation

**File map:**
- Create: `apps/site/src/pages/docs/view-transitions.mdx`
- Modify: `apps/site/src/pages/docs/pages.mdx` — link to the new page.
- Modify: `apps/site/src/pages/docs/_sidebar.ts` (or whatever the project's sidebar config is) — confirm by reading `apps/site/src/pages/docs/` for the manifest.

### Task 6.1: Locate the docs sidebar source

- [ ] **Step 1: Discover the sidebar manifest**

```bash
ls apps/site/src/pages/docs/ | head -40
grep -rn 'view-transitions\|sidebar' apps/site/src/pages/docs/ 2>/dev/null | head -20
```

Identify the file that lists docs entries (a `.ts` or `.tsx` manifest, an `mdx` index, or convention-based ordering).

- [ ] **Step 2: Decide insertion point**

Place "View Transitions" after "Optimistic UI" (related: both deal with transitions / animation).

### Task 6.2: Write the docs page

**Files:**
- Create: `apps/site/src/pages/docs/view-transitions.mdx`

- [ ] **Step 1: Write the page**

Create `apps/site/src/pages/docs/view-transitions.mdx`:

````mdx
---
title: View Transitions
---

# View Transitions

The framework wraps every same-document route change in `document.startViewTransition` automatically. You don't opt in. Style the default root transition with `::view-transition-old(root)` / `::view-transition-new(root)`, and respect `prefers-reduced-motion`.

On top of that, four primitives let you scale View Transitions across many elements, hook into the navigation lifecycle, target CSS by direction, and persist live DOM across navigations.

## Named elements

Use `<ViewTransitionName>` to give an element a stable identity that participates in the transition. The component is polymorphic (Base UI `useRender` style): pass a `render` prop to control which element actually mounts.

```tsx
import { ViewTransitionName } from 'hono-preact';

// list page
{posts.map((post) => (
  <ViewTransitionName
    key={post.id}
    name={`post-${post.id}`}
    groupClass="post-card"
    render={<article class="card" />}
  >
    <h2>{post.title}</h2>
  </ViewTransitionName>
))}

// detail page
<ViewTransitionName name={`post-${post.id}`} render={<header />}>
  <h1>{post.title}</h1>
</ViewTransitionName>
```

The matching `name` between list and detail tells the browser to animate the elements as a continuous group.

For hand-written components, the `useViewTransitionName` hook returns a ref callback:

```tsx
import { useViewTransitionName } from 'hono-preact';

function PostCard({ post }: { post: Post }) {
  const vt = useViewTransitionName(`post-${post.id}`);
  return <article ref={vt}>{post.title}</article>;
}
```

`<ViewTransitionGroup class="post-card">` (or `useViewTransitionClass`) sets `view-transition-class` so you can target many elements via `::view-transition-group(.post-card)` in CSS.

## Lifecycle hooks

`useViewTransitionLifecycle` exposes four phases the framework controls:

```tsx
import { useViewTransitionLifecycle } from 'hono-preact';

useViewTransitionLifecycle({
  onBeforeTransition: (event) => {
    // before startViewTransition is called.
    // event.types.push('my-type') to add a type, event.skip() to bypass.
  },
  onBeforeSwap: (event) => {
    // inside the transition callback, before the Preact render flushes.
    // last chance to mutate the DOM before the new frame is snapshotted.
  },
  onAfterSwap: (event) => {
    // inside the callback, after the render flush. New DOM is committed.
  },
  onAfterTransition: (event) => {
    // after transition.finished resolves (or rejects).
    // event.reason is 'skipped' | 'unsupported' | 'aborted' if the transition didn't run.
  },
});
```

The event carries `to`, `from`, `direction` (`'initial' | 'push' | 'replace' | 'back' | 'forward'`), `types` (mutable), and a `set(key, value)` / `get(key)` stash to carry data from one phase to the next.

## Direction-driven CSS via types

The framework adds three types to every transition:

- `nav-initial` on the first navigation after hydrate, otherwise one of `nav-push` / `nav-replace` / `nav-back` / `nav-forward`.
- `nav-same-origin`.

Target them with `:active-view-transition-type(...)`:

```css
:active-view-transition-type(nav-back) ::view-transition-old(root) {
  animation: slide-right-out 0.3s ease;
}
:active-view-transition-type(nav-back) ::view-transition-new(root) {
  animation: slide-right-in 0.3s ease;
}
```

Add your own types with `useViewTransitionTypes`:

```tsx
import { useViewTransitionTypes } from 'hono-preact';

useViewTransitionTypes((nav) =>
  nav.from?.startsWith('/posts/') && nav.to === '/posts' ? ['back-to-list'] : []
);
```

## Persistent elements

`<Persist>` keeps an element's DOM and JS state alive across route changes. The framework auto-mounts a single `<PersistHost />` outside the SPA root; `<Persist id="...">` writes its children into a registry that the host renders. Same VNode reference + stable host DOM means Preact's diff preserves the underlying nodes (audio playback continues, video position is retained, chat widgets stay initialized).

```tsx
import { Persist } from 'hono-preact';

<Persist id="player" viewTransitionName="player-shell">
  <AudioPlayer src={song.url} />
</Persist>
```

The optional `viewTransitionName` makes the persisted shell animate as a single unit across page transitions.

SSR renders persisted children inline at their declared position; persistence kicks in after the first client-side navigation.
````

- [ ] **Step 2: Add a link from `pages.mdx`**

In `apps/site/src/pages/docs/pages.mdx`, replace the existing paragraph at `:112` (the "Route changes trigger a view transition automatically..." paragraph) with:

```mdx
Route changes trigger a View Transition automatically in browsers that support `document.startViewTransition`. See [View Transitions](./view-transitions) for the full toolkit (named elements, lifecycle hooks, direction-driven types, and persistent elements).
```

- [ ] **Step 3: Update the sidebar manifest**

Insert the new page after Optimistic UI in whatever the project's sidebar config uses (discovered in Task 6.1).

- [ ] **Step 4: Build the site to verify the page renders**

```bash
pnpm --filter site build
```

Expected: clean. New page included in the build output.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/docs/view-transitions.mdx \
        apps/site/src/pages/docs/pages.mdx \
        apps/site/src/pages/docs/_sidebar.ts
git commit -m "docs(site): view transitions toolkit"
```

(Adjust the third path to the real sidebar file discovered in Task 6.1.)

### Task 6.3: Phase 6 wrap — pre-push

Repeat the six-step sequence. PR title: "docs(site): view transitions toolkit".

---

## Cross-cutting integration test (optional, attached to Phase 5)

Add to `packages/iso/src/__tests__/view-transitions-integration.test.tsx` (the file already exists per the earlier search; extend it):

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/preact';
import {
  ViewTransitionName,
  Persist,
  PersistHost,
  useViewTransitionLifecycle,
  useViewTransitionTypes,
} from '../index.js';
import { __dispatchRouteChange } from '../internal/route-change.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../internal/history-shim.js';
import { resetDefaultTypesForTesting } from '../internal/route-change.js';
import { __persistRegistryResetForTesting } from '../internal/persist-registry.js';

describe('toolkit integration', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
    __persistRegistryResetForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('A+B+C+D fire together across a single navigation', async () => {
    const typeAdds: string[] = [];
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    vi.stubGlobal('document', {
      startViewTransition(cb: () => void) {
        cb();
        return {
          ready: Promise.resolve(),
          updateCallbackDone: Promise.resolve(),
          finished,
          types: { add: (t: string) => typeAdds.push(t) },
        };
      },
    });
    setNavDirectionForTesting('back');

    const phases: string[] = [];
    function App() {
      useViewTransitionLifecycle({
        onBeforeTransition: () => phases.push('bt'),
        onAfterSwap: () => phases.push('as'),
      });
      useViewTransitionTypes(['custom-type']);
      return (
        <div>
          <ViewTransitionName name="hero">
            <h1>title</h1>
          </ViewTransitionName>
          <Persist id="player">
            <span data-id="audio">audio</span>
          </Persist>
          <PersistHost />
        </div>
      );
    }
    render(<App />);

    __dispatchRouteChange('/posts', '/posts/1');
    resolveFinished();
    await Promise.resolve();
    await Promise.resolve();

    // A: view-transition-name applied
    const heroes = document.querySelectorAll('[style*="view-transition-name"]');
    expect(heroes.length).toBeGreaterThan(0);

    // B: lifecycle phases fired
    expect(phases).toEqual(expect.arrayContaining(['bt', 'as']));

    // C: nav-back, nav-same-origin, custom-type all applied
    expect(typeAdds).toEqual(
      expect.arrayContaining(['nav-back', 'nav-same-origin', 'custom-type'])
    );

    // D: PersistHost rendered the registry entry
    const slot = document.querySelector('[data-hp-persist-slot="player"]');
    expect(slot?.textContent).toBe('audio');
  });
});
```

Add to Task 5.2 or as a final task in Phase 5. Run with:

```bash
pnpm --filter '@hono-preact/iso' test -- view-transitions-integration
```

---

## Spec coverage matrix

| Spec section | Implemented in |
|---|---|
| Module A — useViewTransitionName, useViewTransitionClass | Task 4.3 |
| Module A — ViewTransitionName, ViewTransitionGroup, useRender | Tasks 4.2, 4.4 |
| Module B — useViewTransitionLifecycle, four phases | Tasks 1.3, 2.1 |
| Module B — ViewTransitionEvent stash, skip(), reason | Tasks 1.1, 1.3 |
| Module C — history shim, NavDirection | Task 1.2 |
| Module C — default nav-* types | Task 3.1 |
| Module C — useViewTransitionTypes | Task 3.2 |
| Module D — registry | Task 5.1 |
| Module D — Persist, PersistHost | Task 5.2 |
| Module D — auto-mount in client entry | Task 5.3 |
| Public exports | Tasks 1.4, 2.1, 3.2, 4.4, 5.2 |
| Internal advanced exports | Tasks 1.4, 4.4 |
| Legacy useRouteChange preserved | Task 1.3 (legacy subscriber list maintained) |
| Docs page | Tasks 6.1, 6.2 |
| Integration test | Cross-cutting section |

## Open follow-ups for after merge

- `<Persist ttlMs>` for explicit teardown (deferred to v2).
- True SSR-portal-slot rendering for Persist (deferred to v2).
- Cross-document (MPA) View Transitions — separate spec.
- Consider whether the legacy `useRouteChange` should be deprecated in favor of `useViewTransitionLifecycle({ onAfterSwap })` once the new API is documented.
