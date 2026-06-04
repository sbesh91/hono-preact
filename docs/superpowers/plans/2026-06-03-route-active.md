# Active-route detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `useRouteMatch` (params or null), `useRouteActive` (boolean), and `<NavLink>` (auto active styling) to the framework, built on preact-iso's existing matcher, and migrate the docs site off its hand-rolled active logic.

**Architecture:** A single internal `matchPath(path, route, exact)` wraps preact-iso's `exec` (the same pattern matcher `<Route path>` uses). Two thin hooks read `useLocation().path` and delegate to it, so they are reactive and SSR-safe for free. `<NavLink>` wraps `<a>` and applies `activeClass`/`inactiveClass` + `aria-current` from `useRouteActive`. No new navigation handling, in-scope click interception by preact-iso is unchanged.

**Tech Stack:** TypeScript, Preact, preact-iso (`exec`, `useLocation`, `LocationProvider`), Vitest + `@testing-library/preact` (happy-dom).

**Reference spec:** `docs/superpowers/specs/2026-06-03-route-active-design.md`

> **Deviation from spec, flagged:** The spec said migrate the docs **area tabs** to `<NavLink exact={false}>`. That is incorrect: the Guide tab's `basePath` is `/docs`, which is a prefix of the Components tab's `/docs/components`, so a pure per-link match would light up **both** tabs on a components page. The tabs are mutually exclusive via `activeAreaId` precedence (components beats guide). So this plan migrates the **sidebar links** to `<NavLink>` (clean exact matches) and uses the **`useRouteActive` hook** to compute `activeAreaId` (replacing `path.startsWith`), leaving the tabs as `<a>` driven by that precedence. This still dogfoods both the hook (nested mode) and NavLink (exact mode), and avoids the double-active bug.

---

## File Structure

- **Create** `packages/iso/src/route-active.ts` — `RouteMatchOptions`, internal `execParams`, exported `matchPath`, `useRouteMatch`, `useRouteActive`.
- **Create** `packages/iso/src/nav-link.tsx` — `NavLinkProps`, `NavLink`.
- **Create** `packages/iso/src/__tests__/route-active.test.tsx` — `matchPath` unit tests + hook render tests.
- **Create** `packages/iso/src/__tests__/nav-link.test.tsx` — `NavLink` tests.
- **Modify** `packages/iso/src/index.ts` — public exports.
- **Modify** `packages/iso/src/__tests__/public-exports.test.ts` — assert new exports.
- **Modify** `apps/site/src/components/DocsLayout.tsx` — migrate sidebar links to `NavLink`, `activeAreaId` to `useRouteActive`.
- **Create** `apps/site/src/pages/docs/active-links.mdx` — Guide docs page (route `/docs/active-links`, auto-registered).
- **Modify** `apps/site/src/pages/docs/nav.ts` — add the nav entry.

The umbrella package `hono-preact` re-exports everything via `export * from '@hono-preact/iso'`, so no umbrella edit is needed.

---

## Task 1: `matchPath` core matcher

**Files:**
- Create: `packages/iso/src/route-active.ts`
- Test: `packages/iso/src/__tests__/route-active.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/route-active.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { matchPath } from '../route-active.js';

describe('matchPath', () => {
  it('exact-matches an identical literal path', () => {
    expect(matchPath('/docs', '/docs', true)).toEqual({});
  });

  it('returns null when the path differs', () => {
    expect(matchPath('/docs', '/about', true)).toBeNull();
  });

  it('captures params from a dynamic pattern', () => {
    expect(matchPath('/posts/123', '/posts/:id', true)).toEqual({ id: '123' });
  });

  it('does NOT match a descendant in exact mode', () => {
    expect(matchPath('/posts/123/edit', '/posts/:id', true)).toBeNull();
  });

  it('matches a descendant in non-exact mode', () => {
    expect(matchPath('/docs/components/dialog', '/docs/components', false)).toEqual({});
  });

  it('matches the section root itself in non-exact mode', () => {
    expect(matchPath('/docs/components', '/docs/components', false)).toEqual({});
  });

  it('ignores a trailing slash on the route argument', () => {
    expect(matchPath('/docs', '/docs/', true)).toEqual({});
  });

  it('matches the root path only against itself', () => {
    expect(matchPath('/', '/', true)).toEqual({});
    expect(matchPath('/x', '/', true)).toBeNull();
  });

  it('supports a wildcard pattern', () => {
    expect(matchPath('/files/a/b', '/files/*', true)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test route-active`
Expected: FAIL, cannot resolve `../route-active.js` / `matchPath is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/iso/src/route-active.ts`:

```ts
import { useLocation, exec } from 'preact-iso';

export interface RouteMatchOptions {
  /** When false, also match descendant paths (segment-prefix). Default true. */
  exact?: boolean;
}

/**
 * preact-iso types `exec` as always returning a `MatchProps` whose captured
 * params are `any`, but at runtime it returns `undefined` on no match. This
 * helper pins the half we use to a precise type so callers stay cast-free.
 */
function execParams(
  path: string,
  route: string
): Record<string, string> | undefined {
  return exec(path, route)?.pathParams;
}

/**
 * Test `path` against a route pattern (same grammar as `<Route path>`).
 * Returns the captured params on a match, else null. In non-exact mode a
 * descendant path also matches (`/a` matches `/a/b`).
 */
export function matchPath(
  path: string,
  route: string,
  exact: boolean
): Record<string, string> | null {
  const direct = execParams(path, route);
  if (direct) return direct;
  if (!exact) {
    const nested = execParams(path, route.replace(/\/+$/, '') + '/*');
    if (nested) return nested;
  }
  return null;
}

export function useRouteMatch(
  route: string,
  options?: RouteMatchOptions
): Record<string, string> | null {
  const { path } = useLocation();
  return matchPath(path, route, options?.exact ?? true);
}

export function useRouteActive(
  route: string,
  options?: RouteMatchOptions
): boolean {
  return useRouteMatch(route, options) !== null;
}
```

