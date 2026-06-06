# Menu + Context Menu (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless `Menu` (button-triggered dropdown) and `ContextMenu` (right-click) components for `@hono-preact/ui`, with nested submenus, checkable items, typeahead, and roving-tabindex navigation, over a shared internal core.

**Architecture:** One internal `menu` core (context + parts) consumed by two thin public namespaces (`Menu.*`, `ContextMenu.*`) that differ only in `Root`/`Trigger`. New shared machinery: a `usePosition` virtual-anchor option, a dismiss-stack tree extension for submenu coordination, pure navigation helpers, and a `useTypeahead` hook. Reuses the shipped `usePosition`, `useDismiss`, `useFocusReturn`, `useSafeArea`, `useControllableState`, `useRender`, `mergeRefs`, and the `data-state` contract.

**Tech Stack:** Preact (hooks, no compat), `@floating-ui/dom` (already a dependency), TypeScript, vitest + `@testing-library/preact` (happy-dom). MDX docs in `apps/site`.

**Spec:** `docs/superpowers/specs/2026-06-05-menu-context-menu-design.md`.

**Conventions to follow (read before starting):**
- Components mirror `packages/ui/src/popover/popover.tsx` and `tooltip/tooltip.tsx` exactly: `useRender` for every part, `useControllableState` for open/checked/value, inline `useId` ids in `Root`, `data-state` attributes, Positioner does positioning + Popover-API promotion, Popup does dismiss + focus.
- No inline `as` casts (project CLAUDE.md). Reshape types instead.
- No em-dashes in prose/comments/commit messages.
- Pure modules use `// @vitest-environment node`; component/DOM modules use `// @vitest-environment happy-dom`, `render`/`cleanup`/`fireEvent` from `@testing-library/preact`, and `vi.useFakeTimers()` where timers are involved.
- Each task ends by running the new test file green, then the whole package suite (`pnpm --filter @hono-preact/ui test`) to catch regressions, then commit. Implementation runs on a feature branch (create it in Task 0); only spec/plan docs go to `main`.

---

## File Structure

**New files (package):**
- `packages/ui/src/menu/navigation.ts` — pure nav helpers (`wrapNext`/`wrapPrev`/`matchTypeahead`/`ITEM_SELECTOR`/`getMenuItems`).
- `packages/ui/src/use-typeahead.ts` — keystroke-buffer hook.
- `packages/ui/src/menu/context.ts` — `MenuContext` + `useMenuContext` + `MenuRadioGroupContext`.
- `packages/ui/src/menu/menu.tsx` — all `Menu.*` parts (Root, Trigger, Positioner, Popup, Item, CheckboxItem, RadioGroup, RadioItem, Separator, Group, GroupLabel, Arrow).
- `packages/ui/src/menu/submenu.tsx` — `SubmenuRoot`, `SubmenuTrigger`, `SubmenuPositioner`, `SubmenuPopup`.
- `packages/ui/src/menu/index.ts` — `Menu` namespace + named re-exports.
- `packages/ui/src/context-menu/context-menu.tsx` — `ContextMenuRoot`, `ContextMenuTrigger`.
- `packages/ui/src/context-menu/index.ts` — `ContextMenu` namespace + named re-exports.
- Test files under `packages/ui/src/__tests__/` per task.

**Modified files (package):**
- `packages/ui/src/use-position.ts` — add optional `getAnchorRect` virtual-anchor option.
- `packages/ui/src/dismiss-stack.ts` — add optional `id`/`parentId`; tree-aware outside-press.
- `packages/ui/src/index.ts` — export Menu + ContextMenu (+ keep machinery exports).

**Modified files (repo):**
- `scripts/client-size-config.mjs` — add `menu`/`context-menu` to `COMPONENT_MODULES` and `CHUNK_PREFIXES`.
- `apps/site/src/pages/docs/components/menu.mdx` + `context-menu.mdx` — new docs pages.
- `apps/site/src/pages/docs/nav.ts` — add the two pages under Overlays.
- `apps/site/src/pages/docs/__tests__/nav.test.ts` — update expected nav if it asserts counts/links.

---

## Task 0: Feature branch

- [ ] **Step 1: Create the branch off current main**

Run:
```bash
git checkout -b feat/ui-menu-context-menu
git log --oneline -1
```
Expected: a new branch at the spec commit `309a7d9`.

- [ ] **Step 2: Confirm a clean baseline build + test**

Run:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm --filter @hono-preact/ui test
```
Expected: build succeeds; the existing `@hono-preact/ui` suite passes.

---

## Task 1: `usePosition` virtual-anchor option

Adds a `getAnchorRect` option so the Context Menu can anchor at pointer coordinates (a floating-ui virtual element) instead of an element ref.

**Files:**
- Modify: `packages/ui/src/use-position.ts`
- Test: `packages/ui/src/__tests__/use-position-virtual.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { useRef } from 'preact/hooks';
import { usePosition } from '../use-position.js';

afterEach(() => {
  document.body.innerHTML = '';
});

// A virtual anchor positions the floating element even with no anchor element.
function Harness() {
  const floatingRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement>(null);
  usePosition({
    open: true,
    anchorRef,
    floatingRef,
    getAnchorRect: () => ({
      width: 0,
      height: 0,
      x: 50,
      y: 60,
      top: 60,
      left: 50,
      right: 50,
      bottom: 60,
    }),
    side: 'bottom',
    align: 'start',
  });
  return <div ref={floatingRef}>floating</div>;
}

