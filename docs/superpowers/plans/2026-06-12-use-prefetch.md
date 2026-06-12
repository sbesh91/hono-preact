# Prefetch on intent: usePrefetch (Section C #3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `usePrefetch(href, refs)`, which resolves `href` to its route params from the route manifest and returns a trigger to prefetch the named loader(s); migrate `IssueRow` off its hand-copied route pattern and manual prefetch wiring.

**Architecture:** A new internal `RouteManifestContext` carries the flat route list (`routes.flat`); `Routes` provides it. `usePrefetch` reads it, matches `href` against the patterns (cast-free via `matchPath`), and calls the existing `prefetch(ref, { location })`. Returns a bare `() => void` the consumer binds to any event. No global singleton; `prefetch()` is unchanged.

**Tech Stack:** TypeScript, preact, preact-iso, Vitest + `@testing-library/preact` (happy-dom).

**Source spec:** `docs/superpowers/specs/2026-06-12-use-prefetch-design.md`.

**Conventions:**
- Run a single test file with `pnpm exec vitest run <path>` from the repo root.
- No em-dashes in code/comments/commit messages.
- Run `pnpm format` before the pre-push step (`.mdx` is checked too).
- Commit after each task; messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

## File map

- **Create** `packages/iso/src/internal/route-manifest.ts`: the `RouteManifestContext`.
- **Create** `packages/iso/src/use-prefetch.ts`: the hook.
- **Create** `packages/iso/src/__tests__/use-prefetch.test.tsx`: hook tests.
- **Modify** `packages/iso/src/index.ts`: export `usePrefetch`.
- **Modify** `packages/iso/src/define-routes.tsx`: `Routes` provides the context.
- **Modify** `packages/iso/src/__tests__/define-routes.test.tsx`: context-provider test.
- **Modify** `apps/site/src/components/demo/IssueRow.tsx`: use `usePrefetch`.
- **Modify** `apps/site/src/pages/docs/link-prefetch.mdx`: a "Prefetch on intent" note.

---

## Task 1: The `usePrefetch` hook + manifest context

**Files:**
- Create: `packages/iso/src/internal/route-manifest.ts`
- Create: `packages/iso/src/use-prefetch.ts`
- Create: `packages/iso/src/__tests__/use-prefetch.test.tsx`
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Write the hook tests.** Create `packages/iso/src/__tests__/use-prefetch.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { RouteManifestContext } from '../internal/route-manifest.js';
import { usePrefetch } from '../use-prefetch.js';
import { defineLoader } from '../define-loader.js';
import type { FlatRoute } from '../define-routes.js';
import type { LoaderRef } from '../define-loader.js';

const prefetchSpy = vi.fn();
vi.mock('../prefetch.js', () => ({
  prefetch: (...args: unknown[]) => prefetchSpy(...args),
}));

beforeEach(() => prefetchSpy.mockClear());
afterEach(cleanup);

const FLAT: ReadonlyArray<FlatRoute> = [
  {
    path: '/demo/projects/:projectId/issues/:issueId',
    component: () => null,
    key: 'k1',
  },
];

const ref = defineLoader(async () => ({ ok: true }), { __moduleKey: 'pf' });

function Harness({
  href,
  refs,
}: {
  href: string;
  refs: LoaderRef<unknown> | ReadonlyArray<LoaderRef<unknown>>;
}) {
  const prefetch = usePrefetch(href, refs);
  return <button onClick={prefetch}>go</button>;
}

function renderIn(href: string, refs: LoaderRef<unknown>) {
  return render(
    <RouteManifestContext.Provider value={FLAT}>
      <Harness href={href} refs={refs} />
    </RouteManifestContext.Provider>
  );
}

describe('usePrefetch', () => {
  it('resolves params from the manifest and prefetches the loader', () => {
    const { getByRole } = renderIn('/demo/projects/p1/issues/i1', ref);
    fireEvent.click(getByRole('button'));
    expect(prefetchSpy).toHaveBeenCalledWith(ref, {
      location: {
        path: '/demo/projects/p1/issues/i1',
        pathParams: { projectId: 'p1', issueId: 'i1' },
        searchParams: {},
      },
    });
  });

  it('is a no-op when no manifest route matches', () => {
    const { getByRole } = renderIn('/nope', ref);
    fireEvent.click(getByRole('button'));
    expect(prefetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** (cannot resolve `../internal/route-manifest.js` / `../use-prefetch.js`). `pnpm exec vitest run packages/iso/src/__tests__/use-prefetch.test.tsx`

- [ ] **Step 3: Create the context.** Create `packages/iso/src/internal/route-manifest.ts`:

```ts
import { createContext } from 'preact';
import type { FlatRoute } from '../define-routes.js';

