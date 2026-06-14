# PR #96 guard-layer cleanups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete two pieces of vestigial wiring left by PR #96: the now-unused `Page.use` prop + its always-on empty `PageMiddlewareHost`, and the single-consumer generic resolver core `makeRouteModuleResolvers`.

**Architecture:** Cleanup 1 makes `Page` render `RouteBoundary > Wrapper > children` with no host (the route builder is the sole host creator; `RouteBoundary`'s existing `<Suspense>` backstops any suspension). Cleanup 2 inlines the build-lifecycle + `byPath` of `makeRouteModuleResolvers` directly into its sole caller `makePageActionResolvers` and deletes the generic. Both are pure refactors guarded by existing tests; no behavior change.

**Tech Stack:** TypeScript, Preact, preact-iso, Hono, Vitest, happy-dom, `@testing-library/preact`. Spec: `docs/superpowers/specs/2026-06-13-pr96-guard-cleanups-design.md`.

---

## Note on TDD shape

Both cleanups are refactors/removals, so the tests are *characterization/parity oracles*: they pass BEFORE and AFTER the change, and the change must not break them. Where a step adds a test, it is expected to PASS immediately against the current code (it locks behavior the refactor must preserve), then still pass after the refactor.

## File Structure

- `packages/iso/src/page.tsx` — drop `use` + `location` from `PageProps`; remove the `PageMiddlewareHost` (and its import) and the unused `PageUse` import; `Page` becomes `RouteBoundary > Wrapper > children`.
- `packages/iso/src/define-page.tsx` — stop forwarding `location` to `<Page>` (it had no other consumer).
- `packages/iso/src/__tests__/page.test.tsx` — drop the now-invalid `location={loc}` props; add a resolving-loader parity test.
- `packages/server/src/page-action-resolvers.ts` — inline the build lifecycle + `byPath` (specialized); import `findBestPattern` directly.
- `packages/server/src/route-module-resolvers.ts` — DELETE.
- `packages/server/src/__tests__/page-action-resolvers.test.ts` — add the ported lifecycle assertions.
- `packages/server/src/__tests__/route-module-resolvers.test.ts` — DELETE.

---

### Task 1: Cleanup 1 — remove `Page.use` and the empty host

**Files:**
- Modify: `packages/iso/src/page.tsx`
- Modify: `packages/iso/src/define-page.tsx`
- Modify: `packages/iso/src/__tests__/page.test.tsx`

- [ ] **Step 1: Add a resolving-loader parity test to `page.test.tsx`**

Add this `describe` block (it renders loader-backed content through `<Page>` with no `use`/host, and must pass both before and after the change; it proves loader content still renders through `Page`). Insert after the existing `Page errorFallback` block:

```tsx
describe('Page renders loader content without a middleware host', () => {
  it('renders a resolving loader through Page', async () => {
    env.current = 'server';

    const ok = defineLoader<{ msg: string }>(async () => ({ msg: 'loaded' }), {
      __moduleKey: 'test/page-content',
    });

    const locMap = new Map();
    locMap.set('test/page-content', loc);

    function PageContent() {
      const { msg } = ok.useData();
      return <p data-testid="content">{msg}</p>;
    }

    render(
      <HonoRequestContext.Provider value={{ context: fakeC }}>
        <RouteLocationsContext.Provider value={locMap}>
          <LocationProvider>
            <Page>
              <ok.Boundary
                fallback={<div data-testid="loading">Loading...</div>}
              >
                <PageContent />
              </ok.Boundary>
            </Page>
          </LocationProvider>
        </RouteLocationsContext.Provider>
      </HonoRequestContext.Provider>
    );

    const el = await screen.findByTestId('content');
    expect(el).toHaveTextContent('loaded');
  });
});
```

Note: this uses `<Page>` with NO `location` prop (the change below removes it). Also update the two existing `<Page location={loc}>` usages (the `renders children inside a default Wrapper` test and the `renders errorFallback...` test) to drop `location={loc}` -> `<Page>` and `<Page errorFallback={...}>` respectively. The loaders in those tests resolve their location through `RouteLocationsContext` (the `locMap`), not through `Page`'s prop, so dropping it changes nothing.

- [ ] **Step 2: Run the test file to confirm it passes against current code**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/page.test.tsx`
Expected: PASS (3 tests). The new test passing against the *current* `Page` (which still has the host) confirms it is a true parity oracle. (`<Page>` without `location` already works at runtime since iso tests are not typechecked.)

- [ ] **Step 3: Rewrite `page.tsx` to drop `use`, `location`, and the host**

Replace the entire file with:

```tsx
import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { useId } from 'preact/hooks';
import { RouteBoundary } from './internal/route-boundary.js';

export type WrapperProps = {
  id: string;
  'data-loader': string;
  children: ComponentChildren;
};

const DefaultWrapper: FunctionComponent<WrapperProps> = (props) => (
  <section {...props} />
);

export type PageProps = {
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  Wrapper?: ComponentType<WrapperProps>;
  children: ComponentChildren;
};

export function Page({ errorFallback, Wrapper, children }: PageProps): JSX.Element {
  const id = useId();
  const W = Wrapper ?? DefaultWrapper;
  return (
    <RouteBoundary errorFallback={errorFallback}>
      <W id={id} data-loader="null">
        {children}
      </W>
    </RouteBoundary>
  );
}
```

(Removed: the `RouteHook` import, the `PageUse` import, the `PageMiddlewareHost` import, the `use` and `location` fields of `PageProps`, and the `<PageMiddlewareHost>` wrapper. `RouteBoundary`'s `<Suspense fallback={undefined}>` is the suspension backstop; loaders use their own `.Boundary`.)

- [ ] **Step 4: Stop forwarding `location` to `<Page>` in `define-page.tsx`**

`definePage`'s inner `PageRoute` passed `location` to `<Page>` only for the host. Drop it. Replace the `definePage` function body's `PageRoute` so it no longer destructures/forwards `location`:

```tsx
export function definePage(
  Component: ComponentType,
  bindings?: PageBindings
): FunctionComponent<RouteHook> {
  const PageRoute: FunctionComponent<RouteHook> = () => (
    <Page Wrapper={bindings?.Wrapper} errorFallback={bindings?.errorFallback}>
      <Component />
    </Page>
  );
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return PageRoute;
}
```

(`PageRoute` keeps its `FunctionComponent<RouteHook>` type so the route layer still types it correctly; it simply ignores the route props now. `<Component />` already received no props before this change, so view location access via hooks is unaffected. The `RouteHook` import stays; the `Page`/`PageBindings` imports stay.)

- [ ] **Step 5: Run the affected iso tests + build + typecheck**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/page.test.tsx src/__tests__/define-page.test.tsx src/__tests__/page-guards-render.test.tsx`
Expected: PASS (loader content renders through `Page`; guards still gate via the route builder; definePage still composes `Page`).

Run: `pnpm --filter @hono-preact/iso exec vitest run`
Expected: PASS (full iso suite; loader/render tests confirm suspension still works with no page host).

Run: `pnpm --filter @hono-preact/iso build`
Expected: clean tsc (confirms `page.tsx`/`define-page.tsx` compile with `use`/`location` gone).

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck`
Expected: PASS (confirms no consumer, including apps/site, passes `use`/`location` to `Page`).

- [ ] **Step 6: Commit**

```bash
pnpm format
git add packages/iso/src/page.tsx packages/iso/src/define-page.tsx packages/iso/src/__tests__/page.test.tsx
git commit -m "refactor(iso): drop Page.use and the empty page-middleware host

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Cleanup 2 — inline the resolver core into `makePageActionResolvers`

**Files:**
- Modify: `packages/server/src/page-action-resolvers.ts`
- Delete: `packages/server/src/route-module-resolvers.ts`
- Modify: `packages/server/src/__tests__/page-action-resolvers.test.ts`
- Delete: `packages/server/src/__tests__/route-module-resolvers.test.ts`

- [ ] **Step 1: Port the build-lifecycle assertions into `page-action-resolvers.test.ts`**

Add these tests to the `describe('makePageActionResolvers', ...)` block in `page-action-resolvers.test.ts`. They exercise the lifecycle behaviors currently covered only by `route-module-resolvers.test.ts`, but through real `ServerModule` shapes. They must PASS against the current (generic-backed) resolver:

```ts
it('loads each distinct thunk exactly once per build (server + ancestor reuse)', async () => {
  const calls = { n: 0 };
  const layout = async () => {
    calls.n++;
    return { __moduleKey: 'l', serverActions: { a: async () => 'a' } };
  };
  const leaf = async () => {
    calls.n++;
    return { __moduleKey: 'p', serverActions: { b: async () => 'b' } };
  };
  const r: ServerRoute[] = [
    { path: '/g', server: layout, ancestors: [] } as unknown as ServerRoute,
    {
      path: '/g/leaf',
      server: leaf,
      ancestors: [layout],
    } as unknown as ServerRoute,
  ];
  const { byPath } = makePageActionResolvers(r, { dev: false });
  const map = await byPath('/g/leaf');
  expect([...map.keys()].sort()).toEqual(['a', 'b']);
  expect(calls.n).toBe(2); // layout loaded once despite being self + ancestor
});

it('caches the build across calls when dev is false', async () => {
  let calls = 0;
  const thunk = async () => {
    calls++;
    return { __moduleKey: 'p', serverActions: { x: async () => 'ok' } };
  };
  const r: ServerRoute[] = [
    { path: '/a', server: thunk, ancestors: [] } as unknown as ServerRoute,
  ];
  const { byPath } = makePageActionResolvers(r, { dev: false });
  await byPath('/a');
  await byPath('/a');
  expect(calls).toBe(1);
});

it('does not cache a failed build: the next call retries and can succeed', async () => {
  let failOnce = true;
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (failOnce) {
      failOnce = false;
      throw new Error('transient import error');
    }
    return { __moduleKey: 'p', serverActions: { x: async () => 'ok' } };
  };
  const r: ServerRoute[] = [
    { path: '/a', server: flaky, ancestors: [] } as unknown as ServerRoute,
  ];
  const { byPath } = makePageActionResolvers(r, { dev: false });
  await expect(byPath('/a')).rejects.toThrow('transient import error');
  const map = await byPath('/a');
  expect([...map.keys()]).toEqual(['x']);
  expect(calls).toBe(2);
});

it('byPath resolves through findBestPattern and returns an empty map on no match', async () => {
  const r: ServerRoute[] = [
    {
      path: '/p/:id',
      server: async () => ({
        __moduleKey: 'param',
        serverActions: { p: async () => 'param' },
      }),
      ancestors: [],
    } as unknown as ServerRoute,
    {
      path: '/p/new',
      server: async () => ({
        __moduleKey: 'lit',
        serverActions: { l: async () => 'lit' },
      }),
      ancestors: [],
    } as unknown as ServerRoute,
  ];
  const { byPath } = makePageActionResolvers(r, { dev: false });
  expect((await byPath('/p/new')).get('l')?.moduleKey).toBe('lit'); // literal beats param
  expect((await byPath('/p/42')).get('p')?.moduleKey).toBe('param');
  expect([...(await byPath('/nope')).keys()]).toEqual([]); // empty map, no match
});

it('concurrent first calls share one in-flight build', async () => {
  let calls = 0;
  let release!: (mod: unknown) => void;
  const gated = () => {
    calls++;
    return new Promise<unknown>((resolve) => {
      release = resolve;
    });
  };
  const r: ServerRoute[] = [
    { path: '/a', server: gated, ancestors: [] } as unknown as ServerRoute,
  ];
  const { byPath } = makePageActionResolvers(r, { dev: false });
  const first = byPath('/a');
  const second = byPath('/a');
  await Promise.resolve();
  release({ __moduleKey: 'p', serverActions: { x: async () => 'ok' } });
  expect([...(await first).keys()]).toEqual(['x']);
  expect([...(await second).keys()]).toEqual(['x']);
  expect(calls).toBe(1);
});
```

- [ ] **Step 2: Run the action-resolver tests to confirm the new ones pass against the current code**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/page-action-resolvers.test.ts`
Expected: PASS (the 4 existing + 5 new = 9 tests). This proves the ported assertions hold for the current generic-backed implementation, so they are a valid oracle for the inline.

- [ ] **Step 3: Inline the core into `page-action-resolvers.ts`**

Replace the file with the self-contained version (the `ActionEntry`/`ServerModule`/`extractActions` parts are unchanged; only the resolver body inlines the build lifecycle):

```ts
import type { ServerRoute } from '@hono-preact/iso';
import { findBestPattern } from './route-pattern.js';

type ActionFn = (ctx: unknown, payload: unknown) => Promise<unknown>;

export type ActionEntry = {
  fn: ActionFn;
  use: ReadonlyArray<unknown>;
  timeoutMs?: number | false;
  moduleKey: string;
};

type ServerModule = {
  __moduleKey?: unknown;
  serverActions?: Record<string, unknown>;
};

function extractActions(
  mod: ServerModule
): Array<{ name: string; entry: ActionEntry }> {
  const moduleKey = mod.__moduleKey;
  if (typeof moduleKey !== 'string' || !mod.serverActions) return [];
  const out: Array<{ name: string; entry: ActionEntry }> = [];
  for (const [name, val] of Object.entries(mod.serverActions)) {
    if (typeof val !== 'function') continue;
    // `defineAction` attaches `use` and `timeoutMs` as non-enumerable
    // properties on the function (see packages/iso/src/action.ts). Read
    // them here as the single deserialization boundary; the handler reads
    // `entry.fn`, `entry.use`, `entry.timeoutMs` through the typed
    // ActionEntry shape from this point on.
    const metadata = val as {
      use?: ReadonlyArray<unknown>;
      timeoutMs?: number | false;
    };
    out.push({
      name,
      entry: {
        fn: val as ActionFn,
        use: metadata.use ?? [],
        timeoutMs: metadata.timeoutMs,
        moduleKey,
      },
    });
  }
  return out;
}

/**
 * Build action resolvers keyed by route path and by module key. Each
 * ServerRoute contributes its own serverActions and its ancestors' serverActions
 * to the merged map for that path. Ancestor entries are written first so that
 * a page-level action shadows a same-named layout action when names collide.
 *
 * Owns the build lifecycle directly: each distinct `.server.*` thunk is loaded
 * exactly once per build (a thunk may appear as `server` on one route and as an
 * `ancestor` on descendants); the built result is cached for the process
 * lifetime; a failed build is not cached (the next call retries); when `dev` is
 * true the cache is bypassed so editing a `.server.*` file takes effect without
 * a restart. `byPath` resolves a concrete URL to the most specific matching
 * pattern via `findBestPattern`.
 *
 * NOTE: framework-private. Intended consumer is the generated server entry and
 * pageActionHandler.
 */
export function makePageActionResolvers(
  serverRoutes: ReadonlyArray<ServerRoute>,
  options: { dev?: boolean } = {}
): {
  byPath: (path: string) => Promise<Map<string, ActionEntry>>;
  byModuleKey: (
    moduleKey: string,
    actionName: string
  ) => Promise<ActionEntry | undefined>;
} {
  const dev = options.dev ?? false;

  type Built = {
    byPathMap: Map<string, Map<string, ActionEntry>>;
    byModuleKeyMap: Map<string, Map<string, ActionEntry>>;
  };
  let buildPromise: Promise<Built> | null = null;

  const build = async (): Promise<Built> => {
    const thunkCache = new Map<
      () => Promise<unknown>,
      Promise<ServerModule>
    >();
    const load = (thunk: () => Promise<unknown>): Promise<ServerModule> => {
      let p = thunkCache.get(thunk);
      if (!p) {
        // Structural read of a user-defined module's exports (a sanctioned
        // cast boundary); extractActions narrows the fields it reads.
        p = thunk().then((mod) => mod as ServerModule);
        thunkCache.set(thunk, p);
      }
      return p;
    };

    const byPathMap = new Map<string, Map<string, ActionEntry>>();
    const byModuleKeyMap = new Map<string, Map<string, ActionEntry>>();

    await Promise.all(
      serverRoutes.map(async (route) => {
        const ancestorMods = await Promise.all(route.ancestors.map(load));
        const selfMod = await load(route.server);
        const merged = new Map<string, ActionEntry>();
        // Write ancestors first (outer -> inner), then self. Later writes
        // shadow earlier ones, so a page-level action wins over a layout
        // action of the same name.
        for (const mod of [...ancestorMods, selfMod]) {
          for (const { name, entry } of extractActions(mod)) {
            merged.set(name, entry);
            let m = byModuleKeyMap.get(entry.moduleKey);
            if (!m) {
              m = new Map();
              byModuleKeyMap.set(entry.moduleKey, m);
            }
            m.set(name, entry);
          }
        }
        byPathMap.set(route.path, merged);
      })
    );

    return { byPathMap, byModuleKeyMap };
  };

  const built = (): Promise<Built> => {
    if (dev) return build();
    if (buildPromise) return buildPromise;
    buildPromise = build().catch((err) => {
      buildPromise = null;
      throw err;
    });
    return buildPromise;
  };

  return {
    async byPath(path: string): Promise<Map<string, ActionEntry>> {
      const { byPathMap } = await built();
      const pattern = findBestPattern(byPathMap.keys(), path);
      return pattern === null
        ? new Map<string, ActionEntry>()
        : (byPathMap.get(pattern) ?? new Map<string, ActionEntry>());
    },
    async byModuleKey(
      moduleKey: string,
      actionName: string
    ): Promise<ActionEntry | undefined> {
      const { byModuleKeyMap } = await built();
      return byModuleKeyMap.get(moduleKey)?.get(actionName);
    },
  };
}
```

- [ ] **Step 4: Delete the now-orphaned generic core and its test**

```bash
git rm packages/server/src/route-module-resolvers.ts packages/server/src/__tests__/route-module-resolvers.test.ts
```

Then grep to confirm nothing else imports it:

Run: `rg -n "route-module-resolvers|makeRouteModuleResolvers" packages/`
Expected: NO results (the only importer was `page-action-resolvers.ts`, now inlined; `internal-runtime.ts` never re-exported it).

- [ ] **Step 5: Run the server suite + cross-package build**

Run: `pnpm --filter @hono-preact/server exec vitest run`
Expected: PASS (page-action-resolvers 9 tests + the action-handler, middleware-chain, boundary, and integration tests that use `makePageActionResolvers` still pass; behavior is identical).

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: clean (confirms the deletion left no dangling import across packages).

- [ ] **Step 6: Commit**

```bash
pnpm format
git add packages/server/src/page-action-resolvers.ts packages/server/src/__tests__/page-action-resolvers.test.ts
git commit -m "refactor(server): inline the single-consumer resolver core into makePageActionResolvers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(The `git rm` from Step 4 is already staged; it lands in this commit.)

---

### Task 3: Full pre-push CI gate

**Files:** none (verification only).

- [ ] **Step 1: Run the six-step pre-push CI mirror (per CLAUDE.md), IN ORDER**

```
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all PASS. Notes:
- If `format:check` fails, run `pnpm format`, re-run `format:check` to confirm clean, and commit the formatted files.
- `test:integration` includes a network-dependent scaffold test that can flake offline; a demo-app auth/render failure is a REAL failure to investigate, a scaffold/template network failure is an environmental flake. Re-run a suspected flake in isolation and report the determination.
- A `server-loader-validation-plugin.test.ts` worker-start timeout under load is a known environmental flake; re-run that file in isolation to confirm it passes alone. A genuine assertion failure is NOT a flake.

- [ ] **Step 2: Commit any format-only fixes**

```bash
git add -A
git commit -m "chore: format for PR #96 guard-layer cleanups

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Skip this commit if `format:check` was already clean and nothing else changed.)