describe('usePosition virtual anchor', () => {
  it('positions a floating element from getAnchorRect without an anchor element', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    render(<Harness />, host);
    // computePosition is async; let the microtask + autoUpdate frame settle.
    await new Promise((r) => setTimeout(r, 0));
    const el = host.querySelector('div')!;
    expect(el.style.position).toBe('fixed');
    // Positioned below-start of a zero-size rect at (50,60): left ~50, top ~68 (offset 8).
    expect(parseFloat(el.style.left)).toBeGreaterThanOrEqual(40);
    expect(parseFloat(el.style.top)).toBeGreaterThan(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/ui test use-position-virtual`
Expected: FAIL (`getAnchorRect` is not an accepted option; floating element is not positioned).

- [ ] **Step 3: Implement the virtual-anchor option**

In `packages/ui/src/use-position.ts`, import the virtual-element type and add the option. At the top imports add `VirtualElement` and `ClientRectObject`:

```ts
import {
  computePosition,
  autoUpdate,
  offset as offsetMiddleware,
  flip,
  shift,
  arrow as arrowMiddleware,
  type Placement,
  type VirtualElement,
  type ClientRectObject,
} from '@floating-ui/dom';
```

Add to `UsePositionOptions` (after `arrowRef`):

```ts
  // When set, positioning uses this rect (a floating-ui virtual element)
  // instead of `anchorRef.current`. Used by the context menu to anchor at the
  // pointer. Returning null falls back to the anchor element.
  getAnchorRect?: () => ClientRectObject | null;
```

Destructure it: `const { open, anchorRef, floatingRef, arrowRef, side = 'bottom', align = 'center', offset = 8, getAnchorRect } = opts;`

Inside `useLayoutEffect`, build the reference. Replace the early guard and `computePosition(anchor, ...)` reference argument so a virtual element is used when `getAnchorRect` is provided:

```ts
  useLayoutEffect(() => {
    const floating = floatingRef.current;
    if (!open || !floating) return;

    const virtual: VirtualElement | null = getAnchorRect
      ? { getBoundingClientRect: () => getAnchorRect() ?? defaultRect() }
      : null;
    const reference: HTMLElement | VirtualElement | null =
      virtual ?? anchorRef.current;
    if (!reference) return;

    let cancelled = false;

    const update = () => {
      const middleware = [
        offsetMiddleware(offset),
        flip(),
        shift({ padding: 8 }),
      ];
      if (arrowRef?.current) {
        middleware.push(arrowMiddleware({ element: arrowRef.current }));
      }
      computePosition(reference, floating, {
        strategy: 'fixed',
        placement: placementFor(side, align),
        middleware,
      }).then(({ x, y, placement, middlewareData }) => {
        // ...unchanged body...
      });
    };

    const stopAutoUpdate = autoUpdate(reference, floating, update);
    return () => {
      cancelled = true;
      stopAutoUpdate();
    };
  }, [open, side, align, offset, getAnchorRect]);
```

Add a module-level helper near the top (after the type exports):

```ts
// A zero-size rect at the origin; getAnchorRect returning null falls back here
// so computePosition always receives a valid rect.
function defaultRect(): ClientRectObject {
  return { width: 0, height: 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hono-preact/ui test use-position-virtual`
Expected: PASS.

- [ ] **Step 5: Run the package suite (regression guard for Popover/Tooltip)**

Run: `pnpm --filter @hono-preact/ui test`
Expected: all pass (element-anchor path unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/use-position.ts packages/ui/src/__tests__/use-position-virtual.test.ts
git commit -m "feat(ui): usePosition getAnchorRect virtual-anchor option"
```

---

## Task 2: Dismiss-stack tree extension

Adds optional `id`/`parentId` to a dismiss layer. Escape is unchanged (topmost-first). Outside-press becomes tree-aware: a press inside any layer of the same tree dismisses nothing; an outside press dismisses the tree's root.

**Files:**
- Modify: `packages/ui/src/dismiss-stack.ts`
- Modify: `packages/ui/src/use-dismiss.ts`
- Test: `packages/ui/src/__tests__/dismiss-stack-tree.test.ts`
- Existing test that must stay green: `packages/ui/src/__tests__/dismiss-stack.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerDismissLayer, type DismissLayer } from '../dismiss-stack.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = '';
});

function makeRef(el: HTMLElement) {
  return { current: el };
}
function layer(partial: Partial<DismissLayer>): DismissLayer {
  return { refs: [], escape: true, outsidePress: true, onDismiss: vi.fn(), ...partial };
}

describe('dismiss stack tree', () => {
  it('outside press dismisses the tree root, not the topmost child', () => {
    const rootEl = document.createElement('div');
    const subEl = document.createElement('div');
    document.body.append(rootEl, subEl);
    const root = layer({ id: 'root', parentId: null, refs: [makeRef(rootEl)] });
    const sub = layer({ id: 'sub', parentId: 'root', refs: [makeRef(subEl)] });
    cleanups.push(registerDismissLayer(root), registerDismissLayer(sub));

    const outside = document.createElement('button');
    document.body.append(outside);
    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

    expect(root.onDismiss).toHaveBeenCalledWith('outside-press');
    expect(sub.onDismiss).not.toHaveBeenCalled();
  });

  it('a press inside the parent layer of an open submenu dismisses nothing', () => {
    const rootEl = document.createElement('div');
    const subEl = document.createElement('div');
    document.body.append(rootEl, subEl);
    const root = layer({ id: 'root', parentId: null, refs: [makeRef(rootEl)] });
    const sub = layer({ id: 'sub', parentId: 'root', refs: [makeRef(subEl)] });
    cleanups.push(registerDismissLayer(root), registerDismissLayer(sub));

    rootEl.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

    expect(root.onDismiss).not.toHaveBeenCalled();
    expect(sub.onDismiss).not.toHaveBeenCalled();
  });

  it('escape still routes to the innermost (topmost) layer', () => {
    const root = layer({ id: 'root', parentId: null });
    const sub = layer({ id: 'sub', parentId: 'root' });
    cleanups.push(registerDismissLayer(root), registerDismissLayer(sub));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(sub.onDismiss).toHaveBeenCalledWith('escape');
    expect(root.onDismiss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/ui test dismiss-stack-tree`
Expected: FAIL (first test: the topmost child is dismissed instead of the root).

- [ ] **Step 3: Implement the tree extension**

Replace `packages/ui/src/dismiss-stack.ts` with:

```ts
// packages/ui/src/dismiss-stack.ts
import type { RefObject } from 'preact';

export type DismissReason = 'escape' | 'outside-press';

export interface DismissLayer {
  // Optional tree identity. A layer with a parentId coordinates with its
  // ancestors/descendants for outside-press (whole-tree dismissal). Layers with
  // no id are single-node trees (Popover, Tooltip), preserving prior behavior.
  id?: string;
  parentId?: string | null;
  // Elements considered "inside" this layer. A pointerdown within any of them
  // is not an outside-press. Pass the floating element and the anchor/trigger.
  refs: Array<RefObject<HTMLElement>>;
  escape: boolean;
  outsidePress: boolean;
  onDismiss: (reason: DismissReason) => void;
}

const stack: DismissLayer[] = [];
let listening = false;
let autoId = 0;

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].escape) {
      stack[i].onDismiss('escape');
      return;
    }
  }
}

// Walk parentId pointers to the root layer of the tree the given layer is in.
function rootOf(layer: DismissLayer): DismissLayer {
  let current = layer;
  while (current.parentId != null) {
    const parent = stack.find((l) => l.id === current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

function pressInside(layer: DismissLayer, target: Node | null): boolean {
  return layer.refs.some(
    (ref) =>
      ref.current != null && target != null && ref.current.contains(target)
  );
}

function onPointerDown(event: Event) {
  const target = event.target;
  const targetNode = target instanceof Node ? target : null;
  for (let i = stack.length - 1; i >= 0; i--) {
    const layer = stack[i];
    if (!layer.outsidePress) continue;

    // The press is "inside" if it landed within any layer of this layer's tree
    // (the layer, its ancestors, or its descendants). The tree is identified by
    // a shared root.
    const root = rootOf(layer);
    const tree = stack.filter((l) => rootOf(l) === root);
    const inside = tree.some((l) => pressInside(l, targetNode));
    if (inside) return;

    // Outside the whole tree: dismiss the root (which unmounts the subtree).
    root.onDismiss('outside-press');
    return;
  }
}

function ensureListening() {
  if (listening) return;
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  listening = true;
}

function stopListening() {
  if (!listening) return;
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('pointerdown', onPointerDown, true);
  listening = false;
}

// Push a layer onto the stack; returns an unregister function. A layer with no
// id is assigned a unique one so rootOf treats it as its own single-node tree.
export function registerDismissLayer(layer: DismissLayer): () => void {
  if (layer.id == null) layer.id = `dismiss-${autoId++}`;
  if (layer.parentId === undefined) layer.parentId = null;
  stack.push(layer);
  ensureListening();
  return () => {
    const index = stack.indexOf(layer);
    if (index >= 0) stack.splice(index, 1);
    if (stack.length === 0) stopListening();
  };
}
```

- [ ] **Step 4: Thread `id`/`parentId` through `useDismiss`**

In `packages/ui/src/use-dismiss.ts`, add the two optional fields to `UseDismissOptions`:

```ts
export interface UseDismissOptions {
  enabled: boolean;
  refs: Array<RefObject<HTMLElement>>;
  escape?: boolean;
  outsidePress?: boolean;
  onDismiss: (reason: DismissReason) => void;
  id?: string; // dismiss-tree node id (menus); omitted = single-node layer
  parentId?: string | null; // parent menu's id, for submenu coordination
}
```

Destructure and pass them through:

```ts
  const { enabled, refs, escape = true, outsidePress = true, onDismiss, id, parentId } = opts;
  // ...
  useLayoutEffect(() => {
    if (!enabled) return;
    return registerDismissLayer({
      id,
      parentId,
      refs: refsRef.current,
      escape,
      outsidePress,
      onDismiss: (reason) => onDismissRef.current(reason),
    });
  }, [enabled, escape, outsidePress, id, parentId]);
```

- [ ] **Step 5: Run the new + existing dismiss tests**

Run: `pnpm --filter @hono-preact/ui test dismiss-stack`
Expected: both `dismiss-stack.test.ts` (no id/parentId path) and `dismiss-stack-tree.test.ts` PASS.

- [ ] **Step 6: Run the package suite (Popover/Tooltip dismissal regression)**

Run: `pnpm --filter @hono-preact/ui test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/dismiss-stack.ts packages/ui/src/use-dismiss.ts packages/ui/src/__tests__/dismiss-stack-tree.test.ts
git commit -m "feat(ui): dismiss-stack tree coordination for nested menus"
```

---

## Task 3: Pure navigation helpers

Index math, the item selector, the DOM item query (scoped to one menu surface), and typeahead matching. All pure or DOM-only, no Preact.

**Files:**
- Create: `packages/ui/src/menu/navigation.ts`
- Test: `packages/ui/src/__tests__/menu-navigation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  wrapNext,
  wrapPrev,
  matchTypeahead,
  getMenuItems,
  ITEM_SELECTOR,
} from '../menu/navigation.js';

describe('menu navigation math', () => {
  it('wrapNext advances and wraps when loop is true', () => {
    expect(wrapNext(0, 3, true)).toBe(1);
    expect(wrapNext(2, 3, true)).toBe(0);
    expect(wrapNext(-1, 3, true)).toBe(0);
  });
  it('wrapNext clamps at the end when loop is false', () => {
    expect(wrapNext(2, 3, false)).toBe(2);
  });
  it('wrapPrev retreats and wraps when loop is true', () => {
    expect(wrapPrev(0, 3, true)).toBe(2);
    expect(wrapPrev(2, 3, true)).toBe(1);
  });
  it('wrapPrev clamps at the start when loop is false', () => {
    expect(wrapPrev(0, 3, false)).toBe(0);
  });
});

describe('typeahead matching', () => {
  const labels = ['Cut', 'Copy', 'Paste', 'Delete'];
  it('matches the next label starting with the query (circular)', () => {
    expect(matchTypeahead(labels, 'p', 0)).toBe(2);
    expect(matchTypeahead(labels, 'c', 0)).toBe(1); // from index 0 -> next "C"
    expect(matchTypeahead(labels, 'c', 1)).toBe(0); // wraps back to "Cut"
  });
  it('is case-insensitive and returns -1 on no match', () => {
    expect(matchTypeahead(labels, 'PA', 0)).toBe(2);
    expect(matchTypeahead(labels, 'z', 0)).toBe(-1);
  });
});

describe('getMenuItems', () => {
  it('returns enabled items scoped to the given surface, in DOM order', () => {
    document.body.innerHTML = `
      <div role="menu" id="m">
        <div role="menuitem" data-menu-item>A</div>
        <div role="menuitem" data-menu-item aria-disabled="true">B</div>
        <div role="separator"></div>
        <div role="menuitemcheckbox" data-menu-item>C</div>
        <div role="menu" id="sub">
          <div role="menuitem" data-menu-item>NESTED</div>
        </div>
      </div>`;
    const surface = document.getElementById('m')!;
    const items = getMenuItems(surface);
    expect(items.map((el) => el.textContent)).toEqual(['A', 'C']);
  });

  it('ITEM_SELECTOR targets the three menu item roles', () => {
    expect(ITEM_SELECTOR).toContain('menuitem');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/ui test menu-navigation`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the helpers**

Create `packages/ui/src/menu/navigation.ts`:

```ts
// packages/ui/src/menu/navigation.ts
//
// Pure navigation helpers for the roving-tabindex menu. Index math is fully
// pure; getMenuItems is DOM-only (no Preact).

// Navigable item roles carry data-menu-item; disabled items set
// aria-disabled="true" and are excluded here.
export const ITEM_SELECTOR =
  '[data-menu-item]:not([aria-disabled="true"])';

export function wrapNext(current: number, length: number, loop: boolean): number {
  if (length === 0) return -1;
  const next = current + 1;
  if (next < length) return next;
  return loop ? 0 : length - 1;
}

export function wrapPrev(current: number, length: number, loop: boolean): number {
  if (length === 0) return -1;
  const prev = current - 1;
  if (prev >= 0) return prev;
  return loop ? length - 1 : 0;
}

// The next item (circularly, starting after `fromIndex`) whose text begins with
// `query`. Returns -1 when nothing matches.
export function matchTypeahead(
  labels: string[],
  query: string,
  fromIndex: number
): number {
  const q = query.toLowerCase();
  const n = labels.length;
  for (let step = 1; step <= n; step++) {
    const i = (fromIndex + step) % n;
    if (labels[i].trim().toLowerCase().startsWith(q)) return i;
  }
  return -1;
}

// Enabled items belonging to exactly this surface (not a nested submenu), in
// DOM order. Scoping by closest [role="menu"] keeps a submenu's items out of
// the parent's navigation even though they are DOM descendants.
export function getMenuItems(surface: HTMLElement): HTMLElement[] {
  const all = Array.from(
    surface.querySelectorAll<HTMLElement>(ITEM_SELECTOR)
  );
  return all.filter((el) => el.closest('[role="menu"]') === surface);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hono-preact/ui test menu-navigation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/menu/navigation.ts packages/ui/src/__tests__/menu-navigation.test.ts
git commit -m "feat(ui): pure menu navigation + typeahead helpers"
```

---

## Task 4: `useTypeahead` hook

Buffers printable keystrokes, resets after an idle gap, and returns the accumulated query for the caller to match.

**Files:**
- Create: `packages/ui/src/use-typeahead.ts`
- Test: `packages/ui/src/__tests__/use-typeahead.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useTypeahead } from '../use-typeahead.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

let api: { onChar: (c: string) => string } | null = null;
function Harness({ idleMs }: { idleMs?: number }) {
  const fn = useTypeahead({ idleMs });
  const ref = useRef(fn);
  ref.current = fn;
  api = { onChar: (c) => ref.current(c) };
  return null;
}

describe('useTypeahead', () => {
  it('accumulates characters within the idle window', () => {
    render(<Harness idleMs={500} />);
    expect(api!.onChar('p')).toBe('p');
    expect(api!.onChar('a')).toBe('pa');
    expect(api!.onChar('s')).toBe('pas');
  });

  it('resets the buffer after the idle gap', () => {
    render(<Harness idleMs={500} />);
    expect(api!.onChar('p')).toBe('p');
    vi.advanceTimersByTime(500);
    expect(api!.onChar('c')).toBe('c');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/ui test use-typeahead`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the hook**

Create `packages/ui/src/use-typeahead.ts`:

```ts
// packages/ui/src/use-typeahead.ts
import { useCallback, useEffect, useRef } from 'preact/hooks';

export interface UseTypeaheadOptions {
  idleMs?: number; // reset the buffer after this idle gap, default 500
}

// Returns an onChar(char) callback that accumulates printable characters into a
// query string and returns the current query. The buffer resets after idleMs of
// no input. The caller matches the returned query against item labels.
export function useTypeahead(opts: UseTypeaheadOptions = {}): (char: string) => string {
  const { idleMs = 500 } = opts;
  const bufferRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  return useCallback(
    (char: string) => {
      clear();
      bufferRef.current += char;
      timerRef.current = setTimeout(() => {
        bufferRef.current = '';
        timerRef.current = null;
      }, idleMs);
      return bufferRef.current;
    },
    [clear, idleMs]
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hono-preact/ui test use-typeahead`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/use-typeahead.ts packages/ui/src/__tests__/use-typeahead.test.tsx
git commit -m "feat(ui): useTypeahead keystroke-buffer hook"
```

---

## Task 5: Menu context + Root + Trigger

The context shape every part reads, plus the root provider and the button trigger.

**Files:**
- Create: `packages/ui/src/menu/context.ts`
- Create: `packages/ui/src/menu/menu.tsx` (Root + Trigger this task; later tasks append parts)
- Test: `packages/ui/src/__tests__/menu-trigger.test.tsx`

- [ ] **Step 1: Write the context module**

Create `packages/ui/src/menu/context.ts`:

```ts
// packages/ui/src/menu/context.ts
import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';
import type {
  Side,
  Align,
  PositionState,
  ClientRectGetter,
} from '../use-position.js';

export interface MenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  // Close the entire menu tree (root). On a submenu this is the parent's
  // closeAll, so item activation anywhere collapses the whole menu.
  closeAll: () => void;
  // Dismiss-tree identity.
  dismissId: string;
  parentDismissId: string | null;
  anchorRef: RefObject<HTMLElement>; // trigger (Menu) or unused (ContextMenu)
  floatingRef: RefObject<HTMLElement>; // Positioner element
  popupRef: RefObject<HTMLElement>; // Popup surface (focus + nav root)
  arrowRef: RefObject<HTMLElement>;
  triggerId: string;
  popupId: string;
  // Roving tabindex: the id of the active item (null until open focuses one).
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  // Which edge to focus when the menu opens ('first' default, 'last' on ArrowUp).
  pendingEdgeRef: RefObject<'first' | 'last'>;
  side: Side;
  align: Align;
  offset: number;
  loop: boolean;
  typeahead: boolean;
  position: PositionState;
  setPosition: (p: PositionState) => void;
  // Context menu only: positions at the pointer. Undefined for Menu.
  getAnchorRect?: ClientRectGetter;
}

export const MenuContext = createContext<MenuContextValue | null>(null);

export function useMenuContext(part: string): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (!ctx) {
    throw new Error(`<Menu.${part}> must be used within <Menu.Root> or <ContextMenu.Root>`);
  }
  return ctx;
}

// Per-RadioGroup selection context.
export interface MenuRadioGroupContextValue {
  value: string | undefined;
  setValue: (value: string) => void;
}
export const MenuRadioGroupContext =
  createContext<MenuRadioGroupContextValue | null>(null);
export function useMenuRadioGroupContext(): MenuRadioGroupContextValue {
  const ctx = useContext(MenuRadioGroupContext);
  if (!ctx) {
    throw new Error('<Menu.RadioItem> must be used within <Menu.RadioGroup>');
  }
  return ctx;
}
```

Add the `ClientRectGetter` type export to `packages/ui/src/use-position.ts` (next to the existing exports), so `context.ts` and the menu parts can name it without importing floating-ui directly:

```ts
import { type ClientRectObject } from '@floating-ui/dom';
// ...
export type ClientRectGetter = () => ClientRectObject | null;
```

And change the `getAnchorRect` option type added in Task 1 to use it: `getAnchorRect?: ClientRectGetter;`.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { MenuRoot, MenuTrigger } from '../menu/menu.js';

afterEach(cleanup);

describe('Menu Trigger', () => {
  it('wires aria-haspopup=menu and toggles open on click', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(
      <MenuRoot onOpenChange={onOpenChange}>
        <MenuTrigger>Open</MenuTrigger>
      </MenuRoot>
    );
    const trigger = getByText('Open');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('opens on ArrowDown', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(
      <MenuRoot onOpenChange={onOpenChange}>
        <MenuTrigger>Open</MenuTrigger>
      </MenuRoot>
    );
    fireEvent.keyDown(getByText('Open'), { key: 'ArrowDown' });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/ui test menu-trigger`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement Root + Trigger**

Create `packages/ui/src/menu/menu.tsx`:

```tsx
// packages/ui/src/menu/menu.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align, PositionState } from '../use-position.js';
import { MenuContext, useMenuContext } from './context.js';

export interface MenuRootProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side; // default 'bottom'
  align?: Align; // default 'start'
  offset?: number; // default 8
  loop?: boolean; // wrap arrow navigation, default true
  typeahead?: boolean; // type-to-focus, default true
  children?: ComponentChildren;
}

export function MenuRoot(props: MenuRootProps) {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    side = 'bottom',
    align = 'start',
    offset = 8,
    loop = true,
    typeahead = true,
    children,
  } = props;

  const [open, setOpen] = useControllableState<boolean>({
    value: openProp,
    defaultValue: defaultOpen ?? false,
    onChange: onOpenChange,
  });

  const anchorRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLElement>(null);
  const arrowRef = useRef<HTMLElement>(null);
  const pendingEdgeRef = useRef<'first' | 'last'>('first');

  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const popupId = `${baseId}-popup`;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [position, setPosition] = useState<PositionState>({
    side,
    align,
    arrowX: null,
    arrowY: null,
  });

  const closeAll = useCallback(() => setOpen(false), [setOpen]);

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      closeAll,
      dismissId: baseId,
      parentDismissId: null,
      anchorRef,
      floatingRef,
      popupRef,
      arrowRef,
      triggerId,
      popupId,
      activeId,
      setActiveId,
      pendingEdgeRef,
      side,
      align,
      offset,
      loop,
      typeahead,
      position,
      setPosition,
      getAnchorRect: undefined,
    }),
    [
      open,
      setOpen,
      closeAll,
      baseId,
      triggerId,
      popupId,
      activeId,
      side,
      align,
      offset,
      loop,
      typeahead,
      position,
    ]
  );

  return h(MenuContext.Provider, { value: ctx }, children);
}

export type MenuTriggerProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function MenuTrigger(props: MenuTriggerProps): VNode {
  const { render, children, onClick, onKeyDown, ...rest } = props;
  const ctx = useMenuContext('Trigger');

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    ctx.pendingEdgeRef.current = 'first';
    ctx.setOpen(!ctx.open);
  };
  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      ctx.pendingEdgeRef.current = 'first';
      ctx.setOpen(true);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      ctx.pendingEdgeRef.current = 'last';
      ctx.setOpen(true);
    }
  };

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      ref: ctx.anchorRef,
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': ctx.open,
      'aria-controls': ctx.open ? ctx.popupId : undefined,
      id: ctx.triggerId,
      'data-state': ctx.open ? 'open' : 'closed',
      onClick: handleClick,
      onKeyDown: handleKeyDown,
    },
    state: { open: ctx.open },
    children,
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hono-preact/ui test menu-trigger`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/menu/context.ts packages/ui/src/menu/menu.tsx packages/ui/src/use-position.ts packages/ui/src/__tests__/menu-trigger.test.tsx
git commit -m "feat(ui): Menu context + Root + Trigger"
```

---

## Task 6: Menu Positioner + Popup (positioning, dismiss, focus, navigation)

The Positioner runs `usePosition` + Popover-API promotion (verbatim Popover pattern). The Popup is `role="menu"`, registers the dismiss-tree layer, moves focus to the first/last item on open, and owns the keyboard navigation + typeahead handler.

**Files:**
- Modify: `packages/ui/src/menu/menu.tsx` (append parts)
- Test: `packages/ui/src/__tests__/menu-navigation-dom.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuItem,
} from '../menu/menu.js';

afterEach(cleanup);

function Harness() {
  return (
    <MenuRoot defaultOpen>
      <MenuTrigger>Open</MenuTrigger>
      <MenuPositioner>
        <MenuPopup>
          <MenuItem>Cut</MenuItem>
          <MenuItem>Copy</MenuItem>
          <MenuItem>Paste</MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuRoot>
  );
}

describe('Menu navigation', () => {
  it('renders role=menu with menuitems and focuses the first on open', async () => {
    const { getByRole, getByText } = render(<Harness />);
    const menu = getByRole('menu');
    expect(menu.getAttribute('aria-labelledby')).toBeTruthy();
    // first item focused + tabindex 0
    await act(async () => {});
    const cut = getByText('Cut');
    expect(document.activeElement).toBe(cut);
    expect(cut.getAttribute('tabindex')).toBe('0');
  });

  it('ArrowDown moves focus to the next item and wraps', async () => {
    const { getByRole, getByText } = render(<Harness />);
    await act(async () => {});
    const menu = getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getByText('Copy'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getByText('Cut')); // wrapped
  });

  it('typeahead focuses the matching item', async () => {
    const { getByRole, getByText } = render(<Harness />);
    await act(async () => {});
    const menu = getByRole('menu');
    fireEvent.keyDown(menu, { key: 'p' });
    expect(document.activeElement).toBe(getByText('Paste'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/ui test menu-navigation-dom`
Expected: FAIL (`MenuPositioner`/`MenuPopup`/`MenuItem` not exported).

- [ ] **Step 3: Implement Positioner + Popup**

Append to `packages/ui/src/menu/menu.tsx`. First extend the imports at the top of the file:

```tsx
import { useLayoutEffect } from 'preact/hooks';
import { usePosition } from '../use-position.js';
import { useDismiss } from '../use-dismiss.js';
import { useFocusReturn } from '../use-focus-return.js';
import { useTypeahead } from '../use-typeahead.js';
import {
  wrapNext,
  wrapPrev,
  matchTypeahead,
  getMenuItems,
} from './navigation.js';
```

Then append the parts:

```tsx
function supportsPopover(el: HTMLElement): boolean {
  return typeof el.showPopover === 'function';
}

export type MenuPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function MenuPositioner(props: MenuPositionerProps): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = useMenuContext('Positioner');

  const position = usePosition({
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    getAnchorRect: ctx.getAnchorRect,
  });

  useLayoutEffect(() => {
    ctx.setPosition(position);
  }, [position.side, position.align, position.arrowX, position.arrowY]);

  useLayoutEffect(() => {
    const el = ctx.floatingRef.current;
    if (!ctx.open || !el || !supportsPopover(el)) return;
    el.setAttribute('popover', 'manual');
    el.showPopover();
    return () => {
      el.hidePopover();
      el.removeAttribute('popover');
    };
  }, [ctx.open]);

  if (!ctx.open) return null;

  return useRender<{ side: Side; align: Align }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.floatingRef,
      'data-side': position.side,
      'data-align': position.align,
      style: {
        position: 'fixed',
        inset: 'auto',
        margin: 0,
        overflow: 'visible',
        border: 0,
        padding: 0,
        background: 'transparent',
      },
    },
    state: { side: position.side, align: position.align },
    children,
  });
}

export type MenuPopupProps = {
  render?: RenderProp<{ open: boolean }>;
  'aria-label'?: string;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function MenuPopup(props: MenuPopupProps): VNode {
  const { render, children, 'aria-label': ariaLabel, onKeyDown, ...rest } = props;
  const ctx = useMenuContext('Popup');
  const runTypeahead = useTypeahead();

  useDismiss({
    enabled: ctx.open,
    refs: [ctx.floatingRef, ctx.anchorRef],
    escape: true,
    outsidePress: true,
    onDismiss: () => ctx.setOpen(false),
    id: ctx.dismissId,
    parentId: ctx.parentDismissId,
  });

  // Return focus to the trigger on close (no trap).
  useFocusReturn({ open: ctx.open, popupRef: ctx.popupRef });

  // On open, focus the first (or last, on ArrowUp open) enabled item.
  useLayoutEffect(() => {
    if (!ctx.open) return;
    const surface = ctx.popupRef.current;
    if (!surface) return;
    const items = getMenuItems(surface);
    if (items.length === 0) return;
    const el = ctx.pendingEdgeRef.current === 'last' ? items[items.length - 1] : items[0];
    ctx.setActiveId(el.id);
    el.focus();
  }, [ctx.open]);

  const focusIndex = (items: HTMLElement[], index: number) => {
    if (index < 0 || index >= items.length) return;
    const el = items[index];
    ctx.setActiveId(el.id);
    el.focus();
  };

  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const surface = ctx.popupRef.current;
    if (!surface) return;
    const items = getMenuItems(surface);
    const current = items.findIndex((el) => el.id === ctx.activeId);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusIndex(items, wrapNext(current, items.length, ctx.loop));
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusIndex(items, wrapPrev(current, items.length, ctx.loop));
        return;
      case 'Home':
        event.preventDefault();
        focusIndex(items, 0);
        return;
      case 'End':
        event.preventDefault();
        focusIndex(items, items.length - 1);
        return;
      case 'Tab':
        // Close the menu; let the default tab proceed from the trigger.
        ctx.setOpen(false);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (current >= 0) items[current].click();
        return;
    }

    // Typeahead: printable single characters (ignore modifier combos).
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const query = runTypeahead(event.key);
      const labels = items.map((el) => el.textContent ?? '');
      const match = matchTypeahead(labels, query, current < 0 ? -1 : current - (query.length > 1 ? 1 : 0));
      if (match >= 0) {
        event.preventDefault();
        focusIndex(items, match);
      }
    }
  };

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.popupRef,
      role: 'menu',
      id: ctx.popupId,
      tabIndex: -1,
      'aria-orientation': 'vertical',
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabel ? undefined : ctx.triggerId,
      'data-state': ctx.open ? 'open' : 'closed',
      onKeyDown: handleKeyDown,
    },
    state: { open: ctx.open },
    children,
  });
}
```

Note on the typeahead `fromIndex`: when the buffer is still a single char, search from the current item so repeated presses cycle; once the buffer has grown, anchor the search to the current item so it stays put while the word completes. The expression keeps the same item matched as the query lengthens.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hono-preact/ui test menu-navigation-dom`
Expected: PASS. (Depends on `MenuItem` from Task 7; if running tasks strictly in order, write a minimal inline `MenuItem` stub first OR run Tasks 6 and 7 together. Recommended: implement `MenuItem` (Task 7) before running this test, since the navigation test renders items.)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/menu/menu.tsx packages/ui/src/__tests__/menu-navigation-dom.test.tsx
git commit -m "feat(ui): Menu Positioner + Popup with roving nav + typeahead"
```

---

## Task 7: Menu Item

The action item: `role="menuitem"`, roving tabindex, pointer-highlight, `onSelect`, close-on-select (preventable), and disabled handling.

**Files:**
- Modify: `packages/ui/src/menu/menu.tsx`
- Test: `packages/ui/src/__tests__/menu-item.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuItem,
} from '../menu/menu.js';

