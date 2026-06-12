# Imperative client navigate (Section C #2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `useNavigate()` hook for imperative client navigation (`navigate(path, { replace?, reload? })`), and migrate the site logout off `window.location.assign`.

**Architecture:** A thin wrapper over preact-iso's `useLocation().route` (so a soft navigate runs the framework's client middleware, loaders, and view transitions like a link click). `reload` is the framework-blessed hard-navigation escape hatch (`window.location.assign`). Additive; one PR.

**Tech Stack:** TypeScript, preact, preact-iso, Vitest + `@testing-library/preact` (happy-dom).

**Source spec:** `docs/superpowers/specs/2026-06-12-imperative-navigate-design.md`.

**Conventions:**
- Run a single test file with `pnpm exec vitest run <path>` from the repo root.
- No em-dashes in code/comments/commit messages.
- Run `pnpm format` before the pre-push step (`.mdx` is checked too).
- Commit after each task; messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

## Note on testing approach

The spec floated asserting observable navigation. This plan instead mocks `useLocation` to return a spy `route` (the established pattern in `packages/iso/src/__tests__/page.test.tsx`), because `useNavigate` is a thin wrapper and the contract to verify is exactly "soft navigate calls `route(path, replace)`; `reload` calls `window.location.assign` and does NOT call `route`." That is more direct and reliable than driving a real `LocationProvider` in happy-dom.

## File map

- **Create** `packages/iso/src/use-navigate.ts`: the hook + `NavigateOptions`.
- **Create** `packages/iso/src/__tests__/use-navigate.test.tsx`: its tests.
- **Modify** `packages/iso/src/index.ts`: export `useNavigate` + `NavigateOptions`.
- **Modify** `apps/site/src/pages/demo/projects.tsx`: logout uses `useNavigate`.
- **Modify** `apps/site/src/pages/docs/active-links.mdx`: a "Navigating programmatically" section.

---

## Task 1: The `useNavigate` hook

**Files:**
- Create: `packages/iso/src/use-navigate.ts`
- Create: `packages/iso/src/__tests__/use-navigate.test.tsx`
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Write the tests.** Create `packages/iso/src/__tests__/use-navigate.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useNavigate, type NavigateOptions } from '../use-navigate.js';

const mockRoute = vi.fn();
vi.mock('preact-iso', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useLocation: () => ({ route: mockRoute }) };
});

beforeEach(() => mockRoute.mockClear());
afterEach(cleanup);

function Harness({ path, options }: { path: string; options?: NavigateOptions }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(path, options)}>go</button>;
}

function click() {
  document.querySelector('button')!.click();
}

describe('useNavigate', () => {
  it('soft-navigates via route() with replace=false by default', () => {
    render(<Harness path="/x" />);
    click();
    expect(mockRoute).toHaveBeenCalledWith('/x', false);
  });

  it('passes replace through to route()', () => {
    render(<Harness path="/x" options={{ replace: true }} />);
    click();
    expect(mockRoute).toHaveBeenCalledWith('/x', true);
  });

  it('reload does a hard navigation and does NOT soft-navigate', () => {
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => {});
    render(<Harness path="/x" options={{ reload: true }} />);
    click();
    expect(assign).toHaveBeenCalledWith('/x');
    expect(mockRoute).not.toHaveBeenCalled();
    assign.mockRestore();
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** (cannot resolve `../use-navigate.js`). `pnpm exec vitest run packages/iso/src/__tests__/use-navigate.test.tsx`

- [ ] **Step 3: Create the hook.** Create `packages/iso/src/use-navigate.ts`:

```ts
import { useCallback } from 'preact/hooks';
import { useLocation } from 'preact-iso';

export interface NavigateOptions {
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean;
  /** Do a full-page navigation (clean slate) instead of a client navigation. */
  reload?: boolean;
}

/**
 * Imperative client navigation for use in event handlers. A soft navigate (the
 * default) goes through preact-iso's `route`, the same entry point a link click
 * reaches, so the framework's client middleware, loaders, and view transitions
 * all run. `reload` does a hard navigation; `replace` avoids a new history entry.
 * Call within the app's LocationProvider tree (every page is).
 */
export function useNavigate(): (
  path: string,
  options?: NavigateOptions
) => void {
  const { route } = useLocation();
  return useCallback(
    (path: string, options?: NavigateOptions) => {
      if (options?.reload) {
        if (typeof window !== 'undefined') window.location.assign(path);
        return;
      }
      route(path, options?.replace ?? false);
    },
    [route]
  );
}
```

- [ ] **Step 4: Add the barrel export.** In `packages/iso/src/index.ts`, in the `// Hooks.` section (after the `useOptimisticAction` exports, before `// Active-route detection.`), add:
```ts
export { useNavigate, type NavigateOptions } from './use-navigate.js';
```