/**
 * The flat route list (patterns) of the active app, provided by `Routes`.
 * `usePrefetch` reads it to resolve an href to its route params. Internal.
 */
export const RouteManifestContext = createContext<ReadonlyArray<FlatRoute>>([]);
```

- [ ] **Step 4: Create the hook.** Create `packages/iso/src/use-prefetch.ts`:

```ts
import { useCallback, useContext } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import type { LoaderRef } from './define-loader.js';
import { prefetch } from './prefetch.js';
import { matchPath } from './route-active.js';
import { RouteManifestContext } from './internal/route-manifest.js';

function parseHref(href: string): {
  path: string;
  searchParams: Record<string, string>;
} {
  const parsed = new URL(href, 'http://_');
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const searchParams: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    searchParams[key] = value;
  });
  return { path, searchParams };
}

// Specificity for picking among overlapping matches (a `:param`/`*` catch-all
// can match the same href as a literal leaf). Literal segments rank highest,
// then `:param`, then `*`; the most specific route is the one the router lands
// on, so its params are the ones the target loader reads.
function specificity(pattern: string): number {
  let score = 0;
  for (const seg of pattern.split('/')) {
    if (seg === '') continue;
    if (seg.includes('*')) score += 1;
    else if (seg.startsWith(':')) score += 2;
    else score += 3;
  }
  return score;
}

/**
 * Returns a callback that prefetches `refs` for the route `href` points at.
 * Bind it to any intent event (hover, focus, touch, pointerenter, an
 * IntersectionObserver). The route's params are resolved from the manifest, so
 * callers do not repeat the route pattern. A warm cache makes repeat calls a
 * no-op (see `prefetch`).
 */
export function usePrefetch(
  href: string,
  refs: LoaderRef<unknown> | ReadonlyArray<LoaderRef<unknown>>
): () => void {
  const flat = useContext(RouteManifestContext);
  return useCallback(() => {
    const { path, searchParams } = parseHref(href);
    let bestParams: Record<string, string> | null = null;
    let bestScore = -1;
    for (const route of flat) {
      const params = matchPath(path, route.path, true);
      if (!params) continue;
      const score = specificity(route.path);
      if (score > bestScore) {
        bestScore = score;
        bestParams = params;
      }
    }
    if (!bestParams) return; // off-manifest or outside Routes: best-effort no-op
    const location: RouteHook = { path, pathParams: bestParams, searchParams };
    const list = Array.isArray(refs) ? refs : [refs];
    for (const ref of list) void prefetch(ref, { location });
  }, [href, refs, flat]);
}
```

(No cast: `prefetch.ts`'s own `buildLocation` already constructs and returns exactly `{ path, searchParams, pathParams }` typed `RouteHook` with no cast, so the object literal is assignable, the extra `RouteHook` fields are optional. If `tsc` unexpectedly complains here, re-check that `bestParams`/`searchParams` are typed `Record<string, string>` rather than widened.)

- [ ] **Step 5: Add the barrel export.** In `packages/iso/src/index.ts`, in the `// Utilities.` section near `export { prefetch } from './prefetch.js';`, add:
```ts
export { usePrefetch } from './use-prefetch.js';
```

- [ ] **Step 6: Run the test; expect PASS** (2 tests). `pnpm exec vitest run packages/iso/src/__tests__/use-prefetch.test.tsx`

- [ ] **Step 7: Build + typecheck.** `pnpm --filter @hono-preact/iso build && pnpm typecheck`
Expected: PASS. (If a `Cannot find module '@hono-preact/...'` unrelated error appears, run `pnpm install` and retry.)

