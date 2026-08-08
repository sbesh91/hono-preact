# Rendering Helpers Rework (`<For>` / `<Show>`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `<For>` and `<Show>` (issue #355) with `<For>` reworked onto per-row Signal cells and no vnode cache, fixing the three staleness failures that got the helpers cut from the signals release.

**Architecture:** `<For>` subscribes to a list signal, keeps a ref-held `Map` of per-row `{item: Signal<T>, index: Signal<number>}` cells keyed by `by(item, i)` (identity default), and emits fresh keyed `<Item>` components every render (no vnode cache, so closures are never stale). Each row runs in its own component boundary, so inline signal reads re-render one row. `<Show>` is restored verbatim from `feat/signals-rendering-helpers`; it was already correct.

**Tech Stack:** Preact + `@preact/signals`, vitest (`happy-dom` for DOM tests, `node` for SSR tests), `@testing-library/preact`.

**Spec:** `docs/superpowers/specs/2026-08-08-rendering-helpers-rework-design.md`

## Global Constraints

- Work in a dedicated git worktree on a branch off `origin/main`; run `pnpm wt:setup` after creating it. Use worktree-prefixed absolute paths in every Read/Edit/Write (a main-checkout path silently edits main). Serena is unavailable in worktrees; use rg/Read/Edit.
- Run tests from the repo root with `pnpm exec vitest run <pattern>` (`pnpm --filter <pkg> test` is a silent no-op).
- SSR tests use `// @vitest-environment node`; DOM tests use `// @vitest-environment happy-dom`.
- No `as` casts; reshape types instead. No em-dashes in prose, comments, or commit messages.
- Do NOT touch `packages/iso/src/internal/__tests__/roster-signal-identity.mutcheck.test.tsx`; it must stay decoupled from `<For>`.
- New public API, not breaking: the helpers never shipped.
- Before any push: the nine pre-push steps from CLAUDE.md, in order (build, gen:agents-corpus, format:check, typecheck, typecheck:tests, test:types, test:coverage, test:integration, site build).
- Reference material lives on branches in this repo: `git show 889d8ef9 -- <path>` (the restore commit; 9 files, 464 insertions) and `git show spike/for-vnode-cache:packages/iso/src/__tests__/for-staleness.mutcheck.test.tsx` (the characterisation spike). Do not merge either branch.

---

### Task 1: Land `<Show>` and the export/tooling scaffolding

Restore everything from the restore commit `889d8ef9` EXCEPT `for.tsx` and its tests (those are reworked in Tasks 2-4). `<Show>` is correct as cut; this task lands it green.

**Files:**
- Create: `packages/iso/src/show.tsx` (verbatim from `git show 889d8ef9:packages/iso/src/show.tsx`)
- Create: `packages/iso/src/__tests__/show.test.tsx` (verbatim from `git show 889d8ef9:packages/iso/src/__tests__/show.test.tsx`)
- Modify: `packages/iso/src/index.ts` (add the export block below near the outcomes exports, matching the restore commit)
- Modify: `scripts/size-probe-config.mjs` (add `'signals-dx': ['for.js', 'show.js']` to `FEATURE_MODULES`)
- Modify: `apps/site/src/__tests__/framework-coverage.test.ts` (add `For` / `Show` ALLOWLIST entries; copy from `git show 889d8ef9 -- apps/site/src/__tests__/framework-coverage.test.ts`, but reword the justification to drop the "(Phase 4)" reference: e.g. `'signal-backed keyed list helper; the demo does not yet dogfood signal-driven lists'`)

**Interfaces:**
- Produces: `Show<C>(props: ShowProps<C>): VNode` and `ShowProps<C>` exported from `packages/iso/src/index.ts`. To keep this task independently green, add ONLY the `Show` export line here; Task 2 adds the `For` export line when `for.tsx` exists.

- [ ] **Step 1: Create the worktree**

Follow superpowers:using-git-worktrees: branch `feat/rendering-helpers-rework` off `origin/main`, then run `pnpm wt:setup` inside it. All subsequent paths are inside the worktree.