afterEach(cleanup);

function Harness({
  onSelect,
  onOpenChange,
  keepOpen,
}: {
  onSelect?: (e: Event) => void;
  onOpenChange?: (o: boolean) => void;
  keepOpen?: boolean;
}) {
  return (
    <MenuRoot defaultOpen onOpenChange={onOpenChange}>
      <MenuTrigger>Open</MenuTrigger>
      <MenuPositioner>
        <MenuPopup>
          <MenuItem
            onSelect={(e) => {
              onSelect?.(e);
              if (keepOpen) e.preventDefault();
            }}
          >
            Cut
          </MenuItem>
          <MenuItem disabled>Disabled</MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuRoot>
  );
}

describe('Menu Item', () => {
  it('fires onSelect and closes the menu on click', async () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const { getByText } = render(
      <Harness onSelect={onSelect} onOpenChange={onOpenChange} />
    );
    await act(async () => {});
    fireEvent.click(getByText('Cut'));
    expect(onSelect).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('preventDefault in onSelect keeps the menu open', async () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(<Harness keepOpen onOpenChange={onOpenChange} />);
    await act(async () => {});
    onOpenChange.mockClear();
    fireEvent.click(getByText('Cut'));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('marks disabled items aria-disabled and skips them in navigation', async () => {
    const { getByText, getByRole } = render(<Harness />);
    await act(async () => {});
    const disabled = getByText('Disabled');
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(getByRole('menu'), { key: 'ArrowDown' });
    // only one enabled item -> focus stays on Cut
    expect(document.activeElement).toBe(getByText('Cut'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/ui test menu-item`
Expected: FAIL (`MenuItem` not exported).

- [ ] **Step 3: Implement MenuItem**

Append to `packages/ui/src/menu/menu.tsx`. Add `useId` is already imported; add the part:

```tsx
export type MenuItemProps = {
  render?: RenderProp<{ disabled: boolean; highlighted: boolean }>;
  disabled?: boolean;
  // Activation handler. Call event.preventDefault() to keep the menu open.
  onSelect?: (event: Event) => void;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'onSelect'>;

export function MenuItem(props: MenuItemProps): VNode {
  const { render, children, disabled = false, onSelect, onClick, onPointerEnter, ...rest } = props;
  const ctx = useMenuContext('Item');
  const id = useId();
  const highlighted = ctx.activeId === id;

  const activate = () => {
    const event = new Event('menu-select', { cancelable: true });
    onSelect?.(event);
    if (!event.defaultPrevented) ctx.closeAll();
  };

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    if (disabled) return;
    activate();
  };
  const handlePointerEnter = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    onPointerEnter?.(event);
    if (disabled) return;
    ctx.setActiveId(id);
    (event.currentTarget as HTMLElement).focus();
  };

  return useRender<{ disabled: boolean; highlighted: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      id,
      role: 'menuitem',
      'data-menu-item': '',
      tabIndex: highlighted ? 0 : -1,
      'aria-disabled': disabled ? 'true' : undefined,
      'data-disabled': disabled ? '' : undefined,
      'data-highlighted': highlighted ? '' : undefined,
      onClick: handleClick,
      onPointerEnter: handlePointerEnter,
    },
    state: { disabled, highlighted },
    children,
  });
}
```

- [ ] **Step 4: Run the Item + navigation tests**

Run: `pnpm --filter @hono-preact/ui test menu-item menu-navigation-dom`
Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/menu/menu.tsx packages/ui/src/__tests__/menu-item.test.tsx
git commit -m "feat(ui): Menu Item with onSelect, close-on-select, disabled"
```

---

## Task 8: CheckboxItem + RadioGroup + RadioItem

Checkable items with controllable selection models.

**Files:**
- Modify: `packages/ui/src/menu/menu.tsx`
- Test: `packages/ui/src/__tests__/menu-checkable.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
} from '../menu/menu.js';

afterEach(cleanup);

describe('Menu checkable items', () => {
  it('CheckboxItem exposes aria-checked and fires onCheckedChange', async () => {
    const onCheckedChange = vi.fn();
    const { getByText } = render(
      <MenuRoot defaultOpen>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPositioner>
          <MenuPopup>
            <MenuCheckboxItem checked={false} onCheckedChange={onCheckedChange}>
              Bold
            </MenuCheckboxItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuRoot>
    );
    await act(async () => {});
    const item = getByText('Bold');
    expect(item.getAttribute('role')).toBe('menuitemcheckbox');
    expect(item.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(item);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('RadioGroup tracks the selected value via RadioItem', async () => {
    const onValueChange = vi.fn();
    const { getByText } = render(
      <MenuRoot defaultOpen>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPositioner>
          <MenuPopup>
            <MenuRadioGroup value="sm" onValueChange={onValueChange}>
              <MenuRadioItem value="sm">Small</MenuRadioItem>
              <MenuRadioItem value="lg">Large</MenuRadioItem>
            </MenuRadioGroup>
          </MenuPopup>
        </MenuPositioner>
      </MenuRoot>
    );
    await act(async () => {});
    expect(getByText('Small').getAttribute('aria-checked')).toBe('true');
    expect(getByText('Large').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(getByText('Large'));
    expect(onValueChange).toHaveBeenCalledWith('lg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/ui test menu-checkable`
Expected: FAIL (parts not exported).

- [ ] **Step 3: Implement the checkable parts**

Append to `packages/ui/src/menu/menu.tsx`. Extend imports with the radio-group context:

```tsx
import {
  MenuContext,
  useMenuContext,
  MenuRadioGroupContext,
  useMenuRadioGroupContext,
} from './context.js';
```

Add the parts:

```tsx
export type MenuCheckboxItemProps = {
  render?: RenderProp<{ checked: boolean; disabled: boolean; highlighted: boolean }>;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  onSelect?: (event: Event) => void;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'onSelect' | 'checked'>;

export function MenuCheckboxItem(props: MenuCheckboxItemProps): VNode {
  const {
    render,
    children,
    checked: checkedProp,
    defaultChecked,
    onCheckedChange,
    disabled = false,
    onSelect,
    onClick,
    onPointerEnter,
    ...rest
  } = props;
  const ctx = useMenuContext('CheckboxItem');
  const id = useId();
  const highlighted = ctx.activeId === id;
  const [checked, setChecked] = useControllableState<boolean>({
    value: checkedProp,
    defaultValue: defaultChecked ?? false,
    onChange: onCheckedChange,
  });

  const activate = () => {
    setChecked(!checked);
    const event = new Event('menu-select', { cancelable: true });
    onSelect?.(event);
    if (!event.defaultPrevented) ctx.closeAll();
  };
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    if (disabled) return;
    activate();
  };
  const handlePointerEnter = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    onPointerEnter?.(event);
    if (disabled) return;
    ctx.setActiveId(id);
    (event.currentTarget as HTMLElement).focus();
  };

  return useRender<{ checked: boolean; disabled: boolean; highlighted: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      id,
      role: 'menuitemcheckbox',
      'data-menu-item': '',
      tabIndex: highlighted ? 0 : -1,
      'aria-checked': checked,
      'aria-disabled': disabled ? 'true' : undefined,
      'data-state': checked ? 'checked' : 'unchecked',
      'data-disabled': disabled ? '' : undefined,
      'data-highlighted': highlighted ? '' : undefined,
      onClick: handleClick,
      onPointerEnter: handlePointerEnter,
    },
    state: { checked, disabled, highlighted },
    children,
  });
}

export type MenuRadioGroupProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'value'>;

export function MenuRadioGroup(props: MenuRadioGroupProps): VNode {
  const { value: valueProp, defaultValue, onValueChange, render, children, ...rest } = props;
  const [value, setValue] = useControllableState<string | undefined>({
    value: valueProp,
    defaultValue: defaultValue,
    onChange: (v) => v !== undefined && onValueChange?.(v),
  });
  const groupCtx = useMemo(
    () => ({ value, setValue: (v: string) => setValue(v) }),
    [value, setValue]
  );
  const node = useRender({
    render,
    defaultTag: 'div',
    props: { ...rest, role: 'group' },
    children,
  });
  return h(MenuRadioGroupContext.Provider, { value: groupCtx }, node);
}

export type MenuRadioItemProps = {
  value: string;
  render?: RenderProp<{ checked: boolean; disabled: boolean; highlighted: boolean }>;
  disabled?: boolean;
  onSelect?: (event: Event) => void;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'onSelect'>;

export function MenuRadioItem(props: MenuRadioItemProps): VNode {
  const { value, render, children, disabled = false, onSelect, onClick, onPointerEnter, ...rest } = props;
  const ctx = useMenuContext('RadioItem');
  const group = useMenuRadioGroupContext();
  const id = useId();
  const highlighted = ctx.activeId === id;
  const checked = group.value === value;

  const activate = () => {
    group.setValue(value);
    const event = new Event('menu-select', { cancelable: true });
    onSelect?.(event);
    if (!event.defaultPrevented) ctx.closeAll();
  };
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    if (disabled) return;
    activate();
  };
  const handlePointerEnter = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    onPointerEnter?.(event);
    if (disabled) return;
    ctx.setActiveId(id);
    (event.currentTarget as HTMLElement).focus();
  };

  return useRender<{ checked: boolean; disabled: boolean; highlighted: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      id,
      role: 'menuitemradio',
      'data-menu-item': '',
      tabIndex: highlighted ? 0 : -1,
      'aria-checked': checked,
      'aria-disabled': disabled ? 'true' : undefined,
      'data-state': checked ? 'checked' : 'unchecked',
      'data-disabled': disabled ? '' : undefined,
      'data-highlighted': highlighted ? '' : undefined,
      onClick: handleClick,
      onPointerEnter: handlePointerEnter,
    },
    state: { checked, disabled, highlighted },
    children,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hono-preact/ui test menu-checkable`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/menu/menu.tsx packages/ui/src/__tests__/menu-checkable.test.tsx
git commit -m "feat(ui): Menu CheckboxItem + RadioGroup + RadioItem"
```

---

## Task 9: Separator + Group + GroupLabel + Arrow

Structural, non-interactive parts.

**Files:**
- Modify: `packages/ui/src/menu/menu.tsx`
- Test: `packages/ui/src/__tests__/menu-structure.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuItem,
  MenuSeparator,
  MenuGroup,
  MenuGroupLabel,
} from '../menu/menu.js';

afterEach(cleanup);

describe('Menu structure parts', () => {
  it('renders a separator and a labelled group', async () => {
    const { getByRole, getByText } = render(
      <MenuRoot defaultOpen>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPositioner>
          <MenuPopup>
            <MenuGroup>
              <MenuGroupLabel>Section</MenuGroupLabel>
              <MenuItem>A</MenuItem>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem>B</MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuRoot>
    );
    await act(async () => {});
    expect(getByRole('separator')).toBeTruthy();
    const group = getByText('Section').closest('[role="group"]')!;
    const labelId = getByText('Section').id;
    expect(group.getAttribute('aria-labelledby')).toBe(labelId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/ui test menu-structure`
Expected: FAIL (parts not exported).

- [ ] **Step 3: Implement the structural parts**

Append to `packages/ui/src/menu/menu.tsx`. The Group provides a label id to its GroupLabel via a tiny local context; simplest implementation uses a `useId` in Group passed through context. Add a minimal group-label context inline:

```tsx
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

const MenuGroupContext = createContext<{ labelId: string } | null>(null);

export type MenuGroupProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function MenuGroup(props: MenuGroupProps): VNode {
  const { render, children, ...rest } = props;
  const labelId = useId();
  const node = useRender({
    render,
    defaultTag: 'div',
    props: { ...rest, role: 'group', 'aria-labelledby': labelId },
    children,
  });
  return h(MenuGroupContext.Provider, { value: { labelId } }, node);
}

export type MenuGroupLabelProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function MenuGroupLabel(props: MenuGroupLabelProps): VNode {
  const { render, children, ...rest } = props;
  const group = useContext(MenuGroupContext);
  return useRender({
    render,
    defaultTag: 'div',
    // Presentational: not focusable, no item role.
    props: { ...rest, id: group?.labelId },
    children,
  });
}

export type MenuSeparatorProps = {
  render?: RenderProp;
} & JSX.HTMLAttributes<HTMLDivElement>;

export function MenuSeparator(props: MenuSeparatorProps): VNode {
  const { render, ...rest } = props;
  return useRender({
    render,
    defaultTag: 'div',
    props: { ...rest, role: 'separator', 'aria-orientation': 'horizontal' },
  });
}

export type MenuArrowProps = {
  render?: RenderProp<{ side: Side }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function MenuArrow(props: MenuArrowProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useMenuContext('Arrow');
  const { side, arrowX, arrowY } = ctx.position;
  return useRender<{ side: Side }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.arrowRef,
      'data-side': side,
      style: {
        position: 'absolute',
        left: arrowX != null ? `${arrowX}px` : undefined,
        top: arrowY != null ? `${arrowY}px` : undefined,
      },
    },
    state: { side },
    children,
  });
}
```

(If `createContext`/`useContext` are already imported at the top of the file, do not duplicate the import; add `createContext` to the existing `preact` import and `useContext` to the existing `preact/hooks` import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hono-preact/ui test menu-structure`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/menu/menu.tsx packages/ui/src/__tests__/menu-structure.test.tsx
git commit -m "feat(ui): Menu Separator + Group + GroupLabel + Arrow"
```

---

## Task 10: Submenu parts

`SubmenuRoot` provides a nested menu context whose dismiss-tree `parentId` is the enclosing menu. `SubmenuTrigger` is a `menuitem` that opens on hover (delay) / ArrowRight, with a `useSafeArea` corridor. `SubmenuPositioner`/`SubmenuPopup` reuse the menu Positioner/Popup behavior; ArrowLeft closes and returns focus to the trigger.

**Files:**
- Create: `packages/ui/src/menu/submenu.tsx`
- Test: `packages/ui/src/__tests__/menu-submenu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuItem,
} from '../menu/menu.js';
import {
  SubmenuRoot,
  SubmenuTrigger,
  SubmenuPositioner,
  SubmenuPopup,
} from '../menu/submenu.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function Harness() {
  return (
    <MenuRoot defaultOpen>
      <MenuTrigger>Open</MenuTrigger>
      <MenuPositioner>
        <MenuPopup>
          <MenuItem>Top</MenuItem>
          <SubmenuRoot>
            <SubmenuTrigger>More</SubmenuTrigger>
            <SubmenuPositioner>
              <SubmenuPopup>
                <MenuItem>Nested</MenuItem>
              </SubmenuPopup>
            </SubmenuPositioner>
          </SubmenuRoot>
        </MenuPopup>
      </MenuPositioner>
    </MenuRoot>
  );
}

describe('Submenu', () => {
  it('SubmenuTrigger is a menuitem with aria-haspopup=menu', async () => {
    const { getByText } = render(<Harness />);
    await act(async () => {});
    const trigger = getByText('More');
    expect(trigger.getAttribute('role')).toBe('menuitem');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('ArrowRight opens the submenu and focuses its first item', async () => {
    const { getByText, queryByText } = render(<Harness />);
    await act(async () => {});
    const trigger = getByText('More');
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    await act(async () => {});
    expect(queryByText('Nested')).toBeTruthy();
    expect(document.activeElement).toBe(getByText('Nested'));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('ArrowLeft closes the submenu and returns focus to the trigger', async () => {
    const { getByText, queryByText } = render(<Harness />);
    await act(async () => {});
    fireEvent.keyDown(getByText('More'), { key: 'ArrowRight' });
    await act(async () => {});
    fireEvent.keyDown(getByText('Nested'), { key: 'ArrowLeft' });
    await act(async () => {});
    expect(queryByText('Nested')).toBeNull();
    expect(document.activeElement).toBe(getByText('More'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/ui test menu-submenu`
Expected: FAIL (submenu module missing).

- [ ] **Step 3: Refactor: extract a shared `MenuSurface` from Positioner/Popup**

To avoid duplicating the Positioner/Popup logic, export from `menu.tsx` the two functions `MenuPositioner` and `MenuPopup` already do this generically (they read whatever `MenuContext` is in scope). The submenu reuses them directly by rendering its own `MenuContext.Provider`. So `SubmenuPositioner` = `MenuPositioner` and `SubmenuPopup` = `MenuPopup` rendered under the submenu's context. The submenu file re-exports them:

In `packages/ui/src/menu/submenu.tsx`:

```tsx
// packages/ui/src/menu/submenu.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import { useCallback, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import { useSafeArea } from '../use-safe-area.js';
import type { Side, Align, PositionState } from '../use-position.js';
import { MenuContext, useMenuContext } from './context.js';
import { MenuPositioner, MenuPopup } from './menu.js';

export interface SubmenuRootProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side; // default 'right'
  align?: Align; // default 'start'
  offset?: number; // default 0
  openDelay?: number; // hover open delay (ms), default 100
  closeDelay?: number; // safe-area grace (ms), default 300
  children?: ComponentChildren;
}

// Internal context extension carried alongside MenuContext so SubmenuTrigger
// can drive hover open/close timing without leaking onto the public context.
interface SubmenuControls {
  scheduleOpen: () => void;
  cancelOpen: () => void;
  closeDelay: number;
}
const SubmenuControlsRef = { current: null as SubmenuControls | null };
```

Then the SubmenuRoot. It builds a child `MenuContext` value whose `parentDismissId` is the parent menu's `dismissId`, whose `closeAll` is the parent's `closeAll` (so activating a nested item collapses the whole tree), and whose `side`/`align` default to right/start. It owns its own open state, refs, ids, activeId. It also wires hover timing used by the trigger via a ref shared through React context. To keep it cohesive, store the controls in the child context using an extra symbol-keyed field is avoided; instead pass controls through a dedicated submenu context:

Replace the placeholder `SubmenuControlsRef` above with a real Preact context and implement the parts:

```tsx
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

const SubmenuControlsContext = createContext<SubmenuControls | null>(null);

export function SubmenuRoot(props: SubmenuRootProps): VNode {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    side = 'right',
    align = 'start',
    offset = 0,
    openDelay = 100,
    closeDelay = 300,
    children,
  } = props;
  const parent = useMenuContext('SubmenuRoot');

  const [open, setOpen] = useControllableState<boolean>({
    value: openProp,
    defaultValue: defaultOpen ?? false,
    onChange: onOpenChange,
  });

  const anchorRef = useRef<HTMLElement>(null); // the SubmenuTrigger
  const floatingRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLElement>(null);
  const arrowRef = useRef<HTMLElement>(null);
  const pendingEdgeRef = useRef<'first' | 'last'>('first');
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const popupId = `${baseId}-popup`;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [position, setPosition] = useState<PositionState>({
    side,
    align,
    arrowX: null,
    arrowY: null,
  });

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelOpen = useCallback(() => {
    if (openTimer.current != null) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  }, []);
  const scheduleOpen = useCallback(() => {
    cancelOpen();
    openTimer.current = setTimeout(() => setOpen(true), openDelay);
  }, [cancelOpen, setOpen, openDelay]);

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      closeAll: parent.closeAll, // collapse the whole tree on item activation
      dismissId: baseId,
      parentDismissId: parent.dismissId,
      anchorRef,
      floatingRef,
      popupRef,
      arrowRef,
      triggerId,
      popupId,
      activeId,
      setActiveId,
      pendingEdgeRef,
      side,
      align,
      offset,
      loop: parent.loop,
      typeahead: parent.typeahead,
      position,
      setPosition,
      getAnchorRect: undefined,
    }),
    [
      open,
      setOpen,
      parent.closeAll,
      parent.dismissId,
      parent.loop,
      parent.typeahead,
      baseId,
      triggerId,
      popupId,
      activeId,
      side,
      align,
      offset,
      position,
    ]
  );

  const controls = useMemo(
    () => ({ scheduleOpen, cancelOpen, closeDelay }),
    [scheduleOpen, cancelOpen, closeDelay]
  );

  return h(
    MenuContext.Provider,
    { value: ctx },
    h(SubmenuControlsContext.Provider, { value: controls }, children)
  );
}

export type SubmenuTriggerProps = {
  render?: RenderProp<{ open: boolean; highlighted: boolean }>;
  disabled?: boolean;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function SubmenuTrigger(props: SubmenuTriggerProps): VNode {
  const { render, children, disabled = false, onPointerEnter, onPointerLeave, onKeyDown, onClick, ...rest } = props;
  const ctx = useMenuContext('SubmenuTrigger');
  const controls = useContext(SubmenuControlsContext);
  const id = useId();
  const highlighted = ctx.activeId === id;

  // The safe-area corridor keeps the submenu open while the pointer travels
  // diagonally from the trigger toward the open submenu.
  useSafeArea({
    enabled: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    onClose: () => ctx.setOpen(false),
    graceMs: controls?.closeDelay ?? 300,
  });

  const handlePointerEnter = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    onPointerEnter?.(event);
    if (disabled || event.pointerType === 'touch') return;
    ctx.setActiveId(id);
    (event.currentTarget as HTMLElement).focus();
    controls?.scheduleOpen();
  };
  const handlePointerLeave = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(event);
    if (event.pointerType === 'touch') return;
    // Cancel a pending open; while open the safe corridor governs the close.
    controls?.cancelOpen();
  };
  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (disabled) return;
    if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation(); // do not let the parent Popup also handle it
      ctx.pendingEdgeRef.current = 'first';
      ctx.setOpen(true);
    }
  };
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    if (disabled) return;
    ctx.pendingEdgeRef.current = 'first';
    ctx.setOpen(true);
  };

  return useRender<{ open: boolean; highlighted: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.anchorRef,
      id,
      role: 'menuitem',
      'data-menu-item': '',
      tabIndex: highlighted ? 0 : -1,
      'aria-haspopup': 'menu',
      'aria-expanded': ctx.open,
      'aria-controls': ctx.open ? ctx.popupId : undefined,
      'aria-disabled': disabled ? 'true' : undefined,
      'data-highlighted': highlighted ? '' : undefined,
      'data-state': ctx.open ? 'open' : 'closed',
      onPointerEnter: handlePointerEnter,
      onPointerLeave: handlePointerLeave,
      onKeyDown: handleKeyDown,
      onClick: handleClick,
    },
    state: { open: ctx.open, highlighted },
    children,
  });
}

// The submenu surface reuses the generic Menu Positioner/Popup against the
// submenu's MenuContext. SubmenuPopup adds ArrowLeft-to-close.
export const SubmenuPositioner = MenuPositioner;

export type SubmenuPopupProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function SubmenuPopup(props: SubmenuPopupProps): VNode {
  const { onKeyDown, ...rest } = props;
  const ctx = useMenuContext('SubmenuPopup');
  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      ctx.setOpen(false);
      ctx.anchorRef.current?.focus();
    }
  };
  return h(MenuPopup, { ...rest, onKeyDown: handleKeyDown });
}
```

Notes:
- `SubmenuPopup` wraps `MenuPopup` and intercepts ArrowLeft before delegating, so the generic Popup's nav handler still drives Up/Down/typeahead within the submenu.
- Because the submenu provides its own `MenuContext`, the generic `MenuPopup`/`MenuPositioner` operate on the submenu's open state, refs, dismiss-tree node (with `parentId` set), and focus-return (returns focus to the SubmenuTrigger via `useFocusReturn`, since the trigger is the previously-focused element).
- Delete the placeholder `SubmenuControls`/`SubmenuControlsRef` lines from Step 3's first snippet; the real `SubmenuControlsContext` replaces them.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hono-preact/ui test menu-submenu`
Expected: PASS.

- [ ] **Step 5: Run the whole package suite**

Run: `pnpm --filter @hono-preact/ui test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/menu/submenu.tsx packages/ui/src/__tests__/menu-submenu.test.tsx
git commit -m "feat(ui): nested Submenu parts with safe-area corridor + keyboard"
```

---

## Task 11: Menu namespace + barrel exports

**Files:**
- Create: `packages/ui/src/menu/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/__tests__/exports.test.ts` (extend)
- Test: `packages/ui/src/__tests__/menu-ssr.test.tsx` (new)

- [ ] **Step 1: Write the namespace module**

Create `packages/ui/src/menu/index.ts`:

```ts
export {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuGroup,
  MenuGroupLabel,
  MenuArrow,
  type MenuRootProps,
  type MenuTriggerProps,
  type MenuPositionerProps,
  type MenuPopupProps,
  type MenuItemProps,
  type MenuCheckboxItemProps,
  type MenuRadioGroupProps,
  type MenuRadioItemProps,
  type MenuSeparatorProps,
  type MenuGroupProps,
  type MenuGroupLabelProps,
  type MenuArrowProps,
} from './menu.js';
export {
  SubmenuRoot,
  SubmenuTrigger,
  SubmenuPositioner,
  SubmenuPopup,
  type SubmenuRootProps,
  type SubmenuTriggerProps,
  type SubmenuPopupProps,
} from './submenu.js';

import {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuGroup,
  MenuGroupLabel,
  MenuArrow,
} from './menu.js';
import {
  SubmenuRoot,
  SubmenuTrigger,
  SubmenuPositioner,
  SubmenuPopup,
} from './submenu.js';

export const Menu = {
  Root: MenuRoot,
  Trigger: MenuTrigger,
  Positioner: MenuPositioner,
  Popup: MenuPopup,
  Item: MenuItem,
  CheckboxItem: MenuCheckboxItem,
  RadioGroup: MenuRadioGroup,
  RadioItem: MenuRadioItem,
  Separator: MenuSeparator,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
  Arrow: MenuArrow,
  SubmenuRoot,
  SubmenuTrigger,
  SubmenuPositioner,
  SubmenuPopup,
};
```

- [ ] **Step 2: Wire the barrel**

In `packages/ui/src/index.ts`, add after the Tooltip export block:

```ts
export { useTypeahead, type UseTypeaheadOptions } from './use-typeahead.js';
export {
  Menu,
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuGroup,
  MenuGroupLabel,
  MenuArrow,
  SubmenuRoot,
  SubmenuTrigger,
  SubmenuPositioner,
  SubmenuPopup,
  type MenuRootProps,
  type MenuTriggerProps,
  type MenuPositionerProps,
  type MenuPopupProps,
  type MenuItemProps,
  type MenuCheckboxItemProps,
  type MenuRadioGroupProps,
  type MenuRadioItemProps,
  type MenuSeparatorProps,
  type MenuGroupProps,
  type MenuGroupLabelProps,
  type MenuArrowProps,
  type SubmenuRootProps,
  type SubmenuTriggerProps,
  type SubmenuPopupProps,
} from './menu/index.js';
```

Note: `useTypeahead` is exported from the barrel (it is a public-shaped hook); the navigation helpers stay internal (not exported), per the spec's "collection/typeahead internal" decision — only `useTypeahead` surfaces, and `Menu` consumes the rest.

Actually, to honor "collection + typeahead stay internal this slice," do NOT export `useTypeahead` from the barrel. Remove the `useTypeahead` export line above; keep it internal. (The decision in spec §2.4 keeps these internal until Phase 4.)

- [ ] **Step 3: Write the SSR + exports test**

Extend `packages/ui/src/__tests__/exports.test.ts` with a Menu assertion:

```ts
  it('exposes the Menu and ContextMenu namespaces', () => {
    expect(typeof ui.Menu.Root).toBe('function');
    expect(typeof ui.Menu.SubmenuTrigger).toBe('function');
    expect(typeof ui.ContextMenu.Root).toBe('function');
    expect(typeof ui.ContextMenu.Trigger).toBe('function');
  });
```

(The ContextMenu assertions pass after Task 12; if running strictly in order, add only the `Menu` lines here and the `ContextMenu` lines in Task 12.)

Create `packages/ui/src/__tests__/menu-ssr.test.tsx`:

```tsx
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuItem,
} from '../menu/menu.js';

describe('Menu SSR', () => {
  it('renders the trigger and omits the closed surface on the server', () => {
    const html = renderToString(
      <MenuRoot>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPositioner>
          <MenuPopup>
            <MenuItem>Cut</MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuRoot>
    );
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('role="menu"'); // Positioner returns null when closed
  });
});
```

- [ ] **Step 4: Run the new tests + full suite**

Run: `pnpm --filter @hono-preact/ui test exports menu-ssr`
Expected: PASS (Menu lines). Then `pnpm --filter @hono-preact/ui test` — all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/menu/index.ts packages/ui/src/index.ts packages/ui/src/__tests__/exports.test.ts packages/ui/src/__tests__/menu-ssr.test.tsx
git commit -m "feat(ui): export Menu namespace + SSR-closed test"
```

---

## Task 12: ContextMenu (Root + Trigger + namespace)

Right-click trigger anchored at a virtual point. Reuses every Menu part.

**Files:**
- Create: `packages/ui/src/context-menu/context-menu.tsx`
- Create: `packages/ui/src/context-menu/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/__tests__/context-menu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  ContextMenuRoot,
  ContextMenuTrigger,
} from '../context-menu/context-menu.js';
import {
  MenuPositioner,
  MenuPopup,
  MenuItem,
} from '../menu/menu.js';

afterEach(cleanup);

describe('ContextMenu', () => {
  it('opens on contextmenu, suppresses the native menu, renders a menu', async () => {
    const { getByText, queryByRole } = render(
      <ContextMenuRoot>
        <ContextMenuTrigger>
          <div>Right-click here</div>
        </ContextMenuTrigger>
        <MenuPositioner>
          <MenuPopup aria-label="Context">
            <MenuItem>Cut</MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </ContextMenuRoot>
    );
    expect(queryByRole('menu')).toBeNull();
    const area = getByText('Right-click here');
    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 });
    fireEvent(area, evt);
    expect(evt.defaultPrevented).toBe(true);
    await act(async () => {});
    expect(queryByRole('menu')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/ui test context-menu`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement ContextMenu Root + Trigger**

Create `packages/ui/src/context-menu/context-menu.tsx`:

```tsx
// packages/ui/src/context-menu/context-menu.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import { useCallback, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align, PositionState } from '../use-position.js';
import { MenuContext, useMenuContext } from '../menu/context.js';

export interface ContextMenuRootProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side; // default 'bottom'
  align?: Align; // default 'start'
  offset?: number; // default 0
  loop?: boolean;
  typeahead?: boolean;
  children?: ComponentChildren;
}

export function ContextMenuRoot(props: ContextMenuRootProps): VNode {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    side = 'bottom',
    align = 'start',
    offset = 0,
    loop = true,
    typeahead = true,
    children,
  } = props;

  const [open, setOpen] = useControllableState<boolean>({
    value: openProp,
    defaultValue: defaultOpen ?? false,
    onChange: onOpenChange,
  });

  const anchorRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLElement>(null);
  const arrowRef = useRef<HTMLElement>(null);
  const pendingEdgeRef = useRef<'first' | 'last'>('first');
  const pointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const popupId = `${baseId}-popup`;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [position, setPosition] = useState<PositionState>({
    side,
    align,
    arrowX: null,
    arrowY: null,
  });

  const closeAll = useCallback(() => setOpen(false), [setOpen]);

  // Virtual anchor: a zero-size rect at the captured pointer.
  const getAnchorRect = useCallback(() => {
    const { x, y } = pointRef.current;
    return { width: 0, height: 0, x, y, top: y, left: x, right: x, bottom: y };
  }, []);

  // Exposed on the context so the Trigger can record the pointer + open.
  const openAt = useCallback(
    (x: number, y: number) => {
      pointRef.current = { x, y };
      pendingEdgeRef.current = 'first';
      setOpen(true);
    },
    [setOpen]
  );

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      closeAll,
      dismissId: baseId,
      parentDismissId: null,
      anchorRef,
      floatingRef,
      popupRef,
      arrowRef,
      triggerId,
      popupId,
      activeId,
      setActiveId,
      pendingEdgeRef,
      side,
      align,
      offset,
      loop,
      typeahead,
      position,
      setPosition,
      getAnchorRect,
    }),
    [open, setOpen, closeAll, baseId, triggerId, popupId, activeId, side, align, offset, loop, typeahead, position, getAnchorRect]
  );

  // Stash openAt on the context object so the Trigger (which reads MenuContext)
  // can call it without a second provider. Typed via a structural extension.
  const ctxWithOpenAt = useMemo(
    () => Object.assign(ctx, { openAt }),
    [ctx, openAt]
  );

  return h(MenuContext.Provider, { value: ctxWithOpenAt }, children);
}

