# Signals DX (keyed rendering helpers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `<For>` (keyed, join/leave-granular) and `<Show>` as first-party signal rendering helpers.

**Architecture:** Both are pure Preact function components that read a `ReadonlyReactive`'s `.value` during render (ambient `@preact/signals` auto-subscribe) and never import `@preact/signals`. `<For>` caches rendered rows by key so a membership change reconciles by key without re-invoking surviving rows. Spec: `docs/superpowers/specs/2026-07-24-signals-dx-design.md`.

**Tech Stack:** Preact, `@preact/signals` (ambient only), `@testing-library/preact`, vitest, `preact-render-to-string`.

## Global Constraints

- No em-dashes in prose, comments, or commit messages.
- No new inline `as` casts. The implementations below are written cast-free (keys are opaque `unknown`); keep them so.
- `<For>` / `<Show>` must NOT import `@preact/signals` (they read `.value` only). Phase 5's module-graph guard asserts `@preact/signals` is reached only through `internal/roster-signal.ts` and `internal/loader-signal.ts`; this phase extends that guard to name `for.tsx` / `show.tsx` as non-importers.
- Core size stays 5521 B gz (nothing new enters the always-loaded `index.ts` graph; the barrel re-exports tree-shake).
- New symbols land on the existing `hono-preact` main entry (no new subpath); the AGENTS appendix subpath gate is unaffected, so no AGENTS edit.
- Tests: mutation-check every regression test (break the code, confirm the test fails, restore).

---

### Task 1: `<For>` keyed list helper

**Files:**
- Create: `packages/iso/src/for.tsx`
- Create: `packages/iso/src/__tests__/for.test.tsx`
- Modify: `packages/iso/src/index.ts` (export `For` / `ForProps`)

**Interfaces:**
- Consumes: `ReadonlyReactive<T>` from `./internal/reactive.js` (`{ readonly value: T }`).
- Produces: `For<T>(props: ForProps<T>): VNode`; `ForProps<T> = { each: ReadonlyReactive<readonly T[]>; by?: (item: T, index: number) => unknown; children: (item: T, index: number) => ComponentChildren }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/iso/src/__tests__/for.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { signal } from '@preact/signals';
import { For } from '../for.js';

afterEach(cleanup);

// A row that records every time it renders, so we can prove survivors do not
// re-render on a membership change.
function makeRow(renders: Map<string, number>) {
  return function Row({ id }: { id: string }) {
    renders.set(id, (renders.get(id) ?? 0) + 1);
    return <li data-testid={`row-${id}`}>{id}</li>;
  };
}

describe('<For>', () => {
  it('renders each item once, keyed by identity', () => {
    const each = signal<readonly string[]>(['a', 'b', 'c']);
    const renders = new Map<string, number>();
    const Row = makeRow(renders);
    render(
      <For each={each}>{(id) => <Row id={id} />}</For>
    );
    expect(screen.getByTestId('row-a')).toBeTruthy();
    expect(screen.getByTestId('row-c')).toBeTruthy();
    expect([...renders.values()]).toEqual([1, 1, 1]);
  });

  it('a join/leave does NOT re-invoke surviving rows', async () => {
    const each = signal<readonly string[]>(['a', 'b']);
    const renders = new Map<string, number>();
    const Row = makeRow(renders);
    render(<For each={each}>{(id) => <Row id={id} />}</For>);
    expect(renders.get('a')).toBe(1);
    expect(renders.get('b')).toBe(1);

    // Join 'c' and leave nobody: 'a' and 'b' must NOT re-render.
    await act(async () => {
      each.value = ['a', 'b', 'c'];
    });
    expect(renders.get('a')).toBe(1); // survivor not re-invoked
    expect(renders.get('b')).toBe(1);
    expect(renders.get('c')).toBe(1);

    // Leave 'a': 'b' and 'c' must NOT re-render, 'a' is unmounted.
    await act(async () => {
      each.value = ['b', 'c'];
    });
    expect(screen.queryByTestId('row-a')).toBeNull();
    expect(renders.get('b')).toBe(1);
    expect(renders.get('c')).toBe(1);
  });

  it('keys arrays of objects via `by`', async () => {
    const each = signal<readonly { id: string; label: string }[]>([
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
    ]);
    render(
      <For each={each} by={(t) => t.id}>
        {(t) => <li data-testid={`o-${t.id}`}>{t.label}</li>}
      </For>
    );
    expect(screen.getByTestId('o-1').textContent).toBe('one');
    // Reorder by the same keys keeps identity (no throw, both still present).
    await act(async () => {
      each.value = [
        { id: '2', label: 'two' },
        { id: '1', label: 'one' },
      ];
    });
    expect(screen.getByTestId('o-2').textContent).toBe('two');
  });

  it('throws on a duplicate key', () => {
    const each = signal<readonly string[]>(['a', 'a']);
    expect(() =>
      render(<For each={each}>{(id) => <li>{id}</li>}</For>)
    ).toThrow(/duplicate key/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/__tests__/for.test.tsx`