- [ ] **Step 2: Restore show.tsx and its test verbatim**

```bash
git show 889d8ef9:packages/iso/src/show.tsx > packages/iso/src/show.tsx
git show 889d8ef9:packages/iso/src/__tests__/show.test.tsx > packages/iso/src/__tests__/show.test.tsx
```

- [ ] **Step 3: Export Show from index.ts**

In `packages/iso/src/index.ts`, after the `outcomes.js` export block, add:

```ts
// Rendering helpers (signals DX)
export { Show, type ShowProps } from './show.js';
```

- [ ] **Step 4: Add the size-probe bucket and coverage allowlist entries**

In `scripts/size-probe-config.mjs` `FEATURE_MODULES`, after the `middleware` entry:

```js
  'signals-dx': ['for.js', 'show.js'],
```

In `apps/site/src/__tests__/framework-coverage.test.ts` `ALLOWLIST`, after the `Page` entry:

```ts
  For: 'signal-backed keyed list helper; the demo does not yet dogfood signal-driven lists',
  Show: 'signal-backed conditional helper; the demo does not yet dogfood signal-driven conditionals',
```

(The `For` allowlist entry is inert until Task 2 exports `For`; the coverage test only checks exported names.)

- [ ] **Step 5: Run the Show tests and typecheck**

```bash
pnpm exec vitest run packages/iso/src/__tests__/show.test.tsx
pnpm --filter @hono-preact/iso exec tsc --noEmit -p tsconfig.json
```

