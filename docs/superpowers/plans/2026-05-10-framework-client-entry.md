# Framework Client Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the client entry into the framework as a virtual module (`virtual:hono-preact/client`); ship `<ClientScript />`, `<Head>`, `<ViewTransitions />` components and a `useRouteChange` hook; reshape the generated server entry so `Layout` receives `children` instead of `{ context }`. Implements item 4 of the v0.1 sequencing per `docs/superpowers/specs/2026-05-10-framework-client-entry-design.md`.

**Architecture:**
- Add a private route-change registry in `@hono-preact/iso/internal/route-change.ts` with two state buckets: a `Set<Sub>` of subscribers and an integer `viewTransitionEnabled` counter. Three pure helpers (`__dispatchRouteChange`, `__subscribeRouteChange`, `__enableViewTransitions`) glue everything together.
- Build the four public surfaces (`useRouteChange`, `<ViewTransitions />`, `<Head>`, `<ClientScript />`) as small files that call into the registry or render markup. Each one has its own file, single responsibility, and a vitest case.
- Add `clientEntryPlugin` in `@hono-preact/vite` that registers the `virtual:hono-preact/client` module. Mirrors `clientShimPlugin`'s `resolveId`/`load` pattern. The shim plugin's transform is updated to also fire on the resolved virtual id, so the framework client entry gets the `process` shim too.
- `honoPreact()` adds `clientEntryPlugin` and switches its `clientEntry` default to the new virtual id (when the user hasn't provided one).
- The generated server entry's catch-all switches from `h(Layout, { context: c })` to `h(Layout, null, h(LocationProvider, null, h(Routes, { routes })))` and drops the `defaultTitle` argument.
- Demo migration deletes `client.tsx` and `iso.tsx`, rewrites `Layout.tsx` to the four-import form from the spec.

**Tech Stack:** TypeScript, Preact (`useEffect`, `useContext`), preact-iso v3, Vite (Plugin API: `resolveId`/`load`), Vitest, `@testing-library/preact`, happy-dom (for DOM-touching tests).

**Out of scope for this plan (separate plans cover them):**
- Spec items 5–8 (streaming loaders, single guards list, package consolidation, README/launch).
- Renaming or removing existing `@hono-preact/iso` exports.
- Configurable hydration target id (`#app` stays hardcoded).
- Pattern-matched `<ViewTransitions match="/movies/*" />` (deferred; `useRouteChange` covers segment scoping today).
- CSP nonce support on `<ClientScript />`.
- Hoofd-replacement primitives. `<Head>` wraps existing hoofd output; we don't fork hoofd.

---

## File Map

**Create (framework runtime):**
- `packages/iso/src/internal/route-change.ts` — private registry: `__dispatchRouteChange`, `__subscribeRouteChange`, `__enableViewTransitions`.
- `packages/iso/src/route-change.ts` — public `useRouteChange(handler)` hook.
- `packages/iso/src/view-transitions.tsx` — public `<ViewTransitions />` component.
- `packages/iso/src/head.tsx` — public `<Head>` component.
- `packages/iso/src/client-script.tsx` — public `<ClientScript />` component.
- `packages/iso/src/__tests__/route-change.test.ts` — registry + hook tests.
- `packages/iso/src/__tests__/view-transitions.test.tsx` — view-transition opt-in tests.
- `packages/iso/src/__tests__/head.test.tsx` — `<Head>` rendering tests.
- `packages/iso/src/__tests__/client-script.test.tsx` — `<ClientScript />` prod/dev branching tests.

**Create (framework build):**
- `packages/vite/src/client-entry.ts` — `clientEntryPlugin` (virtual module owner, source generator).
- `packages/vite/src/__tests__/client-entry.test.ts` — plugin behavior tests.

**Modify (framework runtime):**
- `packages/iso/src/internal.ts` — re-export `__dispatchRouteChange` from `internal/route-change.js` for the generated client entry to import.
- `packages/iso/src/index.ts` — add public exports for `useRouteChange`, `ViewTransitions`, `Head`, `ClientScript`.

**Modify (framework build):**
- `packages/vite/src/server-entry.ts` — `generateServerEntrySource` reshapes the catch-all to `h(Layout, null, h(LocationProvider, null, h(Routes, { routes })))` and drops the `defaultTitle` arg. Adds the necessary imports (`LocationProvider` from `preact-iso`, `Routes` from `@hono-preact/iso`).
- `packages/vite/src/hono-preact.ts` — adds `clientEntryPlugin` to the plugin list (always; the virtual module is harmless if unused). Switches `clientEntry` default from `'./src/client.tsx'` to the virtual id `'virtual:hono-preact/client'`. Threads the virtual id through `clientShimPlugin` so the shim still injects.
- `packages/vite/src/client-shim.ts` — extends the entry-match check to also recognize the resolved virtual client id (`\0virtual:hono-preact/client`). One-line addition.
- `packages/vite/src/index.ts` — re-export `clientEntryPlugin` and `VIRTUAL_CLIENT_ENTRY_ID` for symmetry.
- `packages/vite/src/__tests__/hono-preact.test.ts` — extend assembly tests for the new plugin.
- `packages/vite/src/__tests__/server-entry.test.ts` — update generator tests for the new catch-all shape.

**Modify (demo):**
- `apps/app/src/Layout.tsx` — rewrite to the four-import form from the spec.

**Delete (demo):**
- `apps/app/src/client.tsx`
- `apps/app/src/iso.tsx`

**Touched lightly (one-line corrections only):**
- `apps/app/src/pages/docs/structure.mdx` — note that `client.tsx`/`iso.tsx` no longer exist; framework owns them.
- `apps/app/src/pages/docs/render-page.mdx` — note that `defaultTitle` is no longer threaded by the framework's generated entry; users pass it via `<Head defaultTitle="...">`.

---

## Task 1: Internal route-change registry (TDD)

A pure module-level registry. Three exports, no imports beyond preact's `flushSync`.

**Files:**
- Create: `packages/iso/src/internal/route-change.ts`
- Create: `packages/iso/src/__tests__/route-change.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/iso/src/__tests__/route-change.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __dispatchRouteChange,
  __subscribeRouteChange,
  __enableViewTransitions,
} from '../internal/route-change.js';

describe('__subscribeRouteChange', () => {
  it('invokes the subscriber with (to, from) on dispatch', () => {
    const calls: Array<[string, string | undefined]> = [];
    const unsubscribe = __subscribeRouteChange((to, from) => {
      calls.push([to, from]);
    });

    __dispatchRouteChange('/a', undefined);
    __dispatchRouteChange('/b', '/a');

    expect(calls).toEqual([
      ['/a', undefined],
      ['/b', '/a'],
    ]);
    unsubscribe();
  });

  it('returns a function that unsubscribes', () => {
    const calls: string[] = [];
    const unsubscribe = __subscribeRouteChange((to) => calls.push(to));

    __dispatchRouteChange('/a', undefined);
    unsubscribe();
    __dispatchRouteChange('/b', '/a');

    expect(calls).toEqual(['/a']);
  });

  it('supports multiple subscribers in registration order', () => {
    const order: string[] = [];
    const u1 = __subscribeRouteChange(() => order.push('one'));
    const u2 = __subscribeRouteChange(() => order.push('two'));

    __dispatchRouteChange('/x', undefined);

    expect(order).toEqual(['one', 'two']);
    u1();
    u2();
  });
});

describe('__enableViewTransitions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a disabler function', () => {
    const disable = __enableViewTransitions();
    expect(typeof disable).toBe('function');
    disable();
  });

  it('triggers document.startViewTransition on dispatch when enabled', () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    });
    vi.stubGlobal('document', { startViewTransition });

    const disable = __enableViewTransitions();
    __dispatchRouteChange('/a', undefined);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    disable();
  });

  it('does not trigger when no enabler is active', () => {
    const startViewTransition = vi.fn();
    vi.stubGlobal('document', { startViewTransition });

    __dispatchRouteChange('/a', undefined);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it('only triggers once per dispatch even when enabled multiple times', () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    });
    vi.stubGlobal('document', { startViewTransition });

    const d1 = __enableViewTransitions();
    const d2 = __enableViewTransitions();

    __dispatchRouteChange('/a', undefined);
    expect(startViewTransition).toHaveBeenCalledTimes(1);

    d1();
    __dispatchRouteChange('/b', '/a');
    expect(startViewTransition).toHaveBeenCalledTimes(2); // still enabled by d2

    d2();
    __dispatchRouteChange('/c', '/b');
    expect(startViewTransition).toHaveBeenCalledTimes(2); // disabled, no extra
  });

  it('no-ops when document.startViewTransition is unavailable', () => {
    vi.stubGlobal('document', {});
    const disable = __enableViewTransitions();
    expect(() => __dispatchRouteChange('/a', undefined)).not.toThrow();
    disable();
  });

  it('no-ops in a non-browser environment (no document at all)', () => {
    vi.stubGlobal('document', undefined);
    const disable = __enableViewTransitions();
    expect(() => __dispatchRouteChange('/a', undefined)).not.toThrow();
    disable();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/iso/src/__tests__/route-change.test.ts
```

Expected: FAIL with `Cannot find module '../internal/route-change.js'`.

- [ ] **Step 3: Implement the registry**

Create `packages/iso/src/internal/route-change.ts`:

```ts
import { flushSync } from 'preact/compat';

type Sub = (to: string, from: string | undefined) => void;

const subs = new Set<Sub>();
let viewTransitionEnabled = 0;

export function __dispatchRouteChange(to: string, from: string | undefined): void {
  for (const cb of subs) cb(to, from);

  if (viewTransitionEnabled <= 0) return;
  if (typeof document === 'undefined') return;
  const startViewTransition = (document as { startViewTransition?: (cb: () => void) => unknown })
    .startViewTransition;
  if (typeof startViewTransition !== 'function') return;
  startViewTransition.call(document, () => flushSync(() => {}));
}

export function __subscribeRouteChange(sub: Sub): () => void {
  subs.add(sub);
  return () => {
    subs.delete(sub);
  };
}

export function __enableViewTransitions(): () => void {
  viewTransitionEnabled++;
  return () => {
    viewTransitionEnabled--;
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/iso/src/__tests__/route-change.test.ts
```

Expected: PASS (all 9 tests).

- [ ] **Step 5: Re-export from `packages/iso/src/internal.ts`**

Append to `packages/iso/src/internal.ts`:

```ts
export {
  __dispatchRouteChange,
  __subscribeRouteChange,
  __enableViewTransitions,
} from './internal/route-change.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/route-change.ts packages/iso/src/__tests__/route-change.test.ts packages/iso/src/internal.ts
git commit -m "feat(iso): private route-change registry for client entry hooks"
```

---

## Task 2: `useRouteChange` public hook (TDD)

A trivial wrapper over `__subscribeRouteChange` that uses `useEffect` for mount/cleanup. Test that the handler fires after a `__dispatchRouteChange` call.

**Files:**
- Create: `packages/iso/src/route-change.ts`
- Modify: `packages/iso/src/__tests__/route-change.test.ts` (append a hook describe block)

- [ ] **Step 1: Write the failing test**

Append to `packages/iso/src/__tests__/route-change.test.ts`:

```ts
// @vitest-environment happy-dom
import { renderHook } from '@testing-library/preact';
import { useRouteChange } from '../route-change.js';

describe('useRouteChange', () => {
  it('subscribes on mount and unsubscribes on unmount', () => {
    const calls: Array<[string, string | undefined]> = [];
    const handler = (to: string, from: string | undefined) => {
      calls.push([to, from]);
    };

    const { unmount } = renderHook(() => useRouteChange(handler));

    __dispatchRouteChange('/a', undefined);
    expect(calls).toEqual([['/a', undefined]]);

    unmount();

    __dispatchRouteChange('/b', '/a');
    expect(calls).toEqual([['/a', undefined]]); // no call after unmount
  });

  it('uses the latest handler reference (re-subscribes on handler change)', () => {
    const callsA: string[] = [];
    const callsB: string[] = [];
    const handlerA = (to: string) => callsA.push(to);
    const handlerB = (to: string) => callsB.push(to);

    const { rerender } = renderHook(({ h }: { h: (to: string) => void }) => useRouteChange(h), {
      initialProps: { h: handlerA },
    });

    __dispatchRouteChange('/x', undefined);
    expect(callsA).toEqual(['/x']);
    expect(callsB).toEqual([]);

    rerender({ h: handlerB });

    __dispatchRouteChange('/y', '/x');
    expect(callsA).toEqual(['/x']);
    expect(callsB).toEqual(['/y']);
  });
});
```

Note: the file currently has no `@vitest-environment` pragma at the top (it tests a pure module). Move the pragma to the very first line of the file when adding the hook tests, since happy-dom is needed for `renderHook`.

- [ ] **Step 2: Add the file-level pragma**

Edit `packages/iso/src/__tests__/route-change.test.ts` so the first line is:

```ts
// @vitest-environment happy-dom
```

(All existing tests still pass under happy-dom.)

- [ ] **Step 3: Run the tests to verify the new ones fail**

```bash
pnpm vitest run packages/iso/src/__tests__/route-change.test.ts
```

Expected: FAIL with `Cannot find module '../route-change.js'`.

- [ ] **Step 4: Implement the hook**

Create `packages/iso/src/route-change.ts`:

```ts
import { useEffect, useRef } from 'preact/hooks';
import { __subscribeRouteChange } from './internal/route-change.js';

export type RouteChangeHandler = (to: string, from: string | undefined) => void;

export function useRouteChange(handler: RouteChangeHandler): void {
  // Keep the latest handler in a ref so rerenders don't churn the subscription.
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    return __subscribeRouteChange((to, from) => ref.current(to, from));
  }, []);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm vitest run packages/iso/src/__tests__/route-change.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/route-change.ts packages/iso/src/__tests__/route-change.test.ts
git commit -m "feat(iso): useRouteChange hook for client-side route subscriptions"
```

---

## Task 3: `<ViewTransitions />` component (TDD)

A render-null component that calls `__enableViewTransitions()` on mount and disables on unmount.

**Files:**
- Create: `packages/iso/src/view-transitions.tsx`
- Create: `packages/iso/src/__tests__/view-transitions.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/iso/src/__tests__/view-transitions.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/preact';
import { ViewTransitions } from '../view-transitions.js';
import { __dispatchRouteChange } from '../internal/route-change.js';

describe('ViewTransitions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing', () => {
    const { container } = render(<ViewTransitions />);
    expect(container.innerHTML).toBe('');
  });

  it('opts in to view transitions while mounted', () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    });
    vi.stubGlobal('document', Object.assign(document, { startViewTransition }));

    const { unmount } = render(<ViewTransitions />);

    __dispatchRouteChange('/a', undefined);
    expect(startViewTransition).toHaveBeenCalledTimes(1);

    unmount();

    __dispatchRouteChange('/b', '/a');
    expect(startViewTransition).toHaveBeenCalledTimes(1); // not called after unmount
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run packages/iso/src/__tests__/view-transitions.test.tsx
```

Expected: FAIL with `Cannot find module '../view-transitions.js'`.

- [ ] **Step 3: Implement the component**

Create `packages/iso/src/view-transitions.tsx`:

```tsx
import { useEffect } from 'preact/hooks';
import { __enableViewTransitions } from './internal/route-change.js';

export function ViewTransitions(): null {
  useEffect(() => __enableViewTransitions(), []);
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run packages/iso/src/__tests__/view-transitions.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/view-transitions.tsx packages/iso/src/__tests__/view-transitions.test.tsx
git commit -m "feat(iso): ViewTransitions component opts in to document.startViewTransition"
```

---

## Task 4: `<Head>` component (TDD)

Renders `<head>` with charset, viewport defaults, fallback title, and children.

**Files:**
- Create: `packages/iso/src/head.tsx`
- Create: `packages/iso/src/__tests__/head.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `packages/iso/src/__tests__/head.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { Head } from '../head.js';

describe('Head', () => {
  it('renders <head> with charset and viewport defaults', () => {
    const { container } = render(<Head />);
    const head = container.querySelector('head');
    expect(head).not.toBeNull();
    expect(head?.querySelector('meta[charset="utf-8"]')).not.toBeNull();
    expect(
      head?.querySelector('meta[name="viewport"][content="width=device-width,initial-scale=1.0"]')
    ).not.toBeNull();
  });

  it('renders an empty <title> when defaultTitle is omitted', () => {
    const { container } = render(<Head />);
    const title = container.querySelector('head > title');
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe('');
  });

  it('renders defaultTitle inside <title>', () => {
    const { container } = render(<Head defaultTitle="hono-preact" />);
    const title = container.querySelector('head > title');
    expect(title?.textContent).toBe('hono-preact');
  });

  it('emits children inside <head>', () => {
    const { container } = render(
      <Head defaultTitle="x">
        <link rel="stylesheet" href="/styles.css" />
        <meta name="theme-color" content="#000" />
      </Head>
    );
    const head = container.querySelector('head');
    expect(head?.querySelector('link[rel="stylesheet"][href="/styles.css"]')).not.toBeNull();
    expect(head?.querySelector('meta[name="theme-color"][content="#000"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/iso/src/__tests__/head.test.tsx
```

Expected: FAIL with `Cannot find module '../head.js'`.

- [ ] **Step 3: Implement the component**

Create `packages/iso/src/head.tsx`:

```tsx
import type { ComponentChildren, VNode } from 'preact';

export interface HeadProps {
  defaultTitle?: string;
  children?: ComponentChildren;
}

export function Head({ defaultTitle, children }: HeadProps): VNode {
  return (
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1.0" />
      <title>{defaultTitle ?? ''}</title>
      {children}
    </head>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/iso/src/__tests__/head.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/head.tsx packages/iso/src/__tests__/head.test.tsx
git commit -m "feat(iso): Head component with charset/viewport/title defaults"
```

---

## Task 5: `<ClientScript />` component (TDD)

Renders `<script type="module" src="...">`. Branches on `import.meta.env.PROD`.

**Files:**
- Create: `packages/iso/src/client-script.tsx`
- Create: `packages/iso/src/__tests__/client-script.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `packages/iso/src/__tests__/client-script.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/preact';
import { ClientScript } from '../client-script.js';

describe('ClientScript', () => {
  const originalProd = import.meta.env.PROD;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // Restore PROD on the live env object after each test.
    (import.meta as { env: Record<string, unknown> }).env.PROD = originalProd;
  });

  it('renders a module script tag', () => {
    const { container } = render(<ClientScript />);
    const script = container.querySelector('script[type="module"]');
    expect(script).not.toBeNull();
  });

  it('points at /static/client.js in prod', () => {
    (import.meta as { env: Record<string, unknown> }).env.PROD = true;
    const { container } = render(<ClientScript />);
    const script = container.querySelector('script[type="module"]') as HTMLScriptElement;
    expect(script.getAttribute('src')).toBe('/static/client.js');
  });

  it('points at the dev virtual-module URL when not prod', () => {
    (import.meta as { env: Record<string, unknown> }).env.PROD = false;
    const { container } = render(<ClientScript />);
    const script = container.querySelector('script[type="module"]') as HTMLScriptElement;
    expect(script.getAttribute('src')).toBe('/@id/__x00__virtual:hono-preact/client');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/iso/src/__tests__/client-script.test.tsx
```

Expected: FAIL with `Cannot find module '../client-script.js'`.

- [ ] **Step 3: Implement the component**

Create `packages/iso/src/client-script.tsx`:

```tsx
import type { VNode } from 'preact';

export function ClientScript(): VNode {
  const src = import.meta.env.PROD
    ? '/static/client.js'
    : '/@id/__x00__virtual:hono-preact/client';
  return <script type="module" src={src} />;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/iso/src/__tests__/client-script.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/client-script.tsx packages/iso/src/__tests__/client-script.test.tsx
git commit -m "feat(iso): ClientScript component with prod/dev URL branching"
```

---

## Task 6: Public exports from `@hono-preact/iso` (TDD)

Add the four new public symbols to `packages/iso/src/index.ts` so they propagate to `hono-preact` (which already does `export * from '@hono-preact/iso'`).

**Files:**
- Modify: `packages/iso/src/index.ts`
- Create: `packages/iso/src/__tests__/public-exports.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/iso/src/__tests__/public-exports.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as iso from '../index.js';

describe('public exports for item 4', () => {
  it('exports useRouteChange', () => {
    expect(typeof iso.useRouteChange).toBe('function');
  });

  it('exports ViewTransitions', () => {
    expect(typeof iso.ViewTransitions).toBe('function');
  });

  it('exports Head', () => {
    expect(typeof iso.Head).toBe('function');
  });

  it('exports ClientScript', () => {
    expect(typeof iso.ClientScript).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run packages/iso/src/__tests__/public-exports.test.ts
```

Expected: FAIL — the symbols don't exist on the index export yet.

- [ ] **Step 3: Add the exports**

In `packages/iso/src/index.ts`, find the existing `// Hooks.` block and append a new logical group at the end of the file (preserving the existing structure):

```ts
// Client entry primitives (item 4 of v0.1).
export { useRouteChange } from './route-change.js';
export type { RouteChangeHandler } from './route-change.js';
export { ViewTransitions } from './view-transitions.js';
export { Head } from './head.js';
export type { HeadProps } from './head.js';
export { ClientScript } from './client-script.js';
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run packages/iso/src/__tests__/public-exports.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the full iso test suite to confirm nothing else broke**

```bash
pnpm vitest run packages/iso
```

Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/index.ts packages/iso/src/__tests__/public-exports.test.ts
git commit -m "feat(iso): export ClientScript, Head, ViewTransitions, useRouteChange"
```

---

## Task 7: `clientEntryPlugin` (Vite virtual module) (TDD)

Mirrors `clientShimPlugin`'s pattern. Registers `virtual:hono-preact/client` and serves a generated source that hydrates the route tree.

**Files:**
- Create: `packages/vite/src/client-entry.ts`
- Create: `packages/vite/src/__tests__/client-entry.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/vite/src/__tests__/client-entry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  clientEntryPlugin,
  generateClientEntrySource,
  VIRTUAL_CLIENT_ENTRY_ID,
} from '../client-entry.js';

describe('VIRTUAL_CLIENT_ENTRY_ID', () => {
  it('is the documented virtual module id', () => {
    expect(VIRTUAL_CLIENT_ENTRY_ID).toBe('virtual:hono-preact/client');
  });
});

describe('generateClientEntrySource', () => {
  it('emits the framework imports plus the user routes import (absolute path)', () => {
    const src = generateClientEntrySource({ routesAbsPath: '/proj/src/routes.ts' });

    expect(src).toContain(`import { hydrate } from 'preact';`);
    expect(src).toContain(`import { LocationProvider } from 'preact-iso';`);
    expect(src).toContain(`import { Routes } from '@hono-preact/iso';`);
    expect(src).toContain(
      `import { __dispatchRouteChange } from '@hono-preact/iso/internal';`
    );
    expect(src).toContain(`import routes from '/proj/src/routes.ts';`);
  });

  it('hydrates into #app and wires onRouteChange to the dispatcher', () => {
    const src = generateClientEntrySource({ routesAbsPath: '/proj/src/routes.ts' });
    expect(src).toContain(`document.getElementById('app')`);
    expect(src).toContain(`onRouteChange`);
    expect(src).toContain(`__dispatchRouteChange`);
  });
});

describe('clientEntryPlugin', () => {
  it('resolveId returns the resolved id only for the virtual id', () => {
    const plugin = clientEntryPlugin({ routes: 'src/routes.ts' });
    (plugin as { configResolved?: (c: { root: string }) => void }).configResolved?.({
      root: '/proj',
    });

    const resolved = (plugin as {
      resolveId?: (id: string) => string | undefined;
    }).resolveId?.(VIRTUAL_CLIENT_ENTRY_ID);
    expect(resolved).toBe('\0' + VIRTUAL_CLIENT_ENTRY_ID);

    const other = (plugin as {
      resolveId?: (id: string) => string | undefined;
    }).resolveId?.('not-the-virtual');
    expect(other).toBeUndefined();
  });

  it('load() returns the generated source for the resolved virtual id', () => {
    const plugin = clientEntryPlugin({ routes: 'src/routes.ts' });
    (plugin as { configResolved?: (c: { root: string }) => void }).configResolved?.({
      root: '/proj',
    });

    const code = (plugin as {
      load?: (id: string) => string | undefined;
    }).load?.('\0' + VIRTUAL_CLIENT_ENTRY_ID);

    expect(code).toContain(`import routes from '${path.resolve('/proj', 'src/routes.ts')}';`);
  });

  it('load() returns undefined for non-virtual ids', () => {
    const plugin = clientEntryPlugin({ routes: 'src/routes.ts' });
    (plugin as { configResolved?: (c: { root: string }) => void }).configResolved?.({
      root: '/proj',
    });
    const code = (plugin as { load?: (id: string) => string | undefined }).load?.('other-id');
    expect(code).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/vite/src/__tests__/client-entry.test.ts
```

Expected: FAIL with `Cannot find module '../client-entry.js'`.

- [ ] **Step 3: Implement the plugin and the source generator**

Create `packages/vite/src/client-entry.ts`:

```ts
import * as path from 'node:path';
import type { Plugin } from 'vite';

export const VIRTUAL_CLIENT_ENTRY_ID = 'virtual:hono-preact/client';
const RESOLVED_ID = '\0' + VIRTUAL_CLIENT_ENTRY_ID;

export interface GenerateClientEntrySourceOptions {
  routesAbsPath: string;
}

export function generateClientEntrySource(
  opts: GenerateClientEntrySourceOptions
): string {
  return (
    `import { hydrate } from 'preact';\n` +
    `import { LocationProvider } from 'preact-iso';\n` +
    `import { Routes } from '@hono-preact/iso';\n` +
    `import { __dispatchRouteChange } from '@hono-preact/iso/internal';\n` +
    `import routes from '${opts.routesAbsPath}';\n` +
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
}

export interface ClientEntryPluginOptions {
  routes: string; // project-relative or absolute
}

export function clientEntryPlugin(opts: ClientEntryPluginOptions): Plugin {
  let routesAbsPath = '';

  return {
    name: 'hono-preact:client-entry',
    enforce: 'pre',
    configResolved(config) {
      routesAbsPath = path.isAbsolute(opts.routes)
        ? opts.routes
        : path.resolve(config.root, opts.routes);
    },
    resolveId(id) {
      if (id === VIRTUAL_CLIENT_ENTRY_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      return generateClientEntrySource({ routesAbsPath });
    },
  };
}
```

Wait — the source uses `h(...)` but never imports it. Update the generator:

```ts
export function generateClientEntrySource(
  opts: GenerateClientEntrySourceOptions
): string {
  return (
    `import { h, hydrate } from 'preact';\n` +
    `import { LocationProvider } from 'preact-iso';\n` +
    `import { Routes } from '@hono-preact/iso';\n` +
    `import { __dispatchRouteChange } from '@hono-preact/iso/internal';\n` +
    `import routes from '${opts.routesAbsPath}';\n` +
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
}
```

(Update Step 1's tests to also assert `import { h, hydrate } from 'preact'` — the existing assertion `import { hydrate } from 'preact'` won't match this exact form. Replace that single test assertion with `expect(src).toContain(\`import { h, hydrate } from 'preact';\`);`.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/vite/src/__tests__/client-entry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/client-entry.ts packages/vite/src/__tests__/client-entry.test.ts
git commit -m "feat(vite): clientEntryPlugin registers virtual:hono-preact/client"
```

---

## Task 8: Update `client-shim.ts` to also recognize the virtual client entry (TDD)

The shim plugin's `transform` currently runs against the configured client entry's absolute path on disk. The virtual client entry has no absolute disk path; its id is `\0virtual:hono-preact/client`. The transform check must accept either form.

**Files:**
- Modify: `packages/vite/src/client-shim.ts`
- Modify: `packages/vite/src/__tests__/client-shim.test.ts`

- [ ] **Step 1: Inspect the current test file**

Read `packages/vite/src/__tests__/client-shim.test.ts` to understand the existing assertion shape. Add a new test in the same style.

- [ ] **Step 2: Write the failing test**

Append to `packages/vite/src/__tests__/client-shim.test.ts`:

```ts
import { VIRTUAL_CLIENT_ENTRY_ID } from '../client-entry.js';

describe('clientShimPlugin virtual client entry', () => {
  it('injects the shim into the resolved virtual client entry id', () => {
    const plugin = clientShimPlugin(VIRTUAL_CLIENT_ENTRY_ID);
    (plugin as { configResolved?: (c: { root: string; isProduction: boolean }) => void }).configResolved?.({
      root: '/proj',
      isProduction: false,
    });

    const result = (plugin as {
      transform?: (code: string, id: string) => { code: string } | undefined;
    }).transform?.('console.log("client");', '\0virtual:hono-preact/client');

    expect(result).toBeDefined();
    expect(result?.code).toContain(`import 'virtual:hono-preact/client-shim';`);
    expect(result?.code).toContain('console.log("client");');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm vitest run packages/vite/src/__tests__/client-shim.test.ts
```

Expected: FAIL — the existing transform's `if (!id.startsWith(resolvedEntry)) return;` doesn't match because `resolvedEntry` was resolved against `config.root` (giving `/proj/virtual:hono-preact/client`) not the `\0` id.

- [ ] **Step 4: Update the plugin to special-case virtual ids**

Modify `packages/vite/src/client-shim.ts`. Replace the existing transform body:

```ts
    transform(code, id) {
      if (resolvedEntry === null) return;
      // Virtual client entry: matches the resolved virtual id directly. The
      // configured `clientEntry` carries the unresolved `virtual:` form, which
      // we mirror here so the shim still injects.
      if (clientEntry.startsWith('virtual:') && id === '\0' + clientEntry) {
        return {
          code: `import '${VIRTUAL_ID}';\n${code}`,
          map: null,
        };
      }
      // Disk-based entry: equal, or `<entry>?<query>`.
      if (!id.startsWith(resolvedEntry)) return;
      const tail = id.length - resolvedEntry.length;
      if (tail !== 0 && id.charCodeAt(resolvedEntry.length) !== 63 /* '?' */) return;
      return {
        code: `import '${VIRTUAL_ID}';\n${code}`,
        map: null,
      };
    },
```

Note: this requires `clientEntry` to be in closure scope. It already is (the function arg).

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm vitest run packages/vite/src/__tests__/client-shim.test.ts
```

Expected: PASS (new test plus all existing tests).

- [ ] **Step 6: Commit**

```bash
git add packages/vite/src/client-shim.ts packages/vite/src/__tests__/client-shim.test.ts
git commit -m "fix(vite): client-shim transform recognizes the virtual client entry id"
```

---

## Task 9: Wire `clientEntryPlugin` into `honoPreact()` (TDD)

Add `clientEntryPlugin` to the plugin list. Switch the `clientEntry` default to the virtual id so `clientShimPlugin` and the client build's rollupOptions both target the framework entry by default.

**Files:**
- Modify: `packages/vite/src/hono-preact.ts`
- Modify: `packages/vite/src/__tests__/hono-preact.test.ts`
- Modify: `packages/vite/src/index.ts` (export the new plugin + id for symmetry)

- [ ] **Step 1: Write the failing tests**

Append to `packages/vite/src/__tests__/hono-preact.test.ts`:

```ts
describe('honoPreact client-entry wiring', () => {
  type NamedPlugin = { name?: string };

  it('includes the client-entry plugin', () => {
    const plugins = honoPreact() as NamedPlugin[];
    const names = plugins.map((p) => p.name);
    expect(names).toContain('hono-preact:client-entry');
  });

  it('defaults the client build input to the virtual client entry', () => {
    const plugins = honoPreact();
    const config = getClientConfig(plugins) as {
      build: { rollupOptions: { input: string[] } };
    };
    expect(config.build.rollupOptions.input).toEqual(['virtual:hono-preact/client']);
  });

  it('honors a user-provided clientEntry override', () => {
    const plugins = honoPreact({ clientEntry: './src/custom-client.tsx' });
    const config = getClientConfig(plugins) as {
      build: { rollupOptions: { input: string[] } };
    };
    expect(config.build.rollupOptions.input).toEqual(['./src/custom-client.tsx']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/vite/src/__tests__/hono-preact.test.ts
```

Expected: FAIL — `client-entry` plugin not in the list and the default input is still `'./src/client.tsx'`.

- [ ] **Step 3: Update `honoPreact()`**

In `packages/vite/src/hono-preact.ts`:

Add the import:

```ts
import {
  clientEntryPlugin,
  VIRTUAL_CLIENT_ENTRY_ID,
} from './client-entry.js';
```

Change the `clientEntry` default in the destructuring:

```ts
  const {
    layout = 'src/Layout.tsx',
    routes = 'src/routes.ts',
    api = 'src/api.ts',
    clientEntry = VIRTUAL_CLIENT_ENTRY_ID,
    entry,
    clientBuild = {},
    serverBuild = {},
    sharedBuild = {},
  } = options;
```

Slot `clientEntryPlugin` into the returned plugin array, right after `clientShimPlugin`:

```ts
  return [
    configPlugin,
    clientShimPlugin(clientEntry),
    clientEntryPlugin({ routes }),
    ...(useGeneratedEntry
      ? [serverEntryPlugin({ layout, routes, api, outputPath: generatedServerEntryAbsPath() })]
      : []),
    serverLoaderValidationPlugin(),
    moduleKeyPlugin(),
    serverOnlyPlugin(),
    Object.assign(build({ entry: resolvedEntry }), {
      apply: (_: unknown, { command, mode }: { command: string; mode: string }) =>
        command === 'build' && mode !== 'client',
    }),
    Object.assign(
      devServer({
        entry: resolvedEntry,
        exclude: [
          ...defaultOptions.exclude,
          /\.scss/,
          /\.css/,
          /\?url/,
          /\?inline/,
        ],
        adapter: cloudflareAdapter,
      }),
      { apply: 'serve' as const }
    ),
    ...preact(),
  ];
```

- [ ] **Step 4: Update the existing rollupOptions tests if needed**

The existing test `'uses framework defaults when no clientBuild.rollupOptions provided'` asserts:

```ts
expect(rollup.input).toEqual(['./src/client.tsx']);
```

Update it to:

```ts
expect(rollup.input).toEqual(['virtual:hono-preact/client']);
```

(Search for that line in `hono-preact.test.ts`; only the one assertion changes.)

- [ ] **Step 5: Run the tests to verify they all pass**

```bash
pnpm vitest run packages/vite
```

Expected: PASS.

- [ ] **Step 6: Re-export from the package index**

Append to `packages/vite/src/index.ts`:

```ts
export { clientEntryPlugin, VIRTUAL_CLIENT_ENTRY_ID } from './client-entry.js';
```

- [ ] **Step 7: Commit**

```bash
git add packages/vite/src/hono-preact.ts packages/vite/src/__tests__/hono-preact.test.ts packages/vite/src/index.ts
git commit -m "feat(vite): honoPreact() defaults clientEntry to the virtual module"
```

---

## Task 10: Reshape the generated server entry (TDD)

`generateServerEntrySource` must emit `h(Layout, null, h(LocationProvider, null, h(Routes, { routes })))` instead of `h(Layout, { context: c })`. Drop the `defaultTitle` argument from `renderPage`.

**Files:**
- Modify: `packages/vite/src/server-entry.ts`
- Modify: `packages/vite/src/__tests__/server-entry.test.ts`

- [ ] **Step 1: Update the existing tests for the new shape**

Find the test `'emits the framework imports, mounts loaders/actions/location/catchall, omits api when not provided'` in `packages/vite/src/__tests__/server-entry.test.ts`. Replace these assertions:

```ts
    expect(src).toContain(`import Layout from '/proj/src/Layout.tsx';`);
    expect(src).toContain(`import routes from '/proj/src/routes.ts';`);
```

with:

```ts
    expect(src).toContain(`import Layout from '/proj/src/Layout.tsx';`);
    expect(src).toContain(`import routes from '/proj/src/routes.ts';`);
    expect(src).toContain(`import { LocationProvider } from 'preact-iso';`);
    expect(src).toContain(`import { Routes } from '@hono-preact/iso';`);
```

Find the catch-all assertion. The existing test only checks `src.indexOf('.get(\\'*\\'')`. Add a new assertion right after it that pins down the new shape:

```ts
    expect(src).toContain(
      `(c) => renderPage(c, h(Layout, null, h(LocationProvider, null, h(Routes, { routes }))))`
    );
    // defaultTitle is no longer threaded through renderPage by the framework.
    expect(src).not.toContain('defaultTitle');
```

(Find the existing pipeline-order assertions and keep them; they still apply.)

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/vite/src/__tests__/server-entry.test.ts
```

Expected: FAIL — current generator still emits `h(Layout, { context: c })` with `defaultTitle`.

- [ ] **Step 3: Update `generateServerEntrySource`**

In `packages/vite/src/server-entry.ts`, find the `generateServerEntrySource` function. Replace the body's import block and the catch-all line:

```ts
export function generateServerEntrySource(
  opts: GenerateServerEntrySourceOptions
): string {
  const { layoutAbsPath, routesAbsPath, apiAbsPath } = opts;

  const apiImport = apiAbsPath
    ? `import userApp from '${apiAbsPath}';\n`
    : '';
  const apiMount = apiAbsPath ? `  .route('/', userApp)\n` : '';

  // The generated source is loaded as a virtual module, which Vite/esbuild
  // treats as plain JS by default. Use h() to construct vnodes rather than
  // JSX so the source compiles without a TSX loader hint.
  return (
    `import { Hono } from 'hono';\n` +
    `import { h } from 'preact';\n` +
    `import { LocationProvider } from 'preact-iso';\n` +
    `import { Routes, env } from '@hono-preact/iso';\n` +
    `import {\n` +
    `  actionsHandler,\n` +
    `  loadersHandler,\n` +
    `  location,\n` +
    `  renderPage,\n` +
    `  routeServerModules,\n` +
    `} from '@hono-preact/server';\n` +
    `import Layout from '${layoutAbsPath}';\n` +
    `import routes from '${routesAbsPath}';\n` +
    apiImport +
    `\n` +
    `env.current = 'server';\n` +
    `const serverModules = routeServerModules(routes);\n` +
    `\n` +
    `export const app = new Hono()\n` +
    `  .post('/__loaders', loadersHandler(serverModules))\n` +
    `  .post('/__actions', actionsHandler(serverModules))\n` +
    apiMount +
    `  .use(location)\n` +
    `  .get('*', (c) => renderPage(c, h(Layout, null, h(LocationProvider, null, h(Routes, { routes })))));\n` +
    `\n` +
    `export default app;\n`
  );
}
```

(Note: this also collapses the existing `import { env } from '@hono-preact/iso';` line into the same import block as `Routes`, since both come from the same package. Both are named exports.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run packages/vite
```

Expected: PASS (server-entry tests plus all others).

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-entry.ts packages/vite/src/__tests__/server-entry.test.ts
git commit -m "feat(vite): server entry renders Layout(children) with framework-owned routes"
```

---

## Task 11: Demo migration (cutover)

Delete `client.tsx` and `iso.tsx`. Rewrite `Layout.tsx` to use the framework components.

**Files:**
- Delete: `apps/app/src/client.tsx`
- Delete: `apps/app/src/iso.tsx`
- Modify: `apps/app/src/Layout.tsx`

- [ ] **Step 1: Delete `client.tsx` and `iso.tsx`**

```bash
git rm apps/app/src/client.tsx apps/app/src/iso.tsx
```

- [ ] **Step 2: Rewrite `apps/app/src/Layout.tsx`**

Replace the entire file with:

```tsx
import { ClientScript, Head, ViewTransitions } from 'hono-preact';
import root from '@/styles/root.css?url';
import type { ComponentChildren } from 'preact';

export default function Layout({ children }: { children: ComponentChildren }) {
  return (
    <html>
      <Head defaultTitle="hono-preact">
        <link rel="stylesheet" href={root} />
      </Head>
      <body class="bg-gray-300 isolate">
        <main id="app">{children}</main>
        <ClientScript />
        <ViewTransitions />
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Rebuild framework packages, then typecheck the app**

```bash
pnpm -r --filter './packages/*' build
pnpm --filter app exec tsc --noEmit
```

Expected: PASS. (If pre-existing TS errors surface, note them but don't fix in this task.)

- [ ] **Step 4: Smoke-test the dev server**

```bash
pnpm --filter app dev > /tmp/hp-dev-item4.log 2>&1 &
DEV_PID=$!
sleep 5
curl -s -I http://localhost:5173/ | head -1
curl -s -I http://localhost:5173/movies | head -1
curl -s http://localhost:5173/movies | head -50
curl -s -I http://localhost:5173/api/watched/1/photo | head -2
kill $DEV_PID || true
wait $DEV_PID 2>/dev/null || true
```

Expected: HTTP 200 for `/`, `/movies`. HTML output contains `<title>hono-preact</title>`, `<meta charset>`, `<link rel="stylesheet">`, `<script type="module" src="/@id/__x00__virtual:hono-preact/client">`, the route content. Photo endpoint returns either 200 or 404 (depending on demo data) but no 500.

If something fails, inspect `/tmp/hp-dev-item4.log` for plugin errors.

- [ ] **Step 5: Production build**

```bash
pnpm --filter app build
```

Expected: PASS. Both client build and SSR build complete.

- [ ] **Step 6: Sanity-check the build output**

```bash
ls apps/app/dist/static/ | head
ls apps/app/dist/
node -e "const fs=require('fs');const c=fs.readFileSync('apps/app/dist/index.js','utf8');console.log('size:',c.length);console.log('has /__loaders:',c.includes('__loaders'));console.log('refs virtual client:',c.includes('virtual:hono-preact/client'));"
```

Expected: `dist/static/client.js` and `dist/index.js` exist. SSR bundle should NOT reference `virtual:hono-preact/client` at runtime (the client URL is resolved at build time inside `ClientScript`'s `import.meta.env.PROD` branch — prod build emits `/static/client.js` literal).

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/Layout.tsx
git commit -m "feat(app): drop client.tsx + iso.tsx; Layout uses framework components"
```

---

## Task 12: Update docs (one-line corrections)

The doc site references `client.tsx` and `iso.tsx` as user-authored. Both are gone. Targeted corrections only.

**Files:**
- Modify: `apps/app/src/pages/docs/structure.mdx`
- Modify: `apps/app/src/pages/docs/render-page.mdx`

- [ ] **Step 1: Find the stale claims**

Use the Grep tool:

```
Grep pattern: "client\\.tsx|iso\\.tsx|defaultTitle" path: apps/app/src/pages/docs
```

Expected hits include `structure.mdx` (lists `client.tsx`, `iso.tsx` as user-authored), `render-page.mdx` (documents `defaultTitle` option).

- [ ] **Step 2: Update `structure.mdx`**

Wherever the doc lists `client.tsx` or `iso.tsx` as user-authored files, replace with a note that the framework owns the client entry and routes wrapping. Keep the change minimal: one sentence in the existing paragraph, not a new section.

- [ ] **Step 3: Update `render-page.mdx`**

Where the doc says `defaultTitle` is passed to `renderPage`, add a note that the framework's generated server entry no longer threads it; users express defaults via `<Head defaultTitle="...">` in their Layout. The `renderPage` signature still accepts it for advanced users with custom server entries.

- [ ] **Step 4: Verify docs still build**

```bash
pnpm --filter app build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/docs/structure.mdx apps/app/src/pages/docs/render-page.mdx
git commit -m "docs: framework owns client.tsx/iso.tsx; Head carries defaultTitle"
```

---

## Task 13: Final verification

A whole-repo sanity check before considering item 4 done.

- [ ] **Step 1: Run the full vite-package test suite**

```bash
pnpm vitest run packages/vite
```

Expected: PASS.

- [ ] **Step 2: Run the iso-package test suite**

```bash
pnpm vitest run packages/iso
```

Expected: PASS.

- [ ] **Step 3: Run the server-package test suite**

```bash
pnpm vitest run packages/server
```

Expected: PASS.

- [ ] **Step 4: Typecheck the workspace**

```bash
pnpm -r exec tsc --noEmit
```

Expected: PASS for framework packages. App may have pre-existing errors; note them.

- [ ] **Step 5: Build the app from a clean state**

```bash
rm -rf packages/iso/dist packages/server/dist packages/vite/dist packages/hono-preact/dist apps/app/dist apps/app/node_modules/.vite
pnpm build
```

Expected: PASS. This mirrors what the CF Workers Build pipeline does.

- [ ] **Step 6: Push and verify CF deploy**

```bash
git push
```

Then check CF deploy status with `gh pr checks <pr-number>` once the PR is open.

- [ ] **Step 7: Update the v0.1 burndown memory** (after merge)

After the PR merges, update `/Users/stevenbeshensky/.claude/projects/-Users-stevenbeshensky-Documents-repos-hono-preact/memory/project_v01_sequencing.md` to mark item 4 as ✅ with the merge commit SHA.

---

## Risks and contingencies

**Risk 1: `import.meta.env.PROD` doesn't get statically replaced inside `<ClientScript />` when bundled into the SSR build.**

Vite normally replaces `import.meta.env.PROD` at build time. If for some reason it doesn't (e.g., the SSR bundle takes a different code path), `<ClientScript />` would emit `false` ?: branch into the prod bundle, breaking hydration. Mitigation: the test in Task 5 directly mutates the env object to validate both branches; an end-to-end smoke (Task 11 step 6) confirms the prod bundle doesn't reference the dev URL. If the static replacement fails at build time, fall back to a build-time injected constant via the framework plugin.

**Risk 2: `preact-iso` v3's `onRouteChange` semantics changed.**

The demo's existing iso.tsx works with `onRouteChange` firing before the DOM update, which is what makes view transitions snapshot the right "before" state. If this assumption doesn't hold (the DOM has already updated when `onRouteChange` fires), view transitions wouldn't animate. Mitigation: the `<ViewTransitions />` test asserts the call happens; an end-to-end smoke (manual browser test on `/movies` → `/movies/1`) confirms the visual transition. If it doesn't transition, swap the dispatcher to use a different lifecycle hook from preact-iso.

**Risk 3: Vite's dev URL convention for virtual modules differs from `/@id/__x00__virtual:...`.**

If the dev server doesn't respond at that URL, hydration fails in dev. Mitigation: a quick `curl -I http://localhost:5173/@id/__x00__virtual:hono-preact/client` during Task 11 step 4 will reveal a 404. Alternatives include `/@id/virtual:hono-preact/client` (some versions accept the unprefixed form) or explicit handling via Vite's middleware. The fix is one literal change in `<ClientScript />`.

**Risk 4: Unused exports become dead.**

`HonoContext`/`useHonoContext` stay exported but the demo no longer wraps them. If a future user uses `useHonoContext()` from a view, they'd get `undefined` because the framework's default server entry no longer mounts the provider. Documented in the spec; not a regression for any current user.

**Risk 5: The "Hooks" section in `packages/iso/src/index.ts` may already export `useReload`. Conflict with new `useRouteChange`?**

No name collision (`useReload` vs `useRouteChange`). Just a co-located export; the existing `// Hooks.` comment block is the natural home if we want to consolidate later. For this PR, keep the new exports under their own `// Client entry primitives (item 4 of v0.1).` header to keep the diff legible.

---

## Self-review checklist

- ✅ Spec coverage: every section in `2026-05-10-framework-client-entry-design.md` has at least one task.
  - "Public API" → Tasks 2, 3, 4, 5, 6.
  - "Internals → Generated client entry" → Task 7.
  - "Internals → Generated server entry shape change" → Task 10.
  - "Internals → Internal subscriber registry" → Task 1.
  - "Internals → ClientScript resolution" → Task 5.
  - "Cuts" + "Demo migration" → Task 11.
  - Plumbing for `clientShimPlugin` virtual id → Task 8.
  - Plumbing for `honoPreact()` wiring → Task 9.
  - "Out of scope" items explicitly excluded above.
- ✅ No placeholders: every step has actual code or actual commands; no "TBD", "implement later", "add appropriate handling".
- ✅ Type consistency: `useRouteChange`/`RouteChangeHandler`, `Head`/`HeadProps`, `ClientScript`, `ViewTransitions`, `clientEntryPlugin`/`VIRTUAL_CLIENT_ENTRY_ID`, `__dispatchRouteChange`/`__subscribeRouteChange`/`__enableViewTransitions` used consistently across tasks.
- ✅ TDD throughout: Tasks 1–10 follow red-green-commit; Tasks 11–13 are integration/migration where verification commands are spelled out.
- ✅ Frequent commits: thirteen task-level commits, each leaving the repo in a runnable state.
