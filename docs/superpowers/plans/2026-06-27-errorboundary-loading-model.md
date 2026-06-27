# ErrorBoundary-as-default loading model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a guarded route-to-route navigation keep the outgoing route alive (instead of tearing it to a blank) while the incoming route's page-middleware chain resolves, by letting preact-iso's `Router` be the suspense boundary.

**Architecture:** Two coupled changes in `packages/iso/src/internal/page-middleware-host.tsx`. (1) `SuspenseHost` stops wrapping `HostConsumer` in preact-iso's `ErrorBoundary`, so the chain's thrown promise bubbles to the nearest `Router`, which holds `[cur, prev]` alive. (2) Because chain suspension via `wrapPromise` has no self-update (the removed boundary used to provide one via `forceUpdate`), `HostConsumer` self-heals: it subscribes to the chain promise's resolution and re-renders itself, mirroring preact-iso `lazy`. This adopts ErrorBoundary/Router-as-the-boundary as the default; the interposed fallback-swap boundary is gone. Server SSR (`prerender` catches suspensions globally) and the initial-load hydration path (`DeferredHost`, which never suspends) are untouched.

**Tech Stack:** TypeScript, Preact 10, preact-iso (Router/lazy/ErrorBoundary), Vitest + @testing-library/preact (happy-dom), pnpm workspaces.

**Spec:** [docs/superpowers/specs/2026-06-27-errorboundary-loading-model-design.md](../specs/2026-06-27-errorboundary-loading-model-design.md) (#196).

## Global Constraints

- **No em-dashes** in prose, comments, or commit messages (use comma/colon/parens or two sentences). CLI flags and code identifiers are exempt.
- **Node engines:** `^22.18.0 || >=24.11.0`. Do not change.
- **Bundle discipline:** iso ships into every app. Add no new runtime dependency; prefer platform APIs. Keep new code tree-shakeable and side-effect-free. The PR-only `client-size` job will flag any increase; this change should be net-neutral (it removes a component wrapper and adds a small hook).
- **Baseline support only** for any web-platform API relied on (no Newly-Available APIs in the runtime path).
- **Public/internal boundary:** all edits are under `packages/iso/src/internal/`; do not add to the public barrel.
- **Type casts are smells:** prefer reshaping types over `as`. The one structural read here (peeking a thrown value's `.then`) is avoided by exposing a typed `peek()` on `wrapPromise` (Task 1) so `HostConsumer` never catches its own suspender.
- **Pre-push CI parity (run in order, full detail in `CLAUDE.md`):** 1) build `@hono-preact/*` + `hono-preact` + `hono-preact-ui`; 2) `pnpm gen:agents-corpus`; 3) `pnpm format:check`; 4) `pnpm typecheck`; 5) `pnpm test:types`; 6) `pnpm test:coverage`; 7) `pnpm test:integration`; 8) `pnpm --filter site build`. `format:check` is the most-missed; fix with `pnpm format`.
- **Build before typecheck:** `pnpm typecheck` and `apps/site` resolve cross-package types through the published `dist/`, so rebuild the framework (`pnpm --filter @hono-preact/iso build`) after editing iso before typechecking.

## File Structure

- `packages/iso/src/internal/wrap-promise.ts` (modify) — add a typed `peek()` returning `{ status, settled }` so a consumer can subscribe to settlement without catching its own thrown suspender. Single responsibility: the suspense-resource wrapper.
- `packages/iso/src/internal/page-middleware-host.tsx` (modify) — the two behavior changes (`HostConsumer` self-heal; `SuspenseHost` boundary removal) plus the local `WrappedResult` type update.
- `packages/iso/src/internal/__tests__/wrap-promise.test.ts` (create) — unit test for `peek()`.
- `packages/iso/src/internal/__tests__/route-hold-alive.test.tsx` (create) — keeper integration test: a guarded A->B navigation holds A alive and commits B (the spike probe, promoted to a permanent regression test).
- `packages/iso/src/internal/__tests__/page-middleware-host.test.tsx` (modify) — rewrite the 3 tests that mounted the host without a `Router` ancestor; they now require one (the new contract).
- `packages/iso/src/__tests__/guarded-nav-transition.test.tsx` (create) — validation tests for the spec's open risks (VT cold-flush timing on a guarded nav; guarded redirect-during-nav; rapid double-nav stale-resume).
- `apps/site/src/pages/docs/**` and a release-note draft (modify/create) — document the new ancestor-`Router` contract for the `<Page>` escape hatch and the default-behavior change.

---

### Task 1: Add `peek()` to `wrapPromise`