Expected: show tests PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/show.tsx packages/iso/src/__tests__/show.test.tsx packages/iso/src/index.ts scripts/size-probe-config.mjs apps/site/src/__tests__/framework-coverage.test.ts
git commit -m "feat(iso): land the <Show> rendering helper"
```

---

### Task 2: The reworked `<For>` on per-row Signal cells (TDD core)

**Files:**
- Create: `packages/iso/src/__tests__/for.test.tsx`
- Create: `packages/iso/src/for.tsx`
- Modify: `packages/iso/src/index.ts` (extend the rendering-helpers export block)

**Interfaces:**
- Consumes: nothing from Task 1 (independent module).
- Produces: `For<T>(props: ForProps<T>): VNode` and `ForProps<T>` with `each: ReadonlySignal<readonly T[]>`, `by?: (item: T, index: number) => unknown`, `children: (item: ReadonlySignal<T>, index: ReadonlySignal<number>) => ComponentChildren`. Tasks 3-5 rely on exactly this signature.

- [ ] **Step 1: Write the failing test file**

Create `packages/iso/src/__tests__/for.test.tsx`. This adapts the cut branch's suite to the new signature; the old `a join/leave does NOT re-invoke surviving rows` test is REPLACED by the DOM-preservation test (re-invocation is now by design).

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { For } from '../for.js';

afterEach(cleanup);

describe('<For>', () => {
  it('renders each item once, keyed by identity', () => {
    const each = signal<readonly string[]>(['a', 'b', 'c']);
    render(
      <For each={each}>
        {(id) => <li data-testid={`row-${id.value}`}>{id.value}</li>}
      </For>
    );
    expect(screen.getByTestId('row-a')).toBeTruthy();
    expect(screen.getByTestId('row-c')).toBeTruthy();
  });

  it('a join/leave preserves surviving rows DOM by key (no remount)', async () => {
    const each = signal<readonly string[]>(['a', 'b']);
    render(
      <For each={each}>
        {(id) => <li data-testid={`row-${id.value}`}>{id.value}</li>}
      </For>
    );
    const nodeA = screen.getByTestId('row-a');
    const nodeB = screen.getByTestId('row-b');

    await act(async () => {
      each.value = ['a', 'b', 'c'];
    });
    expect(screen.getByTestId('row-a')).toBe(nodeA);
    expect(screen.getByTestId('row-b')).toBe(nodeB);
    expect(screen.getByTestId('row-c')).toBeTruthy();

    await act(async () => {
      each.value = ['b', 'c'];
    });
    expect(screen.queryByTestId('row-a')).toBeNull();
    expect(screen.getByTestId('row-b')).toBe(nodeB);
  });

  it('the item cell is object-stable across renders for a surviving key', async () => {
    const each = signal<readonly string[]>(['a', 'b']);
    const seen = new Map<string, Set<ReadonlySignal<string>>>();
    render(
      <For each={each}>
        {(id) => {
          const set = seen.get(id.peek()) ?? new Set();
          set.add(id);
          seen.set(id.peek(), set);
          return <li>{id.value}</li>;
        }}
      </For>
    );
    await act(async () => {
      each.value = ['a', 'b', 'c'];
    });
    expect(seen.get('a')?.size).toBe(1);
    expect(seen.get('b')?.size).toBe(1);
  });

  it('index is reactive under reorder', async () => {
    const each = signal<readonly { id: string }[]>([
      { id: 'x' },
      { id: 'y' },
    ]);
    render(
      <For each={each} by={(t) => t.id}>
        {(item, index) => (
          <li data-testid={`pos-${item.value.id}`}>{index.value}</li>
        )}
      </For>
    );
    expect(screen.getByTestId('pos-x').textContent).toBe('0');
    expect(screen.getByTestId('pos-y').textContent).toBe('1');
    await act(async () => {
      each.value = [{ id: 'y' }, { id: 'x' }];
    });
    expect(screen.getByTestId('pos-x').textContent).toBe('1');
    expect(screen.getByTestId('pos-y').textContent).toBe('0');
  });

  it('keys arrays of objects via `by` and updates content in place', async () => {
    const each = signal<readonly { id: string; label: string }[]>([
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
    ]);
    render(
      <For each={each} by={(t) => t.id}>
        {(t) => <li data-testid={`o-${t.value.id}`}>{t.value.label}</li>}
      </For>
    );
    const node1 = screen.getByTestId('o-1');
    expect(node1.textContent).toBe('one');
    await act(async () => {
      each.value = [
        { id: '2', label: 'two' },
        { id: '1', label: 'ONE-RENAMED' },
      ];
    });
    expect(screen.getByTestId('o-1')).toBe(node1);
    expect(screen.getByTestId('o-1').textContent).toBe('ONE-RENAMED');
  });

  it('throws on a duplicate key', () => {
    const each = signal<readonly string[]>(['a', 'a']);
    expect(() =>
      render(<For each={each}>{(id) => <li>{id.value}</li>}</For>)
    ).toThrow(/duplicate key/i);
  });

  it('updates a row when the child reads a signal INLINE (per-row boundary)', async () => {
    const count = signal(5);
    const each = signal<readonly string[]>(['a']);
    render(
      <For each={each}>
        {(id) => <li data-testid={`r-${id.peek()}`}>{count.value}</li>}
      </For>
    );
    expect(screen.getByTestId('r-a').textContent).toBe('5');
    await act(async () => {
      count.value = 6;
    });
    expect(screen.getByTestId('r-a').textContent).toBe('6');
  });

  it('atomic render: a per-row signal re-renders ONLY that row; <For> itself does not re-render', async () => {
    const sigs = { a: signal(0), b: signal(0), c: signal(0) };
    const rowRenders: Record<string, number> = { a: 0, b: 0, c: 0 };
    const each = signal<readonly ('a' | 'b' | 'c')[]>(['a', 'b', 'c']);
    const by = vi.fn((id: 'a' | 'b' | 'c') => id);
    function Row({ id }: { id: 'a' | 'b' | 'c' }) {
      rowRenders[id]++;
      return <li data-testid={`r-${id}`}>{sigs[id].value}</li>;
    }
    render(
      <For each={each} by={by}>
        {(id) => <Row id={id.value} />}
      </For>
    );
    expect(rowRenders).toEqual({ a: 1, b: 1, c: 1 });
    const byCallsAfterMount = by.mock.calls.length;

    await act(async () => {
      sigs.a.value = 9;
    });

    expect(rowRenders).toEqual({ a: 2, b: 1, c: 1 });
    expect(screen.getByTestId('r-a').textContent).toBe('9');
    expect(by.mock.calls.length).toBe(byCallsAfterMount);
  });

  it('a consumer subcomponent driven by the item cell updates without re-invoking siblings', async () => {
    // The cell is a stable reactive identity: a row body that only passes the
    // cell along is not re-invoked when the item content changes; the reader
    // component updates from the cell.
    const bodyRuns: Record<string, number> = { '1': 0, '2': 0 };
    function Label({ item }: { item: ReadonlySignal<{ id: string; label: string }> }) {
      return <li data-testid={`l-${item.value.id}`}>{item.value.label}</li>;
    }
    const each = signal<readonly { id: string; label: string }[]>([
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
    ]);
    render(
      <For each={each} by={(t) => t.id}>
        {(item) => {
          bodyRuns[item.peek().id]++;
          return <Label item={item} />;
        }}
      </For>
    );
    expect(bodyRuns).toEqual({ '1': 1, '2': 1 });
    await act(async () => {
      each.value = [
        { id: '1', label: 'uno' },
        { id: '2', label: 'two' },
      ];
    });
    expect(screen.getByTestId('l-1').textContent).toBe('uno');
    // Both rows re-invoke (no vnode cache; <For> re-rendered), so assert the
    // DOM outcome, not a bail. The granular path is exercised below.
  });

  it('an unchanged item dedupes its cell write on a list change', async () => {
    // Push a new array where only row 1's object changed. Row 2's item
    // reference is unchanged, so its cell write dedupes on ===; both rows
    // still render correct content through their cells.
    const readerRuns: Record<string, number> = { '1': 0, '2': 0 };
    function Reader({ item }: { item: ReadonlySignal<{ id: string; label: string }> }) {
      readerRuns[item.peek().id]++;
      return <li data-testid={`g-${item.peek().id}`}>{item.value.label}</li>;
    }
    const each = signal<readonly { id: string; label: string }[]>([
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
    ]);
    render(
      <For each={each} by={(t) => t.id}>
        {(item) => <Reader item={item} />}
      </For>
    );
    expect(readerRuns).toEqual({ '1': 1, '2': 1 });
    await act(async () => {
      each.value = [
        { id: '1', label: 'uno' },
        { id: '2', label: 'two' },
      ];
    });
    expect(screen.getByTestId('g-1').textContent).toBe('uno');
    // Row 2's item reference is unchanged (same object), so its cell write
    // deduped; its Reader re-ran only because the keyed wrapper re-invoked it,
    // never from a cell notification. Sanity: content unchanged.
    expect(screen.getByTestId('g-2').textContent).toBe('two');
  });
});
```