Expected: FAIL, cannot find module `../for.js`.

- [ ] **Step 3: Implement `<For>`**

Create `packages/iso/src/for.tsx`:

```tsx
import { Fragment } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import { useRef } from 'preact/hooks';
import type { ReadonlyReactive } from './internal/reactive.js';

export type ForProps<T> = {
  /** A reactive array. Read as a signal, so `<For>` re-renders when it changes. */
  each: ReadonlyReactive<readonly T[]>;
  /** Derive a stable, unique key per item. Defaults to the item itself
   * (identity), which is exact for a `memberIds`-style array of keys. */
  by?: (item: T, index: number) => unknown;
  /** Render one item. The result is cached per key, so a surviving row is NOT
   * re-invoked on a list change; read changing state through signals (e.g.
   * `member(id)`), not through captured non-signal props. */
  children: (item: T, index: number) => ComponentChildren;
};

/**
 * A keyed list helper. It caches each rendered row by key, so a membership
 * change (append / remove / reorder) reconciles by key and re-invokes the child
 * only for a newly appeared key; a surviving row keeps its cached vnode (same
 * reference), so Preact bails on it. Pair with a per-item signal so an item
 * update re-renders that row alone.
 */
export function For<T>({ each, by, children }: ForProps<T>): VNode {
  const cacheRef = useRef<Map<unknown, VNode>>(new Map());
  const prev = cacheRef.current;
  const items = each.value; // subscribes <For> to the list signal
  const next = new Map<unknown, VNode>();
  const out: VNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = by ? by(item, i) : item;
    if (next.has(key)) {
      throw new Error(
        `<For>: duplicate key ${String(key)}; keys must be unique.`
      );
    }
    // Reuse the cached vnode for a surviving key (same reference, so Preact
    // bails on that row); build a fresh keyed row only for a new key.
    const row =
      prev.get(key) ?? <Fragment key={key}>{children(item, i)}</Fragment>;
    next.set(key, row);
    out.push(row);
  }
  cacheRef.current = next; // departed keys fall out of the cache (eviction)
  return <Fragment>{out}</Fragment>;
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/iso/src/index.ts`, add (near the other component exports, e.g. after the `NavLink` export):

```ts
export { For, type ForProps } from './for.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/iso/src/__tests__/for.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Mutation-check the granularity test**

Temporarily replace the cache reuse line with an always-fresh row:
`const row = <Fragment key={key}>{children(item, i)}</Fragment>;`
Run the `join/leave` test. Expected: FAIL (survivor `a`/`b` render count becomes 2). Restore the cache line, re-run, confirm PASS. (Do not commit the mutation.)

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/for.tsx packages/iso/src/__tests__/for.test.tsx packages/iso/src/index.ts
git commit -m "feat(iso): keyed <For> rendering helper"
```

---

### Task 2: `<Show>` conditional helper

**Files:**
- Create: `packages/iso/src/show.tsx`
- Create: `packages/iso/src/__tests__/show.test.tsx`
- Modify: `packages/iso/src/index.ts` (export `Show` / `ShowProps`)

**Interfaces:**
- Consumes: `ReadonlyReactive<C>` from `./internal/reactive.js`.
- Produces: `Show<C>(props: ShowProps<C>): VNode`; `ShowProps<C> = { when: ReadonlyReactive<C>; fallback?: ComponentChildren; children: ComponentChildren | ((value: NonNullable<C>) => ComponentChildren) }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/iso/src/__tests__/show.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { signal } from '@preact/signals';
import { Show } from '../show.js';

afterEach(cleanup);

describe('<Show>', () => {
  it('renders children when truthy, fallback when falsy, and reacts', async () => {
    const when = signal<boolean>(false);
    render(
      <Show when={when} fallback={<span data-testid="fb">empty</span>}>
        <span data-testid="body">shown</span>
      </Show>
    );
    expect(screen.queryByTestId('body')).toBeNull();
    expect(screen.getByTestId('fb')).toBeTruthy();

    await act(async () => {
      when.value = true;
    });
    expect(screen.getByTestId('body')).toBeTruthy();
    expect(screen.queryByTestId('fb')).toBeNull();
  });

  it('passes the narrowed value to a function child', () => {
    const when = signal<{ name: string } | null>({ name: 'ada' });
    render(
      <Show when={when}>{(u) => <span data-testid="n">{u.name}</span>}</Show>
    );
    expect(screen.getByTestId('n').textContent).toBe('ada');
  });

  it('renders nothing by default when falsy', () => {
    const when = signal<number>(0);
    const { container } = render(
      <Show when={when}>
        <span>x</span>
      </Show>
    );
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/__tests__/show.test.tsx`
Expected: FAIL, cannot find module `../show.js`.

