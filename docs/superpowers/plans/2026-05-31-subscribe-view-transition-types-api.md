# subscribeViewTransitionTypes Public API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public, non-hook `subscribeViewTransitionTypes(input)` framework API for registering a global, route-aware view-transition type rule, and migrate the site's docs-transition stopgap off the internal escape hatch.

**Architecture:** Lift the existing `useViewTransitionTypes` resolver logic into a standalone `subscribeViewTransitionTypes` function in the same module; the function self-guards against SSR (no `document`) and returns an unsubscribe. Refactor the hook to delegate to the function so there is one code path. Export from the public barrel, then swap `apps/site/src/docs-transition.ts` from `__subscribePhase` (internal) to the new front-door API.

**Tech Stack:** TypeScript, Preact, Vitest (happy-dom), pnpm workspace. Framework package `@hono-preact/iso` is published/consumed as `hono-preact`.

---

## File Structure

- `packages/iso/src/view-transition-types.ts` — add `subscribeViewTransitionTypes`; refactor `useViewTransitionTypes` to delegate. (modify)
- `packages/iso/src/index.ts` — export `subscribeViewTransitionTypes`. (modify)
- `packages/iso/src/__tests__/view-transition-types.test.tsx` — add a `subscribeViewTransitionTypes` describe block. (modify)
- `packages/iso/src/__tests__/public-exports.test.ts` — assert the new export exists. (modify)
- `apps/site/src/docs-transition.ts` — migrate from internal `__subscribePhase` to `subscribeViewTransitionTypes`. (modify)
- `apps/site/src/pages/docs/view-transitions.mdx` — document the new function. (modify)

---

## Task 1: Implement `subscribeViewTransitionTypes` and delegate the hook