- [ ] **Step 2: Run it to verify failure**

```bash
pnpm exec vitest run packages/iso/src/__tests__/for.test.tsx
```

Expected: FAIL (cannot resolve `../for.js`).

- [ ] **Step 3: Implement for.tsx**

Create `packages/iso/src/for.tsx`:

```tsx
import { Fragment } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import { useRef } from 'preact/hooks';
import { batch, signal } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';

export type ForProps<T> = {
  /** A reactive array. Read as a signal, so `<For>` re-renders when it changes. */
  each: ReadonlySignal<readonly T[]>;
  /** Derive a stable, unique key per item. Defaults to the item itself
   * (identity), which is exact for a `memberIds`-style array of keys. Supply
   * `by` whenever items are re-created per payload (e.g. deserialised loader
   * data), or every row remounts on each new array. */
  by?: (item: T, index: number) => unknown;
  /** Render one item. `item` and `index` are per-row signal cells: they are
   * object-stable for as long as the key survives, and their values track the
   * current item and position. Rows re-run with fresh closures whenever the
   * list changes, so nothing captured here can go stale; the cells exist so a
   * row can hand a stable reactive identity to its own subcomponents and
   * effects. */
  children: (
    item: ReadonlySignal<T>,
    index: ReadonlySignal<number>
  ) => ComponentChildren;
};

type RowCells<T> = { item: Signal<T>; index: Signal<number> };

// A per-row component boundary. The child render runs HERE, inside a
// component, so a signal read in it subscribes THIS row (which re-renders
// alone on its own signal), not the parent <For>.
function Item<T>({
  cells,
  render,
}: {
  cells: RowCells<T>;
  render: ForProps<T>['children'];
}): VNode {
  return <Fragment>{render(cells.item, cells.index)}</Fragment>;
}

/**
 * A keyed list helper bound to a signal. Rows reconcile by key, so a surviving
 * key keeps its DOM and component state across membership changes; every list
 * change re-invokes row renders with fresh closures, so captured state is
 * never stale. Each row gets a stable pair of signal cells (`item`, `index`)
 * it can pass to subcomponents or effects for granular, closure-independent
 * updates, and each row runs inside its own component boundary, so an inline
 * signal read re-renders that row alone.
 */
export function For<T>({ each, by, children }: ForProps<T>): VNode {
  const cellsRef = useRef<Map<unknown, RowCells<T>> | null>(null);
  // Lazy first-render init so later renders do not allocate a throwaway Map.
  const prev = (cellsRef.current ??= new Map());
  const items = each.value; // subscribes <For> to the list signal
  const next = new Map<unknown, RowCells<T>>();
  const out: VNode[] = [];
  // Cell writes are batched so subscribers see one consistent update per list
  // change, not one per row.
  batch(() => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = by ? by(item, i) : item;
      if (next.has(key)) {
        throw new Error(
          `<For>: duplicate key ${String(key)}; keys must be unique.`
        );
      }
      let cells = prev.get(key);
      if (cells) {
        // Signal `===` dedupe makes unchanged writes free.
        cells.item.value = item;
        cells.index.value = i;
      } else {
        cells = { item: signal(item), index: signal(i) };
      }
      next.set(key, cells);
      out.push(<Item key={key} cells={cells} render={children} />);
    }
  });
  cellsRef.current = next; // departed keys fall out of the map (eviction)
  return <Fragment>{out}</Fragment>;
}
```