- [ ] **Step 8: Commit.**
```bash
git add packages/iso/src/internal/route-manifest.ts \
  packages/iso/src/use-prefetch.ts \
  packages/iso/src/__tests__/use-prefetch.test.tsx \
  packages/iso/src/index.ts
git commit -m "feat(iso): usePrefetch hook (resolve href params from the manifest, prefetch on intent)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `Routes` provides the manifest context

**Files:**
- Modify: `packages/iso/src/define-routes.tsx`
- Modify: `packages/iso/src/__tests__/define-routes.test.tsx`

- [ ] **Step 1: Write the provider test.** Append to `packages/iso/src/__tests__/define-routes.test.tsx`, inside the existing `describe('<Routes>', ...)` block. It uses the same harness pattern the file already uses (`history.replaceState` + `LocationProvider` + lazy `view`). Add `useContext` to the `preact/hooks` import (the file already imports `useState`), and `RouteManifestContext` from `../internal/route-manifest.js`, and `FlatRoute` to the `../define-routes.js` type import:

```tsx
  it('provides the route manifest via RouteManifestContext', async () => {
    let seen: ReadonlyArray<FlatRoute> | null = null;
    const Probe = () => {
      seen = useContext(RouteManifestContext);
      return h('div', { 'data-testid': 'probe' }, 'ok');
    };
    const manifest = defineRoutes([
      { path: '/ctx', view: () => Promise.resolve({ default: Probe }) },
    ]);
    history.replaceState(null, '', '/ctx');
    const { findByTestId } = render(
      h(LocationProvider, null, h(Routes, { routes: manifest })) as VNode
    );
    await findByTestId('probe');
    expect(seen).toBe(manifest.flat);
  });
```

- [ ] **Step 2: Run it; expect FAIL** (`seen` is the empty default array, not `manifest.flat`, because `Routes` does not provide the context yet). `pnpm exec vitest run packages/iso/src/__tests__/define-routes.test.tsx`

- [ ] **Step 3: Wire the provider into `Routes`.** In `packages/iso/src/define-routes.tsx`:
  - Add `import { RouteManifestContext } from './internal/route-manifest.js';`
  - Wrap the `Routes` component's returned `Router` element in the provider. The current `Routes` returns `h(asRouteComponent(Router), { onLoadStart, onLoadEnd }, ...routes.flat.map(...))`. Change it to wrap that whole `h(...)` in `h(RouteManifestContext.Provider, { value: routes.flat }, <the existing Router element>)`:
```tsx
export const Routes: ComponentType<RoutesProps> = ({ routes }) => {
  return h(
    RouteManifestContext.Provider,
    { value: routes.flat },
    h(
      asRouteComponent(Router),
      {
        onLoadStart: __noteLoadStart,
        onLoadEnd: __noteLoadEnd,
      },
      ...routes.flat.map((r) =>
        h(Route, {
          key: r.key,
          path: r.path,
          component: asRouteComponent(r.component),
        })
      )
    )
  );
};
```

- [ ] **Step 4: Run the test; expect PASS.** `pnpm exec vitest run packages/iso/src/__tests__/define-routes.test.tsx` (the new test plus all existing `<Routes>` tests stay green).

- [ ] **Step 5: Build + typecheck.** `pnpm --filter @hono-preact/iso build && pnpm typecheck` -> expect PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-routes.test.tsx
git commit -m "feat(iso): Routes provides the flat route manifest via context (for usePrefetch)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Migrate `IssueRow`

**Files:**
- Modify: `apps/site/src/components/demo/IssueRow.tsx`

- [ ] **Step 1: Read `apps/site/src/components/demo/IssueRow.tsx`.** It declares `const ISSUE_ROUTE = '/demo/projects/:projectId/issues/:issueId';`, a `useCallback` `onPrefetch` that calls `prefetch(serverLoaders.issue, { url: href, route: ISSUE_ROUTE })`, and binds `onMouseEnter={onPrefetch} onFocus={onPrefetch}` on the anchor inside the `ViewTransitionName` render.

- [ ] **Step 2: Switch to `usePrefetch`.**
  - In the `hono-preact` import, replace `prefetch` with `usePrefetch` (keep `ViewTransitionName`). Remove the `useCallback` import if it becomes unused.
  - Delete the `const ISSUE_ROUTE = ...;` line.
  - Replace the `onPrefetch` `useCallback` with: `const prefetchIssue = usePrefetch(href, serverLoaders.issue);`
  - Change the anchor's handlers from `onMouseEnter={onPrefetch} onFocus={onPrefetch}` to `onMouseEnter={prefetchIssue} onFocus={prefetchIssue}`.

- [ ] **Step 3: Typecheck + build the framework + site.** Run:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck && pnpm --filter site build
```
Expected: PASS. (Build the framework first so the site resolves `usePrefetch` through `dist/`. A failure on an unused `useCallback`/`prefetch` import means Step 2 missed removing one.)

