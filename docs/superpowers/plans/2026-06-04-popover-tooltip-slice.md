# Popover + Tooltip Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 2 headless components, Popover and Tooltip, in `@hono-preact/ui`, plus only the shared machinery they need (positioning, a dismissal stack, focus return).

**Architecture:** Both components are compound part sets over a Preact context, exactly like the shipped Dialog. They render inline with `position: fixed` (positioned by `@floating-ui/dom`) and promote to the native top layer via the Popover API where available; no portal and no `preact/compat`. Dismissal flows through a tiny module-level stack with shared capture-phase document listeners. Popover moves focus in on open and returns it on close (no trap); Tooltip implements WCAG 1.4.13 hover/focus behavior with no delay group.

**Tech Stack:** TypeScript, Preact (`preact/hooks`), `@floating-ui/dom`, Vitest + `@testing-library/preact` (happy-dom) + `preact-render-to-string`, MDX docs in `apps/site`.

**Design spec:** `docs/superpowers/specs/2026-06-03-popover-tooltip-design.md`. Read it first.

---

## Conventions (read once before starting)

- **This runs on a feature branch + PR.** Only spec/plan docs go to `main`. Before Task 1, create the branch: `git switch -c feat/ui-popover-tooltip`.
- **Test files** carry a per-file environment directive `// @vitest-environment happy-dom` (DOM tests) and use `@testing-library/preact` with `afterEach(cleanup)`. SSR tests use `preact-render-to-string` and need no DOM env. Mirror `packages/ui/src/__tests__/dialog-*.test.tsx`.
- **`packages/ui` is already wired into** `vitest.config.ts` (`test.include` + `coverage.include`) and into the size config's `ui-core`. New component index barrels must be added to `coverage.exclude` (Task 21).
- **Commit after every task.** Use the message shown in the task's final step. Do not push until the final verification task.
- **Run a single test file** with: `pnpm vitest run packages/ui/src/__tests__/<file>` (Vitest picks up the per-file env directive).
- **Build the package** with: `pnpm --filter @hono-preact/ui build` (it is `tsc`). Run this before site typecheck/build tasks so cross-package types resolve through `dist/`.
- **No inline type casts.** Reshape types instead (project rule). The code below is already cast-free; keep it that way.
- **No em-dashes in prose, comments, or commit messages** (project rule).

## File structure

New files in `packages/ui/src/` (shared machinery, flat, mirroring the existing primitives):

- `use-position.ts`: `@floating-ui/dom` binding hook + pure placement helpers.
- `dismiss-stack.ts`: module-level dismissal stack + shared capture-phase listeners.
- `use-dismiss.ts`: per-component hook over the stack.
- `use-focus-return.ts`: focus-in-on-open / return-on-close (Popover only).

New component directories (mirroring `src/dialog/`):

- `src/popover/{context.ts,popover.tsx,index.ts}`
- `src/tooltip/{context.ts,tooltip.tsx,index.ts}`

Modified:

- `packages/ui/package.json`: add `@floating-ui/dom` dependency.
- `packages/ui/src/index.ts`: export new primitives + components.
- `scripts/client-size-config.mjs`: `COMPONENT_MODULES` + `CHUNK_PREFIXES`.
- `vitest.config.ts`: `coverage.exclude` for the two new index barrels.
- `apps/site/src/pages/docs/nav.ts`: Overlays + Foundations entries.
- `apps/site/src/styles/root.css`: demo styles.

New docs files in `apps/site`:

- `src/components/docs/PopoverDemo.tsx`, `src/components/docs/TooltipDemo.tsx`
- `src/pages/docs/components/{popover,tooltip,use-position,use-dismiss}.mdx`

---

# Phase A: dependency + shared machinery

## Task 1: Add the `@floating-ui/dom` dependency

**Files:**
- Modify: `packages/ui/package.json`

- [ ] **Step 1: Create the feature branch (once)**

Run:
```bash
git switch -c feat/ui-popover-tooltip
```
Expected: `Switched to a new branch 'feat/ui-popover-tooltip'`. (If it already exists, `git switch feat/ui-popover-tooltip`.)

- [ ] **Step 2: Add the dependency**

Run:
```bash
pnpm --filter @hono-preact/ui add @floating-ui/dom
```
Expected: `packages/ui/package.json` gains a `dependencies` block with `"@floating-ui/dom": "^1.6.x"`, and the lockfile updates.

- [ ] **Step 3: Verify it resolves and the package still builds**

Run:
```bash
pnpm --filter @hono-preact/ui build
```
Expected: PASS (tsc emits `packages/ui/dist/` with no errors; nothing imports floating-ui yet, this just confirms the dep installed cleanly).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/package.json pnpm-lock.yaml
git commit -m "build(ui): add @floating-ui/dom dependency"
```

---

## Task 2: Positioning placement helpers (pure)

Pure functions mapping our `side`/`align` to floating-ui `Placement` and back. Pure so they are deterministic to test (floating-ui's `computePosition` needs real layout, which happy-dom does not provide).

**Files:**
- Create: `packages/ui/src/use-position.ts`
- Test: `packages/ui/src/__tests__/use-position.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { placementFor, sideAlignFromPlacement } from '../use-position.js';