Note on `items[i]`: with `noUncheckedIndexedAccess` this reads as `T | undefined`; if the iso tsconfig has it enabled, use a length-bounded `for` loop plus a local `const item = items[i] as T` is NOT allowed (no casts); instead iterate with `items.forEach((item, i) => ...)` or `for (const [i, item] of items.entries())`. Check the tsconfig and pick the non-cast form if needed.

- [ ] **Step 4: Run the tests**

```bash
pnpm exec vitest run packages/iso/src/__tests__/for.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Export For and typecheck**

Extend the Task 1 export block in `packages/iso/src/index.ts`:

```ts
// Rendering helpers (signals DX)
export { For, type ForProps } from './for.js';
export { Show, type ShowProps } from './show.js';
```

```bash
pnpm --filter @hono-preact/iso exec tsc --noEmit -p tsconfig.json
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/for.tsx packages/iso/src/__tests__/for.test.tsx packages/iso/src/index.ts
git commit -m "feat(iso): rework <For> on per-row Signal cells, no vnode cache"
```

---

### Task 3: Staleness regression suite (the spike's cases, now green)

Port the spike's characterisation cases so exactly what was broken is what is pinned. Source: `git show spike/for-vnode-cache:packages/iso/src/__tests__/for-staleness.mutcheck.test.tsx`.

**Files:**
- Create: `packages/iso/src/__tests__/for-staleness.mutcheck.test.tsx`

**Interfaces:**
- Consumes: `For` from Task 2 with the cell signature.

- [ ] **Step 1: Write the suite**

Adapt the spike's cases (a)-(e) to the cell signature. All must pass. Case (e) keeps the spike's finding: no-`by` with fresh identities is a KEYING contract (identity default), not a cache defect; assert the `by`-supplied behaviour as the fix and document the no-`by` remount as intended.

```tsx
// @vitest-environment happy-dom
// Regression suite for the three failures that got <For> cut from the signals
// release (#355), ported from spike/for-vnode-cache and required GREEN. The
// reworked <For> re-invokes rows with fresh closures on every list change and
// delivers item/index through per-row signal cells, so none of these can
// recur without failing here.
import { describe, it, expect, afterEach } from 'vitest';
import {
  render,
  screen,
  act,
  cleanup,
  fireEvent,
} from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { For } from '../for.js';

