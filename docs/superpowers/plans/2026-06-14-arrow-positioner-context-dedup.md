# Arrow + PositionerContext dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five byte-identical `Arrow` parts with one shared `Arrow` component, and delete the position-state round-trip that exists only so the Arrow can read the resolved position.

**Architecture:** The Positioner part provides the resolved position and the arrow ref through a small shared `PositionerContext`; one shared `Arrow` consumes it. `usePositioner` owns the arrow ref and returns the position it already computes, so `position`/`setPosition`/`arrowRef` leave all five main contexts and `useMenuCore`. Migration is incremental: `usePositioner` is first made additive/back-compatible (Task 3), each component migrates independently while the build stays green (Tasks 4-8), then the temporary compatibility shim is removed (Task 9).

**Tech Stack:** Preact, TypeScript, Vitest + @testing-library/preact (happy-dom), `@hono-preact/ui` (private, unpublished).

**Spec:** `docs/superpowers/specs/2026-06-14-arrow-positioner-context-dedup-design.md`

**Conventions for every task:**
- Work on a feature branch (verify with `git branch --show-current` before each commit; never commit to `main`).
- Run `pnpm format` before committing so committed files are Prettier-clean (the committed state, not just the working tree, must pass `format:check`).
- `noUnusedLocals`/`noUnusedParameters` are on: after removing a field, delete any now-unused import (e.g. `PositionState`) or `pnpm --filter @hono-preact/ui exec tsc --noEmit` fails. That failure is the signal, not a surprise.
- Focused test run: `pnpm exec vitest run <path/to/test>`. Per-package typecheck: `pnpm --filter @hono-preact/ui exec tsc --noEmit`.

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/ui/src/positioner-context.ts` (new) | The shared `PositionerContext` + `usePositionerContext()` | 1 |
| `packages/ui/src/arrow.tsx` (new) | The single shared `Arrow` component + `ArrowProps` | 2 |
| `packages/ui/src/__tests__/arrow.test.tsx` (new) | Tests for the shared Arrow + the context guard | 2 |
| `packages/ui/src/use-positioner.ts` | Own arrowRef, return `position`+`arrowRef`, drop the publish round-trip | 3, 9 |
| `packages/ui/src/__tests__/use-positioner.test.tsx` | Adapt to the new return shape | 3 |
| `packages/ui/src/popover/{popover.tsx,context.ts}` | Migrate Popover | 4 |
| `packages/ui/src/tooltip/{tooltip.tsx,context.ts}` | Migrate Tooltip | 5 |
| `packages/ui/src/menu/{menu.tsx,context.ts,use-menu-core.ts}` | Migrate Menu (covers ContextMenu + Submenu) | 6 |
| `packages/ui/src/select/{select.tsx,context.ts}` | Migrate Select | 7 |
| `packages/ui/src/combobox/{combobox.tsx,context.ts}` | Migrate Combobox | 8 |

The index files (`*/index.ts`) are **not** modified: each component file re-exports the shared `Arrow` under its old name (`export { Arrow as PopoverArrow }`), so the existing namespace wiring (`Arrow: PopoverArrow`) keeps working unchanged.

---

## Task 1: PositionerContext

**Files:**
- Create: `packages/ui/src/positioner-context.ts`
- Test: `packages/ui/src/__tests__/positioner-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/__tests__/positioner-context.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { h } from 'preact';
import {
  PositionerContext,
  usePositionerContext,
} from '../positioner-context.js';

afterEach(cleanup);

function Consumer() {
  const { position } = usePositionerContext();
  return <span data-testid="side">{position.side}</span>;
}