// The Trigger reads a context augmented with openAt. Declare the structural
// shape so no cast is needed.
interface ContextWithOpenAt {
  openAt: (x: number, y: number) => void;
}
function hasOpenAt(ctx: object): ctx is ContextWithOpenAt {
  return 'openAt' in ctx && typeof (ctx as ContextWithOpenAt).openAt === 'function';
}

export type ContextMenuTriggerProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ContextMenuTrigger(props: ContextMenuTriggerProps): VNode {
  const { render, children, onContextMenu, ...rest } = props;
  const ctx = useMenuContext('Trigger');

  const handleContextMenu = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    onContextMenu?.(event);
    event.preventDefault();
    if (hasOpenAt(ctx)) ctx.openAt(event.clientX, event.clientY);
  };

  return useRender({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.anchorRef,
      'data-state': ctx.open ? 'open' : 'closed',
      onContextMenu: handleContextMenu,
    },
    children,
  });
}
```

Reshape note (avoids a cast, per CLAUDE.md): the `MenuContextValue` does not declare `openAt`, so the Trigger narrows with the `hasOpenAt` type guard instead of casting. Alternatively, add an optional `openAt?: (x: number, y: number) => void` field to `MenuContextValue` in `menu/context.ts` and drop the guard. Prefer adding the optional field if it reads cleaner; then `ContextMenuRoot` sets it and `ContextMenuTrigger` calls `ctx.openAt?.(...)` directly. Pick one; do not ship both.

- [ ] **Step 4: Implement the namespace**

Create `packages/ui/src/context-menu/index.ts`:

```ts
export {
  ContextMenuRoot,
  ContextMenuTrigger,
  type ContextMenuRootProps,
  type ContextMenuTriggerProps,
} from './context-menu.js';