- [ ] **Step 3: Implement `<Show>`**

Create `packages/iso/src/show.tsx`:

```tsx
import { Fragment } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import type { ReadonlyReactive } from './internal/reactive.js';

export type ShowProps<C> = {
  /** A reactive condition. `<Show>` re-renders when it changes. */
  when: ReadonlyReactive<C>;
  /** Rendered when `when.value` is falsy. Defaults to nothing. */
  fallback?: ComponentChildren;
  /** Rendered when truthy. A function child receives the narrowed truthy value. */
  children: ComponentChildren | ((value: NonNullable<C>) => ComponentChildren);
};

/**
 * Conditional render bound to a signal: shows `children` when `when.value` is
 * truthy, else `fallback`. A function child receives the narrowed truthy value.
 */
export function Show<C>({ when, fallback, children }: ShowProps<C>): VNode {
  const value = when.value; // subscribes <Show> to the condition signal
  if (!value) {
    return <Fragment>{fallback ?? null}</Fragment>;
  }
  return (
    <Fragment>
      {typeof children === 'function' ? children(value) : children}
    </Fragment>
  );
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/iso/src/index.ts`, after the `For` export:

```ts
export { Show, type ShowProps } from './show.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/iso/src/__tests__/show.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Mutation-check the reactivity test**

Temporarily change `const value = when.value;` to `const value = false;`. Run the first test. Expected: FAIL (body never shows). Restore, re-run, confirm PASS. (Do not commit the mutation.)

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/show.tsx packages/iso/src/__tests__/show.test.tsx packages/iso/src/index.ts
git commit -m "feat(iso): <Show> conditional rendering helper"
```

---

### Task 3: SSR + size bucket + module-graph guard + type tests

**Files:**
- Create: `packages/iso/src/__tests__/rendering-helpers-ssr.test.tsx`
- Create: `packages/iso/src/__tests__/rendering-helpers.test-d.ts`
- Modify: `scripts/size-probe-config.mjs` (add the `signals-dx` bucket)
- Modify: `packages/iso/src/internal/__tests__/signals-always-on.test.ts` (extend the guard)

**Interfaces:**
- Consumes: `For` / `ForProps` from `../for.js`, `Show` / `ShowProps` from `../show.js`.

- [ ] **Step 1: Write the SSR test**

Create `packages/iso/src/__tests__/rendering-helpers-ssr.test.tsx`:

```tsx
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { signal } from '@preact/signals';
import { For } from '../for.js';
import { Show } from '../show.js';

describe('rendering helpers SSR', () => {
  it('<For> renders its rows through renderToString', () => {
    const each = signal<readonly string[]>(['a', 'b']);
    const html = renderToString(
      <ul>
        <For each={each}>{(id) => <li>{id}</li>}</For>
      </ul>
    );
    expect(html).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('<For> renders nothing for an empty array', () => {
    const each = signal<readonly string[]>([]);
    const html = renderToString(
      <ul>
        <For each={each}>{(id) => <li>{id}</li>}</For>
      </ul>
    );
    expect(html).toBe('<ul></ul>');
  });

  it('<Show> renders the branch on the server', () => {
    const on = signal(true);
    const off = signal(false);
    expect(
      renderToString(<Show when={on} fallback={<i>no</i>}>{<b>yes</b>}</Show>)
    ).toBe('<b>yes</b>');
    expect(
      renderToString(<Show when={off} fallback={<i>no</i>}>{<b>yes</b>}</Show>)
    ).toBe('<i>no</i>');
  });
});
```

- [ ] **Step 2: Run the SSR test**

Run: `pnpm exec vitest run packages/iso/src/__tests__/rendering-helpers-ssr.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 3: Write the type tests**

Create `packages/iso/src/__tests__/rendering-helpers.test-d.ts`:

```ts
import { describe, it, expectTypeOf } from 'vitest';
import { signal } from '@preact/signals';
import type { ForProps } from '../for.js';
import type { ShowProps } from '../show.js';