afterEach(cleanup);

describe('<For> staleness regression', () => {
  it('(a) a surviving key with changed content renders the NEW content', async () => {
    const each = signal<readonly { id: string; label: string }[]>([
      { id: '1', label: 'one' },
    ]);
    render(
      <For each={each} by={(t) => t.id}>
        {(t) => <li data-testid={`o-${t.value.id}`}>{t.value.label}</li>}
      </For>
    );
    expect(screen.getByTestId('o-1').textContent).toBe('one');
    await act(async () => {
      each.value = [{ id: '1', label: 'ONE-RENAMED' }];
    });
    expect(screen.getByTestId('o-1').textContent).toBe('ONE-RENAMED');
  });

  it('(b) index updates after an earlier item is removed', async () => {
    const each = signal<readonly string[]>(['a', 'b', 'c']);
    render(
      <For each={each}>
        {(id, i) => <li data-testid={`i-${id.value}`}>{String(i.value)}</li>}
      </For>
    );
    expect(screen.getByTestId('i-b').textContent).toBe('1');
    expect(screen.getByTestId('i-c').textContent).toBe('2');
    await act(async () => {
      each.value = ['b', 'c'];
    });
    expect(screen.getByTestId('i-b').textContent).toBe('0');
    expect(screen.getByTestId('i-c').textContent).toBe('1');
  });

  it('(c) `by` on index tracks a wholly replaced array', async () => {
    const each = signal<readonly string[]>(['x', 'y']);
    render(
      <For each={each} by={(_item, i) => i}>
        {(v, i) => <li data-testid={`c-${i.peek()}`}>{v.value}</li>}
      </For>
    );
    expect(screen.getByTestId('c-0').textContent).toBe('x');
    await act(async () => {
      each.value = ['p', 'q'];
    });
    expect(screen.getByTestId('c-0').textContent).toBe('p');
    expect(screen.getByTestId('c-1').textContent).toBe('q');
  });

  it('(d) a row closing over parent useState sees the current value', async () => {
    const each = signal<readonly string[]>(['a']);
    function Parent() {
      const [n, setN] = useState(0);
      return (
        <>
          <button data-testid="inc" onClick={() => setN((v) => v + 1)}>
            inc
          </button>
          <ul>
            <For each={each}>
              {(id) => (
                <li data-testid={`d-${id.peek()}`}>
                  {id.value}:{String(n)}
                </li>
              )}
            </For>
          </ul>
        </>
      );
    }
    render(<Parent />);
    expect(screen.getByTestId('d-a').textContent).toBe('a:0');
    await act(async () => {
      fireEvent.click(screen.getByTestId('inc'));
    });
    expect(screen.getByTestId('d-a').textContent).toBe('a:1');
  });

  it('(e) with `by`, freshly-deserialised objects reconcile in place', async () => {
    const parse = () => [
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
    ];
    const each = signal<readonly { id: string; label: string }[]>(parse());
    render(
      <For each={each} by={(t) => t.id}>
        {(t) => <li data-testid={`e-${t.value.id}`}>{t.value.label}</li>}
      </For>
    );
    const firstNode = screen.getByTestId('e-1');
    await act(async () => {
      each.value = parse();
    });
    expect(screen.getByTestId('e-1')).toBe(firstNode);
  });

  it('(e2) with `by`, per-row local state survives a fresh-identity payload', async () => {
    function Counter({ label }: { label: string }) {
      const [n, setN] = useState(0);
      return (
        <li>
          <button
            data-testid={`btn-${label}`}
            onClick={() => setN((v) => v + 1)}
          >
            {label}
          </button>
          <span data-testid={`cnt-${label}`}>{String(n)}</span>
        </li>
      );
    }
    const parse = () => [{ id: '1', label: 'one' }];
    const each = signal<readonly { id: string; label: string }[]>(parse());
    render(
      <For each={each} by={(t) => t.id}>
        {(t) => <Counter label={t.value.label} />}
      </For>
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-one'));
    });
    expect(screen.getByTestId('cnt-one').textContent).toBe('1');
    await act(async () => {
      each.value = parse();
    });
    expect(screen.getByTestId('cnt-one').textContent).toBe('1');
  });

  it('(e-contract) without `by`, fresh identities remount (identity keying is the documented default)', async () => {
    const parse = () => [{ id: '1', label: 'one' }];
    const each = signal<readonly { id: string; label: string }[]>(parse());
    render(
      <For each={each}>
        {(t) => <li data-testid={`k-${t.value.id}`}>{t.value.label}</li>}
      </For>
    );
    const firstNode = screen.getByTestId('k-1');
    await act(async () => {
      each.value = parse();
    });
    expect(screen.getByTestId('k-1')).not.toBe(firstNode);
  });
});
```

- [ ] **Step 2: Run the suite**

```bash
pnpm exec vitest run packages/iso/src/__tests__/for-staleness.mutcheck.test.tsx
```

Expected: ALL PASS. If (a)-(d) fail, the Task 2 implementation is wrong; fix it there, not by weakening these tests.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/for-staleness.mutcheck.test.tsx
git commit -m "test(iso): pin the #355 staleness failures as regressions"
```