import { ContextMenuRoot, ContextMenuTrigger } from './context-menu.js';
import {
  MenuPositioner,
  MenuPopup,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuGroup,
  MenuGroupLabel,
  MenuArrow,
} from '../menu/menu.js';
import {
  SubmenuRoot,
  SubmenuTrigger,
  SubmenuPositioner,
  SubmenuPopup,
} from '../menu/submenu.js';

// Same underlying parts as Menu, under ContextMenu names so examples stay
// self-consistent (never mix Menu.Item inside ContextMenu.Root).
export const ContextMenu = {
  Root: ContextMenuRoot,
  Trigger: ContextMenuTrigger,
  Positioner: MenuPositioner,
  Popup: MenuPopup,
  Item: MenuItem,
  CheckboxItem: MenuCheckboxItem,
  RadioGroup: MenuRadioGroup,
  RadioItem: MenuRadioItem,
  Separator: MenuSeparator,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
  Arrow: MenuArrow,
  SubmenuRoot,
  SubmenuTrigger,
  SubmenuPositioner,
  SubmenuPopup,
};
```

- [ ] **Step 5: Wire the barrel + extend exports test**

In `packages/ui/src/index.ts` add:

```ts
export {
  ContextMenu,
  ContextMenuRoot,
  ContextMenuTrigger,
  type ContextMenuRootProps,
  type ContextMenuTriggerProps,
} from './context-menu/index.js';
```

Add the `ContextMenu` assertions to `exports.test.ts` (if not already added in Task 11).

- [ ] **Step 6: Run tests + full suite**

Run: `pnpm --filter @hono-preact/ui test context-menu exports`
Expected: PASS. Then `pnpm --filter @hono-preact/ui test` — all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/context-menu packages/ui/src/index.ts packages/ui/src/__tests__/context-menu.test.tsx packages/ui/src/__tests__/exports.test.ts
git commit -m "feat(ui): ContextMenu Root + Trigger over the shared menu core"
```