describe('usePositionerContext', () => {
  it('returns the provided value inside a provider', () => {
    function Wrapper() {
      const arrowRef = useRef<HTMLElement>(null);
      return h(
        PositionerContext.Provider,
        {
          value: {
            position: { side: 'top', align: 'center', arrowX: null, arrowY: null },
            arrowRef,
          },
        },
        <Consumer />
      );
    }
    const { getByTestId } = render(<Wrapper />);
    expect(getByTestId('side').textContent).toBe('top');
  });

  it('throws when used outside a provider', () => {
    expect(() => render(<Consumer />)).toThrow(
      '<Arrow> must be rendered inside a Positioner'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/positioner-context.test.tsx`
Expected: FAIL (`Cannot find module '../positioner-context.js'`).

- [ ] **Step 3: Create the context**

Create `packages/ui/src/positioner-context.ts`:

```ts
import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';
import type { PositionState } from './use-position.js';

// Provided by each component's Positioner part, consumed by the shared Arrow.
// Small sibling context in the spirit of SelectOptionGroupContext: it carries
// only what the Arrow needs (the resolved position + the ref it attaches to),
// so position changes no longer invalidate the component's main context.
export interface PositionerContextValue {
  position: PositionState;
  arrowRef: RefObject<HTMLElement>;
}

export const PositionerContext = createContext<PositionerContextValue | null>(
  null
);

export function usePositionerContext(): PositionerContextValue {
  const ctx = useContext(PositionerContext);
  if (!ctx) {
    throw new Error('<Arrow> must be rendered inside a Positioner');
  }
  return ctx;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/positioner-context.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/positioner-context.ts packages/ui/src/__tests__/positioner-context.test.tsx
git commit -m "feat(ui): add shared PositionerContext for Arrow"
```

---

## Task 2: Shared Arrow component

**Files:**
- Create: `packages/ui/src/arrow.tsx`
- Test: `packages/ui/src/__tests__/arrow.test.tsx`

The body is lifted verbatim from the five existing `*Arrow` functions; the only change is reading `position`/`arrowRef` from `usePositionerContext()` instead of a per-component context.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/__tests__/arrow.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { h } from 'preact';
import { Arrow } from '../arrow.js';
import { PositionerContext } from '../positioner-context.js';
import type { PositionState } from '../use-position.js';

afterEach(cleanup);

function withPosition(position: PositionState, child: preact.VNode) {
  function Wrapper() {
    const arrowRef = useRef<HTMLElement>(null);
    return h(PositionerContext.Provider, { value: { position, arrowRef } }, child);
  }
  return <Wrapper />;
}

describe('Arrow', () => {
  it('renders data-side and the absolute offset from the provided position', () => {
    const { container } = render(
      withPosition(
        { side: 'right', align: 'center', arrowX: 12, arrowY: 34 },
        <Arrow data-testid="arrow" />
      )
    );
    const el = container.querySelector('[data-testid="arrow"]') as HTMLElement;
    expect(el.getAttribute('data-side')).toBe('right');
    expect(el.style.position).toBe('absolute');
    expect(el.style.left).toBe('12px');
    expect(el.style.top).toBe('34px');
  });

  it('omits left/top when arrowX/arrowY are null', () => {
    const { container } = render(
      withPosition(
        { side: 'top', align: 'center', arrowX: null, arrowY: null },
        <Arrow data-testid="arrow" />
      )
    );
    const el = container.querySelector('[data-testid="arrow"]') as HTMLElement;
    expect(el.style.left).toBe('');
    expect(el.style.top).toBe('');
  });

  it('throws when rendered outside a Positioner', () => {
    expect(() => render(<Arrow />)).toThrow(
      '<Arrow> must be rendered inside a Positioner'
    );
  });

  it('reads the nearest Positioner when providers are nested (submenu case)', () => {
    function Nested() {
      const outerRef = useRef<HTMLElement>(null);
      const innerRef = useRef<HTMLElement>(null);
      return h(
        PositionerContext.Provider,
        {
          value: {
            position: { side: 'top', align: 'center', arrowX: null, arrowY: null },
            arrowRef: outerRef,
          },
        },
        h(
          PositionerContext.Provider,
          {
            value: {
              position: { side: 'left', align: 'center', arrowX: null, arrowY: null },
              arrowRef: innerRef,
            },
          },
          <Arrow data-testid="inner-arrow" />
        )
      );
    }
    const { container } = render(<Nested />);
    const el = container.querySelector(
      '[data-testid="inner-arrow"]'
    ) as HTMLElement;
    expect(el.getAttribute('data-side')).toBe('left');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/arrow.test.tsx`
Expected: FAIL (`Cannot find module '../arrow.js'`).

- [ ] **Step 3: Create the shared Arrow**

Create `packages/ui/src/arrow.tsx`:

```tsx
import { type ComponentChildren, type JSX, type VNode } from 'preact';
import { renderElement, type RenderProp } from './use-render.js';
import type { Side } from './use-position.js';
import { usePositionerContext } from './positioner-context.js';

export type ArrowProps = {
  render?: RenderProp<{ side: Side }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

// One Arrow for every overlay. Reads the resolved position from the enclosing
// Positioner (via PositionerContext) and attaches the ref floating-ui measures.
export function Arrow(props: ArrowProps): VNode {
  const { render, children, ...rest } = props;
  const { position, arrowRef } = usePositionerContext();
  const { side, arrowX, arrowY } = position;
  return renderElement<{ side: Side }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: arrowRef,
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/arrow.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/arrow.tsx packages/ui/src/__tests__/arrow.test.tsx
git commit -m "feat(ui): add shared Arrow component"
```

---

## Task 3: usePositioner owns arrowRef and returns the position (additive)

This change is **back-compatible**: existing callers keep passing `arrowRef`/`setPosition` (now optional), behavior is identical, and the new `position`/`arrowRef` return values let each component migrate independently in Tasks 4-8. The publish round-trip is kept here (guarded) and removed in Task 9.

**Files:**
- Modify: `packages/ui/src/use-positioner.ts`
- Test: `packages/ui/src/__tests__/use-positioner.test.tsx`

Current `UsePositionerOptions` (lines 28-46) declares `arrowRef: RefObject<HTMLElement>` and `setPosition: (p: PositionState) => void` as required. Current `UsePositionerResult` (lines 56-62) returns `{ isPresent, positionerProps, state }`. The hook receives `opts.arrowRef`, passes it to `usePosition`, and publishes via a `useLayoutEffect` calling `opts.setPosition(position)` (lines 79-81).

- [ ] **Step 1: Update the test first (new return shape)**

Replace `packages/ui/src/__tests__/use-positioner.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { usePositioner } from '../use-positioner.js';
import type { ClientRectGetter } from '../use-position.js';

afterEach(cleanup);

function Harness(props: {
  open: boolean;
  mount: 'unmount' | 'hidden';
  getAnchorRect?: ClientRectGetter;
  onSide?: (side: string) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const { isPresent, positionerProps, position, arrowRef } = usePositioner({
    open: props.open,
    anchorRef,
    floatingRef,
    side: 'bottom',
    align: 'start',
    offset: 8,
    getAnchorRect: props.getAnchorRect,
    mount: props.mount,
  });
  props.onSide?.(position.side);
  return (
    <div>
      <button ref={anchorRef}>anchor</button>
      <span data-testid="present">{String(isPresent)}</span>
      <span data-testid="has-arrow-ref">{String(arrowRef != null)}</span>
      {props.mount === 'unmount' && !isPresent ? null : (
        <div data-testid="floating" {...positionerProps} />
      )}
    </div>
  );
}

describe('usePositioner', () => {
  it('unmount mode: not present when closed, present when open', () => {
    const closed = render(<Harness open={false} mount="unmount" />);
    expect(closed.getByTestId('present').textContent).toBe('false');
    expect(closed.queryByTestId('floating')).toBeNull();
    cleanup();
    const open = render(<Harness open mount="unmount" />);
    expect(open.getByTestId('present').textContent).toBe('true');
    expect(open.queryByTestId('floating')).not.toBeNull();
    expect(open.getByTestId('floating').hasAttribute('hidden')).toBe(false);
  });

  it('hidden mode: stays mounted; hidden toggles with open', () => {
    const closed = render(<Harness open={false} mount="hidden" />);
    expect(closed.queryByTestId('floating')).not.toBeNull();
    expect(closed.getByTestId('floating').hasAttribute('hidden')).toBe(true);
    cleanup();
    const open = render(<Harness open mount="hidden" />);
    expect(open.getByTestId('floating').hasAttribute('hidden')).toBe(false);
  });

  it('emits the neutralize style and data-side/data-align', () => {
    const { getByTestId } = render(<Harness open mount="unmount" />);
    const el = getByTestId('floating');
    expect(el.style.position).toBe('fixed');
    expect(el.getAttribute('data-side')).toBe('bottom');
    expect(el.getAttribute('data-align')).toBe('start');
  });

  it('returns the resolved position and owns an arrow ref', () => {
    const seen: string[] = [];
    const { getByTestId } = render(
      <Harness open mount="unmount" onSide={(s) => seen.push(s)} />
    );
    expect(getByTestId('has-arrow-ref').textContent).toBe('true');
    expect(seen[seen.length - 1]).toBe('bottom');
  });

  it('forwards getAnchorRect to usePosition', async () => {
    const getAnchorRect = vi.fn(() => ({
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    }));
    render(<Harness open mount="unmount" getAnchorRect={getAnchorRect} />);
    await waitFor(() => expect(getAnchorRect).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/use-positioner.test.tsx`
Expected: FAIL (`position`/`arrowRef` are not on the result type/value yet).

- [ ] **Step 3: Make arrowRef/setPosition optional, own the ref, return position+arrowRef**

In `packages/ui/src/use-positioner.ts`:

Add `useRef` to the hooks import (line 2):

```ts
import { useLayoutEffect, useRef } from 'preact/hooks';
```

In `UsePositionerOptions` (around lines 33 and 41), make these two optional. Replace the `arrowRef` line with:

```ts
  // Optional during the migration to PositionerContext: when omitted the hook
  // creates and owns the ref. Removed once every component stops passing it.
  arrowRef?: RefObject<HTMLElement>;
```

and replace the `setPosition` lines (40-41) with:

```ts
  // Optional legacy publish hook (pre-PositionerContext); removed once every
  // component reads the position from the hook return instead.
  setPosition?: (p: PositionState) => void;
```

In `UsePositionerResult` (lines 56-62), add `position` and `arrowRef`:

```ts
export interface UsePositionerResult {
  isPresent: boolean;
  positionerProps: PositionerProps;
  state: { side: Side; align: Align };
  // The resolved position, for a Positioner to publish via PositionerContext.
  position: PositionState;
  // The ref floating-ui measures and the Arrow attaches to.
  arrowRef: RefObject<HTMLElement>;
}
```

In the `usePositioner` body (line 64+), resolve the ref and pass it to `usePosition`. Immediately after `const presence = usePresence(opts.open);` add:

```ts
  const ownArrowRef = useRef<HTMLElement>(null);
  const arrowRef = opts.arrowRef ?? ownArrowRef;
```

Change the `usePosition` call's `arrowRef: opts.arrowRef` to `arrowRef,`. Guard the publish effect (lines 79-81):

```ts
  // Legacy publish to the Root (back-compat during migration). No-op once a
  // component reads `position` from this hook's return instead.
  useLayoutEffect(() => {
    opts.setPosition?.(position);
  }, [position.side, position.align, position.arrowX, position.arrowY]);
```

In the `return` (lines 106-116), add `position` and `arrowRef`, and use the resolved `arrowRef` in `mergeRefs`:

```ts
  return {
    isPresent: presence.isPresent,
    positionerProps: {
      ref: mergeRefs(opts.floatingRef, presence.ref),
      hidden: opts.mount === 'hidden' && !presence.isPresent ? true : undefined,
      'data-side': position.side,
      'data-align': position.align,
      style: POSITIONER_STYLE,
    },
    state: { side: position.side, align: position.align },
    position,
    arrowRef,
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/use-positioner.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify no component broke (back-compat)**

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS (existing Positioners still pass `arrowRef`/`setPosition`, now optional).

Run: `pnpm exec vitest run packages/ui`
Expected: PASS (whole ui suite; behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/use-positioner.ts packages/ui/src/__tests__/use-positioner.test.tsx
git commit -m "refactor(ui): usePositioner owns arrowRef and returns position"
```

---

## Task 4: Migrate Popover

**Files:**
- Modify: `packages/ui/src/popover/popover.tsx`, `packages/ui/src/popover/context.ts`

- [ ] **Step 1: Strip position-state from the context type**

In `packages/ui/src/popover/context.ts`, remove these three lines from `PopoverContextValue` (lines 12, 22-23):

```ts
  arrowRef: RefObject<HTMLElement>;   // line 12
  position: PositionState;            // line 22
  setPosition: (p: PositionState) => void;  // line 23
```

Then fix imports: `PositionState` (line 4) is now unused, remove it; `RefObject` is still used (anchorRef/floatingRef/popupRef), keep it. The line-4 import becomes:

```ts
import type { Side, Align } from '../use-position.js';
```

- [ ] **Step 2: Strip position-state from the Root, wire the Positioner + Arrow**

In `packages/ui/src/popover/popover.tsx`:

Add imports near the top (after the existing `usePositioner` import on line 16):

```ts
import { PositionerContext } from '../positioner-context.js';
```

Remove `const arrowRef = useRef<HTMLElement>(null);` (line 49). Remove the `const [position, setPosition] = useState<PositionState>({...})` block (lines 63-68). Remove `arrowRef`, `position`, `setPosition` from the `ctx` object (lines 77, 87-88) and remove `position` from the memo dep array (line 102). The `PositionState` import (line 15) and `useState` (line 9) are now unused in this file — remove `PositionState` from the line-15 import (keep `Side`, `Align`), and remove `useState` from the line 4-10 hooks import **only if** nothing else in the file uses it (it is used only by the removed block, so remove it).

Rewrite `PopoverPositioner` (lines 168-190) to drop the `arrowRef`/`setPosition` args, memoize the context value, and wrap the output:

```tsx
export function PopoverPositioner(props: PopoverPositionerProps): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Positioner');
  const { isPresent, positionerProps, state, position, arrowRef } =
    usePositioner({
      open: ctx.open,
      anchorRef: ctx.anchorRef,
      floatingRef: ctx.floatingRef,
      side: ctx.side,
      align: ctx.align,
      offset: ctx.offset,
      mount: 'unmount',
    });
  const positionerValue = useMemo(() => ({ position, arrowRef }), [position]);
  if (!isPresent) return null;
  return h(
    PositionerContext.Provider,
    { value: positionerValue },
    renderElement<{ side: Side; align: Align }>({
      render,
      defaultTag: 'div',
      props: { ...rest, ...positionerProps },
      state,
      children,
    })
  );
}
```

Replace the entire `PopoverArrow` function and `PopoverArrowProps` type (lines 229-254) with a re-export of the shared Arrow:

```tsx
export { Arrow as PopoverArrow, type ArrowProps as PopoverArrowProps } from '../arrow.js';
```

(`useMemo` and `h` are already imported in this file.)

- [ ] **Step 2b: Confirm an existing Arrow test is covered**

The shared Arrow is exercised by `arrow.test.tsx` (Task 2). There is no popover-specific Arrow test to migrate (Popover's tests cover Trigger/Popup/Positioner/SSR). If `popover-parts.test.tsx` renders an Arrow, verify it nests it under `Popover.Positioner`; it already does (the demos and tests follow `Positioner > Popup > Arrow`).

- [ ] **Step 3: Typecheck (catches any leftover unused import)**

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS. If it reports an unused `PositionState`/`useState`/`RefObject`, remove that import and re-run.

- [ ] **Step 4: Run the Popover tests**

Run: `pnpm exec vitest run packages/ui/src/__tests__/popover-root.test.tsx packages/ui/src/__tests__/popover-parts.test.tsx packages/ui/src/__tests__/popover-popup.test.tsx packages/ui/src/__tests__/popover-anchor.test.tsx packages/ui/src/__tests__/popover-presence.test.tsx packages/ui/src/__tests__/popover-ssr.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/ui/src/popover/
git commit -m "refactor(ui): migrate Popover Arrow to PositionerContext"
```

---

## Task 5: Migrate Tooltip

**Files:**
- Modify: `packages/ui/src/tooltip/tooltip.tsx`, `packages/ui/src/tooltip/context.ts`

- [ ] **Step 1: Strip position-state from the context type**

In `packages/ui/src/tooltip/context.ts`, remove `arrowRef` (line 15), `position` (line 21), and `setPosition` (line 22) from `TooltipContextValue`. `PositionState` is then unused; change the line-4 import to `import type { Side, Align } from '../use-position.js';` (keep the separate `RefObject` import on line 2).

- [ ] **Step 2: Strip the Root, wire the Positioner + Arrow**

In `packages/ui/src/tooltip/tooltip.tsx`:

Add `import { PositionerContext } from '../positioner-context.js';`.

Remove `const arrowRef = useRef<HTMLElement>(null);` (line 52). Remove the `const [position, setPosition] = useState<PositionState>({...})` block (lines 78-83). Remove `arrowRef`, `position`, `setPosition` from the `ctx` object (lines 93, 99-100) and `position` from the memo deps (line 112). Remove the now-unused `PositionState` import and `useState` (used only by the removed block).

Rewrite `TooltipPositioner` (lines 186-208):

```tsx
export function TooltipPositioner(props: TooltipPositionerProps): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = useTooltipContext('Positioner');
  const { isPresent, positionerProps, state, position, arrowRef } =
    usePositioner({
      open: ctx.open,
      anchorRef: ctx.anchorRef,
      floatingRef: ctx.floatingRef,
      side: ctx.side,
      align: ctx.align,
      offset: ctx.offset,
      mount: 'unmount',
    });
  const positionerValue = useMemo(() => ({ position, arrowRef }), [position]);
  if (!isPresent) return null;
  return h(
    PositionerContext.Provider,
    { value: positionerValue },
    renderElement<{ side: Side; align: Align }>({
      render,
      defaultTag: 'div',
      props: { ...rest, ...positionerProps },
      state,
      children,
    })
  );
}
```

Replace the `TooltipArrow` function + `TooltipArrowProps` type (lines 271-296) with:

```tsx
export { Arrow as TooltipArrow, type ArrowProps as TooltipArrowProps } from '../arrow.js';
```

Confirm `useMemo` is imported (tooltip Root uses it, so it is). If `useMemo` were missing, add it to the `preact/hooks` import.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS (remove any leftover unused import it flags).

- [ ] **Step 4: Run the Tooltip tests**

Run: `pnpm exec vitest run packages/ui/src/__tests__/tooltip-trigger.test.tsx packages/ui/src/__tests__/tooltip-popup.test.tsx packages/ui/src/__tests__/tooltip-presence.test.tsx packages/ui/src/__tests__/tooltip-safe-area.test.tsx packages/ui/src/__tests__/tooltip-ssr.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/ui/src/tooltip/
git commit -m "refactor(ui): migrate Tooltip Arrow to PositionerContext"
```

---

## Task 6: Migrate Menu (covers Menu, ContextMenu, Submenu)

Menu, ContextMenu, and Submenu share `useMenuCore`, `MenuContext`, `MenuPositioner`, and `MenuArrow`, so migrating those four migrates all three variants. ContextMenu and Submenu need no edits of their own.

**Files:**
- Modify: `packages/ui/src/menu/use-menu-core.ts`, `packages/ui/src/menu/context.ts`, `packages/ui/src/menu/menu.tsx`

- [ ] **Step 1: Strip position-state from MenuContextValue**

In `packages/ui/src/menu/context.ts`, remove `arrowRef` (line 26), `position` (line 39), and `setPosition` (line 40) from `MenuContextValue`. Remove the now-unused `PositionState` from the line 4-9 import (keep `Side`, `Align`, `ClientRectGetter`); remove `RefObject` **only if** unused (it is still used by `anchorRef`/`floatingRef`/`popupRef`/`pendingEdgeRef`, so keep it).

- [ ] **Step 2: Strip position-state from useMenuCore**

In `packages/ui/src/menu/use-menu-core.ts`:

Remove `arrowRef` from the `MenuCore` interface (line 34), and `position`/`setPosition` (lines 41-42). Remove `const arrowRef = useRef<HTMLElement>(null);` (line 69) and the `const [position, setPosition] = useState<PositionState>({...})` block (lines 77-82). Remove `arrowRef`, `position`, `setPosition` from the `menuCtx` object (lines 116, 127-128) and `position` from its memo deps (line 142). Remove `arrowRef`, `position`, `setPosition` from the final return object (lines 158, 165-166).

Fix imports: `PositionState` (line 4) is now unused, remove it (keep `Side`, `Align`); `useState` is still used (`activeId`), keep it; `useRef` is still used (`floatingRef`, `popupRef`, `anchorRef`, `pendingEdgeRef`, `pointRef`), keep it.

- [ ] **Step 3: Wire the Positioner + Arrow in menu.tsx**

In `packages/ui/src/menu/menu.tsx`:

Add `import { PositionerContext } from '../positioner-context.js';`.

Rewrite `MenuPositioner` (lines 182-205), keeping `getAnchorRect` (ContextMenu needs it) and dropping `arrowRef`/`setPosition`:

```tsx
export function MenuPositioner(props: MenuPositionerProps): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = useMenuContext('Positioner');
  const { isPresent, positionerProps, state, position, arrowRef } =
    usePositioner({
      open: ctx.open,
      anchorRef: ctx.anchorRef,
      floatingRef: ctx.floatingRef,
      side: ctx.side,
      align: ctx.align,
      offset: ctx.offset,
      getAnchorRect: ctx.getAnchorRect,
      mount: 'unmount',
    });
  const positionerValue = useMemo(() => ({ position, arrowRef }), [position]);
  if (!isPresent) return null;
  return h(
    PositionerContext.Provider,
    { value: positionerValue },
    renderElement<{ side: Side; align: Align }>({
      render,
      defaultTag: 'div',
      props: { ...rest, ...positionerProps },
      state,
      children,
    })
  );
}
```

Replace the `MenuArrow` function + `MenuArrowProps` type (lines 538-563) with:

```tsx
export { Arrow as MenuArrow, type ArrowProps as MenuArrowProps } from '../arrow.js';
```

Confirm `useMemo` is imported in menu.tsx; if not, add it to the `preact/hooks` import.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS (remove any leftover unused import it flags).

- [ ] **Step 5: Run the Menu / ContextMenu / Submenu tests**

Run: `pnpm exec vitest run packages/ui/src/__tests__/menu-trigger.test.tsx packages/ui/src/__tests__/menu-item.test.tsx packages/ui/src/__tests__/menu-structure.test.tsx packages/ui/src/__tests__/menu-checkable.test.tsx packages/ui/src/__tests__/menu-navigation-dom.test.tsx packages/ui/src/__tests__/menu-presence.test.tsx packages/ui/src/__tests__/menu-ssr.test.tsx packages/ui/src/__tests__/menu-submenu.test.tsx packages/ui/src/__tests__/menu-submenu-safe-area.test.tsx packages/ui/src/__tests__/context-menu.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add packages/ui/src/menu/
git commit -m "refactor(ui): migrate Menu/ContextMenu/Submenu Arrow to PositionerContext"
```

---

## Task 7: Migrate Select

Select uses `mount: 'hidden'` (always rendered), so its Positioner has no `if (!isPresent) return null` gate.

**Files:**
- Modify: `packages/ui/src/select/select.tsx`, `packages/ui/src/select/context.ts`

- [ ] **Step 1: Strip position-state from the context type**

In `packages/ui/src/select/context.ts`, remove `arrowRef` (line 23), `position` (line 33), and `setPosition` (line 34) from `SelectContextValue`. Remove the now-unused `PositionState` import (keep `Side`, `Align`, `RefObject`).

- [ ] **Step 2: Strip the Root, wire the Positioner + Arrow**

In `packages/ui/src/select/select.tsx`:

Add `import { PositionerContext } from '../positioner-context.js';`.

Remove `const arrowRef = useRef<HTMLElement>(null);` (line 93) and the `const [position, setPosition] = useState<PositionState>({...})` block (lines 98-103). Remove `arrowRef`, `position`, `setPosition` from the `ctx` object (lines 132, 142-143) and `position` from the memo deps. Remove the now-unused `PositionState` import. `useState` is still used (`activeId`), keep it.

Rewrite `SelectPositioner` (lines 300-324) - note: no `isPresent` gate (hidden mount):

```tsx
export function SelectPositioner(props: SelectPositionerProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useSelectContext('Positioner');
  // Always rendered (mount: 'hidden') so options register their labels; the
  // hook drives `hidden` while not present, which composes with the top-layer
  // promotion (active only while present).
  const { positionerProps, state, position, arrowRef } = usePositioner({
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    mount: 'hidden',
  });
  const positionerValue = useMemo(() => ({ position, arrowRef }), [position]);
  return h(
    PositionerContext.Provider,
    { value: positionerValue },
    renderElement<{ side: Side; align: Align }>({
      render,
      defaultTag: 'div',
      props: { ...rest, ...positionerProps },
      state,
      children,
    })
  );
}
```

Replace the `SelectArrow` function + `SelectArrowProps` type (lines 474-499) with:

```tsx
export { Arrow as SelectArrow, type ArrowProps as SelectArrowProps } from '../arrow.js';
```

Confirm `useMemo` is imported (Select Root uses it).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS (remove any leftover unused import it flags).

- [ ] **Step 4: Run the Select tests**

Run: `pnpm exec vitest run packages/ui/src/__tests__/select-trigger.test.tsx packages/ui/src/__tests__/select-option.test.tsx packages/ui/src/__tests__/select-nav.test.tsx packages/ui/src/__tests__/select-form.test.tsx packages/ui/src/__tests__/select-presence.test.tsx packages/ui/src/__tests__/select-ssr.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/ui/src/select/
git commit -m "refactor(ui): migrate Select Arrow to PositionerContext"
```

---

## Task 8: Migrate Combobox

Combobox also uses `mount: 'hidden'` and anchors to `inputRef` with a `getAnchorRect`.

**Files:**
- Modify: `packages/ui/src/combobox/combobox.tsx`, `packages/ui/src/combobox/context.ts`

- [ ] **Step 1: Strip position-state from the context type**

In `packages/ui/src/combobox/context.ts`, remove `arrowRef` (line 44), `position` (line 55), and `setPosition` (line 56) from `ComboboxContextValue`. `PositionState` is then unused; change the line-4 import to `import type { Side, Align } from '../use-position.js';` (keep the separate `RefObject` import on line 2 and the `OptionEntry` import on line 5).

- [ ] **Step 2: Strip the Root, wire the Positioner + Arrow**

In `packages/ui/src/combobox/combobox.tsx`:

Add `import { PositionerContext } from '../positioner-context.js';`.

Remove `const arrowRef = useRef<HTMLElement>(null);` (line 120) and the `const [position, setPosition] = useState<PositionState>({...})` block (lines 125-130). Remove `arrowRef`, `position`, `setPosition` from the `ctx` object (lines 208, 218-219) and `position` from the memo deps. Remove the now-unused `PositionState` import. `useState` is still used (`activeId`), keep it.

Rewrite `ComboboxPositioner` (lines 263-294), keeping the `getAnchorRect` and `inputRef` anchor, dropping `arrowRef`/`setPosition`:

```tsx
export function ComboboxPositioner(props: ComboboxPositionerProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useComboboxContext('Positioner');
  // Anchor to the <Combobox.Anchor> field if one is rendered, else the input.
  // Both refs are stable, so the callback is stable (no autoUpdate churn).
  const getAnchorRect = useCallback(
    () =>
      (
        ctx.anchorRef.current ?? ctx.inputRef.current
      )?.getBoundingClientRect() ?? null,
    [ctx.anchorRef, ctx.inputRef]
  );
  const { positionerProps, state, position, arrowRef } = usePositioner({
    open: ctx.open,
    anchorRef: ctx.inputRef,
    floatingRef: ctx.floatingRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    getAnchorRect,
    mount: 'hidden',
  });
  const positionerValue = useMemo(() => ({ position, arrowRef }), [position]);
  return h(
    PositionerContext.Provider,
    { value: positionerValue },
    renderElement<{ side: Side; align: Align }>({
      render,
      defaultTag: 'div',
      props: { ...rest, ...positionerProps },
      state,
      children,
    })
  );
}
```

Replace the `ComboboxArrow` function + `ComboboxArrowProps` type (lines 363-388) with:

```tsx
export { Arrow as ComboboxArrow, type ArrowProps as ComboboxArrowProps } from '../arrow.js';
```

Confirm `useMemo` and `useCallback` are imported (the Root uses both).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS (remove any leftover unused import it flags).

- [ ] **Step 4: Run the Combobox tests**

Run: `pnpm exec vitest run packages/ui/src/__tests__/combobox-root.test.tsx packages/ui/src/__tests__/combobox-input.test.tsx packages/ui/src/__tests__/combobox-option.test.tsx packages/ui/src/__tests__/combobox-popup.test.tsx packages/ui/src/__tests__/combobox-value.test.tsx packages/ui/src/__tests__/combobox-autocomplete.test.ts packages/ui/src/__tests__/combobox-controls.test.tsx packages/ui/src/__tests__/combobox-anchor-focus.test.tsx packages/ui/src/__tests__/combobox-form-reset.test.tsx packages/ui/src/__tests__/combobox-inline.test.tsx packages/ui/src/__tests__/combobox-presence.test.tsx packages/ui/src/__tests__/combobox-status.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/ui/src/combobox/
git commit -m "refactor(ui): migrate Combobox Arrow to PositionerContext"
```

---

## Task 9: Remove the temporary compatibility shim from usePositioner

Every component now reads `position`/`arrowRef` from the hook return and provides them via `PositionerContext`. No caller passes `arrowRef` or `setPosition`, so remove them and delete the publish round-trip.

**Files:**
- Modify: `packages/ui/src/use-positioner.ts`

- [ ] **Step 1: Confirm nothing still passes the legacy options**

Run: `grep -rn "setPosition\|arrowRef:" packages/ui/src --include=*.tsx --include=*.ts | grep -v "__tests__"`
Expected: no matches that pass `setPosition` or `arrowRef:` into `usePositioner` (the only `arrowRef` references should be the hook's own internal ref and the `PositionerContextValue` field). If anything still passes them, that component was not migrated; fix it before continuing.

- [ ] **Step 2: Remove the options and the publish effect**

In `packages/ui/src/use-positioner.ts`:

- In `UsePositionerOptions`, delete the optional `arrowRef?` and `setPosition?` fields.
- Replace `const arrowRef = opts.arrowRef ?? ownArrowRef;` with `const arrowRef = useRef<HTMLElement>(null);` and delete the now-redundant `ownArrowRef` line.
- Delete the legacy publish `useLayoutEffect` (the one calling `opts.setPosition?.(position)`).
- If `useLayoutEffect` is no longer used anywhere else in the file (the top-layer promotion effect still uses it), keep the import; otherwise remove it. (The promotion effect at lines ~88-104 still uses `useLayoutEffect`, so keep it.)

The final options/result/body should read: options carry `open`, `anchorRef`, `floatingRef`, `side`, `align`, `offset`, `getAnchorRect?`, `mount`; the hook owns `arrowRef` via `useRef`; it returns `{ isPresent, positionerProps, state, position, arrowRef }`.

- [ ] **Step 3: Typecheck + full ui suite**

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS.

Run: `pnpm exec vitest run packages/ui`
Expected: PASS (entire ui suite).

- [ ] **Step 4: Commit**

```bash
pnpm format
git add packages/ui/src/use-positioner.ts
git commit -m "refactor(ui): drop legacy setPosition/arrowRef from usePositioner"
```

---

## Task 10: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Confirm the dedup actually happened**

Run: `grep -rn "function .*Arrow\b" packages/ui/src --include=*.tsx | grep -v "__tests__"`
Expected: exactly one match: `arrow.tsx` `export function Arrow`. No `PopoverArrow`/`TooltipArrow`/`MenuArrow`/`SelectArrow`/`ComboboxArrow` function definitions remain.

Run: `grep -rn "position: PositionState" packages/ui/src/*/context.ts packages/ui/src/menu/use-menu-core.ts`
Expected: no matches (position left all main contexts and useMenuCore).

- [ ] **Step 2: Run the full six-step CI sequence (per CLAUDE.md)**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all six PASS. If `format:check` fails, run `pnpm format`, commit, and re-run.

- [ ] **Step 3: Final state review**

```bash
git status            # working tree clean
git log --oneline main..HEAD
```

Expected: clean tree; the commit series from Tasks 1-9. No stray files, no uncommitted format fixes.

---

## Notes for the final reviewer

- **Replacement parity:** the five `*Arrow` parts had byte-identical bodies; confirm the shared `Arrow` reproduces the exact rendered output (`ref`, `data-side`, `position: absolute`, `left`/`top` from `arrowX`/`arrowY`, `state: { side }`). Read one deleted body from git (`git show <pre-PR-sha>:packages/ui/src/popover/popover.tsx`) and diff it mentally against `arrow.tsx`.
- **Cross-cutting:** `floatingRef` must remain in each main context (the Popup's `useDismiss` reads it); only `position`/`setPosition`/`arrowRef` leave. Verify no Popup lost its dismiss ref.
- **Nested submenus:** a submenu's `MenuPositioner` provides its own `PositionerContext`, so a submenu Arrow reads the submenu's position, not the parent's. Confirm `menu-submenu.test.tsx` passes.
- **Contract tightening:** an Arrow rendered outside a Positioner now throws (was: rendered a default-position arrow). This is intended and covered by `arrow.test.tsx`.