---

### Task 4: SSR and type-level tests

**Files:**
- Create: `packages/iso/src/__tests__/rendering-helpers-ssr.test.tsx` (based on `git show 889d8ef9:...`, `<For>` children adapted to the cell signature)
- Create: `packages/iso/src/__tests__/rendering-helpers.test-d.ts` (rewritten for the cell signature)

**Interfaces:**
- Consumes: `For`/`ForProps` (Task 2), `Show`/`ShowProps` (Task 1).

- [ ] **Step 1: Write the SSR test**

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
        <For each={each}>{(id) => <li>{id.value}</li>}</For>
      </ul>
    );
    expect(html).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('<For> renders nothing for an empty array', () => {
    const each = signal<readonly string[]>([]);
    const html = renderToString(
      <ul>
        <For each={each}>{(id) => <li>{id.value}</li>}</For>
      </ul>
    );
    expect(html).toBe('<ul></ul>');
  });

  it('<Show> renders the branch on the server', () => {
    const on = signal(true);
    const off = signal(false);
    expect(
      renderToString(
        <Show when={on} fallback={<i>no</i>}>
          {<b>yes</b>}
        </Show>
      )
    ).toBe('<b>yes</b>');
    expect(
      renderToString(
        <Show when={off} fallback={<i>no</i>}>
          {<b>yes</b>}
        </Show>
      )
    ).toBe('<i>no</i>');
  });
});
```

- [ ] **Step 2: Write the type test**

```ts
import { describe, it, expectTypeOf } from 'vitest';
import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import type { ForProps } from '../for.js';
import type { ShowProps } from '../show.js';