(The hooks are included now but are exercised in Task 2. `execParams` and `matchPath` are what Task 1's tests cover.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test route-active`
Expected: PASS, 9 passing in the `matchPath` describe block.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/route-active.ts packages/iso/src/__tests__/route-active.test.tsx
git commit -m "feat(iso): add matchPath route matcher over preact-iso exec"
```

---

## Task 2: `useRouteMatch` / `useRouteActive` hooks

**Files:**
- Modify: `packages/iso/src/route-active.ts` (already contains the hooks from Task 1)
- Test: `packages/iso/src/__tests__/route-active.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/iso/src/__tests__/route-active.test.tsx` (and extend the top import line to include the hooks + testing utils):

```tsx
import { fireEvent, render, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { useRouteMatch, useRouteActive } from '../route-active.js';

function Probe({ route, exact }: { route: string; exact?: boolean }) {
  const params = useRouteMatch(route, { exact });
  const active = useRouteActive(route, { exact });
  return (
    <div>
      <span data-testid="active">{active ? 'yes' : 'no'}</span>
      <span data-testid="params">{JSON.stringify(params)}</span>
      <a href="/posts/2" data-testid="nav">
        go
      </a>
    </div>
  );
}

describe('useRouteMatch / useRouteActive', () => {
  it('reflects the initial location and captured params', () => {
    history.replaceState(null, '', '/posts/1');
    const { getByTestId } = render(
      <LocationProvider>
        <Probe route="/posts/:id" />
      </LocationProvider>
    );
    expect(getByTestId('active').textContent).toBe('yes');
    expect(getByTestId('params').textContent).toBe('{"id":"1"}');
  });

  it('returns null params and inactive when the route does not match', () => {
    history.replaceState(null, '', '/posts/1');
    const { getByTestId } = render(
      <LocationProvider>
        <Probe route="/about" />
      </LocationProvider>
    );
    expect(getByTestId('active').textContent).toBe('no');
    expect(getByTestId('params').textContent).toBe('null');
  });

  it('re-evaluates after navigation', async () => {
    history.replaceState(null, '', '/posts/1');
    const { getByTestId } = render(
      <LocationProvider>
        <Probe route="/posts/2" exact />
      </LocationProvider>
    );
    expect(getByTestId('active').textContent).toBe('no');
    fireEvent.click(getByTestId('nav'));
    await waitFor(() =>
      expect(getByTestId('active').textContent).toBe('yes')
    );
  });
});
```

> Note: the first import line in this file (from Task 1) imports only `matchPath`. Update it to `import { matchPath, useRouteMatch, useRouteActive } from '../route-active.js';` and add the `@testing-library/preact` + `LocationProvider` imports shown above. Do not duplicate the `vitest` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test route-active`
Expected: the three new `useRouteMatch / useRouteActive` tests are present and PASS (the hooks already exist from Task 1). If any fail, fix the hooks in `route-active.ts`. The goal of this task is the render/reactivity coverage.

Note: navigation works because `<a href="/posts/2">` is intercepted by preact-iso's global click handler under `LocationProvider`, updating `useLocation` and re-rendering. This mirrors the proven pattern in `define-routes.test.tsx`.

- [ ] **Step 3: (no new implementation expected)**

The hooks were written in Task 1. If Step 2 surfaced a bug, the minimal fix lives in `packages/iso/src/route-active.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test route-active`
Expected: PASS, all `matchPath` + hook tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/__tests__/route-active.test.tsx
git commit -m "test(iso): cover useRouteMatch/useRouteActive reactivity"
```

---

## Task 3: `<NavLink>` component

**Files:**
- Create: `packages/iso/src/nav-link.tsx`
- Test: `packages/iso/src/__tests__/nav-link.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/nav-link.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { NavLink } from '../nav-link.js';

describe('NavLink', () => {
  it('applies activeClass and aria-current="page" when active', () => {
    history.replaceState(null, '', '/docs');
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/docs" class="base" activeClass="on" inactiveClass="off">
          Docs
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('Docs') as HTMLAnchorElement;
    expect(a.getAttribute('class')).toBe('base on');
    expect(a.getAttribute('aria-current')).toBe('page');
  });

  it('applies inactiveClass and no aria-current when inactive', () => {
    history.replaceState(null, '', '/other');
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/docs" class="base" activeClass="on" inactiveClass="off">
          Docs
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('Docs') as HTMLAnchorElement;
    expect(a.getAttribute('class')).toBe('base off');
    expect(a.getAttribute('aria-current')).toBeNull();
  });

  it('uses `match` for the active test instead of href', () => {
    history.replaceState(null, '', '/posts/7');
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/posts" match="/posts/:id" activeClass="on">
          Posts
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('Posts') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/posts');
    expect(a.getAttribute('class')).toBe('on');
  });

  it('matches a descendant when exact is false', () => {
    history.replaceState(null, '', '/docs/components/dialog');
    const { getByText } = render(
      <LocationProvider>
        <NavLink
          href="/docs/components"
          exact={false}
          activeClass="on"
          inactiveClass="off"
        >
          Components
        </NavLink>
      </LocationProvider>
    );
    expect((getByText('Components') as HTMLElement).getAttribute('class')).toBe('on');
  });

  it('forwards arbitrary anchor props', () => {
    history.replaceState(null, '', '/x');
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/y" target="_blank" rel="noreferrer" data-kind="nav">
          Y
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('Y') as HTMLAnchorElement;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noreferrer');
    expect(a.getAttribute('data-kind')).toBe('nav');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test nav-link`
Expected: FAIL, cannot resolve `../nav-link.js` / `NavLink is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/iso/src/nav-link.tsx`:

```tsx
import type { JSX, VNode } from 'preact';
import { useRouteActive } from './route-active.js';

export type NavLinkProps = Omit<
  JSX.HTMLAttributes<HTMLAnchorElement>,
  'class' | 'className'
> & {
  href: string;
  /** Pattern to test for active state. Defaults to `href`. */
  match?: string;
  /** Default true. */
  exact?: boolean;
  /** Always applied. */
  class?: string;
  /** Merged in when active. */
  activeClass?: string;
  /** Merged in when not active. */
  inactiveClass?: string;
};

export function NavLink(props: NavLinkProps): VNode {
  const {
    href,
    match,
    exact = true,
    class: baseClass,
    activeClass,
    inactiveClass,
    'aria-current': ariaCurrentProp,
    children,
    ...rest
  } = props;

  const active = useRouteActive(match ?? href, { exact });

  const className =
    [baseClass, active ? activeClass : inactiveClass].filter(Boolean).join(' ') ||
    undefined;

  const ariaCurrent = ariaCurrentProp ?? (active ? 'page' : undefined);

  return (
    <a {...rest} href={href} class={className} aria-current={ariaCurrent}>
      {children}
    </a>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test nav-link`
Expected: PASS, 5 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/nav-link.tsx packages/iso/src/__tests__/nav-link.test.tsx
git commit -m "feat(iso): add NavLink with activeClass/inactiveClass"
```

---

## Task 4: Public exports

**Files:**
- Modify: `packages/iso/src/index.ts`
- Test: `packages/iso/src/__tests__/public-exports.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block to `packages/iso/src/__tests__/public-exports.test.ts` (after the existing blocks; the file already does `import * as iso from '../index.js';`):

```ts
describe('active-route detection exports', () => {
  it('exports useRouteMatch', () => {
    expect(typeof iso.useRouteMatch).toBe('function');
  });

  it('exports useRouteActive', () => {
    expect(typeof iso.useRouteActive).toBe('function');
  });

  it('exports NavLink', () => {
    expect(typeof iso.NavLink).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test public-exports`
Expected: FAIL, `iso.useRouteMatch` etc. are `undefined` (not yet exported).

- [ ] **Step 3: Write minimal implementation**

In `packages/iso/src/index.ts`, add after the existing `Hooks.` export block (right after the `useOptimisticAction` exports):

```ts
// Active-route detection.
export {
  useRouteMatch,
  useRouteActive,
  type RouteMatchOptions,
} from './route-active.js';
export { NavLink, type NavLinkProps } from './nav-link.js';
```

(`matchPath` stays internal, it is intentionally not exported from `index.ts`; tests import it directly from `../route-active.js`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test public-exports`
Expected: PASS, the three new export assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/index.ts packages/iso/src/__tests__/public-exports.test.ts
git commit -m "feat(iso): export useRouteMatch, useRouteActive, NavLink"
```

---

## Task 5: Migrate `DocsLayout` to the new primitives

**Files:**
- Modify: `apps/site/src/components/DocsLayout.tsx`

Reference current code: sidebar links at `apps/site/src/components/DocsLayout.tsx:58-72`, `activeAreaId` at `:37-39`, area tabs at `:99-117`.

- [ ] **Step 1: Rebuild framework dist (so `hono-preact` exposes the new symbols to the site typecheck)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: builds all `@hono-preact/*` packages + `hono-preact` with no errors.

- [ ] **Step 2: Add the import**

In `apps/site/src/components/DocsLayout.tsx`, add below the existing `useLocation` import (`:3`):

```tsx
import { NavLink, useRouteActive } from 'hono-preact';
```

Keep the existing `import { useLocation } from 'preact-iso';` line, `path` is still used for the mobile-drawer effect and prev/next.

- [ ] **Step 3: Replace the `activeAreaId` derivation**

Replace:

```tsx
const activeAreaId = path.startsWith('/docs/components')
  ? 'components'
  : 'guide';
```

with:

```tsx
const activeAreaId = useRouteActive('/docs/components', { exact: false })
  ? 'components'
  : 'guide';
```

- [ ] **Step 4: Replace the sidebar entry anchor with `NavLink`**

In `renderNav`, replace the `section.entries.map(...)` body (the `const active = entry.route === path;` block and its `<a>`) with:

```tsx
{section.entries.map((entry) => (
  <NavLink
    key={entry.route}
    href={entry.route}
    exact
    class="flex items-center h-9 rounded text-sm no-underline whitespace-nowrap pl-9 pr-3"
    activeClass="bg-accent/10 text-accent font-semibold"
    inactiveClass="text-muted hover:text-foreground hover:bg-foreground/10"
  >
    <span>{entry.title}</span>
  </NavLink>
))}
```

Leave the area-tab block (`:99-117`) as-is: it is driven by `activeAreaId` (mutually exclusive areas), not a per-link match. Its `isActive = area.id === activeAreaId` stays.

- [ ] **Step 5: Typecheck, build the site, and eyeball**

Run: `pnpm typecheck`
Expected: PASS (no errors in `apps/site` or packages).

Run: `pnpm --filter site build`
Expected: site builds with no errors.

Manual check (optional but recommended): `pnpm --filter site dev`, open `/docs` (sidebar "Overview" active, Guide tab active) and `/docs/components/dialog` if present (or `/docs/components`: Components tab active, sidebar "Overview" active). Confirm exactly one tab and one sidebar link are highlighted on each.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/components/DocsLayout.tsx
git commit -m "refactor(site): drive DocsLayout active state via useRouteActive + NavLink"
```

---

## Task 6: Docs page

**Files:**
- Create: `apps/site/src/pages/docs/active-links.mdx`
- Modify: `apps/site/src/pages/docs/nav.ts`

- [ ] **Step 1: Invoke the local `add-docs-page` skill**

Read and follow `.claude/skills/add-docs-page.md`. It confirms: Guide pages live at `apps/site/src/pages/docs/<slug>.mdx` (route auto-registered via the recursive glob in `DocsRoute.tsx`), and the nav entry goes in `nav.ts`. Run its checklist.

- [ ] **Step 2: Create the MDX page**

Create `apps/site/src/pages/docs/active-links.mdx`:

````mdx
# Active Links

Highlighting the current page in navigation needs one question answered: does the current URL match a given route? `useRouteActive`, `useRouteMatch`, and `<NavLink>` answer it against the same route grammar your route table uses, so `/posts/:id` matches any post and hands you the `id`.

## `useRouteActive`

Returns `true` when the current path matches the route.

```tsx
import { useRouteActive } from 'hono-preact';

function Tab() {
  const active = useRouteActive('/docs');
  return <a href="/docs" aria-current={active ? 'page' : undefined}>Docs</a>;
}
```

By default the match is **exact**. Pass `{ exact: false }` to also match descendant paths, e.g. highlight a section for every page beneath it:

```tsx
// active on /docs/components AND /docs/components/dialog
const inSection = useRouteActive('/docs/components', { exact: false });
```

## `useRouteMatch`

Same matching, but returns the captured params (or `null`). Use it when you want to both test *and* read the dynamic segments.

```tsx
import { useRouteMatch } from 'hono-preact';

function Crumb() {
  const params = useRouteMatch('/posts/:id');
  // on /posts/42 -> { id: '42' }, elsewhere -> null
  return params ? <span>Post {params.id}</span> : null;
}
```

The route accepts the full pattern grammar: `:param`, `*`, `+`, `:param?`.

## `<NavLink>`

A `<a>` that applies an active or inactive class for you (and sets `aria-current="page"` when active).

```tsx
import { NavLink } from 'hono-preact';

<NavLink
  href="/docs"
  activeClass="text-accent font-semibold"
  inactiveClass="text-muted"
>
  Docs
</NavLink>
```

Any `class` you pass is always applied; `activeClass` / `inactiveClass` are merged on top per state. Other anchor props (`target`, `rel`, `data-*`) pass straight through.

Use `exact={false}` for section links, and `match` when the link target differs from the pattern you want to highlight on:

```tsx
// links to /posts, but stays active on /posts/123
<NavLink href="/posts" match="/posts/:id" activeClass="text-accent">
  Posts
</NavLink>
```
````

- [ ] **Step 3: Add the nav entry**

In `apps/site/src/pages/docs/nav.ts`, add to the `Pages & Routing` section's `entries` (after `Adding Pages`):

```ts
{ title: 'Active Links', route: '/docs/active-links' },
```

- [ ] **Step 4: Verify route ↔ nav parity and formatting**

Run: `pnpm test docs/__tests__`
Expected: PASS (the parity test sees the new MDX route and its matching nav entry).

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format` and re-stage.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/docs/active-links.mdx apps/site/src/pages/docs/nav.ts
git commit -m "docs(site): add Active Links guide page"
```

---

## Task 7: Full pre-push verification

**Files:** none (verification only)

- [ ] **Step 1: Run the six CI-mirroring checks in order**

Run each, expecting PASS:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm --filter site build
```

If `format:check` fails: `pnpm format`, then re-stage and amend/commit the formatting.

- [ ] **Step 2: Note on client-size tracking**

Adding `NavLink` + the hooks grows the client runtime slightly. If the size-tracking check (CI sticky comment / `client-size-report.json`) flags an increase over budget, regenerate and commit the baseline as a separate `chore(size): update client size baseline` commit, following the existing size-tracking workflow. This is a follow-up, not a blocker for the feature commits.

- [ ] **Step 3: Final state check**

Run: `git log --oneline -7`
Expected: the feature/test/docs commits from Tasks 1-6 present, working tree clean.

---

## Self-Review

**Spec coverage:**
- `useRouteMatch` (params|null) — Task 1 (impl) + Task 2 (tests) + Task 4 (export). ✓
- `useRouteActive` (boolean) — same. ✓
- `<NavLink>` with `activeClass`/`inactiveClass`, `aria-current`, anchor passthrough, `match`, `exact` — Task 3 + Task 4. ✓
- Same route grammar as `<Route path>` (via `exec`) — Task 1. ✓
- exact default true; nested opt-in — Task 1 tests + hooks. ✓
- Pathname-only / trailing-slash / root — Task 1 tests. ✓
- Reactive + SSR-safe (built on `useLocation`) — Task 2 reactivity test. ✓
- `matchPath` chokepoint over `exec`, cast-free via `execParams` — Task 1. ✓
- Not added to `/page` subpath — Task 4 (only `index.ts` touched). ✓
- DocsLayout dogfood — Task 5 (with the flagged tabs deviation). ✓
- Docs page + nav — Task 6. ✓
- Out-of-scope items (search params, function forms, hash) — not implemented. ✓

**Placeholder scan:** none. Every code step has full content.

**Type consistency:** `RouteMatchOptions`, `matchPath(path, route, exact)`, `useRouteMatch(route, options?)`, `useRouteActive(route, options?)`, `NavLinkProps`, `NavLink(props)` are named identically across impl, tests, exports, and the DocsLayout migration. `execParams` is internal to `route-active.ts` and never referenced elsewhere.
</content>