- [ ] **Step 5: Run the test; expect PASS** (3 tests). `pnpm exec vitest run packages/iso/src/__tests__/use-navigate.test.tsx`
(If the `reload` test fails because happy-dom does not allow spying on `window.location.assign`, stub it instead: `const assign = vi.fn(); vi.stubGlobal('location', { ...window.location, assign });` at the top of that test and `vi.unstubAllGlobals()` after. Keep the two assertions: `assign` called with `'/x'`, `mockRoute` not called.)

- [ ] **Step 6: Build + typecheck.** `pnpm --filter @hono-preact/iso build && pnpm typecheck`
Expected: PASS. (If a `Cannot find module '@hono-preact/...'` unrelated error appears, run `pnpm install` and retry.)

- [ ] **Step 7: Commit.**
```bash
git add packages/iso/src/use-navigate.ts \
  packages/iso/src/__tests__/use-navigate.test.tsx \
  packages/iso/src/index.ts
git commit -m "feat(iso): useNavigate hook for imperative client navigation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migrate the site logout

**Files:**
- Modify: `apps/site/src/pages/demo/projects.tsx`

- [ ] **Step 1: Read `apps/site/src/pages/demo/projects.tsx`.** The `LogoutInline` component currently does, inside the `useAction(loginActions.logout, { onSuccess })`:
```ts
      try {
        window.localStorage.removeItem(DEMO_AUTHED_KEY);
      } catch {
        // ignore: full reload still drops the in-memory flag.
      }
      window.location.assign('/demo/login');
```

- [ ] **Step 2: Use `useNavigate`.** Add `useNavigate` to the existing `hono-preact` import (the file already imports from `'hono-preact'`). Inside `LogoutInline`, before the `useAction` call, add `const navigate = useNavigate();`. Change the `onSuccess` body to:
```ts
      try {
        window.localStorage.removeItem(DEMO_AUTHED_KEY);
      } catch {
        // ignore: a soft nav still leaves the in-memory flag cleared
      }
      navigate('/demo/login', { replace: true });
```
(Leave everything else, including the `DEMO_AUTHED_KEY` removal, unchanged. `replace: true` so the back button does not return to the deauthed page.)

- [ ] **Step 3: Typecheck + build the framework + site.** Run:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck && pnpm --filter site build
```
Expected: PASS. (Build the framework first so the site resolves the new `useNavigate` export through `dist/`.)

- [ ] **Step 4: Commit.**
```bash
git add apps/site/src/pages/demo/projects.tsx
git commit -m "refactor(site): logout uses useNavigate instead of window.location.assign

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Document `useNavigate`

**Files:**
- Modify: `apps/site/src/pages/docs/active-links.mdx`

- [ ] **Step 1: Add a "Navigating programmatically" section.** In `apps/site/src/pages/docs/active-links.mdx`, insert a `## Navigating programmatically` section after the `## \`<NavLink>\`` section and before `## API reference` (so imperative navigation sits next to the declarative `<NavLink>`):

````md
## Navigating programmatically

`useNavigate()` returns a `navigate(path, options?)` function for navigating from
an event handler (a logout button, a post-action redirect). A soft navigate runs
the same client middleware, loaders, and view transitions as a `<NavLink>` click.

```tsx
import { useNavigate } from 'hono-preact';

function LogoutButton() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('/login', { replace: true })}>
      Log out
    </button>
  );
}
```

| Option    | Type      | Default | Description                                                          |
| --------- | --------- | ------- | -------------------------------------------------------------------- |
| `replace` | `boolean` | `false` | Replace the current history entry instead of pushing a new one.      |
| `reload`  | `boolean` | `false` | Do a full-page navigation (clean slate) instead of a client navigation. |
````

- [ ] **Step 2: Verify docs parse + parity + prettier.** Run:
- `pnpm exec vitest run apps/site/src/pages/docs/__tests__` -> expect PASS (no page added; parity unaffected).
- `pnpm --filter site build` -> expect PASS.
- `pnpm exec prettier --check apps/site/src/pages/docs/active-links.mdx`; if flagged, `pnpm exec prettier --write` it and re-check.

- [ ] **Step 3: Commit.**
```bash
git add apps/site/src/pages/docs/active-links.mdx
git commit -m "docs: document useNavigate for programmatic navigation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full pre-push verification

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

- **Spec coverage:** the `useNavigate` hook + `NavigateOptions` (`replace`/`reload`) and barrel export (Task 1), the logout migration to a soft `replace` nav (Task 2), docs on `active-links.mdx` (Task 3). Out of scope (hook-free navigate, auth-state localStorage) is correctly absent. All present.
- **Placeholder scan:** every code step has full code; the `reload` test step includes a concrete fallback for the happy-dom `location.assign` spy. No placeholders.
- **Type/name consistency:** `useNavigate`/`NavigateOptions`/`replace`/`reload` are identical across the hook, its test, the barrel export, the migration, and the docs table; `navigate('/demo/login', { replace: true })` in the migration matches the hook signature.