describe('<For> / <Show> types', () => {
  it('For infers the item type in children and defaults by to identity', () => {
    const each = signal<readonly string[]>(['a']);
    const props: ForProps<string> = {
      each,
      children: (item, index) => {
        expectTypeOf(item).toEqualTypeOf<string>();
        expectTypeOf(index).toEqualTypeOf<number>();
        return null;
      },
    };
    void props;
  });

  it('For accepts a by key extractor for object arrays', () => {
    const each = signal<readonly { id: string }[]>([{ id: '1' }]);
    const props: ForProps<{ id: string }> = {
      each,
      by: (t) => t.id,
      children: (t) => t.id,
    };
    void props;
  });

  it('Show function child receives the NonNullable narrowed value', () => {
    const when = signal<{ name: string } | null>(null);
    const props: ShowProps<{ name: string } | null> = {
      when,
      children: (value) => {
        expectTypeOf(value).toEqualTypeOf<{ name: string }>();
        return value.name;
      },
    };
    void props;
  });
});
```

- [ ] **Step 4: Run the type tests**

Run: `pnpm exec vitest --typecheck run packages/iso/src/__tests__/rendering-helpers.test-d.ts`
Expected: PASS, no type errors.

- [ ] **Step 5: Add the size-probe bucket**

In `scripts/size-probe-config.mjs`, add a bucket to `FEATURE_MODULES` (near the other iso feature buckets):

```js
  'signals-dx': ['for.js', 'show.js'],
```

- [ ] **Step 6: Extend the module-graph guard**

In `packages/iso/src/internal/__tests__/signals-always-on.test.ts`, add an assertion inside the existing `describe('signals are the always-on data layer', ...)` block that the two helpers do NOT import `@preact/signals`:

```ts
  it('the rendering helpers are pure Preact (no @preact/signals import)', () => {
    expect(reads('for.tsx', "'@preact/signals'")).toBe(false);
    expect(reads('show.tsx', "'@preact/signals'")).toBe(false);
  });
```

(`reads(rel, needle)` is the existing helper; `for.tsx` / `show.tsx` are at `packages/iso/src`, which is the `iso` base the helper resolves against.) Note the existing `@preact/signals enters the graph ONLY through the two factory modules` test already asserts the whole-tree invariant; this adds an explicit, named check for the two new files.

- [ ] **Step 7: Run the guard + build the barrel**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/signals-always-on.test.ts`
Expected: PASS (4 tests: the 3 existing plus the new one).
Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: clean (the barrel re-exports `For` / `Show`; `dist/for.js` / `dist/show.js` exist for the size probe).

- [ ] **Step 8: Verify the size bucket resolves and core is unchanged**

Run:
```bash
node scripts/measure-framework-size.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).sectionA;console.log('core:',a.core.total,'| signals-dx:',a['signals-dx']?.marginal ?? '(missing)');})"
```
Expected: `core: 5521`; `signals-dx` is a small number (not `(missing)`).

- [ ] **Step 9: Commit**

```bash
git add packages/iso/src/__tests__/rendering-helpers-ssr.test.tsx packages/iso/src/__tests__/rendering-helpers.test-d.ts scripts/size-probe-config.mjs packages/iso/src/internal/__tests__/signals-always-on.test.ts
git commit -m "test(iso): SSR + types + size bucket + guard for <For>/<Show>"
```

---

## Self-Review

**Spec coverage:**
- `<For>` (spec section 3) -> Task 1.
- `<Show>` (spec section 4) -> Task 2.
- SSR (spec section 5) -> Task 3 Step 1.
- Placement / exports / size bucket (spec section 6) -> Task 1/2 barrel exports + Task 3 Step 5.
- Testing incl. mutation-checks + guard + types (spec section 7) -> Task 1 Step 6, Task 2 Step 6, Task 3 Steps 3/6.
- Streaming signals split out (spec section 8) -> intentionally absent.
- Scope excludes signal.map / new @preact/signals importer (spec section 9) -> the guard (Task 3 Step 6) enforces the no-import rule.
- Risks (spec section 10): the per-key cache is covered by the mutation-checked join/leave test (Task 1 Step 6); duplicate keys by the throw test.

**Placeholder scan:** No TBD/TODO; every step shows the exact code and command.

**Type consistency:** `For<T>(ForProps<T>)`, `Show<C>(ShowProps<C>)`, keys typed `unknown` (no `Key` generic, no cast), consistent across the component, tests, and type tests. `ReadonlyReactive<T>` imported from `./internal/reactive.js` in both components.