describe('placement helpers', () => {
  it('maps center alignment to the bare side', () => {
    expect(placementFor('bottom', 'center')).toBe('bottom');
    expect(placementFor('top', 'center')).toBe('top');
  });

  it('maps start/end to floating-ui suffixes', () => {
    expect(placementFor('bottom', 'start')).toBe('bottom-start');
    expect(placementFor('right', 'end')).toBe('right-end');
  });

  it('round-trips a resolved placement back to side/align', () => {
    expect(sideAlignFromPlacement('bottom')).toEqual({
      side: 'bottom',
      align: 'center',
    });
    expect(sideAlignFromPlacement('left-start')).toEqual({
      side: 'left',
      align: 'start',
    });
    expect(sideAlignFromPlacement('top-end')).toEqual({
      side: 'top',
      align: 'end',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/use-position.test.ts`
Expected: FAIL with "does not provide an export named 'placementFor'".

- [ ] **Step 3: Write the helpers (minimal module, hook added next task)**

```ts
// packages/ui/src/use-position.ts
import type { Placement } from '@floating-ui/dom';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Align = 'start' | 'center' | 'end';

// Our (side, align) maps to a floating-ui Placement: center is the bare side,
// start/end become the `-start` / `-end` suffix. After the center early-return,
// align narrows to 'start' | 'end', so the template literal is structurally a
// Placement with no cast.
export function placementFor(side: Side, align: Align): Placement {
  if (align === 'center') return side;
  return `${side}-${align}`;
}

// The resolved placement (after flip/shift may have changed it) maps back to
// our side/align so parts can render data-side / data-align.
export function sideAlignFromPlacement(placement: Placement): {
  side: Side;
  align: Align;
} {
  const [side, alignment] = placement.split('-') as [Side, Align | undefined];
  return { side, align: alignment ?? 'center' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/use-position.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/use-position.ts packages/ui/src/__tests__/use-position.test.ts
git commit -m "feat(ui): positioning placement helpers"
```

---

## Task 3: `usePosition` hook

The floating-ui binding. Positions the floating element with `position: fixed`, keeps it updated via `autoUpdate`, and returns the resolved `side`/`align` plus arrow coordinates for data attributes and the arrow part.

**Files:**
- Modify: `packages/ui/src/use-position.ts`
- Test: `packages/ui/src/__tests__/use-position-hook.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { usePosition, type PositionState } from '../use-position.js';

afterEach(cleanup);

function Harness({ open }: { open: boolean }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const pos: PositionState = usePosition({
    open,
    anchorRef,
    floatingRef,
    side: 'bottom',
    align: 'center',
  });
  return (
    <div>
      <button ref={anchorRef}>anchor</button>
      {open ? (
        <div ref={floatingRef} data-testid="float" data-side={pos.side}>
          floating
        </div>
      ) : null}
    </div>
  );
}

describe('usePosition', () => {
  it('reports the requested side before any flip', () => {
    const { getByTestId } = render(<Harness open />);
    expect(getByTestId('float').getAttribute('data-side')).toBe('bottom');
  });

  it('sets position:fixed on the floating element when open', async () => {
    const { getByTestId } = render(<Harness open />);
    const float = getByTestId('float');
    // computePosition resolves a microtask later; flush it.
    await Promise.resolve();
    await Promise.resolve();
    expect(float.style.position).toBe('fixed');
  });

  it('does not throw when closed (floating element absent)', () => {
    expect(() => render(<Harness open={false} />)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/use-position-hook.test.tsx`
Expected: FAIL with "does not provide an export named 'usePosition'".

- [ ] **Step 3: Implement the hook**

Append to `packages/ui/src/use-position.ts`:

```ts
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  computePosition,
  autoUpdate,
  offset as offsetMiddleware,
  flip,
  shift,
  arrow as arrowMiddleware,
} from '@floating-ui/dom';

export interface UsePositionOptions {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  arrowRef?: RefObject<HTMLElement>;
  side?: Side; // default 'bottom'
  align?: Align; // default 'center'
  offset?: number; // gap in px, default 8
}

export interface PositionState {
  side: Side;
  align: Align;
  arrowX: number | null;
  arrowY: number | null;
}

export function usePosition(opts: UsePositionOptions): PositionState {
  const {
    open,
    anchorRef,
    floatingRef,
    arrowRef,
    side = 'bottom',
    align = 'center',
    offset = 8,
  } = opts;

  const [state, setState] = useState<PositionState>({
    side,
    align,
    arrowX: null,
    arrowY: null,
  });

  // Keep the latest state in a ref so the autoUpdate callback can skip
  // setState when nothing the render cares about changed (it fires on every
  // scroll/resize frame; we only re-render on a side/align/arrow change).
  const stateRef = useRef(state);
  stateRef.current = state;

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!open || !anchor || !floating) return;

    const update = () => {
      const middleware = [offsetMiddleware(offset), flip(), shift({ padding: 8 })];
      if (arrowRef?.current) {
        middleware.push(arrowMiddleware({ element: arrowRef.current }));
      }
      computePosition(anchor, floating, {
        strategy: 'fixed',
        placement: placementFor(side, align),
        middleware,
      }).then(({ x, y, placement, middlewareData }) => {
        floating.style.position = 'fixed';
        floating.style.left = `${x}px`;
        floating.style.top = `${y}px`;

        const resolved = sideAlignFromPlacement(placement);
        const arrowData = middlewareData.arrow;
        const next: PositionState = {
          side: resolved.side,
          align: resolved.align,
          arrowX: arrowData?.x ?? null,
          arrowY: arrowData?.y ?? null,
        };
        const prev = stateRef.current;
        if (
          prev.side !== next.side ||
          prev.align !== next.align ||
          prev.arrowX !== next.arrowX ||
          prev.arrowY !== next.arrowY
        ) {
          setState(next);
        }
      });
    };

    return autoUpdate(anchor, floating, update);
    // anchorRef/floatingRef/arrowRef are stable RefObjects; depend on the
    // values that change the computation.
  }, [open, side, align, offset]);

  return state;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/use-position-hook.test.tsx`
Expected: PASS (3 tests). If `style.position` is empty, add one more `await Promise.resolve()` (floating-ui chains a couple of microtasks).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/use-position.ts packages/ui/src/__tests__/use-position-hook.test.tsx
git commit -m "feat(ui): usePosition floating-ui binding"
```

---

## Task 4: Dismissal stack

A module-level stack of open layers with one shared pair of capture-phase document listeners. Escape routes to the topmost escape-enabled layer; outside-press routes to the topmost outside-press layer whose `refs` do not contain the press target.

**Files:**
- Create: `packages/ui/src/dismiss-stack.ts`
- Test: `packages/ui/src/__tests__/dismiss-stack.test.ts`

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
  return {
    refs: [],
    escape: true,
    outsidePress: true,
    onDismiss: vi.fn(),
    ...partial,
  };
}

describe('dismiss stack', () => {
  it('routes Escape to the topmost escape-enabled layer only', () => {
    const bottom = layer({});
    const top = layer({});
    cleanups.push(registerDismissLayer(bottom), registerDismissLayer(top));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(top.onDismiss).toHaveBeenCalledWith('escape');
    expect(bottom.onDismiss).not.toHaveBeenCalled();
  });

  it('skips layers that opted out of escape', () => {
    const noEscape = layer({ escape: false });
    cleanups.push(registerDismissLayer(noEscape));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(noEscape.onDismiss).not.toHaveBeenCalled();
  });

  it('does not dismiss when the press is inside the layer refs', () => {
    const inside = document.createElement('div');
    document.body.append(inside);
    const l = layer({ refs: [makeRef(inside)] });
    cleanups.push(registerDismissLayer(l));

    inside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(l.onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses the topmost outside-press layer on an outside press', () => {
    const inside = document.createElement('div');
    const outside = document.createElement('div');
    document.body.append(inside, outside);
    const l = layer({ refs: [makeRef(inside)] });
    cleanups.push(registerDismissLayer(l));

    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(l.onDismiss).toHaveBeenCalledWith('outside-press');
  });

  it('detaches listeners when the stack empties', () => {
    const l = layer({});
    const unregister = registerDismissLayer(l);
    unregister();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(l.onDismiss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/dismiss-stack.test.ts`
Expected: FAIL with "does not provide an export named 'registerDismissLayer'".

- [ ] **Step 3: Implement the stack**

```ts
// packages/ui/src/dismiss-stack.ts
import type { RefObject } from 'preact';

export type DismissReason = 'escape' | 'outside-press';

export interface DismissLayer {
  // Elements considered "inside" this layer. A pointerdown within any of them
  // is not an outside-press. Pass the floating element and the anchor/trigger.
  refs: Array<RefObject<HTMLElement>>;
  escape: boolean;
  outsidePress: boolean;
  onDismiss: (reason: DismissReason) => void;
}

const stack: DismissLayer[] = [];
let listening = false;

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].escape) {
      stack[i].onDismiss('escape');
      return;
    }
  }
}

function onPointerDown(event: Event) {
  // event.target is EventTarget | null; narrow to Node via instanceof so
  // contains() is callable without a cast.
  const target = event.target;
  const targetNode = target instanceof Node ? target : null;
  for (let i = stack.length - 1; i >= 0; i--) {
    const layer = stack[i];
    if (!layer.outsidePress) continue;
    const inside = layer.refs.some(
      (ref) =>
        ref.current != null &&
        targetNode != null &&
        ref.current.contains(targetNode)
    );
    // The first outside-press layer from the top decides: if the press landed
    // inside it, nothing dismisses; otherwise it dismisses and we stop.
    if (inside) return;
    layer.onDismiss('outside-press');
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

// Push a layer onto the stack; returns an unregister function. The shared
// document listeners attach on the first layer and detach when the last leaves.
export function registerDismissLayer(layer: DismissLayer): () => void {
  stack.push(layer);
  ensureListening();
  return () => {
    const index = stack.indexOf(layer);
    if (index >= 0) stack.splice(index, 1);
    if (stack.length === 0) stopListening();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/dismiss-stack.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/dismiss-stack.ts packages/ui/src/__tests__/dismiss-stack.test.ts
git commit -m "feat(ui): shared dismissal stack"
```

---

## Task 5: `useDismiss` hook

The per-component hook: registers a layer while `enabled`, forwarding to the latest `onDismiss`.

**Files:**
- Create: `packages/ui/src/use-dismiss.ts`
- Test: `packages/ui/src/__tests__/use-dismiss.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useDismiss } from '../use-dismiss.js';

afterEach(cleanup);

function Harness({
  open,
  onDismiss,
}: {
  open: boolean;
  onDismiss: (r: 'escape' | 'outside-press') => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss({ enabled: open, refs: [ref], onDismiss });
  return open ? <div ref={ref}>panel</div> : null;
}

describe('useDismiss', () => {
  it('calls onDismiss on Escape while open', () => {
    const onDismiss = vi.fn();
    render(<Harness open onDismiss={onDismiss} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).toHaveBeenCalledWith('escape');
  });

  it('unregisters when it closes', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Harness open onDismiss={onDismiss} />);
    rerender(<Harness open={false} onDismiss={onDismiss} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/use-dismiss.test.tsx`
Expected: FAIL with "does not provide an export named 'useDismiss'".

- [ ] **Step 3: Implement the hook**

```ts
// packages/ui/src/use-dismiss.ts
import type { RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  registerDismissLayer,
  type DismissReason,
} from './dismiss-stack.js';

export interface UseDismissOptions {
  enabled: boolean; // typically the open state
  refs: Array<RefObject<HTMLElement>>; // stable RefObjects treated as "inside"
  escape?: boolean; // default true
  outsidePress?: boolean; // default true
  onDismiss: (reason: DismissReason) => void;
}

export function useDismiss(opts: UseDismissOptions): void {
  const { enabled, refs, escape = true, outsidePress = true, onDismiss } = opts;

  // Forward to the latest onDismiss without re-registering the layer.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // refs are stable RefObjects (from context); capture them in a ref so the
  // effect does not re-run on the array literal's changing identity.
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!enabled) return;
    return registerDismissLayer({
      refs: refsRef.current,
      escape,
      outsidePress,
      onDismiss: (reason) => onDismissRef.current(reason),
    });
  }, [enabled, escape, outsidePress]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/use-dismiss.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/use-dismiss.ts packages/ui/src/__tests__/use-dismiss.test.tsx
git commit -m "feat(ui): useDismiss hook"
```

---

## Task 6: `useFocusReturn` hook

Captures the focused element on open, moves focus into the popup, and returns focus on close. Not a trap.

**Files:**
- Create: `packages/ui/src/use-focus-return.ts`
- Test: `packages/ui/src/__tests__/use-focus-return.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useFocusReturn } from '../use-focus-return.js';

afterEach(cleanup);

function Harness({ open }: { open: boolean }) {
  const popupRef = useRef<HTMLDivElement>(null);
  useFocusReturn({ open, popupRef });
  return (
    <div>
      <button data-testid="trigger">trigger</button>
      {open ? (
        <div ref={popupRef}>
          <button data-testid="inside">inside</button>
        </div>
      ) : null}
    </div>
  );
}

describe('useFocusReturn', () => {
  it('moves focus to the first focusable in the popup on open', () => {
    const { getByTestId, rerender } = render(<Harness open={false} />);
    getByTestId('trigger').focus();
    rerender(<Harness open />);
    expect(document.activeElement).toBe(getByTestId('inside'));
  });

  it('returns focus to the previously focused element on close', () => {
    const { getByTestId, rerender } = render(<Harness open={false} />);
    const trigger = getByTestId('trigger');
    trigger.focus();
    rerender(<Harness open />);
    expect(document.activeElement).toBe(getByTestId('inside'));
    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(trigger);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/use-focus-return.test.tsx`
Expected: FAIL with "does not provide an export named 'useFocusReturn'".

- [ ] **Step 3: Implement the hook**

```ts
// packages/ui/src/use-focus-return.ts
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface UseFocusReturnOptions {
  open: boolean;
  popupRef: RefObject<HTMLElement>;
  // Optional element to focus first; defaults to the first focusable, then the
  // popup container itself.
  initialFocusRef?: RefObject<HTMLElement>;
}

export function useFocusReturn(opts: UseFocusReturnOptions): void {
  const { open, popupRef, initialFocusRef } = opts;
  const previousRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    previousRef.current = active instanceof HTMLElement ? active : null;

    const popup = popupRef.current;
    const target =
      initialFocusRef?.current ??
      popup?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      popup;
    target?.focus();

    return () => {
      previousRef.current?.focus();
    };
  }, [open]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/use-focus-return.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/use-focus-return.ts packages/ui/src/__tests__/use-focus-return.test.tsx
git commit -m "feat(ui): useFocusReturn hook"
```

---

## Task 7: Export the new primitives

**Files:**
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/__tests__/exports.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as ui from '../index.js';

describe('@hono-preact/ui exports', () => {
  it('exposes the new machinery primitives', () => {
    expect(typeof ui.usePosition).toBe('function');
    expect(typeof ui.useDismiss).toBe('function');
    expect(typeof ui.useFocusReturn).toBe('function');
    expect(typeof ui.placementFor).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/exports.test.ts`
Expected: FAIL ("usePosition is not a function" / undefined).

- [ ] **Step 3: Add the exports**

Add to `packages/ui/src/index.ts` (after the existing primitive exports, before/around the Dialog export):

```ts
export {
  usePosition,
  placementFor,
  sideAlignFromPlacement,
  type UsePositionOptions,
  type PositionState,
  type Side,
  type Align,
} from './use-position.js';
export { useDismiss, type UseDismissOptions } from './use-dismiss.js';
export { type DismissReason } from './dismiss-stack.js';
export {
  useFocusReturn,
  type UseFocusReturnOptions,
} from './use-focus-return.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/exports.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/index.ts packages/ui/src/__tests__/exports.test.ts
git commit -m "feat(ui): export positioning/dismiss/focus primitives"
```

---

# Phase B: Popover

## Task 8: Popover context + Root

**Files:**
- Create: `packages/ui/src/popover/context.ts`
- Create: `packages/ui/src/popover/popover.tsx`
- Test: `packages/ui/src/__tests__/popover-root.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { PopoverRoot, PopoverTrigger } from '../popover/popover.js';

afterEach(cleanup);

describe('Popover Root + Trigger', () => {
  it('renders a button trigger with popover ARIA wiring', () => {
    const { getByText } = render(
      <PopoverRoot>
        <PopoverTrigger>Open</PopoverTrigger>
      </PopoverRoot>
    );
    const btn = getByText('Open');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBeTruthy();
    expect(btn.getAttribute('data-state')).toBe('closed');
  });

  it('toggling the trigger flips open state', () => {
    const { getByText } = render(
      <PopoverRoot>
        <PopoverTrigger>Open</PopoverTrigger>
      </PopoverRoot>
    );
    const btn = getByText('Open');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('data-state')).toBe('open');
  });

  it('respects a controlled open prop', () => {
    const { getByText } = render(
      <PopoverRoot open>
        <PopoverTrigger>Open</PopoverTrigger>
      </PopoverRoot>
    );
    expect(getByText('Open').getAttribute('aria-expanded')).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/popover-root.test.tsx`
Expected: FAIL ("does not provide an export named 'PopoverRoot'").

- [ ] **Step 3: Implement context + Root + Trigger (Trigger fleshed out here so the test passes)**

```ts
// packages/ui/src/popover/context.ts
import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';
import type { Side, Align, PositionState } from '../use-position.js';

export interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>; // the Positioner element
  popupRef: RefObject<HTMLElement>; // the Popup element (focus target)
  arrowRef: RefObject<HTMLElement>;
  triggerId: string;
  popupId: string;
  titleId: string;
  descriptionId: string;
  hasDescription: boolean;
  registerDescription: () => () => void;
  side: Side;
  align: Align;
  offset: number;
  position: PositionState;
  setPosition: (p: PositionState) => void;
}

export const PopoverContext = createContext<PopoverContextValue | null>(null);

export function usePopoverContext(part: string): PopoverContextValue {
  const ctx = useContext(PopoverContext);
  if (!ctx) {
    throw new Error(`<Popover.${part}> must be used within <Popover.Root>`);
  }
  return ctx;
}
```

```tsx
// packages/ui/src/popover/popover.tsx
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
import { PopoverContext, usePopoverContext } from './context.js';

export interface PopoverRootProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side; // default 'bottom'
  align?: Align; // default 'center'
  offset?: number; // default 8
  children?: ComponentChildren;
}

export function PopoverRoot(props: PopoverRootProps) {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    side = 'bottom',
    align = 'center',
    offset = 8,
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

  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const popupId = `${baseId}-popup`;
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  const [descriptionCount, setDescriptionCount] = useState(0);
  const registerDescription = useCallback(() => {
    setDescriptionCount((c) => c + 1);
    return () => setDescriptionCount((c) => c - 1);
  }, []);

  const [position, setPosition] = useState<PositionState>({
    side,
    align,
    arrowX: null,
    arrowY: null,
  });

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      anchorRef,
      floatingRef,
      popupRef,
      arrowRef,
      triggerId,
      popupId,
      titleId,
      descriptionId,
      hasDescription: descriptionCount > 0,
      registerDescription,
      side,
      align,
      offset,
      position,
      setPosition,
    }),
    [
      open,
      setOpen,
      triggerId,
      popupId,
      titleId,
      descriptionId,
      descriptionCount,
      registerDescription,
      side,
      align,
      offset,
      position,
    ]
  );

  return h(PopoverContext.Provider, { value: ctx }, children);
}

export type PopoverTriggerProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function PopoverTrigger(props: PopoverTriggerProps): VNode {
  const { render, children, onClick, ...rest } = props;
  const ctx = usePopoverContext('Trigger');

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    ctx.setOpen(!ctx.open);
  };

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      ref: ctx.anchorRef,
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': ctx.open,
      'aria-controls': ctx.popupId,
      id: ctx.triggerId,
      'data-state': ctx.open ? 'open' : 'closed',
      onClick: handleClick,
    },
    state: { open: ctx.open },
    children,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/popover-root.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/popover/context.ts packages/ui/src/popover/popover.tsx packages/ui/src/__tests__/popover-root.test.tsx
git commit -m "feat(ui): Popover Root + Trigger"
```

---

## Task 9: Popover Anchor (alternate anchor element)

**Files:**
- Modify: `packages/ui/src/popover/popover.tsx`
- Test: `packages/ui/src/__tests__/popover-anchor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { PopoverRoot, PopoverAnchor } from '../popover/popover.js';

afterEach(cleanup);

describe('Popover Anchor', () => {
  it('renders its children as the anchor element by default (a span)', () => {
    const { getByText } = render(
      <PopoverRoot>
        <PopoverAnchor>anchored here</PopoverAnchor>
      </PopoverRoot>
    );
    const el = getByText('anchored here');
    expect(el.tagName).toBe('SPAN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/popover-anchor.test.tsx`
Expected: FAIL ("does not provide an export named 'PopoverAnchor'").

- [ ] **Step 3: Implement Anchor**

Append to `packages/ui/src/popover/popover.tsx`:

```tsx
export type PopoverAnchorProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLSpanElement>, 'children'>;

// Optional: positions the popover relative to this element instead of the
// Trigger. Sets the shared anchorRef, overriding the Trigger's ref (last write
// wins; render Anchor when you want a non-trigger anchor).
export function PopoverAnchor(props: PopoverAnchorProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Anchor');
  return useRender({
    render,
    defaultTag: 'span',
    props: { ...rest, ref: ctx.anchorRef },
    children,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/popover-anchor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/popover/popover.tsx packages/ui/src/__tests__/popover-anchor.test.tsx
git commit -m "feat(ui): Popover Anchor"
```

---

## Task 10: Popover Positioner + Popup

The Positioner gates mount-on-open, runs `usePosition`, applies the Popover API imperatively, and writes `data-side`/`data-align`. The Popup is the surface: `role="dialog"`, focus target (`useFocusReturn`), dismissal layer (`useDismiss`), and `aria-labelledby`/`aria-describedby` wiring.

**Files:**
- Modify: `packages/ui/src/popover/popover.tsx`
- Test: `packages/ui/src/__tests__/popover-popup.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPositioner,
  PopoverPopup,
} from '../popover/popover.js';

afterEach(cleanup);

function Example() {
  return (
    <PopoverRoot>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverPositioner>
        <PopoverPopup aria-label="Menu">
          <button>Action</button>
        </PopoverPopup>
      </PopoverPositioner>
    </PopoverRoot>
  );
}

describe('Popover Positioner + Popup', () => {
  it('does not render the popup while closed', () => {
    const { queryByRole } = render(<Example />);
    expect(queryByRole('dialog')).toBeNull();
  });

  it('renders the popup with role=dialog and data-state=open when open', () => {
    const { getByText, getByRole } = render(<Example />);
    fireEvent.click(getByText('Open'));
    const popup = getByRole('dialog');
    expect(popup.getAttribute('data-state')).toBe('open');
    expect(popup.getAttribute('aria-label')).toBe('Menu');
    expect(popup.getAttribute('id')).toBeTruthy();
  });

  it('moves focus into the popup on open', () => {
    const { getByText } = render(<Example />);
    fireEvent.click(getByText('Open'));
    expect(document.activeElement?.textContent).toBe('Action');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const { getByText, queryByRole } = render(<Example />);
    const trigger = getByText('Open');
    trigger.focus(); // so useFocusReturn captures the trigger as the opener
    fireEvent.click(trigger);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on an outside press', () => {
    const { getByText, queryByRole } = render(<Example />);
    fireEvent.click(getByText('Open'));
    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true })
    );
    expect(queryByRole('dialog')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/popover-popup.test.tsx`
Expected: FAIL ("does not provide an export named 'PopoverPositioner'").

- [ ] **Step 3: Implement Positioner + Popup**

Add imports at the top of `packages/ui/src/popover/popover.tsx` (extend the existing hook import and add the new modules):

```tsx
import { useLayoutEffect } from 'preact/hooks';
import { usePosition } from '../use-position.js';
import { useDismiss } from '../use-dismiss.js';
import { useFocusReturn } from '../use-focus-return.js';
```

Append the parts:

```tsx
function supportsPopover(el: HTMLElement): boolean {
  return typeof (el as { showPopover?: unknown }).showPopover === 'function';
}

export type PopoverPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function PopoverPositioner(
  props: PopoverPositionerProps
): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Positioner');

  const position = usePosition({
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
  });

  // Publish the resolved position so Arrow (and any consumer) can read it.
  useLayoutEffect(() => {
    ctx.setPosition(position);
  }, [position.side, position.align, position.arrowX, position.arrowY]);

  // Promote to the native top layer where supported (progressive enhancement).
  // Applied imperatively so there is no SSR/hydration attribute mismatch.
  useLayoutEffect(() => {
    const el = ctx.floatingRef.current;
    // Runs when open flips true and the element has mounted (refs are assigned
    // before layout effects). Empty deps would never re-run, so showPopover
    // would never fire on a mount-on-open element.
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
      // The Positioner is a framework-owned layout wrapper: style it via class
      // (z-index etc.), not the style prop, which is reserved for positioning.
      style: { position: 'fixed' },
    },
    state: { side: position.side, align: position.align },
    children,
  });
}

export type PopoverPopupProps = {
  render?: RenderProp<{ open: boolean }>;
  'aria-label'?: string; // alternative to a Title
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function PopoverPopup(props: PopoverPopupProps): VNode {
  const { render, children, 'aria-label': ariaLabel, ...rest } = props;
  const ctx = usePopoverContext('Popup');

  useDismiss({
    enabled: ctx.open,
    refs: [ctx.floatingRef, ctx.anchorRef],
    onDismiss: () => ctx.setOpen(false),
  });

  useFocusReturn({ open: ctx.open, popupRef: ctx.popupRef });

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.popupRef,
      role: 'dialog',
      id: ctx.popupId,
      tabIndex: -1,
      'data-state': ctx.open ? 'open' : 'closed',
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabel ? undefined : ctx.titleId,
      'aria-describedby': ctx.hasDescription ? ctx.descriptionId : undefined,
    },
    state: { open: ctx.open },
    children,
  });
}
```

> Implementation note: `useDismiss`/`useFocusReturn` live in `Popup`, which only mounts while open (the Positioner gates it), so their effect cleanups (unregister layer, return focus) fire on close-driven unmount. `aria-labelledby` points at the Title id; if no Title is rendered, supply `aria-label`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/popover-popup.test.tsx`
Expected: PASS (5 tests). happy-dom does not implement `showPopover`, so the enhancement path is inert under test (the `supportsPopover` guard returns false), and the inline `position: fixed` baseline is what the tests exercise.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/popover/popover.tsx packages/ui/src/__tests__/popover-popup.test.tsx
git commit -m "feat(ui): Popover Positioner + Popup (position, dismiss, focus)"
```

---

## Task 11: Popover Arrow, Title, Description, Close

**Files:**
- Modify: `packages/ui/src/popover/popover.tsx`
- Test: `packages/ui/src/__tests__/popover-parts.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPositioner,
  PopoverPopup,
  PopoverArrow,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
} from '../popover/popover.js';

afterEach(cleanup);

function Example() {
  return (
    <PopoverRoot>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverPositioner>
        <PopoverPopup>
          <PopoverArrow data-testid="arrow" />
          <PopoverTitle>Settings</PopoverTitle>
          <PopoverDescription>Tune your preferences.</PopoverDescription>
          <PopoverClose>Done</PopoverClose>
        </PopoverPopup>
      </PopoverPositioner>
    </PopoverRoot>
  );
}

describe('Popover parts', () => {
  it('wires aria-labelledby and aria-describedby to Title/Description', () => {
    const { getByText, getByRole } = render(<Example />);
    fireEvent.click(getByText('Open'));
    const popup = getByRole('dialog');
    const labelledby = popup.getAttribute('aria-labelledby');
    const describedby = popup.getAttribute('aria-describedby');
    expect(getByText('Settings').getAttribute('id')).toBe(labelledby);
    expect(getByText('Tune your preferences.').getAttribute('id')).toBe(
      describedby
    );
  });

  it('Close dismisses the popover', () => {
    const { getByText, queryByRole } = render(<Example />);
    fireEvent.click(getByText('Open'));
    fireEvent.click(getByText('Done'));
    expect(queryByRole('dialog')).toBeNull();
  });

  it('renders an arrow element carrying data-side', () => {
    const { getByText, getByTestId } = render(<Example />);
    fireEvent.click(getByText('Open'));
    expect(getByTestId('arrow').getAttribute('data-side')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/popover-parts.test.tsx`
Expected: FAIL ("does not provide an export named 'PopoverArrow'").

- [ ] **Step 3: Implement the parts**

Append to `packages/ui/src/popover/popover.tsx`. (`useLayoutEffect` is already imported from Task 10.)

```tsx
export type PopoverArrowProps = {
  render?: RenderProp<{ side: Side }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function PopoverArrow(props: PopoverArrowProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Arrow');
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

export type PopoverTitleProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLHeadingElement>, 'children'>;

export function PopoverTitle(props: PopoverTitleProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Title');
  return useRender({
    render,
    defaultTag: 'h2',
    props: { ...rest, id: ctx.titleId },
    children,
  });
}

export type PopoverDescriptionProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLParagraphElement>, 'children'>;

export function PopoverDescription(props: PopoverDescriptionProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Description');
  useLayoutEffect(() => ctx.registerDescription(), [ctx.registerDescription]);
  return useRender({
    render,
    defaultTag: 'p',
    props: { ...rest, id: ctx.descriptionId },
    children,
  });
}

export type PopoverCloseProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function PopoverClose(props: PopoverCloseProps): VNode {
  const { render, children, onClick, ...rest } = props;
  const ctx = usePopoverContext('Close');
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    ctx.setOpen(false);
  };
  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      type: 'button',
      'data-state': ctx.open ? 'open' : 'closed',
      onClick: handleClick,
    },
    state: { open: ctx.open },
    children,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/popover-parts.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/popover/popover.tsx packages/ui/src/__tests__/popover-parts.test.tsx
git commit -m "feat(ui): Popover Arrow/Title/Description/Close"
```

---

## Task 12: Popover namespace, barrel, and SSR

**Files:**
- Create: `packages/ui/src/popover/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/__tests__/popover-ssr.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { Popover } from '../popover/index.js';

describe('Popover SSR', () => {
  it('renders the trigger closed and omits the popup (mount-on-open)', () => {
    const html = renderToString(
      <Popover.Root>
        <Popover.Trigger>Open</Popover.Trigger>
        <Popover.Positioner>
          <Popover.Popup aria-label="Menu">
            <button>Action</button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Root>
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-state="closed"');
    // Mount-on-open: no dialog markup on the server.
    expect(html).not.toContain('role="dialog"');
  });

  it('produces a trigger id that matches aria-controls', () => {
    const html = renderToString(
      <Popover.Root>
        <Popover.Trigger>Open</Popover.Trigger>
      </Popover.Root>
    );
    const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controls).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/popover-ssr.test.tsx`
Expected: FAIL ("does not provide an export named 'Popover'").

- [ ] **Step 3: Create the namespace barrel and re-export from the package index**

```ts
// packages/ui/src/popover/index.ts
export {
  PopoverRoot,
  PopoverTrigger,
  PopoverAnchor,
  PopoverPositioner,
  PopoverPopup,
  PopoverArrow,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
  type PopoverRootProps,
  type PopoverTriggerProps,
  type PopoverAnchorProps,
  type PopoverPositionerProps,
  type PopoverPopupProps,
  type PopoverArrowProps,
  type PopoverTitleProps,
  type PopoverDescriptionProps,
  type PopoverCloseProps,
} from './popover.js';

import {
  PopoverRoot,
  PopoverTrigger,
  PopoverAnchor,
  PopoverPositioner,
  PopoverPopup,
  PopoverArrow,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
} from './popover.js';

export const Popover = {
  Root: PopoverRoot,
  Trigger: PopoverTrigger,
  Anchor: PopoverAnchor,
  Positioner: PopoverPositioner,
  Popup: PopoverPopup,
  Arrow: PopoverArrow,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Close: PopoverClose,
};
```

Add to `packages/ui/src/index.ts`:

```ts
export {
  Popover,
  PopoverRoot,
  PopoverTrigger,
  PopoverAnchor,
  PopoverPositioner,
  PopoverPopup,
  PopoverArrow,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
  type PopoverRootProps,
  type PopoverTriggerProps,
  type PopoverAnchorProps,
  type PopoverPositionerProps,
  type PopoverPopupProps,
  type PopoverArrowProps,
  type PopoverTitleProps,
  type PopoverDescriptionProps,
  type PopoverCloseProps,
} from './popover/index.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/popover-ssr.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Build + commit**

```bash
pnpm --filter @hono-preact/ui build
git add packages/ui/src/popover/index.ts packages/ui/src/index.ts packages/ui/src/__tests__/popover-ssr.test.tsx
git commit -m "feat(ui): Popover namespace + barrel + SSR"
```

---

# Phase C: Tooltip

## Task 13: Tooltip context + Root + Trigger (hover/focus/touch/delay)

**Files:**
- Create: `packages/ui/src/tooltip/context.ts`
- Create: `packages/ui/src/tooltip/tooltip.tsx`
- Test: `packages/ui/src/__tests__/tooltip-trigger.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { TooltipRoot, TooltipTrigger } from '../tooltip/tooltip.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function Harness({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  return (
    <TooltipRoot delay={100} closeDelay={100} onOpenChange={onOpenChange}>
      <TooltipTrigger>Hover me</TooltipTrigger>
    </TooltipRoot>
  );
}

describe('Tooltip Trigger', () => {
  it('opens after the delay on pointer enter (mouse)', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.pointerEnter(getByText('Hover me'), { pointerType: 'mouse' });
    expect(onOpenChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('opens immediately on focus', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.focus(getByText('Hover me'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('does not open on a touch pointer', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.pointerEnter(getByText('Hover me'), { pointerType: 'touch' });
    vi.advanceTimersByTime(1000);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('closes after closeDelay on pointer leave', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.focus(getByText('Hover me')); // open immediately
    onOpenChange.mockClear();
    fireEvent.pointerLeave(getByText('Hover me'), { pointerType: 'mouse' });
    vi.advanceTimersByTime(100);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/tooltip-trigger.test.tsx`
Expected: FAIL ("does not provide an export named 'TooltipRoot'").

- [ ] **Step 3: Implement context + Root + Trigger**

```ts
// packages/ui/src/tooltip/context.ts
import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';
import type { Side, Align, PositionState } from '../use-position.js';

export interface TooltipContextValue {
  open: boolean;
  // open/close go through delayed schedulers; `immediate` skips the timers
  // (used by focus/blur and Escape).
  scheduleOpen: () => void;
  scheduleClose: () => void;
  setOpenImmediate: (open: boolean) => void;
  cancelPending: () => void;
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  arrowRef: RefObject<HTMLElement>;
  popupId: string;
  side: Side;
  align: Align;
  offset: number;
  position: PositionState;
  setPosition: (p: PositionState) => void;
}

export const TooltipContext = createContext<TooltipContextValue | null>(null);

export function useTooltipContext(part: string): TooltipContextValue {
  const ctx = useContext(TooltipContext);
  if (!ctx) {
    throw new Error(`<Tooltip.${part}> must be used within <Tooltip.Root>`);
  }
  return ctx;
}
```

```tsx
// packages/ui/src/tooltip/tooltip.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import { useCallback, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align, PositionState } from '../use-position.js';
import { TooltipContext, useTooltipContext } from './context.js';

export interface TooltipRootProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delay?: number; // open delay (ms), default 600
  closeDelay?: number; // close delay (ms), default 300
  side?: Side; // default 'top'
  align?: Align; // default 'center'
  offset?: number; // default 8
  children?: ComponentChildren;
}

export function TooltipRoot(props: TooltipRootProps) {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    delay = 600,
    closeDelay = 300,
    side = 'top',
    align = 'center',
    offset = 8,
    children,
  } = props;

  const [open, setOpen] = useControllableState<boolean>({
    value: openProp,
    defaultValue: defaultOpen ?? false,
    onChange: onOpenChange,
  });

  const anchorRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<HTMLElement>(null);
  const arrowRef = useRef<HTMLElement>(null);
  const popupId = useId();

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPending = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const setOpenImmediate = useCallback(
    (next: boolean) => {
      cancelPending();
      setOpen(next);
    },
    [cancelPending, setOpen]
  );
  const scheduleOpen = useCallback(() => {
    cancelPending();
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [cancelPending, setOpen, delay]);
  const scheduleClose = useCallback(() => {
    cancelPending();
    timer.current = setTimeout(() => setOpen(false), closeDelay);
  }, [cancelPending, setOpen, closeDelay]);

  const [position, setPosition] = useState<PositionState>({
    side,
    align,
    arrowX: null,
    arrowY: null,
  });

  const ctx = useMemo(
    () => ({
      open,
      scheduleOpen,
      scheduleClose,
      setOpenImmediate,
      cancelPending,
      anchorRef,
      floatingRef,
      arrowRef,
      popupId,
      side,
      align,
      offset,
      position,
      setPosition,
    }),
    [
      open,
      scheduleOpen,
      scheduleClose,
      setOpenImmediate,
      cancelPending,
      popupId,
      side,
      align,
      offset,
      position,
    ]
  );

  return h(TooltipContext.Provider, { value: ctx }, children);
}

export type TooltipTriggerProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function TooltipTrigger(props: TooltipTriggerProps): VNode {
  const {
    render,
    children,
    onPointerEnter,
    onPointerLeave,
    onFocus,
    onBlur,
    ...rest
  } = props;
  const ctx = useTooltipContext('Trigger');

  const handlePointerEnter = (
    event: JSX.TargetedPointerEvent<HTMLButtonElement>
  ) => {
    onPointerEnter?.(event);
    // Tooltips are inaccessible on touch; do not open on a touch pointer.
    if (event.pointerType === 'touch') return;
    ctx.scheduleOpen();
  };
  const handlePointerLeave = (
    event: JSX.TargetedPointerEvent<HTMLButtonElement>
  ) => {
    onPointerLeave?.(event);
    if (event.pointerType === 'touch') return;
    ctx.scheduleClose();
  };
  const handleFocus = (event: JSX.TargetedFocusEvent<HTMLButtonElement>) => {
    onFocus?.(event);
    ctx.setOpenImmediate(true);
  };
  const handleBlur = (event: JSX.TargetedFocusEvent<HTMLButtonElement>) => {
    onBlur?.(event);
    ctx.setOpenImmediate(false);
  };

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      ref: ctx.anchorRef,
      type: 'button',
      'aria-describedby': ctx.open ? ctx.popupId : undefined,
      'data-state': ctx.open ? 'open' : 'closed',
      onPointerEnter: handlePointerEnter,
      onPointerLeave: handlePointerLeave,
      onFocus: handleFocus,
      onBlur: handleBlur,
    },
    state: { open: ctx.open },
    children,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/tooltip-trigger.test.tsx`
Expected: PASS (4 tests). If `fireEvent.pointerEnter` does not carry `pointerType` in happy-dom, the touch test will fail; in that case construct the event explicitly: `fireEvent(el, new PointerEvent('pointerenter', { pointerType: 'touch' }))`. Verify happy-dom exposes `PointerEvent`; if not, fall back to dispatching a `MouseEvent` and reading `event.pointerType` (undefined, treated as non-touch) for the mouse cases, and assert touch-suppression via a unit test that calls the handler with `{ pointerType: 'touch' }`.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/tooltip/context.ts packages/ui/src/tooltip/tooltip.tsx packages/ui/src/__tests__/tooltip-trigger.test.tsx
git commit -m "feat(ui): Tooltip Root + Trigger (hover/focus/touch/delay)"
```

---

## Task 14: Tooltip Positioner + Popup (hoverable + Escape)

**Files:**
- Modify: `packages/ui/src/tooltip/tooltip.tsx`
- Test: `packages/ui/src/__tests__/tooltip-popup.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipPositioner,
  TooltipPopup,
} from '../tooltip/tooltip.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function Example() {
  return (
    <TooltipRoot delay={100} closeDelay={100}>
      <TooltipTrigger>Help</TooltipTrigger>
      <TooltipPositioner>
        <TooltipPopup>More info</TooltipPopup>
      </TooltipPositioner>
    </TooltipRoot>
  );
}

describe('Tooltip Positioner + Popup', () => {
  it('renders role=tooltip with the id the trigger describes', () => {
    const { getByText, getByRole } = render(<Example />);
    fireEvent.focus(getByText('Help'));
    const tip = getByRole('tooltip');
    expect(tip.getAttribute('id')).toBe(
      getByText('Help').getAttribute('aria-describedby')
    );
  });

  it('stays open when the pointer moves onto the popup (hoverable)', () => {
    const { getByText, getByRole, queryByRole } = render(<Example />);
    fireEvent.focus(getByText('Help')); // open
    fireEvent.pointerLeave(getByText('Help'), { pointerType: 'mouse' });
    // Before the close timer fires, hovering the popup cancels the close.
    fireEvent.pointerEnter(getByRole('tooltip'), { pointerType: 'mouse' });
    vi.advanceTimersByTime(100);
    expect(queryByRole('tooltip')).not.toBeNull();
  });

  it('closes on Escape', () => {
    const { getByText, queryByRole } = render(<Example />);
    fireEvent.focus(getByText('Help'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(queryByRole('tooltip')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/tooltip-popup.test.tsx`
Expected: FAIL ("does not provide an export named 'TooltipPositioner'").

- [ ] **Step 3: Implement Positioner + Popup**

Add imports near the top of `packages/ui/src/tooltip/tooltip.tsx`:

```tsx
import { useLayoutEffect } from 'preact/hooks';
import { usePosition } from '../use-position.js';
import { useDismiss } from '../use-dismiss.js';
```

Append the parts:

```tsx
function supportsPopover(el: HTMLElement): boolean {
  return typeof (el as { showPopover?: unknown }).showPopover === 'function';
}

export type TooltipPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function TooltipPositioner(
  props: TooltipPositionerProps
): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = useTooltipContext('Positioner');

  const position = usePosition({
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
  });

  useLayoutEffect(() => {
    ctx.setPosition(position);
  }, [position.side, position.align, position.arrowX, position.arrowY]);

  useLayoutEffect(() => {
    const el = ctx.floatingRef.current;
    // Runs when open flips true and the element has mounted (refs are assigned
    // before layout effects). Empty deps would never re-run, so showPopover
    // would never fire on a mount-on-open element.
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
      // The Positioner is a framework-owned layout wrapper: style it via class
      // (z-index etc.), not the style prop, which is reserved for positioning.
      style: { position: 'fixed' },
    },
    state: { side: position.side, align: position.align },
    children,
  });
}

export type TooltipPopupProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function TooltipPopup(props: TooltipPopupProps): VNode {
  const { render, children, onPointerEnter, onPointerLeave, ...rest } = props;
  const ctx = useTooltipContext('Popup');

  // Escape closes; no outside-press for a tooltip.
  useDismiss({
    enabled: ctx.open,
    refs: [ctx.floatingRef, ctx.anchorRef],
    escape: true,
    outsidePress: false,
    onDismiss: () => ctx.setOpenImmediate(false),
  });

  // Hoverable (WCAG 1.4.13): moving onto the popup keeps it open; leaving it
  // re-schedules the close.
  const handlePointerEnter = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>
  ) => {
    onPointerEnter?.(event);
    ctx.cancelPending();
  };
  const handlePointerLeave = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>
  ) => {
    onPointerLeave?.(event);
    ctx.scheduleClose();
  };

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      // No ref here: the Positioner holds floatingRef, and the dismiss layer's
      // "inside" check (floatingRef.contains(target)) already covers this
      // child Popup. The Popup only needs role/id/state and the hover handlers.
      role: 'tooltip',
      id: ctx.popupId,
      'data-state': ctx.open ? 'open' : 'closed',
      onPointerEnter: handlePointerEnter,
      onPointerLeave: handlePointerLeave,
    },
    state: { open: ctx.open },
    children,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/tooltip-popup.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/tooltip/tooltip.tsx packages/ui/src/__tests__/tooltip-popup.test.tsx
git commit -m "feat(ui): Tooltip Positioner + Popup (hoverable, Escape)"
```

---

## Task 15: Tooltip Arrow, namespace, barrel, and SSR

**Files:**
- Modify: `packages/ui/src/tooltip/tooltip.tsx`
- Create: `packages/ui/src/tooltip/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/__tests__/tooltip-ssr.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { Tooltip } from '../tooltip/index.js';

describe('Tooltip SSR', () => {
  it('renders the trigger closed and omits the tooltip (mount-on-open)', () => {
    const html = renderToString(
      <Tooltip.Root>
        <Tooltip.Trigger>Help</Tooltip.Trigger>
        <Tooltip.Positioner>
          <Tooltip.Popup>More</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Root>
    );
    expect(html).toContain('data-state="closed"');
    expect(html).not.toContain('role="tooltip"');
    // Closed: the trigger does not describe a not-yet-rendered tooltip.
    expect(html).not.toContain('aria-describedby');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ui/src/__tests__/tooltip-ssr.test.tsx`
Expected: FAIL ("does not provide an export named 'Tooltip'").

- [ ] **Step 3: Add Arrow + the namespace barrel + package export**

Append `TooltipArrow` to `packages/ui/src/tooltip/tooltip.tsx`:

```tsx
export type TooltipArrowProps = {
  render?: RenderProp<{ side: Side }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function TooltipArrow(props: TooltipArrowProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useTooltipContext('Arrow');
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

```ts
// packages/ui/src/tooltip/index.ts
export {
  TooltipRoot,
  TooltipTrigger,
  TooltipPositioner,
  TooltipPopup,
  TooltipArrow,
  type TooltipRootProps,
  type TooltipTriggerProps,
  type TooltipPositionerProps,
  type TooltipPopupProps,
  type TooltipArrowProps,
} from './tooltip.js';

import {
  TooltipRoot,
  TooltipTrigger,
  TooltipPositioner,
  TooltipPopup,
  TooltipArrow,
} from './tooltip.js';

export const Tooltip = {
  Root: TooltipRoot,
  Trigger: TooltipTrigger,
  Positioner: TooltipPositioner,
  Popup: TooltipPopup,
  Arrow: TooltipArrow,
};
```

Add to `packages/ui/src/index.ts`:

```ts
export {
  Tooltip,
  TooltipRoot,
  TooltipTrigger,
  TooltipPositioner,
  TooltipPopup,
  TooltipArrow,
  type TooltipRootProps,
  type TooltipTriggerProps,
  type TooltipPositionerProps,
  type TooltipPopupProps,
  type TooltipArrowProps,
} from './tooltip/index.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ui/src/__tests__/tooltip-ssr.test.tsx`
Expected: PASS.

- [ ] **Step 5: Build + run the whole package suite + commit**

```bash
pnpm --filter @hono-preact/ui build
pnpm vitest run packages/ui
```
Expected: all `packages/ui` tests PASS (Dialog's existing suite plus the new files).

```bash
git add packages/ui/src/tooltip/tooltip.tsx packages/ui/src/tooltip/index.ts packages/ui/src/index.ts packages/ui/src/__tests__/tooltip-ssr.test.tsx
git commit -m "feat(ui): Tooltip Arrow + namespace + barrel + SSR"
```

---

# Phase D: configuration, size tracking, and docs

## Task 16: Size config + vitest coverage exclude

**Files:**
- Modify: `scripts/client-size-config.mjs`
- Modify: `vitest.config.ts`
- Test: `scripts/__tests__/client-size-config.test.mjs` (extend if present; otherwise add a focused test)

- [ ] **Step 1: Write the failing test**

Add to the existing `scripts/__tests__/client-size-config.test.mjs` (create the file with this content if it does not exist):

```js
import { describe, it, expect } from 'vitest';
import {
  COMPONENT_MODULES,
  bucketForChunk,
} from '../client-size-config.mjs';

describe('client size config: Popover + Tooltip', () => {
  it('measures popover and tooltip as components', () => {
    expect(COMPONENT_MODULES.popover).toEqual(['popover/index.js']);
    expect(COMPONENT_MODULES.tooltip).toEqual(['tooltip/index.js']);
  });

  it('buckets the new component doc chunks under components', () => {
    expect(bucketForChunk('popover-AbC123.js')).toBe('components');
    expect(bucketForChunk('tooltip-AbC123.js')).toBe('components');
    expect(bucketForChunk('use-position-AbC123.js')).toBe('components');
    expect(bucketForChunk('use-dismiss-AbC123.js')).toBe('components');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scripts/__tests__/client-size-config.test.mjs`
Expected: FAIL (`COMPONENT_MODULES.popover` is undefined).

- [ ] **Step 3: Update the config**

In `scripts/client-size-config.mjs`, extend `COMPONENT_MODULES`:

```js
export const COMPONENT_MODULES = {
  dialog: ['dialog/index.js'],
  popover: ['popover/index.js'],
  tooltip: ['tooltip/index.js'],
};
```

In the same file, add component-doc chunk prefixes to `CHUNK_PREFIXES` directly after the existing `['dialog', 'components'],` line:

```js
    ['dialog', 'components'],
    ['popover', 'components'],
    ['tooltip', 'components'],
    ['use-position', 'components'],
    ['use-dismiss', 'components'],
```

In `vitest.config.ts`, add the two new index barrels to `coverage.exclude` (next to the existing `'packages/ui/src/dialog/index.ts'`):

```ts
        'packages/ui/src/dialog/index.ts',
        'packages/ui/src/popover/index.ts',
        'packages/ui/src/tooltip/index.ts',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scripts/__tests__/client-size-config.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/client-size-config.mjs scripts/__tests__/client-size-config.test.mjs vitest.config.ts
git commit -m "chore(size): track Popover + Tooltip in Section C"
```

> Do not regenerate `client-size-report.json`; the `build-and-tag` job refreshes it on main-push. Regenerating here would zero the PR deltas.

---

## Task 17: Nav entries for the new pages

**Files:**
- Modify: `apps/site/src/pages/docs/nav.ts`
- Test: `apps/site/src/pages/docs/__tests__/nav.test.ts` (add a targeted check)

- [ ] **Step 1: Write the failing test**

Append to `apps/site/src/pages/docs/__tests__/nav.test.ts` (inside the `describe('docs nav', ...)` block):

```ts
  it('lists Popover and Tooltip under Overlays', () => {
    const components = nav.find((a) => a.id === 'components')!;
    const overlays = components.sections.find((s) => s.heading === 'Overlays')!;
    const routes = overlays.entries.map((e) => e.route);
    expect(routes).toContain('/docs/components/popover');
    expect(routes).toContain('/docs/components/tooltip');
  });

  it('lists usePosition and useDismiss under Foundations', () => {
    const components = nav.find((a) => a.id === 'components')!;
    const foundations = components.sections.find(
      (s) => s.heading === 'Foundations'
    )!;
    const routes = foundations.entries.map((e) => e.route);
    expect(routes).toContain('/docs/components/use-position');
    expect(routes).toContain('/docs/components/use-dismiss');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/site/src/pages/docs/__tests__/nav.test.ts`
Expected: FAIL (routes not found).

- [ ] **Step 3: Update the nav**

In `apps/site/src/pages/docs/nav.ts`, extend the `Overlays` section entries:

```ts
      {
        heading: 'Overlays',
        icon: PanelsTopLeft,
        entries: [
          { title: 'Dialog', route: '/docs/components/dialog' },
          { title: 'Popover', route: '/docs/components/popover' },
          { title: 'Tooltip', route: '/docs/components/tooltip' },
        ],
      },
```

And extend the `Foundations` section entries:

```ts
        entries: [
          { title: 'useRender', route: '/docs/components/use-render' },
          {
            title: 'useControllableState',
            route: '/docs/components/use-controllable-state',
          },
          { title: 'mergeRefs', route: '/docs/components/merge-refs' },
          { title: 'usePosition', route: '/docs/components/use-position' },
          { title: 'useDismiss', route: '/docs/components/use-dismiss' },
        ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/site/src/pages/docs/__tests__/nav.test.ts`
Expected: PASS (existing nav tests plus the two new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/docs/nav.ts apps/site/src/pages/docs/__tests__/nav.test.ts
git commit -m "docs(site): nav entries for Popover, Tooltip, usePosition, useDismiss"
```

---

## Task 18: Popover demo + docs page + styles

**Files:**
- Create: `apps/site/src/components/docs/PopoverDemo.tsx`
- Create: `apps/site/src/pages/docs/components/popover.mdx`
- Modify: `apps/site/src/styles/root.css`

This is a docs/content task. There is no unit test; verification is the site build (Task 20) and a visual check. Keep the styled demo and the copyable CSS identical so "what you see is what you copy" (the Dialog page's contract).

- [ ] **Step 1: Create the demo component**

```tsx
// apps/site/src/components/docs/PopoverDemo.tsx
import { Popover } from '@hono-preact/ui';

// Styled Popover used as the live demo. The styling lives in
// apps/site/src/styles/root.css (.docs-popover*) and mirrors the copyable CSS
// example on the docs page, so what you see is what you copy.
export function PopoverDemo() {
  return (
    <Popover.Root>
      <Popover.Trigger class="docs-popover-trigger">
        Open popover
      </Popover.Trigger>
      <Popover.Positioner class="docs-popover-positioner">
        <Popover.Popup class="docs-popover">
          <Popover.Arrow class="docs-popover__arrow" />
          <Popover.Title class="docs-popover__title">Settings</Popover.Title>
          <Popover.Description class="docs-popover__desc">
            Adjust how the demo behaves.
          </Popover.Description>
          <Popover.Close class="docs-popover-close">Done</Popover.Close>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Root>
  );
}
```

- [ ] **Step 2: Create the docs page**

```mdx
// apps/site/src/pages/docs/components/popover.mdx
import { Example } from '../../../components/docs/Example.js';
import { CodeTabs } from '../../../components/docs/CodeTabs.js';
import { PopoverDemo } from '../../../components/docs/PopoverDemo.js';

# Popover

A non-modal, anchored overlay for interactive content: menus of actions, small
forms, or detail panels. Positioning runs on Floating UI; the overlay renders
in place and promotes to the browser top layer where the Popover API is
available. It ships unstyled, told through the `data-state`, `data-side`, and
`data-align` contract.

## Demo

<Example>
  <PopoverDemo />
</Example>

## Usage

```tsx
import { Popover } from '@hono-preact/ui';

export function Settings() {
  return (
    <Popover.Root>
      <Popover.Trigger>Open popover</Popover.Trigger>
      <Popover.Positioner>
        <Popover.Popup>
          <Popover.Arrow />
          <Popover.Title>Settings</Popover.Title>
          <Popover.Description>Adjust your preferences.</Popover.Description>
          <Popover.Close>Done</Popover.Close>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Root>
  );
}
```

Focus moves into the popup on open and returns to the trigger on close. Tab is
not trapped: tabbing past the last control moves into the rest of the page.
Escape and an outside press both close it.

## Parts

| Part | Element | Notes |
| --- | --- | --- |
| `Popover.Root` | none | Owns open state. Props: `open`, `defaultOpen`, `onOpenChange`, `side`, `align`, `offset`. |
| `Popover.Trigger` | `button` | Toggles the popover and anchors it. `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`. |
| `Popover.Anchor` | `span` | Optional. Anchors positioning to a different element than the trigger. |
| `Popover.Positioner` | `div` | The fixed-positioned wrapper. Carries `data-side` / `data-align`. |
| `Popover.Popup` | `div` | `role="dialog"`. The focus target. Pass `aria-label` if there is no `Title`. |
| `Popover.Arrow` | `div` | Optional. Positioned from the Floating UI arrow data. |
| `Popover.Title` | `h2` | Sets the accessible name (`aria-labelledby`). |
| `Popover.Description` | `p` | Sets the accessible description (`aria-describedby`). |
| `Popover.Close` | `button` | Closes the popover. |

Every part accepts a `render` prop to compose with your own element, and
forwards `class`, `style`, and `ref`.

## Styling

Parts expose `data-state="open" | "closed"`; the Positioner and Arrow also
expose `data-side` and `data-align`. The demo above uses the styles below; copy
a starting point in either flavor:

<CodeTabs labels={['CSS', 'Tailwind']}>

```css
.docs-popover {
  width: max(16rem, 12rem);
  padding: 1rem;
  border: 1px solid #e4e4e7;
  border-radius: 0.5rem;
  background: #fff;
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.12);
}
.docs-popover[data-state='open'] {
  animation: docs-popover-in 120ms ease-out;
}
@keyframes docs-popover-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
.docs-popover__arrow {
  width: 8px;
  height: 8px;
  rotate: 45deg;
  background: #fff;
  border-left: 1px solid #e4e4e7;
  border-top: 1px solid #e4e4e7;
}
```

```tsx
<Popover.Positioner className="z-50">
  <Popover.Popup className="w-64 rounded-lg border border-zinc-200 bg-white p-4 shadow-xl data-[state=open]:animate-in">
    <Popover.Title className="text-sm font-semibold">Settings</Popover.Title>
    <Popover.Description className="mt-1 text-sm text-zinc-500">
      Adjust your preferences.
    </Popover.Description>
  </Popover.Popup>
</Popover.Positioner>
```

</CodeTabs>
```

- [ ] **Step 3: Add the demo styles**

Append to `apps/site/src/styles/root.css` (mirror the `.docs-dialog*` block already there; match the page's CSS sample so copy fidelity holds):

```css
/* Popover docs demo. Mirrors the copyable CSS on /docs/components/popover. */
.docs-popover-positioner {
  z-index: 50;
}
.docs-popover {
  width: max(16rem, 12rem);
  padding: 1rem;
  border: 1px solid var(--border, #e4e4e7);
  border-radius: 0.5rem;
  background: var(--surface, #fff);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.12);
}
.docs-popover[data-state='open'] {
  animation: docs-popover-in 120ms ease-out;
}
@keyframes docs-popover-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
.docs-popover__arrow {
  width: 8px;
  height: 8px;
  rotate: 45deg;
  background: var(--surface, #fff);
  border-left: 1px solid var(--border, #e4e4e7);
  border-top: 1px solid var(--border, #e4e4e7);
}
.docs-popover__title {
  font-size: 0.875rem;
  font-weight: 600;
}
.docs-popover__desc {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: var(--text-muted, #71717a);
}
```

> Use the same theme tokens the existing `.docs-dialog*` rules use; check `root.css` for the actual token names (e.g. `--surface`, `--border`, `--text-muted`) and match them so dark mode works. The fallbacks above are only a guard.

- [ ] **Step 4: Verify the page renders in the build (deferred to Task 20)**

No unit test here. The full site build in Task 20 will fail if the MDX import paths or component names are wrong, so treat that as this task's gate.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/docs/PopoverDemo.tsx apps/site/src/pages/docs/components/popover.mdx apps/site/src/styles/root.css
git commit -m "docs(site): Popover page, demo, and styles"
```

---

## Task 19: Tooltip demo + docs page + styles, and the two Foundations pages

**Files:**
- Create: `apps/site/src/components/docs/TooltipDemo.tsx`
- Create: `apps/site/src/pages/docs/components/tooltip.mdx`
- Create: `apps/site/src/pages/docs/components/use-position.mdx`
- Create: `apps/site/src/pages/docs/components/use-dismiss.mdx`
- Modify: `apps/site/src/styles/root.css`

- [ ] **Step 1: Create the Tooltip demo**

```tsx
// apps/site/src/components/docs/TooltipDemo.tsx
import { Tooltip } from '@hono-preact/ui';

export function TooltipDemo() {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger class="docs-tooltip-trigger">Hover me</Tooltip.Trigger>
      <Tooltip.Positioner class="docs-tooltip-positioner">
        <Tooltip.Popup class="docs-tooltip">
          <Tooltip.Arrow class="docs-tooltip__arrow" />
          Saved to your library
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}
```

- [ ] **Step 2: Create the Tooltip docs page**

```mdx
// apps/site/src/pages/docs/components/tooltip.mdx
import { Example } from '../../../components/docs/Example.js';
import { CodeTabs } from '../../../components/docs/CodeTabs.js';
import { TooltipDemo } from '../../../components/docs/TooltipDemo.js';

# Tooltip

A small label that appears on hover or keyboard focus. It follows WCAG 1.4.13:
the tooltip is hoverable (you can move the pointer onto it), dismissible with
Escape, and persistent (it stays until you leave or press Escape). Tooltips are
not shown for touch input, which cannot hover; do not put essential information
only in a tooltip.

## Demo

<Example>
  <TooltipDemo />
</Example>

## Usage

```tsx
import { Tooltip } from '@hono-preact/ui';

export function SaveHint() {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger>Hover me</Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Popup>
          <Tooltip.Arrow />
          Saved to your library
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}
```

The trigger opens after a short delay on hover and immediately on focus. Set
`delay` and `closeDelay` on `Tooltip.Root` to tune the timing.

## Parts

| Part | Element | Notes |
| --- | --- | --- |
| `Tooltip.Root` | none | Props: `open`, `defaultOpen`, `onOpenChange`, `delay`, `closeDelay`, `side`, `align`, `offset`. |
| `Tooltip.Trigger` | `button` | Binds hover + focus and wires `aria-describedby`. Use the `render` prop to attach it to your own control. |
| `Tooltip.Positioner` | `div` | Fixed-positioned wrapper. `data-side` / `data-align`. |
| `Tooltip.Popup` | `div` | `role="tooltip"`. Hoverable. |
| `Tooltip.Arrow` | `div` | Optional. |

## Styling

<CodeTabs labels={['CSS', 'Tailwind']}>

```css
.docs-tooltip {
  padding: 0.375rem 0.625rem;
  border-radius: 0.375rem;
  background: #18181b;
  color: #fafafa;
  font-size: 0.8125rem;
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.18);
}
.docs-tooltip[data-state='open'] {
  animation: docs-tooltip-in 100ms ease-out;
}
@keyframes docs-tooltip-in {
  from {
    opacity: 0;
  }
}
.docs-tooltip__arrow {
  width: 8px;
  height: 8px;
  rotate: 45deg;
  background: #18181b;
}
```

```tsx
<Tooltip.Positioner className="z-50">
  <Tooltip.Popup className="rounded-md bg-zinc-900 px-2.5 py-1.5 text-[13px] text-zinc-50 shadow-lg">
    Saved to your library
  </Tooltip.Popup>
</Tooltip.Positioner>
```

</CodeTabs>
```

- [ ] **Step 3: Create the two Foundations pages**

```mdx
// apps/site/src/pages/docs/components/use-position.mdx

# usePosition

`usePosition` is the positioning binding both Popover and Tooltip use. It wraps
[Floating UI](https://floating-ui.com) and keeps a floating element anchored to
a reference element, updating on scroll and resize.

```tsx
import { usePosition } from '@hono-preact/ui';
import { useRef } from 'preact/hooks';

function Anchored({ open }: { open: boolean }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const { side, align } = usePosition({
    open,
    anchorRef,
    floatingRef,
    side: 'bottom',
    align: 'center',
    offset: 8,
  });
  return (
    <>
      <button ref={anchorRef}>Anchor</button>
      {open ? (
        <div ref={floatingRef} data-side={side} data-align={align}>
          floating
        </div>
      ) : null}
    </>
  );
}
```

## Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `open` | `boolean` | none | Positioning runs only while open. |
| `anchorRef` | `RefObject` | none | The reference element. |
| `floatingRef` | `RefObject` | none | The element being positioned. |
| `arrowRef` | `RefObject` | optional | Enables arrow positioning. |
| `side` | `'top' \| 'right' \| 'bottom' \| 'left'` | `'bottom'` | Preferred side. |
| `align` | `'start' \| 'center' \| 'end'` | `'center'` | Alignment along the side. |
| `offset` | `number` | `8` | Gap in pixels. |

It returns the resolved `side`, `align`, and arrow `arrowX` / `arrowY` (after
any flip or shift), so the floating element can render `data-side` /
`data-align` and position an arrow.
```

```mdx
// apps/site/src/pages/docs/components/use-dismiss.mdx

# useDismiss

`useDismiss` registers an open overlay with a shared dismissal stack. Pressing
Escape or pressing outside the overlay dismisses the topmost registered layer,
so nested overlays close one at a time, innermost first.

```tsx
import { useDismiss } from '@hono-preact/ui';
import { useRef } from 'preact/hooks';

function Panel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss({
    enabled: open,
    refs: [ref],
    onDismiss: onClose,
  });
  return open ? <div ref={ref}>panel</div> : null;
}
```

## Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | `boolean` | none | Register only while open. |
| `refs` | `RefObject[]` | none | Elements treated as inside (no outside-press). |
| `escape` | `boolean` | `true` | Dismiss on Escape. |
| `outsidePress` | `boolean` | `true` | Dismiss on an outside pointer press. |
| `onDismiss` | `(reason) => void` | none | Called with `'escape'` or `'outside-press'`. |

The listeners are document-level and capture-phase, attached once and shared
across every registered layer, so adding overlays does not multiply listeners.
```

- [ ] **Step 4: Add the Tooltip demo styles**

Append to `apps/site/src/styles/root.css`:

```css
/* Tooltip docs demo. Mirrors the copyable CSS on /docs/components/tooltip. */
.docs-tooltip-positioner {
  z-index: 50;
}
.docs-tooltip {
  padding: 0.375rem 0.625rem;
  border-radius: 0.375rem;
  background: #18181b;
  color: #fafafa;
  font-size: 0.8125rem;
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.18);
}
.docs-tooltip[data-state='open'] {
  animation: docs-tooltip-in 100ms ease-out;
}
@keyframes docs-tooltip-in {
  from {
    opacity: 0;
  }
}
.docs-tooltip__arrow {
  width: 8px;
  height: 8px;
  rotate: 45deg;
  background: #18181b;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/docs/TooltipDemo.tsx apps/site/src/pages/docs/components/tooltip.mdx apps/site/src/pages/docs/components/use-position.mdx apps/site/src/pages/docs/components/use-dismiss.mdx apps/site/src/styles/root.css
git commit -m "docs(site): Tooltip page + usePosition/useDismiss foundations"
```

---

## Task 20: Full pre-push verification

Mirror CI exactly (see `CLAUDE.md` "Pre-push verification"). Fix anything that fails before proceeding.

**Files:** none (verification only).

- [ ] **Step 1: Build all framework packages (so cross-package types resolve)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: PASS.

- [ ] **Step 2: Format check**

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format`, then `git add -A && git commit -m "chore: format"`.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. Common miss: a `render`-prop `style` spread or a missing type export. Fix at the source type, not with a cast.

- [ ] **Step 4: Unit tests with coverage**

Run: `pnpm test:coverage`
Expected: PASS, including every new `packages/ui` test, the nav test, and the size-config test.

- [ ] **Step 5: Integration tests**

Run: `pnpm test:integration`
Expected: PASS (unaffected by this slice, but CI runs it).

- [ ] **Step 6: Site build**

Run: `pnpm --filter site build`
Expected: PASS. This is the real gate for the MDX pages and demos: a wrong import path or component name fails here.

- [ ] **Step 7: Commit any format fixes, then push and open the PR**

```bash
git push -u origin feat/ui-popover-tooltip
gh pr create --title "feat(ui): Popover + Tooltip (Phase 2)" --body "Implements the Phase 2 headless components per docs/superpowers/specs/2026-06-03-popover-tooltip-design.md: Popover and Tooltip plus the shared positioning, dismissal-stack, and focus-return machinery. Inline + Popover API substrate (no portal/compat). WCAG 1.4.13 tooltip; non-modal Popover with move-in/return focus.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

> After opening the PR, run the deep PR review immediately (CLAUDE.md "PR workflow"), then update the size baseline only via the normal main-push flow.

---

## Self-review notes (for the executing agent)

- **Spec coverage:** §4 machinery → Tasks 2-6; §5 Popover → Tasks 8-12; §6 Tooltip → Tasks 13-15; §7.1 data-attributes → woven through component tasks; §7.2 SSR/hydration → Popover/Tooltip SSR tests (Tasks 12, 15) and the imperative Popover-API effect (Tasks 10, 14); §7.3 docs → Tasks 17-19; §7.4 size → Task 16; §7.5 testing → every component task; §7.6 a11y → ARIA assertions in Tasks 8, 10, 11, 13, 14.
- **Type consistency check:** machinery names (`usePosition`/`placementFor`/`sideAlignFromPlacement`/`PositionState`/`Side`/`Align`, `registerDismissLayer`/`DismissLayer`/`DismissReason`, `useDismiss`/`UseDismissOptions`, `useFocusReturn`) are used identically wherever referenced. Popover context fields (`anchorRef`/`floatingRef`/`popupRef`/`arrowRef`/`position`/`setPosition`) and Tooltip context fields (`scheduleOpen`/`scheduleClose`/`setOpenImmediate`/`cancelPending`/`position`/`setPosition`/`popupId`) match their consumers.
- **happy-dom caveats:** `showPopover` is absent (the top-layer enhancement path is inert under test via the `supportsPopover` guard, which is fine; tests exercise the inline `position: fixed` baseline), and `PointerEvent.pointerType` may need an explicit event construction (noted in Task 13, Step 4).
- **Positioner mount-on-open + Popover API:** the top-layer effect depends on `[ctx.open]` (not `[]`) so it fires when the element mounts on open; empty deps would never call `showPopover`. The Positioner is a framework-owned layout wrapper (style via class, not the style prop).