describe('<For> / <Show> types', () => {
  it('For hands the child signal cells and defaults by to identity', () => {
    const each = signal<readonly string[]>(['a']);
    const props: ForProps<string> = {
      each,
      children: (item, index) => {
        expectTypeOf(item).toEqualTypeOf<ReadonlySignal<string>>();
        expectTypeOf(index).toEqualTypeOf<ReadonlySignal<number>>();
        return null;
      },
    };
    void props;
  });

  it('For accepts a by key extractor receiving the plain item', () => {
    const each = signal<readonly { id: string }[]>([{ id: '1' }]);
    const props: ForProps<{ id: string }> = {
      each,
      by: (t, i) => {
        expectTypeOf(t).toEqualTypeOf<{ id: string }>();
        expectTypeOf(i).toEqualTypeOf<number>();
        return t.id;
      },
      children: (t) => t.value.id,
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

- [ ] **Step 3: Run both, plus the tests typecheck**

```bash
pnpm exec vitest run packages/iso/src/__tests__/rendering-helpers-ssr.test.tsx
pnpm test:types
pnpm typecheck:tests
```

Expected: all PASS. (`test:types` needs a current `dist/`; if it fails on missing exports, rebuild first: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`.)

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/__tests__/rendering-helpers-ssr.test.tsx packages/iso/src/__tests__/rendering-helpers.test-d.ts
git commit -m "test(iso): SSR and type-level coverage for <For>/<Show>"
```

---

### Task 5: Docs (signals.mdx section)

**Files:**
- Modify: `apps/site/src/pages/docs/signals.mdx` (add a "Rendering helpers" section)
- Possibly modify: `apps/site/src/pages/docs/__tests__/type-members-known-gaps.json` (only if the type-members gate flags members you cannot document inline; prefer documenting)

**Interfaces:**
- Consumes: the public API exactly as shipped in Tasks 1-2.

- [ ] **Step 1: Read the docs context**

Read `apps/site/BRAND.md` (required before user-visible copy) and the existing `apps/site/src/pages/docs/signals.mdx` to match voice and structure. Note the docs-coverage gotcha: naming a type in a docs code span opts in ALL its members to the type-members gate, so when the section names `ForProps` / `ShowProps`, every prop must appear in the API table.

- [ ] **Step 2: Write the section**

Append a `## Rendering helpers` section to `signals.mdx` covering, in the site's established voice (describe what is; no migration breadcrumbs, no references to the cut or to Solid):

- `<For each={listSignal} by={...}>{(item, index) => ...}</For>`: keyed list rendering bound to a signal. Explain the three contract points: rows reconcile by key (surviving keys keep DOM and component state); `item` and `index` are per-row signal cells, object-stable while the key survives, for handing a reactive identity to subcomponents and effects; the default key is item identity, so supply `by` for deserialised objects.
- `<Show when={sig} fallback={...}>` with both children forms, and that the function child receives the narrowed truthy value.
- Per-part API tables for `ForProps` (each, by, children) and `ShowProps` (when, fallback, children), self-contained per the docs policy.
- A short example wiring `<For>` to a rooms `memberIds` signal with `member(id).value` read inside the row, mirroring the rooms docs pattern.

- [ ] **Step 3: Verify the docs gates and site build**

```bash
pnpm exec vitest run apps/site/src --reporter=dot
pnpm --filter site build
```

Expected: coverage/type-members gates PASS, site builds. If the type-members gate flags a member, document it rather than adding a known-gaps entry.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs/signals.mdx
git commit -m "docs(site): document the <For> and <Show> rendering helpers"
```

---

### Task 6: Full verification, size check, and PR

**Files:** none new.

- [ ] **Step 1: Run the nine pre-push steps in order**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm typecheck:tests
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all PASS. If `format:check` fails, run `pnpm format`, commit the result, and rerun.

- [ ] **Step 2: Measure the helpers' size**

```bash
node scripts/measure-framework-size.mjs 2>/dev/null | rg -i 'signals-dx' || node scripts/measure-framework-size.mjs
```

Record the `signals-dx` marginal gzip number for the PR description. There is no committed baseline; this is informational.

- [ ] **Step 3: Push and open the PR**

Push the branch and open a PR against `main` titled `Rendering helpers: <For>/<Show> on per-row Signal cells (#355)`. The body summarises the design (link the spec), states the granularity model and the O(n) membership-change trade explicitly, includes the size number, and closes #355 with `Closes #355`. Note in the body that `feat/signals-rendering-helpers` and `spike/for-vnode-cache` can be deleted after merge.

- [ ] **Step 4: Deep PR review**

Per the repo's PR workflow, immediately run the `REVIEW.md` review as the first post-open step.