---

## Task 13: Typecheck + build the package

Before docs/size, make sure the package typechecks and builds (the site and size scripts resolve through `dist/`).

**Files:** none (verification + fixes only).

- [ ] **Step 1: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS. If errors appear (e.g. a missing prop type, a cast that should be reshaped), fix at the source and re-run. Do not silence with `as`.

- [ ] **Step 2: Build the framework packages**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: `packages/ui/dist` regenerates with `menu/` and `context-menu/` entries.

- [ ] **Step 3: Commit only if fixes were needed**

```bash
git add -A
git commit -m "fix(ui): typecheck fixes for menu + context-menu" || echo "nothing to commit"
```

---

## Task 14: Size tracking

**Files:**
- Modify: `scripts/client-size-config.mjs`

- [ ] **Step 1: Add the component modules + chunk prefixes**

In `scripts/client-size-config.mjs`, extend `COMPONENT_MODULES`:

```js
export const COMPONENT_MODULES = {
  dialog: ['dialog/index.js'],
  popover: ['popover/index.js'],
  tooltip: ['tooltip/index.js'],
  menu: ['menu/index.js'],
  'context-menu': ['context-menu/index.js'],
};
```

And add chunk prefixes in `CHUNK_PREFIXES` next to the other component pages (before `['components', 'components']`):