- [ ] **Step 4: Commit.**
```bash
git add apps/site/src/components/demo/IssueRow.tsx
git commit -m "refactor(site): IssueRow uses usePrefetch (drops copied route pattern + manual prefetch wiring)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Document `usePrefetch`

**Files:**
- Modify: `apps/site/src/pages/docs/link-prefetch.mdx`

- [ ] **Step 1: Add a "Prefetch on intent" section.** Read `apps/site/src/pages/docs/link-prefetch.mdx` to find a sensible insertion point (after the section describing the manual `prefetch()` on a link, or at the end of a usage section). Insert:

````md
## Prefetch on intent

`usePrefetch(href, loaders)` returns a callback that prefetches a link's loader
data, resolving the target route's params from the route table for you (no
copied route pattern). Bind it to whatever events express intent, hover and
focus, touch, an `IntersectionObserver`, a long-press:

```tsx
import { usePrefetch } from 'hono-preact';
import { serverLoaders } from '../pages/issue.server.js';

function IssueLink({ href }: { href: string }) {
  const prefetchIssue = usePrefetch(href, serverLoaders.issue);
  return (
    <a href={href} onMouseEnter={prefetchIssue} onFocus={prefetchIssue}>
      Open issue
    </a>
  );
}
```

Pass one loader or an array. A warm cache makes repeat fires free, so binding to
several events is fine.
````

- [ ] **Step 2: Verify docs parse + parity + prettier.** Run:
- `pnpm exec vitest run apps/site/src/pages/docs/__tests__` -> expect PASS (no page added).
- `pnpm --filter site build` -> expect PASS.
- `pnpm exec prettier --check apps/site/src/pages/docs/link-prefetch.mdx`; if flagged, `pnpm exec prettier --write` it and re-check.

- [ ] **Step 3: Commit.**
```bash
git add apps/site/src/pages/docs/link-prefetch.mdx
git commit -m "docs: document usePrefetch for prefetch-on-intent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full pre-push verification

**Files:** none.

- [ ] **Step 1: Run the six-step CI mirror in order, each expecting PASS:**
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

- [ ] **Step 2: If `format:check` fails,** `pnpm format`, restage into the relevant commit or a `style:` commit, and re-run from Step 1.

- [ ] **Step 3: Flake note.** If `measure-client-size` times out under load, re-run it in isolation (`pnpm exec vitest run scripts/__tests__/measure-client-size.test.mjs`) before treating it as real.

---

## Self-review

- **Spec coverage:** the `usePrefetch` hook returning a bare trigger (Task 1), the internal `RouteManifestContext` provided by `Routes` (Tasks 1 + 2), href->params resolution via `matchPath` + specificity (Task 1), the `IssueRow` migration (Task 3), docs (Task 4). `prefetch()` unchanged; NavLink deferred (correctly absent). All present.
- **Placeholder scan:** every code step has full code; the one cast (`as RouteHook`) is annotated with the existing-precedent rationale and a "drop if tsc accepts" instruction. No placeholders.
- **Type/name consistency:** `usePrefetch(href, refs)` and `RouteManifestContext` are identical across the hook, its test, the barrel, the Routes wiring, the provider test, and the migration; the resolved `location` shape (`{ path, pathParams, searchParams }`) matches the `prefetch` test's assertion and `prefetch.ts`'s own `buildLocation`.