**Files:**
- Modify: `packages/iso/src/internal/wrap-promise.ts`
- Test: `packages/iso/src/internal/__tests__/wrap-promise.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `wrapPromise<T>(p): { read: () => T; peek: () => { status: WrapStatus; settled: Promise<void> } }` and `export type WrapStatus = 'pending' | 'success' | 'error'`. `read()` is unchanged (throws the suspender while pending, throws the error on rejection, else returns the value). `peek().status` reports settlement state without throwing; `peek().settled` is a promise that resolves (never rejects) once the underlying promise settles either way.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/wrap-promise.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { wrapPromise } from '../wrap-promise.js';

describe('wrapPromise.peek', () => {
  it('reports pending then success without throwing', async () => {
    let resolve!: (v: number) => void;
    const w = wrapPromise<number>(new Promise((r) => (resolve = r)));
    expect(w.peek().status).toBe('pending');
    resolve(42);
    await w.peek().settled;
    expect(w.peek().status).toBe('success');
    expect(w.read()).toBe(42);
  });

  it('reports error without throwing from peek, and settled still resolves', async () => {
    const err = new Error('boom');
    const w = wrapPromise<number>(Promise.reject(err));
    await w.peek().settled; // resolves, does not reject
    expect(w.peek().status).toBe('error');
    expect(() => w.read()).toThrow(err);
  });

  it('read() throws the suspender while pending', () => {
    const w = wrapPromise<number>(new Promise(() => {}));
    let thrown: unknown;
    try {
      w.read();
    } catch (e) {
      thrown = e;
    }
    expect(typeof (thrown as { then?: unknown }).then).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/iso/src/internal/__tests__/wrap-promise.test.ts`
Expected: FAIL — `w.peek is not a function`.

- [ ] **Step 3: Implement `peek()`**

Replace the body of `packages/iso/src/internal/wrap-promise.ts` with:

```ts
export type WrapStatus = 'pending' | 'success' | 'error';

export function wrapPromise<T>(promise: Promise<T>) {
  let status: WrapStatus = 'pending';
  let result: T;
  let error: unknown;

  // `settled` resolves (never rejects) once the source settles either way, so a
  // consumer can subscribe to resume without catching its own thrown suspender.
  const settled = promise.then(
    (res) => {
      status = 'success';
      result = res;
    },
    (err) => {
      status = 'error';
      error = err;
    }
  );

  const read = () => {
    switch (status) {
      case 'pending':
        throw settled;
      case 'error':
        throw error;
      default:
        return result;
    }
  };

  const peek = () => ({ status, settled });

  return { read, peek };
}

export default wrapPromise;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/iso/src/internal/__tests__/wrap-promise.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/wrap-promise.ts packages/iso/src/internal/__tests__/wrap-promise.test.ts
git commit -m "feat(iso): add peek() to wrapPromise for suspense-resume subscription"
```

---

### Task 2: Router-as-boundary + self-healing `HostConsumer` (the core change)

**Files:**
- Modify: `packages/iso/src/internal/page-middleware-host.tsx` (import block ~lines 3-7; `WrappedResult` type ~line 84; `HostConsumer` ~lines 130-141; `SuspenseHost` doc comment + return ~lines 237-280)
- Test: `packages/iso/src/internal/__tests__/route-hold-alive.test.tsx` (create)
- Modify (keep suite green): `packages/iso/src/internal/__tests__/page-middleware-host.test.tsx` (3 tests)

**Interfaces:**
- Consumes: `wrapPromise().peek()` from Task 1; preact-iso `Router` / `Route` / `LocationProvider` / `useLocation`.
- Produces: no exported signature change. `PageMiddlewareHost` keeps its props (`use?`, `location`, `children`). New runtime contract: `PageMiddlewareHost`'s `SuspenseHost` branch now requires an ancestor preact-iso `Router` (or any component that sets `__c`) as its suspense boundary.

- [ ] **Step 1: Write the failing integration test**

Create `packages/iso/src/internal/__tests__/route-hold-alive.test.tsx`:

```tsx
// @vitest-environment happy-dom
// Regression: a guarded route-to-route navigation keeps the outgoing route
// alive while the incoming route's page-middleware chain resolves (the Router
// is the suspense boundary), and commits the incoming route once it resolves.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  render as rtlRender,
  cleanup,
  waitFor,
  fireEvent,
  findByTestId,
} from '@testing-library/preact';
import { LocationProvider, Router, Route, useLocation } from 'preact-iso';
import { h, type ComponentType } from 'preact';
import { useEffect } from 'preact/hooks';
import { defineClientMiddleware } from '../../define-middleware.js';
import { PageMiddlewareHost } from '../page-middleware-host.js';
import { defineRoutes, Routes, type ViewProps } from '../../define-routes.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../history-shim.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetHistoryShimForTesting();
  if (typeof window !== 'undefined') window.history.replaceState({}, '', '/');
});

function NavOnce({ to }: { to: string }) {
  const { route } = useLocation();
  useEffect(() => {
    const id = setTimeout(() => {
      setNavDirectionForTesting('push');
      route(to);
    }, 0);
    return () => clearTimeout(id);
  }, [route, to]);
  return null;
}

describe('guarded route hold-alive', () => {
  it('holds the outgoing route alive while the incoming chain is pending', async () => {
    const gate: { release?: () => void } = {};
    const fastMw = defineClientMiddleware(async (_c, next) => {
      await next();
    });
    const gatedMw = defineClientMiddleware(async (_c, next) => {
      await new Promise<void>((r) => {
        gate.release = r;
      });
      await next();
    });
    const A = (loc: never) =>
      h(
        PageMiddlewareHost,
        { use: [fastMw], location: loc },
        h('div', { 'data-testid': 'route-A' }, 'route-A')
      );
    const B = (loc: never) =>
      h(
        PageMiddlewareHost,
        { use: [gatedMw], location: loc },
        h('div', { 'data-testid': 'route-B' }, 'route-B')
      );
    const onLoadStart = vi.fn();

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(
        LocationProvider,
        null,
        h(NavOnce, { to: '/b' }),
        h(
          Router,
          { onLoadStart },
          h(Route, { path: '/a', component: A as never }),
          h(Route, { path: '/b', component: B as never })
        )
      )
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="route-A"]')).not.toBeNull()
    );
    // The Router fires onLoadStart ONLY when its own __c catches a thrown
    // promise, so this asserts the guarded chain suspension reached the Router.
    await waitFor(() => expect(onLoadStart).toHaveBeenCalledWith('/b'), {
      timeout: 2000,
    });
    // Outgoing route is held alive; incoming is not shown while pending.
    expect(container.querySelector('[data-testid="route-A"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="route-B"]')).toBeNull();

    gate.release?.();
  });

  it('commits the incoming guarded route after its chain resolves (real Routes)', async () => {
    const slowMw = defineClientMiddleware(async (_c, next) => {
      await Promise.resolve();
      await Promise.resolve();
      await next();
    });
    const AView: ComponentType<ViewProps> = () =>
      h('a', { href: '/b', 'data-testid': 'to-b' }, 'go b');
    const BView: ComponentType<ViewProps> = () =>
      h('div', { 'data-testid': 'route-B' }, 'route-B');

    const manifest = defineRoutes([
      { path: '/a', view: () => Promise.resolve({ default: AView }) },
      {
        path: '/b',
        view: () => Promise.resolve({ default: BView }),
        use: [slowMw],
      },
    ]);

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );

    const link = await findByTestId(container, 'to-b');
    setNavDirectionForTesting('push');
    fireEvent.click(link);

    await waitFor(
      () =>
        expect(
          container.querySelector('[data-testid="route-B"]')
        ).not.toBeNull(),
      { timeout: 3000 }
    );
    expect(container.querySelector('[data-testid="to-b"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the integration test against the unchanged code to verify it fails**

Run: `pnpm --filter @hono-preact/iso build && npx vitest run packages/iso/src/internal/__tests__/route-hold-alive.test.tsx`
Expected: FAIL. The first test fails because today's interposed `PreactIsoErrorBoundary` catches the chain promise, so the `Router` never fires `onLoadStart('/b')` (the `waitFor` on `onLoadStart` times out). This proves the test exercises the new behavior, not the old.

- [ ] **Step 3: Remove the interposed boundary in `SuspenseHost`**

In `packages/iso/src/internal/page-middleware-host.tsx`, change the import block (currently lines ~3-7) from:

```tsx
import {
  ErrorBoundary as PreactIsoErrorBoundary,
  type RouteHook,
  useLocation,
} from 'preact-iso';
```

to:

```tsx
import { type RouteHook, useLocation } from 'preact-iso';
```

Then replace `SuspenseHost`'s return (currently the `<PreactIsoErrorBoundary>` wrapper, lines ~276-280):

```tsx
  return (
    <PreactIsoErrorBoundary>
      <HostConsumer resultRef={resultRef}>{children}</HostConsumer>
    </PreactIsoErrorBoundary>
  );
}
```

with:

```tsx
  // No interposed boundary. The promise HostConsumer throws bubbles to the
  // nearest preact-iso Router, which holds [cur, prev] alive while the chain
  // resolves instead of tearing the outgoing route to blank. Outcomes
  // (render/deny/redirect) are not promises, so the Router ignores them: deny
  // throws propagate (server: to renderPage; client: unchanged from before,
  // since the old boundary had no onError and never caught outcomes either),
  // redirect/render are handled inside HostConsumer. The server prerender
  // catches suspensions globally; DeferredHost (initial load) never suspends.
  // Contract: SuspenseHost now requires an ancestor Router as its boundary.
  return <HostConsumer resultRef={resultRef}>{children}</HostConsumer>;
}
```

Also update the `SuspenseHost` doc comment (lines ~237-248) so it no longer claims an interposed boundary. Replace that comment block with:

```tsx
/**
 * Suspense strategy wrapper. Lazily dispatches the chain once per path (see the
 * lazy-ref note below) and renders the outcome through HostConsumer.
 *
 * There is no interposed boundary: the promise HostConsumer throws bubbles to
 * the nearest preact-iso Router (the suspense boundary), which keeps the
 * outgoing route mounted while the chain resolves. HostConsumer self-heals on
 * resolve (it subscribes to the chain promise) so the incoming route commits;
 * see HostConsumer. Thrown framework outcomes (render/deny) are not promises and
 * propagate past the Router to the framework RouteBoundary / renderPage.
 */