```js
  ['menu', 'components'],
  ['context-menu', 'components'],
```

- [ ] **Step 2: Run the size script against the clean build**

Run:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
node scripts/measure-client-size.mjs 2>/dev/null || node scripts/client-size.mjs 2>/dev/null || echo "use the repo's size entrypoint"
```
Expected: the report includes `menu` and `context-menu` rows (each carrying the floating-ui + menu machinery marginal). Do NOT commit a regenerated `client-size-report.json` baseline (it refreshes on main-push; committing it would zero the PR deltas).

- [ ] **Step 3: Commit the config only**

```bash
git add scripts/client-size-config.mjs
git commit -m "chore(size): track menu + context-menu client size"
```

---

## Task 15: Docs pages (Menu + Context Menu)

Add two component docs pages under the Overlays nav section, each with prose, a styled live demo with a copy button in CSS + Tailwind flavors, and a full per-part API reference.

**Files:**
- Create: `apps/site/src/pages/docs/components/menu.mdx`
- Create: `apps/site/src/pages/docs/components/context-menu.mdx`
- Modify: `apps/site/src/pages/docs/nav.ts`
- Modify (if it asserts link counts): `apps/site/src/pages/docs/__tests__/nav.test.ts`

- [ ] **Step 1: Read the local docs skill and the sibling pages**

REQUIRED: read `.claude/skills/add-docs-page.md` (the source of truth for the page templates and the three pillars) and follow it. Use `apps/site/src/pages/docs/components/popover.mdx` and `tooltip.mdx` as the exact structural template (frontmatter, `CodeTabs` usage, API-reference tables built from `packages/ui` types, the docs-template standard from PRs #75/#76). Describe what is; no migration breadcrumbs. CSS and Tailwind tabs must be feature-equivalent (base Tailwind v4 only; reproduce CSS keyframes with `transition` + `starting:`).

- [ ] **Step 2: Author `menu.mdx`**

Content checklist (mirror popover.mdx section order):
- Frontmatter (title "Menu", description, the Overlays/Components area fields popover.mdx uses).
- Intro prose: what Menu is (button-triggered dropdown command menu), when to use it, the APG note that `role="menu"` is for application/command menus, not site navigation.
- A styled live demo: `Menu.Root` > `Trigger` + `Positioner` > `Popup` with `Item`s, a `Separator`, a `CheckboxItem`, a `RadioGroup`/`RadioItem`, a `Group`/`GroupLabel`, and a `SubmenuRoot` example. Wrapped in `CodeTabs` with **CSS** and **Tailwind** flavors and a copy button (same component the popover page uses).
- The keyboard map table (from spec §7.1).
- The data-attribute table (`data-state`, `data-highlighted`, `data-disabled`, `data-side`, `data-align`).
- API reference: one table per part (Root, Trigger, Positioner, Popup, Item, CheckboxItem, RadioGroup, RadioItem, Separator, Group, GroupLabel, Arrow, SubmenuRoot, SubmenuTrigger, SubmenuPositioner, SubmenuPopup) with props/types/defaults read from the `packages/ui/src/menu` source.

- [ ] **Step 3: Author `context-menu.mdx`**

Same structure, scoped to ContextMenu: intro (right-click menu), a styled demo (`ContextMenu.Root` > `ContextMenu.Trigger` area + `Positioner`/`Popup`/`Item`s), the note that the part set is identical to Menu, the touch-long-press limitation, and the API reference for `Root` + `Trigger` (cross-link to the Menu page for the shared parts).

- [ ] **Step 4: Add both pages to the nav**

In `apps/site/src/pages/docs/nav.ts`, add `menu` and `context-menu` entries under the Overlays section, alongside `popover`/`tooltip` (match the existing entry shape: label, href `/docs/components/menu`, etc.).

- [ ] **Step 5: Run the nav test + site build**

Run:
```bash
pnpm --filter @hono-preact/ui build
pnpm --filter site build
pnpm vitest run apps/site/src/pages/docs/__tests__/nav.test.ts
```
Expected: site builds; nav test passes (update its expectations if it asserts the page list/count). Verify the new pages render under `/docs/components/menu` and `/docs/components/context-menu` in the build output.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages/docs/components/menu.mdx apps/site/src/pages/docs/components/context-menu.mdx apps/site/src/pages/docs/nav.ts apps/site/src/pages/docs/__tests__/nav.test.ts
git commit -m "docs(components): add Menu + Context Menu pages"
```

