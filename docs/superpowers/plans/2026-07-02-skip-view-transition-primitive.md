# Skip-view-transition primitive (#165) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class, opt-in way to update the URL without the framework wrapping the resulting render in a view transition, exposed through three entry points over one internal one-shot flag.

**Architecture:** A module-level one-shot boolean in `packages/iso/src/internal/route-change.ts` that the render scheduler consults: when armed, the next *navigated* flush commits without `startViewTransition` while still advancing `lastHref`. Public `skipNextNavTransition()` arms it; `navigate(href, { transition: false })` and `<NavLink transition={false}>` arm it for you. The docs TOC adopts it to write `#section` without a flash, closing #148.

**Tech Stack:** Preact, preact-iso, TypeScript, Vitest (happy-dom), MDX docs.

## Global Constraints

- No em-dashes in prose, comments, or commit messages (use commas/semicolons/parentheses).
- Casts are smells: reshape types rather than `as` (see `CLAUDE.md` "Type casts").
- Default behavior is unchanged: transition on every URL change. This feature is strictly opt-out.
- `transition: false` suppresses the *whole* view transition (no `beforeSwap`/`afterSwap`/types events), not just the animation.
- The internal flag is consumed only on a *navigated* flush; the documented contract is "arm immediately before the URL write."
- New runtime export (`skipNextNavTransition`) must be documented in an `.mdx` under `apps/site/src/pages/docs/` (the tightened #177 `exports-coverage` gate) and cited names in `AGENTS.md` must stay real (the #177 `agents-appendix` gate).
- Pre-push, run the 8 CI-parity checks from `CLAUDE.md` in order.

---

## File structure

- `packages/iso/src/internal/route-change.ts` — add the `skipNextTransition` flag, the public `skipNextNavTransition()`, the scheduler consumption, and the test-reset line. (Core.)
- `packages/iso/src/index.ts` — re-export `skipNextNavTransition`.
- `packages/iso/src/use-navigate.ts` — add `transition?: boolean` to `NavigateOptions`; arm on the soft-nav path.
- `packages/iso/src/nav-link.tsx` — add `transition?: boolean` to `NavLinkProps`; arm via a plain-left-click-guarded composed `onClick`.
- `apps/site/src/components/docs/TableOfContents.tsx` — adopt `skipNextNavTransition()` + a hash write (closes #148).
- Tests: `packages/iso/src/__tests__/skip-view-transition.test.ts` (scheduler), `skip-view-transition.test-d.ts` (types), plus additions to `use-navigate.test.tsx` and `nav-link.test.tsx`.
- Docs: `apps/site/src/pages/docs/view-transitions.mdx` (opt-out section) and `apps/site/src/pages/docs/active-links.mdx` (`transition` prop on `<NavLink>`).

---

## Task 1: Core primitive — `skipNextNavTransition()` and scheduler consumption

**Files:**
- Modify: `packages/iso/src/internal/route-change.ts` (flag near line 204; scheduler decision at lines 291-309; reset in `__resetTransitionStateForTesting` ~line 129)
- Modify: `packages/iso/src/index.ts` (add re-export)
- Test: `packages/iso/src/__tests__/skip-view-transition.test.ts`

**Interfaces:**
- Produces: `export function skipNextNavTransition(): void` from `packages/iso/src/internal/route-change.js`, re-exported by `hono-preact`. Arms a one-shot suppression of the next navigated flush's view transition.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/skip-view-transition.test.ts`. This mirrors the harness in `route-change-coordinator.test.ts` (fake `startViewTransition`, `flushRender` = `options.debounceRendering`, `navigateTo` = `history.pushState`).

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { options } from 'preact';
import {
  installNavTransitionScheduler,
  skipNextNavTransition,
  resetDefaultTypesForTesting,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';
import { resetHistoryShimForTesting } from '../internal/history-shim.js';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function installFakeVt() {
  const startViewTransition = vi.fn((cb: () => void | Promise<void>) => {
    void Promise.resolve().then(() => cb());
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished: Promise.resolve(),
      types: { add: () => {} },
      skipTransition: () => {},
    };
  });
  vi.stubGlobal('document', { startViewTransition });
  return { startViewTransition };
}

const flushRender = (process: () => void) => options.debounceRendering!(process);
const navigateTo = (url: string) => history.pushState(null, '', url);

describe('skipNextNavTransition', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
    __resetTransitionStateForTesting();
    history.replaceState(null, '', '/');
  });
  afterEach(() => {
    __resetTransitionStateForTesting();
    vi.unstubAllGlobals();
  });

  it('suppresses the view transition for the next navigated flush but still commits the render', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    const ran: string[] = [];
    skipNextNavTransition();
    navigateTo('/b');
    flushRender(() => ran.push('render'));
    await tick();
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(ran).toEqual(['render']);
  });

  it('is one-shot: the following navigation transitions again', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    skipNextNavTransition();
    navigateTo('/b');
    flushRender(() => {});
    await tick();
    expect(startViewTransition).not.toHaveBeenCalled();
    navigateTo('/c');
    flushRender(() => {});
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });

  it('an unarmed navigation still transitions (regression guard)', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    navigateTo('/b');
    flushRender(() => {});
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });

  it('a non-navigation flush does not consume the arm; the next real navigation is still skipped', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    skipNextNavTransition();
    flushRender(() => {}); // no location change
    await tick();
    expect(startViewTransition).not.toHaveBeenCalled();
    navigateTo('/b');
    flushRender(() => {});
    await tick();
    expect(startViewTransition).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run packages/iso/src/__tests__/skip-view-transition.test.ts`
Expected: FAIL — `skipNextNavTransition` is not exported from `route-change.js`.

- [ ] **Step 3: Add the flag and the public function**

In `packages/iso/src/internal/route-change.ts`, after `let lastHref = '';` (line ~204) add:

```ts
// One-shot: when set, the next navigated flush commits without a view
// transition (see skipNextNavTransition). Consumed on that flush.
let skipNextTransition = false;

/**
 * Suppress the view transition for the next client navigation, committing the
 * render without animating. One-shot: applies to the next navigation only.
 * Call it immediately before the URL write (a `navigate`, a history
 * push/replace, or a `location.hash` assignment). `navigate(href, { transition:
 * false })` and `<NavLink transition={false}>` call it for you.
 */
export function skipNextNavTransition(): void {
  skipNextTransition = true;
}
```

- [ ] **Step 4: Consume the flag in `scheduleRender`**

In `scheduleRender`, replace the decision block (currently):

```ts
  lastHref = href;
  const start = navigated ? getStartViewTransition() : undefined;
```

with:

```ts
  const skip = navigated && skipNextTransition;
  if (navigated) skipNextTransition = false; // one-shot: consumed on the nav flush
  lastHref = href;
  const start = navigated && !skip ? getStartViewTransition() : undefined;
```

- [ ] **Step 5: Reset the flag in the test helper**

In `__resetTransitionStateForTesting`, add alongside the other resets (e.g. after `transitionActive = false;`):

```ts
  skipNextTransition = false;
```

- [ ] **Step 6: Re-export publicly**

In `packages/iso/src/index.ts`, add:

```ts
export { skipNextNavTransition } from './internal/route-change.js';
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `pnpm vitest run packages/iso/src/__tests__/skip-view-transition.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Mutation-check**

Temporarily change the decision line to `const start = navigated ? getStartViewTransition() : undefined;` (ignore `skip`). Run the test; expected: the "suppresses" and "one-shot" tests FAIL. Restore the line; re-run; expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/iso/src/internal/route-change.ts packages/iso/src/index.ts packages/iso/src/__tests__/skip-view-transition.test.ts
git commit -m "feat(#165): skipNextNavTransition() one-shot view-transition opt-out"
```

---

## Task 2: `navigate(href, { transition: false })`

**Files:**
- Modify: `packages/iso/src/use-navigate.ts`
- Test: `packages/iso/src/__tests__/use-navigate.test.tsx` (add cases); `packages/iso/src/__tests__/skip-view-transition.test-d.ts` (create)

**Interfaces:**
- Consumes: `skipNextNavTransition()` from Task 1.
- Produces: `NavigateOptions.transition?: boolean` (default undefined = animate).

- [ ] **Step 1: Write the failing runtime test**

Add to `packages/iso/src/__tests__/use-navigate.test.tsx` (which already mocks `preact-iso` with `mockRoute` and renders via `<Harness path options>`). Add the import at the top and three cases inside the `describe`:

```ts
import * as routeChange from '../internal/route-change.js';
```

```ts
it('arms skipNextNavTransition on a soft nav when transition is false', () => {
  const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
  render(<Harness path="/x?tab=2" options={{ replace: true, transition: false }} />);
  click();
  expect(spy).toHaveBeenCalledTimes(1);
  expect(mockRoute).toHaveBeenCalledWith('/x?tab=2', true);
  spy.mockRestore();
});

it('does not arm skipNextNavTransition when transition is omitted', () => {
  const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
  render(<Harness path="/x" />);
  click();
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

it('does not arm on a reload (hard) navigation even when transition is false', () => {
  const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
  const assign = vi
    .spyOn(window.location, 'assign')
    .mockImplementation(() => {});
  render(<Harness path="/x" options={{ reload: true, transition: false }} />);
  click();
  expect(spy).not.toHaveBeenCalled();
  expect(assign).toHaveBeenCalledWith('/x');
  assign.mockRestore();
  spy.mockRestore();
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run packages/iso/src/__tests__/use-navigate.test.tsx`
Expected: FAIL — `skipNextNavTransition` never called.

- [ ] **Step 3: Implement**

Edit `packages/iso/src/use-navigate.ts`:

```ts
import { useCallback } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { skipNextNavTransition } from './internal/route-change.js';

export interface NavigateOptions {
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean;
  /** Do a full-page navigation (clean slate) instead of a client navigation. */
  reload?: boolean;
  /**
   * Set false to update the URL without a view transition (the render still
   * commits). Default: animate. Ignored when `reload` is true (a full-page load
   * has no transition to suppress).
   */
  transition?: boolean;
}

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
      if (options?.transition === false) skipNextNavTransition();
      route(path, options?.replace ?? false);
    },
    [route]
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm vitest run packages/iso/src/__tests__/use-navigate.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the type-level test**

Create `packages/iso/src/__tests__/skip-view-transition.test-d.ts`:

```ts
import { expectTypeOf } from 'vitest';
import type { NavigateOptions } from '../use-navigate.js';

expectTypeOf<NavigateOptions['transition']>().toEqualTypeOf<boolean | undefined>();
```

- [ ] **Step 6: Run the type test, verify it passes**

Run: `pnpm test:types`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/use-navigate.ts packages/iso/src/__tests__/use-navigate.test.tsx packages/iso/src/__tests__/skip-view-transition.test-d.ts
git commit -m "feat(#165): navigate({ transition: false }) opt-out"
```

---

## Task 3: `<NavLink transition={false}>`

**Files:**
- Modify: `packages/iso/src/nav-link.tsx`
- Test: `packages/iso/src/__tests__/nav-link.test.tsx` (add cases); `packages/iso/src/__tests__/skip-view-transition.test-d.ts` (extend)

**Interfaces:**
- Consumes: `skipNextNavTransition()` from Task 1.
- Produces: `NavLinkProps.transition?: boolean`.

- [ ] **Step 1: Write the failing runtime test**

Add to `packages/iso/src/__tests__/nav-link.test.tsx`:

```ts
import * as routeChange from '../internal/route-change.js';
import { fireEvent, render, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { NavLink } from '../nav-link.js';

it('arms skipNextNavTransition on a plain left-click when transition is false', () => {
  const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
  const { getByText } = render(
    h(NavLink, { href: '/a', transition: false }, 'go')
  );
  fireEvent.click(getByText('go'), { button: 0 });
  expect(spy).toHaveBeenCalledTimes(1);
  cleanup();
});

it('does not arm on a modifier-click', () => {
  const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
  const { getByText } = render(
    h(NavLink, { href: '/a', transition: false }, 'go')
  );
  fireEvent.click(getByText('go'), { button: 0, metaKey: true });
  expect(spy).not.toHaveBeenCalled();
  cleanup();
});

it('still invokes a caller-provided onClick', () => {
  const onClick = vi.fn();
  const { getByText } = render(
    h(NavLink, { href: '/a', transition: false, onClick }, 'go')
  );
  fireEvent.click(getByText('go'), { button: 0 });
  expect(onClick).toHaveBeenCalledTimes(1);
  cleanup();
});

it('does not arm when transition is omitted', () => {
  const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
  const { getByText } = render(h(NavLink, { href: '/a' }, 'go'));
  fireEvent.click(getByText('go'), { button: 0 });
  expect(spy).not.toHaveBeenCalled();
  cleanup();
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run packages/iso/src/__tests__/nav-link.test.tsx`
Expected: FAIL — `transition` prop not handled; spy not called.

- [ ] **Step 3: Implement**

Edit `packages/iso/src/nav-link.tsx`:

```tsx
import type { JSX, VNode } from 'preact';
import { useRouteActive } from './route-active.js';
import type { RoutePattern } from './internal/typed-routes.js';
import { skipNextNavTransition } from './internal/route-change.js';

export type NavLinkProps = Omit<
  JSX.HTMLAttributes<HTMLAnchorElement>,
  'class' | 'className'
> & {
  href: string;
  /** Pattern to test for active state. Defaults to `href`. */
  match?: RoutePattern;
  /** Default true. */
  exact?: boolean;
  /** Always applied. */
  class?: string;
  /** Merged in when active. */
  activeClass?: string;
  /** Merged in when not active. */
  inactiveClass?: string;
  /** Set false to navigate without a view transition. Default: animate. */
  transition?: boolean;
};

// A plain left-click with no modifiers on a same-tab link: the conditions under
// which preact-iso will actually soft-navigate. Only then do we arm the
// one-shot skip, so a modifier / new-tab click never leaves it armed.
function isPlainLeftClick(e: JSX.TargetedMouseEvent<HTMLAnchorElement>): boolean {
  return (
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.defaultPrevented &&
    !(e.currentTarget.target && e.currentTarget.target !== '_self')
  );
}

export function NavLink(props: NavLinkProps): VNode {
  const {
    href,
    match,
    exact = true,
    class: baseClass,
    activeClass,
    inactiveClass,
    transition,
    onClick: onClickProp,
    'aria-current': ariaCurrentProp,
    children,
    ...rest
  } = props;

  const active = useRouteActive(match ?? href, { exact });

  const className =
    [baseClass, active ? activeClass : inactiveClass]
      .filter(Boolean)
      .join(' ') || undefined;

  const ariaCurrent = ariaCurrentProp ?? (active ? 'page' : undefined);

  const handleClick = (e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
    if (transition === false && isPlainLeftClick(e)) skipNextNavTransition();
    onClickProp?.(e);
  };

  return (
    <a
      {...rest}
      href={href}
      class={className}
      aria-current={ariaCurrent}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm vitest run packages/iso/src/__tests__/nav-link.test.tsx`
Expected: PASS.

- [ ] **Step 5: Extend the type-level test**

Append to `packages/iso/src/__tests__/skip-view-transition.test-d.ts`:

```ts
import type { NavLinkProps } from '../nav-link.js';

expectTypeOf<NavLinkProps['transition']>().toEqualTypeOf<boolean | undefined>();
```

- [ ] **Step 6: Run the type test, verify it passes**

Run: `pnpm test:types`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/nav-link.tsx packages/iso/src/__tests__/nav-link.test.tsx packages/iso/src/__tests__/skip-view-transition.test-d.ts
git commit -m "feat(#165): <NavLink transition={false}> opt-out"
```

---

## Task 4: Docs TOC adopts the primitive (closes #148)

**Files:**
- Modify: `apps/site/src/components/docs/TableOfContents.tsx`
- Test: `apps/site/src/components/docs/__tests__/table-of-contents.test.tsx` (create if absent; otherwise add a case)

**Interfaces:**
- Consumes: `skipNextNavTransition` from `hono-preact`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/components/docs/__tests__/table-of-contents.test.tsx`. The TOC now writes the hash on a plain-left click. Assert the URL hash updates and the smooth-scroll still runs. Stub `scrollIntoView` (happy-dom lacks it).

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { TableOfContents } from '../TableOfContents.js';

const headings = [
  { id: 'intro', text: 'Intro', depth: 2 },
  { id: 'usage', text: 'Usage', depth: 2 },
];

beforeEach(() => {
  history.replaceState(null, '', '/docs/x');
  // @ts-expect-error happy-dom element lacks scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
  document.getElementById = ((id: string) => {
    const el = document.createElement('div');
    el.id = id;
    return el;
  }) as never;
});
afterEach(() => cleanup());

describe('TableOfContents', () => {
  it('writes the section hash to the URL on a plain left-click', () => {
    const { getByText } = render(h(TableOfContents, { headings }));
    fireEvent.click(getByText('Usage'), { button: 0 });
    expect(location.hash).toBe('#usage');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run apps/site/src/components/docs/__tests__/table-of-contents.test.tsx`
Expected: FAIL — `location.hash` is empty (the TOC deliberately does not write it yet).

- [ ] **Step 3: Implement**

In `apps/site/src/components/docs/TableOfContents.tsx`, add the import:

```ts
import { skipNextNavTransition } from 'hono-preact';
```

Replace the `onLinkClick` body's tail (after the modifier-click early return, from `event.preventDefault();` onward) so it writes the hash without a flash. The updated handler:

```ts
  // Smooth-scroll in-page AND put `#section` in the URL so it is shareable.
  // The framework starts a view transition whenever location.href changes, which
  // would flash the whole page; skipNextNavTransition() suppresses it for this
  // one URL write. Honors modifier-clicks so "open in new tab" still works.
  const onLinkClick = (event: MouseEvent, id: string) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    const el = document.getElementById(id);
    if (!el) return;
    event.preventDefault();
    setActiveId(id);
    scrollLock.current = true;
    if (lockTimer.current !== undefined) clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(() => {
      scrollLock.current = false;
    }, 700);
    skipNextNavTransition();
    history.pushState(null, '', `#${id}`);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm vitest run apps/site/src/components/docs/__tests__/table-of-contents.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/docs/TableOfContents.tsx apps/site/src/components/docs/__tests__/table-of-contents.test.tsx
git commit -m "feat(#165): docs TOC writes shareable #section without a flash (closes #148)"
```

---

## Task 5: Docs + gate sync

**Files:**
- Modify: `apps/site/src/pages/docs/view-transitions.mdx` (opt-out section — must mention `skipNextNavTransition`)
- Modify: `apps/site/src/pages/docs/active-links.mdx` (`transition` prop on `<NavLink>`)
- Run: `pnpm gen:agents-corpus`

**Interfaces:** none (docs).

- [ ] **Step 1: Add the opt-out section to `view-transitions.mdx`**

Append a section covering all three entry points. It MUST contain the literal token `skipNextNavTransition` (the tightened `exports-coverage` gate requires the new runtime export to appear in the corpus):

```mdx
## Opting out of the transition

The transition is on by default for every URL change. Three opt-outs update the
URL without animating (the render still commits):

- `navigate(href, { transition: false })` from `useNavigate` — for programmatic
  navigations (reflecting a tab, filter, or sort into the query string).
- `<NavLink href="..." transition={false}>` — the declarative form of the same.
- `skipNextNavTransition()` — a one-shot escape hatch for code that writes
  history directly. Call it immediately before the write:

  ```ts
  import { skipNextNavTransition } from 'hono-preact';

  skipNextNavTransition();
  history.pushState(null, '', '#section-3'); // URL updates, no transition
  ```

Each opt-out applies to the next navigation only.
```

- [ ] **Step 2: Document the `transition` prop in `active-links.mdx`**

In the `<NavLink>` props table, add a row:

```mdx
| `transition` | `boolean` | Set `false` to navigate without a view transition. Default: animate. |
```

- [ ] **Step 3: Regenerate the bundled corpus**

Run: `pnpm gen:agents-corpus`
Expected: writes `packages/create-hono-preact/templates/agents/llms-full.txt`.

- [ ] **Step 4: Verify the #177 docs gates and coverage are green**

Run: `pnpm vitest run apps/site/src/pages/docs/__tests__/exports-coverage.test.ts packages/create-hono-preact/__tests__/agents-appendix.test.ts`
Expected: PASS (in particular, `documents skipNextNavTransition` passes).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/docs/view-transitions.mdx apps/site/src/pages/docs/active-links.mdx
git commit -m "docs(#165): document the view-transition opt-out"
```

---

## Final verification (before PR)

- [ ] Run the 8 CI-parity checks from `CLAUDE.md` in order: build framework packages; `pnpm gen:agents-corpus`; `pnpm format:check`; `pnpm typecheck`; `pnpm test:types`; `pnpm test` (or `test:coverage`); `pnpm test:integration`; `pnpm --filter site build`.
- [ ] Confirm the full suite is green and `format:check` is clean (run `pnpm format` if not).

---

## Self-review notes (coverage against the spec)

- Mechanism (one-shot flag, consume-on-navigated-flush, `start = undefined`): Task 1.
- `skipNextNavTransition()` public export: Task 1 (steps 3, 6).
- `navigate({ transition: false })` + `NavigateOptions.transition`: Task 2.
- `<NavLink transition={false}>` + `NavLinkProps.transition` + plain-left-click guard: Task 3.
- Whole-VT suppression (no lifecycle events): inherent in the `start = undefined` path (Task 1); no lifecycle wiring added.
- #148 closure via TOC adoption: Task 4.
- Docs + gate sync (`skipNextNavTransition` documented; corpus regenerated): Task 5.
- `replaceUrl`/`setUrl` intentionally not built (YAGNI): no task, by design.