```

- [ ] **Step 4: Add the self-heal to `HostConsumer`**

In the same file, update the `WrappedResult` type (line ~84) to include `peek`, importing `WrapStatus`:

Change the `wrap-promise` import (currently `import wrapPromise from './wrap-promise.js';`) to:

```tsx
import wrapPromise, { type WrapStatus } from './wrap-promise.js';
```

Change the type (line ~84) from:

```tsx
type WrappedResult = { read: () => HostResult };
```

to:

```tsx
type WrappedResult = {
  read: () => HostResult;
  peek: () => { status: WrapStatus; settled: Promise<void> };
};
```

Then in `HostConsumer`, replace the read (lines ~135-136):

```tsx
  const wrapped = resultRef.current;
  const { outcome } = wrapped ? wrapped.read() : { outcome: undefined };
```

with:

```tsx
  const wrapped = resultRef.current;
  // Self-heal: chain suspension via wrapPromise has no self-update of its own,
  // so when the Router is the boundary (it holds [cur, prev] but does not deeply
  // re-render this suspended consumer) the incoming route would never commit.
  // Subscribe to the chain promise's settlement and re-render THIS component on
  // resolve, mirroring preact-iso `lazy`'s self-update. Re-subscribe whenever
  // the wrapped result changes (a new path produces a fresh wrapPromise).
  const [, force] = useState(0);
  const subscribedTo = useRef<WrappedResult | null>(null);
  if (wrapped && subscribedTo.current !== wrapped) {
    subscribedTo.current = wrapped;
    if (wrapped.peek().status === 'pending') {
      wrapped.peek().settled.then(() => force((n) => n + 1));
    }
  }
  const { outcome } = wrapped ? wrapped.read() : { outcome: undefined };
```

(`useState` and `useRef` are already imported on line 8; no import change needed for them.)

- [ ] **Step 5: Rebuild and run the integration test to verify it passes**

Run: `pnpm --filter @hono-preact/iso build && npx vitest run packages/iso/src/internal/__tests__/route-hold-alive.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Rewrite the 3 Router-less unit tests to satisfy the new contract**

The removal of the interposed boundary means `SuspenseHost` now needs an ancestor `Router`. Three tests in `packages/iso/src/internal/__tests__/page-middleware-host.test.tsx` mount the host under only a `LocationProvider`; wrap each in a real `Router` with a single catch-all `Route`. Add the import at the top of that file (alongside the existing `LocationProvider` import):

```tsx
import { LocationProvider, Router, Route, type RouteHook } from 'preact-iso';
```

For the test **"renders nothing while the chain is pending then renders children once resolved (post-navigation suspense path)"**, replace its `rtlRender(...)` tree with the host mounted as a route component inside a `Router` at the test's location, so the `Router` is the boundary:

```tsx
    const HostRoute = () =>
      h(
        PageMiddlewareHost,
        { use: [mw], location: loc },
        h('div', null, 'page-content')
      );
    window.history.replaceState({}, '', '/x');
    rtlRender(
      <LocationProvider>
        <Router>
          <Route path="/x" component={HostRoute as never} />
        </Router>
      </LocationProvider>
    );
```

(Keep the rest of the test: assert `page-content` is absent while pending, call `resolve()`, then `waitFor` it to appear.) Add `import { h } from 'preact';` if not already present.

For **"client redirect after a navigation uses SPA route(), not a hard navigation"**, do the same wrap (host as a `Route` component inside a `Router`), leaving the redirect middleware and the `route` spy assertions unchanged.