**Files:**
- Modify: `packages/iso/src/view-transition-types.ts`
- Test: `packages/iso/src/__tests__/view-transition-types.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add this describe block to `packages/iso/src/__tests__/view-transition-types.test.tsx`, after the closing `});` of the `useViewTransitionTypes` describe (end of file). Update the import on line 4 from:

```ts
import { useViewTransitionTypes } from '../view-transition-types.js';
```
to:
```ts
import {
  useViewTransitionTypes,
  subscribeViewTransitionTypes,
} from '../view-transition-types.js';
```

Then append:

```tsx
describe('subscribeViewTransitionTypes', () => {
  beforeEach(() => {
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds a static string', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const unsub = subscribeViewTransitionTypes('posts-listing');

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toContain('posts-listing');
    unsub();
  });

  it('adds a static array of strings', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const unsub = subscribeViewTransitionTypes(['a', 'b']);

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toEqual(expect.arrayContaining(['a', 'b']));
    unsub();
  });

  it('calls a resolver per nav with to/from/direction', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const seen: Array<{ to: string; from: string | undefined }> = [];
    const unsub = subscribeViewTransitionTypes((nav) => {
      seen.push({ to: nav.to, from: nav.from });
      return nav.to === '/docs' ? ['docs'] : [];
    });

    __dispatchRouteChange('/docs', '/');
    resolveFinished();
    await Promise.resolve();

    expect(seen).toContainEqual({ to: '/docs', from: '/' });
    expect(typeAdds).toContain('docs');
    unsub();
  });

  it('resolver returning null/undefined contributes nothing', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const unsub = subscribeViewTransitionTypes(() => null);

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    const nonNav = typeAdds.filter((t) => !t.startsWith('nav-'));
    expect(nonNav).toEqual([]);
    unsub();
  });

  it('returned unsubscribe stops further contributions', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const unsub = subscribeViewTransitionTypes('one');

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();
    expect(typeAdds).toContain('one');

    unsub();
    typeAdds.length = 0;
    __dispatchRouteChange('/posts/1', '/posts');
    await Promise.resolve();
    expect(typeAdds).not.toContain('one');
  });

  it('is a no-op under SSR (no document)', () => {
    vi.stubGlobal('document', undefined);
    expect(() => {
      const unsub = subscribeViewTransitionTypes('x');
      expect(typeof unsub).toBe('function');
      unsub();
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hono-preact/iso test view-transition-types`
Expected: FAIL — `subscribeViewTransitionTypes` is not exported (import error / `not a function`).

- [ ] **Step 3: Implement the function and delegate the hook**

Replace the entire body of `packages/iso/src/view-transition-types.ts` (keep the existing imports and the two type definitions; replace the `useViewTransitionTypes` function) with:

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

/**
 * Register a global, route-aware view-transition type rule. The resolver runs on
 * every navigation with `{ to, from, direction }` and returns the type(s) to add
 * to that navigation's transition (a static string/array adds the same type(s) to
 * every navigation). Returns an unsubscribe.
 *
 * Unlike {@link useViewTransitionTypes}, this is not tied to a mounted component,
 * so it covers entering AND leaving a section (a layout hook is not subscribed yet
 * on enter and is already torn down on leave). No-op on the server (no document).
 */
export function subscribeViewTransitionTypes(
  input: ViewTransitionTypesInput
): () => void {
  if (typeof document === 'undefined') return () => {};
  return __subscribePhase('beforeTransition', (event) => {
    const resolved =
      typeof input === 'function'
        ? input({ to: event.to, from: event.from, direction: event.direction })
        : input;
    if (resolved == null) return;
    if (typeof resolved === 'string') event.types.push(resolved);
    else for (const t of resolved) event.types.push(t);
  });
}

export function useViewTransitionTypes(input: ViewTransitionTypesInput): void {
  const ref = useRef(input);
  ref.current = input;

  useEffect(
    () =>
      subscribeViewTransitionTypes((nav) => {
        const v = ref.current;
        return typeof v === 'function' ? v(nav) : v;
      }),
    []
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hono-preact/iso test view-transition-types`
Expected: PASS — both the existing `useViewTransitionTypes` block (parity proof) and the new `subscribeViewTransitionTypes` block are green.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/view-transition-types.ts packages/iso/src/__tests__/view-transition-types.test.tsx
git commit -m "feat(iso): add subscribeViewTransitionTypes; hook delegates to it

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Export from the public barrel

**Files:**
- Modify: `packages/iso/src/index.ts:132-137`
- Test: `packages/iso/src/__tests__/public-exports.test.ts:30-33`

- [ ] **Step 1: Write the failing test**

In `packages/iso/src/__tests__/public-exports.test.ts`, extend the "module C" test (currently lines 30-33) to:

```ts
  it('exports module C: types and direction', () => {
    expect(typeof iso.useViewTransitionTypes).toBe('function');
    expect(typeof iso.subscribeViewTransitionTypes).toBe('function');
    expect(typeof iso.getViewTransitionDirection).toBe('function');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hono-preact/iso test public-exports`
Expected: FAIL — `iso.subscribeViewTransitionTypes` is `undefined` (`expected "undefined" to be "function"`).

- [ ] **Step 3: Add the export**

In `packages/iso/src/index.ts`, change the `view-transition-types.js` export block (currently lines 133-137) to include the new function:

```ts
// View transitions types.
export {
  useViewTransitionTypes,
  subscribeViewTransitionTypes,
  type ViewTransitionTypesInput,
  type ViewTransitionTypesNav,
} from './view-transition-types.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hono-preact/iso test public-exports`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/index.ts packages/iso/src/__tests__/public-exports.test.ts
git commit -m "feat(iso): export subscribeViewTransitionTypes from public barrel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Migrate the docs-transition stopgap

**Files:**
- Modify: `apps/site/src/docs-transition.ts`

The site resolves `hono-preact` types through the built `dist/`, so the framework must be rebuilt before the site typechecks against the new export.

- [ ] **Step 1: Rebuild the framework dist**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: build succeeds; `subscribeViewTransitionTypes` is now present in the published `dist/` types.

- [ ] **Step 2: Replace the module contents**

Replace the entire contents of `apps/site/src/docs-transition.ts` with:

```ts
// Docs pages use a calm fade + subtle zoom instead of the global directional
// page slide. We emit the `docs` view-transition type for any navigation that
// enters, leaves, or moves within /docs, so root.css can override the slide for
// those navigations (see `:active-view-transition-type(docs)` there).
//
// This is a single always-on subscriber rather than a useViewTransitionTypes
// hook in DocsLayout: a layout hook only reliably catches docs->docs navigation.
// It is not subscribed yet when you navigate INTO docs (its effect runs a tick
// after the transition reads its types), and it is already torn down when you
// navigate OUT. A subscriber registered once at client startup is the only place
// that sees every navigation's `from` and `to`, so it covers enter/leave/within
// uniformly. subscribeViewTransitionTypes no-ops on the server, so the
// side-effect import from routes.ts (which also runs server-side) is safe.
import { subscribeViewTransitionTypes } from 'hono-preact';

function isDocsPath(p: string | undefined): boolean {
  return p === '/docs' || (p?.startsWith('/docs/') ?? false);
}

subscribeViewTransitionTypes((nav) => {
  const toDocs = isDocsPath(nav.to);
  const fromDocs = isDocsPath(nav.from);
  const types: string[] = [];
  // `docs` drives the content fade + zoom for any navigation touching /docs.
  if (toDocs || fromDocs) types.push('docs');
  // `docs-within` marks the case where the sidebar is present in BOTH snapshots
  // and should stay frozen. Entering or leaving docs it is captured on only one
  // side, where freezing it would leave the old sidebar stuck on screen for the
  // transition — there it falls back to the default fade.
  if (toDocs && fromDocs) types.push('docs-within');
  return types;
});
```

- [ ] **Step 3: Typecheck the site**

Run: `pnpm typecheck`
Expected: PASS — no missing-export error for `subscribeViewTransitionTypes`, no unused-import or `__subscribePhase` references remaining.

- [ ] **Step 4: Verify the internal import is gone**

Run: `grep -rn "__subscribePhase\|hono-preact/internal" apps/site/src/docs-transition.ts`
Expected: no output (the internal escape hatch is no longer referenced in this file).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/docs-transition.ts
git commit -m "refactor(site): migrate docs-transition to public subscribeViewTransitionTypes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Document the new function

**Files:**
- Modify: `apps/site/src/pages/docs/view-transitions.mdx:96-104`

- [ ] **Step 1: Check local docs conventions**

Read `.claude/skills/add-docs-page.md` (if present) and skim the existing `view-transitions.mdx` to match its heading style, code-fence language tags, and prose voice. Note: per project convention, describe what the API *is*, not what it replaces; no migration breadcrumbs.

- [ ] **Step 2: Add the documentation**

In `apps/site/src/pages/docs/view-transitions.mdx`, immediately after the existing `useViewTransitionTypes` example (the code fence ending at line 104), insert:

````mdx
For a rule that should apply regardless of what is mounted — for example, a calm
transition whenever a navigation enters or leaves a whole section — use the
always-on `subscribeViewTransitionTypes`. A hook in a section layout only sees
navigations within the section: it is not subscribed yet when you navigate in, and
is torn down before you navigate out. A single subscriber registered at client
startup sees every navigation's `from` and `to`.

```ts
import { subscribeViewTransitionTypes } from 'hono-preact';

subscribeViewTransitionTypes((nav) => {
  const inDocs = (p?: string) => p === '/docs' || p?.startsWith('/docs/');
  return inDocs(nav.to) || inDocs(nav.from) ? ['docs'] : [];
});
```

It returns an unsubscribe and is a no-op on the server, so it is safe to register
as a module side effect.
````

- [ ] **Step 3: Build the site to verify the MDX compiles**

Run: `pnpm --filter site build`
Expected: PASS — the docs page builds with no MDX/markdown errors.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs/view-transitions.mdx
git commit -m "docs(site): document subscribeViewTransitionTypes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (full CI mirror before any push)

Run the project's six-step pre-push sequence in order (per `CLAUDE.md`):

1. `pnpm --filter '@hono-preact/*' --filter hono-preact build`
2. `pnpm format:check` (if it fails, run `pnpm format` and amend/commit)
3. `pnpm typecheck`
4. `pnpm test:coverage` (or `pnpm test`)
5. `pnpm test:integration`
6. `pnpm --filter site build`

All six must pass before pushing or opening a PR.

---

## Self-Review Notes

- **Spec coverage:** API signature + SSR self-guard + unsubscribe (Task 1); hook delegation/parity (Task 1, existing tests stay green); export front-door-only, not internal.ts (Task 2); stopgap migration with guard removal (Task 3); tests incl. SSR no-op and unsubscribe (Tasks 1-2); docs (Task 4). All spec sections map to a task.
- **Type consistency:** `subscribeViewTransitionTypes(input: ViewTransitionTypesInput): () => void` and `ViewTransitionTypesNav` ({ to, from, direction }) are used identically across function impl, hook delegation, tests, and the migrated caller.
- **No placeholders:** every code and command step is concrete.