---

## Self-Review

**Spec coverage:**
- Cleanup 1: remove `Page.use` + empty host, route builder sole host creator, suspension via `RouteBoundary` — Task 1. ✓
- Cleanup 1: breaking `Page` prop removal verified by iso build + typecheck — Task 1 Step 5. ✓ (Also drops the now-dead `location` prop per the spec's new `Page` body, which has no `location`.)
- Cleanup 2: inline lifecycle + `byPath` into `makePageActionResolvers`, delete `route-module-resolvers.ts`, `route-pattern.ts` stays — Task 2. ✓
- Cleanup 2: fold lifecycle test assertions (load-once, dev cache + rebuild, evict-on-failure, best-pattern, concurrent-share) into the action-resolver test, delete the old test — Task 2 Steps 1, 4. ✓ (dev-rebuild already existed in `page-action-resolvers.test.ts`.)
- Full pre-push CI — Task 3. ✓
- Non-goals (no behavior change; `PageMiddlewareHost.fallback` left as-is) — respected; no task touches guarded-page/loader/action behavior or the host's `fallback`.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows assertions + the exact command + expected outcome.

**Type/name consistency:** `Built`, `byPathMap`, `byModuleKeyMap`, `ServerModule`, `ActionEntry`, `extractActions`, `findBestPattern`, `makePageActionResolvers` are used consistently across Task 2's code and tests. `PageProps`/`Page`/`definePage`/`PageRoute` consistent across Task 1. The inlined `byPath` returns an empty `Map` on no match (matching the prior `?? new Map()` wrapper), and the ported test asserts the empty-map (not `undefined`) behavior — consistent.