For **"propagates a thrown deny outcome out of the inner preact-iso ErrorBoundary to an outer boundary"**: rename it to drop the stale "inner preact-iso ErrorBoundary" wording, and put the `Router` between the deny-throwing host and the `OuterCatch` so the suspension is caught by the `Router` (not delivered to `OuterCatch` as if it were an error), while the thrown `deny` still propagates to `OuterCatch`:

```tsx
  it('propagates a thrown deny outcome to an outer boundary (Router is the suspense boundary)', async () => {
    let caught: unknown = null;
    class OuterCatch extends Component<{ children: ComponentChildren }> {
      static getDerivedStateFromError(error: unknown) {
        caught = error;
        return {};
      }
      render() {
        return caught !== null ? <div>outer-caught</div> : this.props.children;
      }
    }
    setNavDirectionForTesting('push');
    const mw = defineClientMiddleware(async () => {
      throw deny(403, 'nope');
    });
    const HostRoute = () =>
      h(
        PageMiddlewareHost,
        { use: [mw], location: loc },
        h('div', null, 'protected-content')
      );
    window.history.replaceState({}, '', '/x');
    rtlRender(
      <LocationProvider>
        <OuterCatch>
          <Router>
            <Route path="/x" component={HostRoute as never} />
          </Router>
        </OuterCatch>
      </LocationProvider>
    );
    await waitFor(() =>
      expect(screen.queryByText('outer-caught')).not.toBeNull()
    );
    expect(screen.queryByText('protected-content')).toBeNull();
    expect(isDeny(caught)).toBe(true);
  });
```

- [ ] **Step 7: Run the full iso suite to verify green**

Run: `pnpm --filter @hono-preact/iso build && npx vitest run packages/iso`
Expected: PASS. 0 failures attributable to this change (the 3 rewritten tests pass; everything else stays green). If `create-hono-preact` corpus tests fail with a missing `templates/agents/llms-full.txt`, that is an unrelated local-only gap; run `pnpm gen:agents-corpus` first.

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src/internal/page-middleware-host.tsx \
  packages/iso/src/internal/__tests__/route-hold-alive.test.tsx \
  packages/iso/src/internal/__tests__/page-middleware-host.test.tsx
git commit -m "feat(iso): hold the outgoing route alive on guarded navigation

Drop the interposed preact-iso ErrorBoundary in SuspenseHost so the chain
suspension reaches the Router (which holds [cur, prev] alive); self-heal
HostConsumer on chain resolve so the incoming route commits. SuspenseHost now
requires an ancestor Router; the 3 Router-less unit tests are rewritten to
provide one."
```

---

### Task 3: Guarantee no interactive duplicate content during a cold guarded nav

**Files:**
- Test: `packages/iso/src/__tests__/guarded-nav-transition.test.tsx` (create)

**Interfaces:**
- Consumes: the behavior from Task 2; `defineRoutes` / `Routes`.
- Produces: nothing (test-only).

Rationale: the spec's a11y concern is "two routes in the DOM at once." The prototype showed that for a cold guarded nav the incoming route has no DOM while suspended, so only the outgoing route is present (no interactive duplicate). This task pins that property so a future change cannot regress into rendering both routes' interactive content simultaneously. (Warm-overlap `inert` handling is a documented follow-up; see Task 6.)

- [ ] **Step 1: Write the test**

Create `packages/iso/src/__tests__/guarded-nav-transition.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  render as rtlRender,
  cleanup,
  waitFor,
  fireEvent,
  findByTestId,
} from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { h, type ComponentType } from 'preact';
import { defineClientMiddleware } from '../define-middleware.js';
import {
  defineRoutes,
  Routes,
  type ViewProps,
} from '../define-routes.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../internal/history-shim.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetHistoryShimForTesting();
  if (typeof window !== 'undefined') window.history.replaceState({}, '', '/');
});