---

## Task 16: Full CI mirror + PR

Run the six pre-push checks in CI order (project CLAUDE.md), fix anything, then open the PR.

**Files:** none (verification).

- [ ] **Step 1: Build framework dist**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: PASS.

- [ ] **Step 2: Format check**

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format` and commit the result.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Unit tests**

Run: `pnpm test:coverage` (or `pnpm test`)
Expected: PASS, including the new `@hono-preact/ui` menu/context-menu suites.

- [ ] **Step 5: Integration + site build**

Run:
```bash
pnpm test:integration
pnpm --filter site build
```
Expected: PASS.

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin feat/ui-menu-context-menu
gh pr create --title "feat(ui): Menu + Context Menu (Phase 3)" --body "$(cat <<'EOF'
Implements Phase 3 of the headless components roadmap: Menu (button-triggered dropdown) and ContextMenu (right-click), over a shared internal core.

Spec: docs/superpowers/specs/2026-06-05-menu-context-menu-design.md
Plan: docs/superpowers/plans/2026-06-05-menu-context-menu.md

Highlights:
- Roving-tabindex collection + typeahead (internal machinery).
- Dismiss-stack tree extension for nested submenu coordination.
- usePosition virtual-anchor option for pointer-anchored context menus.
- Submenu pointer corridors reuse useSafeArea.
- Full item model: menuitem / checkbox / radio group / separator / group.
- Docs pages in CSS + Tailwind flavors; menu + context-menu added to size tracking.

Deferred (to be captured in a durable memory backlog on merge): Menubar, context-menu long-press on touch, RTL submenus, promoting collection/typeahead to a public primitive.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Deep PR review (project CLAUDE.md PR workflow)**

Immediately run a deep PR review as the first post-open step: replacement parity (none here, this is additive) and cross-cutting concerns end-to-end (dismiss-tree vs the prior flat stack for Popover/Tooltip; focus return; SSR). Then address findings.

- [ ] **Step 8: Write the deferred-work memory backlog**

After the PR number exists, create `~/.claude/projects/-Users-stevenbeshensky-Documents-repos-hono-preact/memory/project_menu_slice_followups.md` (mirroring the #12/#22 followup memories) listing the deferred items from spec §8, and add a one-line pointer to `MEMORY.md`.

---

## Self-review notes (author)

- **Spec coverage:** Root/Trigger/Positioner/Popup (T5–T6), Item (T7), Checkbox/Radio (T8), Separator/Group/GroupLabel/Arrow (T9), Submenu (T10), ContextMenu (T12), virtual anchor (T1), dismiss-tree (T2), roving+typeahead (T3/T4/T6), SSR (T11), docs CSS+Tailwind (T15), size (T14), deferred-work memory (T16 Step 8). Keyboard map fully implemented in T5 (trigger) + T6 (popup) + T10 (submenu).
- **Known sequencing dependency:** the T6 navigation test renders `MenuItem`, defined in T7 — implement T7 before running T6's test (called out in T6 Step 4). A subagent executor should treat T6+T7 as a pair.
- **Cast avoidance:** the one place a cast is tempting (ContextMenu `openAt` on the context) is reshaped two ways (type-guard or optional context field); the plan instructs picking the field if cleaner. `event.currentTarget as HTMLElement` in pointer handlers matches the existing tooltip/popover code style; if `currentTarget` is already typed as the element, drop the cast.
- **Type consistency:** `getAnchorRect`/`ClientRectGetter`, `dismissId`/`parentDismissId`, `pendingEdgeRef`, `closeAll`, `activeId`/`setActiveId` names are used identically across context.ts, menu.tsx, submenu.tsx, and context-menu.tsx.