describe('cold guarded nav: no interactive duplicate content', () => {
  it('shows only the outgoing route while the incoming chain is pending', async () => {
    const gate: { release?: () => void } = {};
    const gatedMw = defineClientMiddleware(async (_c, next) => {
      await new Promise<void>((r) => {
        gate.release = r;
      });
      await next();
    });
    const AView: ComponentType<ViewProps> = () =>
      h(
        'div',
        null,
        h('a', { href: '/b', 'data-testid': 'to-b' }, 'go b'),
        h('button', { 'data-testid': 'a-btn' }, 'A action')
      );
    const BView: ComponentType<ViewProps> = () =>
      h('button', { 'data-testid': 'b-btn' }, 'B action');

    const manifest = defineRoutes([
      { path: '/a', view: () => Promise.resolve({ default: AView }) },
      {
        path: '/b',
        view: () => Promise.resolve({ default: BView }),
        use: [gatedMw],
      },
    ]);

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );

    const link = await findByTestId(container, 'to-b');
    setNavDirectionForTesting('push');
    fireEvent.click(link);

    // While B's chain is gated (pending): A's interactive content is present,
    // B's is not. Exactly one route's interactive content is in the DOM.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="a-btn"]')).not.toBeNull()
    );
    expect(container.querySelector('[data-testid="b-btn"]')).toBeNull();
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(1);

    gate.release?.();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="b-btn"]')).not.toBeNull()
    );
  });
});
```

- [ ] **Step 2: Run the test (mutation-check it)**

Run: `pnpm --filter @hono-preact/iso build && npx vitest run packages/iso/src/__tests__/guarded-nav-transition.test.tsx`
Expected: PASS. Mutation check: temporarily change `expect(buttons.length).toBe(1)` to `toBe(0)` and confirm it then fails (proves the assertion is live), then restore to `toBe(1)`.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/guarded-nav-transition.test.tsx
git commit -m "test(iso): pin no-duplicate-interactive-content on cold guarded nav"
```

---

### Task 4: Validate view-transition cold-flush timing on a guarded nav (spec risk #1)

**Files:**
- Test: `packages/iso/src/__tests__/guarded-nav-transition.test.tsx` (append)

**Interfaces:**
- Consumes: `installNavTransitionScheduler`, `__resetTransitionStateForTesting` from `../internal/route-change.js`; the behavior from Task 2.
- Produces: nothing (test-only).

Rationale: this change makes the `Router` fire `onLoadStart`/`onLoadEnd` for guarded navigations, which moves `loadingDepth` (previously the interposed boundary swallowed the suspension, so a guarded nav never touched `loadingDepth`). The nav scheduler's cold-flush loop reads `loadingDepth`. Verify a guarded cold navigation still completes under the scheduler (does not deadlock or strand the transition).

- [ ] **Step 1: Write the test**

Append to `packages/iso/src/__tests__/guarded-nav-transition.test.tsx`. Add the scheduler imports at the top of the file:

```tsx
import {
  installNavTransitionScheduler,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';
```

Then add this `describe` block:

```tsx
describe('guarded cold nav under the nav-transition scheduler', () => {
  afterEach(() => {
    __resetTransitionStateForTesting();
  });

  it('completes a guarded navigation with the scheduler installed', async () => {
    installNavTransitionScheduler();

    const slowMw = defineClientMiddleware(async (_c, next) => {
      await Promise.resolve();
      await Promise.resolve();
      await next();
    });
    const AView: ComponentType<ViewProps> = () =>
      h('a', { href: '/b', 'data-testid': 'to-b' }, 'go b');
    const BView: ComponentType<ViewProps> = () =>
      h('div', { 'data-testid': 'route-B' }, 'route-B');

    const manifest = defineRoutes([
      { path: '/a', view: () => Promise.resolve({ default: AView }) },
      {
        path: '/b',
        view: () => Promise.resolve({ default: BView }),
        use: [slowMw],
      },
    ]);

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );

    const link = await findByTestId(container, 'to-b');
    setNavDirectionForTesting('push');
    fireEvent.click(link);

    await waitFor(
      () =>
        expect(
          container.querySelector('[data-testid="route-B"]')
        ).not.toBeNull(),
      { timeout: 3000 }
    );
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run packages/iso/src/__tests__/guarded-nav-transition.test.tsx`
Expected: PASS. **If it fails (the navigation strands or times out):** this is spec risk #1 materializing (guarded-nav `loadingDepth` mis-times the cold-flush). Switch to superpowers:systematic-debugging. The likely fix area is `route-change.ts`'s `runNavTransition` / `loadingDepth` coordination (its hard reset at `scheduleRender` already guards leaked depth); do not weaken the reset. Do not mark this task complete until the test passes.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/guarded-nav-transition.test.tsx
git commit -m "test(iso): guarded cold nav completes under the nav-transition scheduler"
```

---

### Task 5: Validate guarded redirect-during-nav and rapid double-nav (spec risks #4 and #3)

**Files:**
- Test: `packages/iso/src/__tests__/guarded-nav-transition.test.tsx` (append)

**Interfaces:**
- Consumes: `redirect` from `../outcomes.js`; the behavior from Task 2.
- Produces: nothing (test-only).

- [ ] **Step 1: Write the redirect-during-nav test**

Append to `packages/iso/src/__tests__/guarded-nav-transition.test.tsx`. Add `import { redirect } from '../outcomes.js';` at the top. Then:

```tsx
describe('guarded nav edge cases', () => {
  it('a guarded chain that redirects during nav lands on the redirect target', async () => {
    const redirectMw = defineClientMiddleware(async () => {
      await Promise.resolve();
      throw redirect('/c');
    });
    const passMw = defineClientMiddleware(async (_c, next) => {
      await next();
    });
    const AView: ComponentType<ViewProps> = () =>
      h('a', { href: '/b', 'data-testid': 'to-b' }, 'go b');
    const BView: ComponentType<ViewProps> = () =>
      h('div', { 'data-testid': 'route-B' }, 'route-B');
    const CView: ComponentType<ViewProps> = () =>
      h('div', { 'data-testid': 'route-C' }, 'route-C');

    const manifest = defineRoutes([
      { path: '/a', view: () => Promise.resolve({ default: AView }) },
      {
        path: '/b',
        view: () => Promise.resolve({ default: BView }),
        use: [redirectMw],
      },
      {
        path: '/c',
        view: () => Promise.resolve({ default: CView }),
        use: [passMw],
      },
    ]);

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );
    const link = await findByTestId(container, 'to-b');
    setNavDirectionForTesting('push');
    fireEvent.click(link);

    await waitFor(
      () =>
        expect(
          container.querySelector('[data-testid="route-C"]')
        ).not.toBeNull(),
      { timeout: 3000 }
    );
    expect(container.querySelector('[data-testid="route-B"]')).toBeNull();
  });

  it('rapid double-nav lands on the final target, not a superseded one', async () => {
    const mk = (id: string) => {
      const mw = defineClientMiddleware(async (_c, next) => {
        await Promise.resolve();
        await Promise.resolve();
        await next();
      });
      const View: ComponentType<ViewProps> = () =>
        h(
          'div',
          null,
          h('div', { 'data-testid': `route-${id}` }, `route-${id}`),
          h('a', { href: '/c', 'data-testid': 'to-c' }, 'c')
        );
      return { mw, View };
    };
    const a = mk('A');
    const b = mk('B');
    const c = mk('C');

    const manifest = defineRoutes([
      { path: '/a', view: () => Promise.resolve({ default: a.View }), use: [a.mw] },
      { path: '/b', view: () => Promise.resolve({ default: b.View }), use: [b.mw] },
      { path: '/c', view: () => Promise.resolve({ default: c.View }), use: [c.mw] },
    ]);

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="route-A"]')).not.toBeNull()
    );

    // Navigate A -> B, then immediately B -> C before B settles.
    setNavDirectionForTesting('push');
    window.history.pushState(null, '', '/b');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.history.pushState(null, '', '/c');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitFor(
      () =>
        expect(
          container.querySelector('[data-testid="route-C"]')
        ).not.toBeNull(),
      { timeout: 3000 }
    );
    expect(container.querySelector('[data-testid="route-B"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @hono-preact/iso build && npx vitest run packages/iso/src/__tests__/guarded-nav-transition.test.tsx`
Expected: PASS. **If the rapid double-nav test fails (lands on B, or shows both B and C):** this is spec risk #3 (stale resume). Switch to superpowers:systematic-debugging. The self-heal subscription in `HostConsumer` is keyed to re-subscribe per `wrapped` identity (a new path makes a fresh `wrapPromise`), and preact-iso's `Router` has a monotonic `count` guard against stale resumes; investigate whether a superseded `wrapPromise.settled` callback is still calling `force()` after the path changed, and gate the `force()` on the subscription still being current (compare `subscribedTo.current === wrapped` inside the `.then`). Do not mark complete until green.

If the redirect-during-nav navigation behaves unexpectedly (note: the redirect-target `pushState`+`popstate` form in the double-nav test mirrors how the history shim observes navigations; if `route()`-based nav is needed instead, use a `useLocation().route` call from a child component as in `route-hold-alive.test.tsx`'s `NavOnce`), adjust the harness, not the assertion.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/guarded-nav-transition.test.tsx
git commit -m "test(iso): guarded redirect-during-nav and rapid double-nav resolution"
```

---

### Task 6: Docs, release note, and the new contract

**Files:**
- Modify: `apps/site/src/pages/docs/**` (the page that documents page middleware / the `<Page>` escape hatch; find with the grep in Step 1)
- Create: `docs/superpowers/specs/2026-06-27-errorboundary-loading-release-note.md` (release-note draft)

**Interfaces:**
- Consumes: nothing.
- Produces: documentation only.

- [ ] **Step 1: Locate the docs to update**

Run: `rg -l "PageMiddlewareHost|page middleware|errorFallback|<Page" apps/site/src/pages/docs`
Read the matched pages. The new public-facing facts: (a) on a guarded navigation the previous route now stays visible until the next route's middleware resolves (no blank flash); (b) for hand-composed pipelines using the `<Page>` escape hatch, `PageMiddlewareHost` must have an ancestor `Router` (the default `Routes` component provides it).

- [ ] **Step 2: Update the docs page(s)**

Edit the relevant docs page to describe the current behavior (describe what *is*, not what changed; no "formerly" breadcrumbs, per repo docs style). Keep `CodeTabs` CSS/Tailwind flavors at feature parity if you touch any example. Do not add a public API symbol; if you do not add/rename/remove a public symbol, the `keep-docs-fresh` hook will not require more.

- [ ] **Step 3: Write the release-note draft**

Create `docs/superpowers/specs/2026-06-27-errorboundary-loading-release-note.md`:

```markdown
# Release note draft: hold-alive guarded navigation

**Behavior change (not a breaking API change).** On a client navigation between
routes that have page-layer middleware (`use`), the previous route now stays
visible while the next route's middleware chain resolves, instead of blanking
out and showing nothing. This makes guarded navigations match the existing
behavior for plain lazy routes.

- No public API changed; no migration needed.
- The page-middleware host now relies on the surrounding `Router` (provided by
  the `Routes` component) as its suspense boundary. Apps that hand-compose the
  render pipeline with the `<Page>` escape hatch must ensure a `Router` ancestor
  (the default `Routes` already does).

Include this in the next minor release notes.
```

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs docs/superpowers/specs/2026-06-27-errorboundary-loading-release-note.md
git commit -m "docs: hold-alive guarded navigation behavior + release-note draft"
```

---

### Task 7: Full CI-parity gate

**Files:** none (verification only).

- [ ] **Step 1: Run the eight CI-parity checks in order**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all pass. If `format:check` fails, run `pnpm format`, re-run `format:check`, and commit the formatting. Read the `client-size` expectation: this change removes a component wrapper and adds a small hook + one method on `wrapPromise`; the per-feature framework size delta should be approximately neutral. If the gzip delta is non-trivial and positive, investigate before pushing.

- [ ] **Step 2: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore: formatting"
```

(Skip if there is nothing to commit.)

- [ ] **Step 3: Push**

```bash
git push
```

---

## Self-Review

**Spec coverage:**
- Spec "Change 1 — remove the interposed boundary" -> Task 2 Step 3. Covered.
- Spec "Change 2 — self-heal HostConsumer" (with the `wrapPromise.peek()` reshape it recommends over try/catch) -> Task 1 + Task 2 Step 4. Covered.
- Spec "boundary return shape + visibility mechanism" (Router `[cur, prev]`, no `display:none`) -> realized by Task 2 (no new component); asserted by Task 3. Covered.
- Spec "Changes enumerated": `page-middleware-host.tsx` -> Task 2; `wrap-promise.ts` reshape -> Task 1; `route-change.ts` "no change but validate timing" -> Task 4; hydration path "no change" -> not touched (correct); rewrite 3 unit tests -> Task 2 Step 6; `<Page>` escape-hatch contract docs -> Task 6. Covered.
- Spec "open risks": #1 VT timing -> Task 4; #3 stale resume -> Task 5; #4 redirect-in-effect -> Task 5; #5 default-behavior change release note -> Task 6. **#2 (inert overlap correctness) is deliberately descoped** from this plan: the prototype showed the cold-nav case has no incoming DOM during the hold (no interactive duplicate to `inert`), and a reliable "stale route" signal for the warm-overlap case is non-trivial (naive `useRoute().path !== useLocation().path` breaks for param routes). Task 3 pins the no-duplicate-interactive-content guarantee that actually matters; warm-overlap `inert` is left as a documented follow-up. This is called out here and to the user, not silently dropped.
- Spec "public loading-indicator surface (deferred)" -> not implemented (correctly deferred per the spec). The plan notes `loadingDepth` now moves on guarded navs (Task 4 rationale), which is the future signal source.

**Placeholder scan:** No "TBD"/"handle edge cases"/"write tests for the above" left; every code step shows the code; every test step shows the test and the expected result. The two "if it fails, debug" branches (Tasks 4 and 5) are contingencies for spec-flagged risks, each with a concrete starting hypothesis, not placeholders for required work.

**Type consistency:** `wrapPromise` returns `{ read, peek }` with `peek(): { status: WrapStatus; settled: Promise<void> }` (Task 1), and the `WrappedResult` type in `page-middleware-host.tsx` is updated to match, importing `WrapStatus` (Task 2 Step 4). `force` / `subscribedTo` names are consistent within `HostConsumer`. The integration test's helper names (`NavOnce`, `gate`) are self-contained per file.
