# Positioner dedup via `usePositioner` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the five near-identical `XPositioner` bodies (Popover, Tooltip, Menu, Select, Combobox) into one internal `usePositioner` hook, and make the Popover API a hard dependency (remove the `supportsPopover` gate).

**Architecture:** A new internal hook `usePositioner` owns the shared mechanism (`usePresence` → `usePosition` → the `setPosition` publish effect → the unconditional top-layer promotion effect → the neutralize `style`). Each `XPositioner` becomes a ~12-line wrapper that reads its own typed context and passes a thin slice to the hook. Behavior-preserving except the gate removal, so the existing per-component test suites are the safety net; a new direct hook test covers the extracted unit.

**Tech Stack:** Preact, `@floating-ui/dom` (via `usePosition`), Vitest + happy-dom + `@testing-library/preact`, the native Popover API.

**Spec:** `docs/superpowers/specs/2026-06-10-positioner-dedup-design.md`

---

## File structure

- **`packages/ui/src/use-positioner.ts`** (new) — the shared hook + `POSITIONER_STYLE` constant. One responsibility: the Positioner mechanism. Not exported from `index.ts` (internal primitive, like `use-position.ts`).
- **`packages/ui/src/__tests__/use-positioner.test.tsx`** (new) — direct hook test.
- **`packages/ui/src/{popover/popover,tooltip/tooltip,menu/menu,select/select,combobox/combobox}.tsx`** (modify) — replace the Positioner body, delete the local `supportsPopover` helper (4 of 5), remove orphaned imports.
- **`apps/site/src/pages/docs/components/index.mdx`** (modify) — update the browser-support paragraph to state the Popover API is required.

**Do NOT touch** `scripts/client-size-config.mjs` or any `client-size-report.json`/history: `use-positioner` is a shared internal module attributed per-component (matching the `use-position` / `listbox/selection` precedent), and the post-merge build job regenerates baselines. Keep the size baseline equal to main's.

---

### Task 1: Create the `usePositioner` hook

**Files:**
- Test: `packages/ui/src/__tests__/use-positioner.test.tsx`
- Create: `packages/ui/src/use-positioner.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/__tests__/use-positioner.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { usePositioner } from '../use-positioner.js';
import type { PositionState, ClientRectGetter } from '../use-position.js';

afterEach(cleanup);

function Harness(props: {
  open: boolean;
  mount: 'unmount' | 'hidden';
  getAnchorRect?: ClientRectGetter;
  onPosition?: (p: PositionState) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const { isPresent, positionerProps } = usePositioner({
    open: props.open,
    anchorRef,
    floatingRef,
    arrowRef,
    side: 'bottom',
    align: 'start',
    offset: 8,
    getAnchorRect: props.getAnchorRect,
    setPosition: (p) => props.onPosition?.(p),
    mount: props.mount,
  });
  return (
    <div>
      <button ref={anchorRef}>anchor</button>
      <span data-testid="present">{String(isPresent)}</span>
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
    // Always rendered, but hidden while closed.
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

  it('publishes the resolved position via setPosition', () => {
    const seen: PositionState[] = [];
    render(<Harness open mount="unmount" onPosition={(p) => seen.push(p)} />);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].side).toBe('bottom');
    expect(seen[0].align).toBe('start');
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
Expected: FAIL — cannot resolve `'../use-positioner.js'` / `usePositioner is not a function`.

- [ ] **Step 3: Create the hook**

Create `packages/ui/src/use-positioner.ts`:

```ts
import type { JSX, RefObject } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import { usePosition } from './use-position.js';
import type {
  Side,
  Align,
  PositionState,
  ClientRectGetter,
} from './use-position.js';
import { usePresence } from './use-presence.js';
import { mergeRefs } from './merge-refs.js';

// The framework-owned layout wrapper's style. Besides positioning, it
// neutralizes the UA [popover] rule that applies once the element is promoted
// to the top layer (overflow/inset/margin/border/padding/background): without
// this the UA `overflow: auto` clips the popup's box-shadow and `inset: 0`
// fights the computed left/top. One stable reference (shared by all 5).
const POSITIONER_STYLE: JSX.CSSProperties = {
  position: 'fixed',
  inset: 'auto',
  margin: 0,
  overflow: 'visible',
  border: 0,
  padding: 0,
  background: 'transparent',
};

export interface UsePositionerOptions {
  open: boolean;
  // usePosition anchor (the Combobox passes its inputRef here).
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  arrowRef: RefObject<HTMLElement>;
  side: Side;
  align: Align;
  offset: number;
  // Position against a point/virtual element instead of anchorRef (context-menu
  // pointer anchor, combobox anchor-or-input). Undefined for the common case.
  getAnchorRect?: ClientRectGetter;
  // Publish the resolved position so an Arrow part can read it.
  setPosition: (p: PositionState) => void;
  // 'unmount': the component returns null while closed (branch on isPresent).
  // 'hidden': the element stays mounted (so options can register their labels)
  // and is `hidden` while closed.
  mount: 'unmount' | 'hidden';
}

export interface PositionerProps {
  ref: (node: HTMLElement | null) => void;
  hidden?: true;
  'data-side': Side;
  'data-align': Align;
  style: JSX.CSSProperties;
}

export interface UsePositionerResult {
  // Raw presence value. 'unmount' components branch on this (`return null`);
  // 'hidden' components ignore it (the hook bakes `hidden` into the props).
  isPresent: boolean;
  positionerProps: PositionerProps;
  state: { side: Side; align: Align };
}

export function usePositioner(opts: UsePositionerOptions): UsePositionerResult {
  const presence = usePresence(opts.open);

  const position = usePosition({
    open: presence.isPresent,
    anchorRef: opts.anchorRef,
    floatingRef: opts.floatingRef,
    arrowRef: opts.arrowRef,
    side: opts.side,
    align: opts.align,
    offset: opts.offset,
    getAnchorRect: opts.getAnchorRect,
  });

  // Publish the resolved position so Arrow (and any consumer) can read it.
  useLayoutEffect(() => {
    opts.setPosition(position);
  }, [position.side, position.align, position.arrowX, position.arrowY]);

  // Promote to the native top layer. The Popover API is a hard dependency of
  // these components; on a browser without it showPopover() throws (no
  // fallback). Applied imperatively so there is no SSR/hydration mismatch, and
  // it stays mounted through the exit animation so hidePopover fires only after
  // the closing transition completes.
  useLayoutEffect(() => {
    const el = opts.floatingRef.current;
    if (!presence.isPresent || !el) return;
    el.setAttribute('popover', 'manual');
    el.showPopover();
    return () => {
      // Best-effort un-promotion: hidePopover() throws if the element already
      // left the top layer (closed by another path or disconnected). Either way
      // the goal state (not promoted) is met, so ignore the throw.
      try {
        el.hidePopover();
      } catch {
        // already hidden / disconnected
      }
      el.removeAttribute('popover');
    };
  }, [presence.isPresent]);

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
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/use-positioner.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter '@hono-preact/*' build && pnpm typecheck`
Expected: exit 0 (the new module compiles; nothing else changed yet).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/use-positioner.ts packages/ui/src/__tests__/use-positioner.test.tsx
git commit -m "feat(ui): add usePositioner hook (shared Positioner mechanism)"
```

---

### Task 2: Refactor `PopoverPositioner` onto the hook

**Files:**
- Modify: `packages/ui/src/popover/popover.tsx`

- [ ] **Step 1: Replace the Positioner body, delete `supportsPopover`, fix imports**

In `packages/ui/src/popover/popover.tsx`:

1. Delete the `supportsPopover` helper function entirely:

```ts
function supportsPopover(el: HTMLElement): boolean {
  return typeof el.showPopover === 'function';
}
```

2. Replace the whole `PopoverPositioner` function with:

```tsx
export function PopoverPositioner(props: PopoverPositionerProps): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Positioner');
  const { isPresent, positionerProps, state } = usePositioner({
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    setPosition: ctx.setPosition,
    mount: 'unmount',
  });
  if (!isPresent) return null;
  return useRender<{ side: Side; align: Align }>({
    render,
    defaultTag: 'div',
    props: { ...rest, ...positionerProps },
    state,
    children,
  });
}
```

3. Remove the now-orphaned imports (each used only in the old Positioner): the `usePosition`, `usePresence`, and `mergeRefs` import lines. Add the hook import alongside the other `../use-*.js` imports:

```ts
import { usePositioner } from '../use-positioner.js';
```

Keep `useLayoutEffect` (still used by `PopoverDescription`), and keep `type { Side, Align, PositionState }` (used by the Root's `useState<PositionState>` and the Positioner's `useRender<{side, align}>` generic / props type).

- [ ] **Step 2: Typecheck (catches any missed/over-removed import)**

Run: `pnpm typecheck`
Expected: exit 0. If it reports an unused import (`noUnusedLocals`) or a missing symbol, fix exactly what it names and re-run.

- [ ] **Step 3: Run the Popover tests**

Run: `pnpm exec vitest run packages/ui/src/__tests__/popover-popup.test.tsx packages/ui/src/__tests__/popover-parts.test.tsx packages/ui/src/__tests__/popover-presence.test.tsx packages/ui/src/__tests__/popover-ssr.test.tsx packages/ui/src/__tests__/popover-root.test.tsx packages/ui/src/__tests__/popover-anchor.test.tsx`
Expected: PASS (all green, behavior preserved).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/popover/popover.tsx
git commit -m "refactor(ui): PopoverPositioner onto usePositioner; require Popover API"
```

---

### Task 3: Refactor `TooltipPositioner` onto the hook

**Files:**
- Modify: `packages/ui/src/tooltip/tooltip.tsx`

- [ ] **Step 1: Replace the Positioner body, delete `supportsPopover`, fix imports**

In `packages/ui/src/tooltip/tooltip.tsx`:

1. Delete the `supportsPopover` helper:

```ts
function supportsPopover(el: HTMLElement): boolean {
  return typeof el.showPopover === 'function';
}
```

2. Replace the whole `TooltipPositioner` function with:

```tsx
export function TooltipPositioner(props: TooltipPositionerProps): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = useTooltipContext('Positioner');
  const { isPresent, positionerProps, state } = usePositioner({
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    setPosition: ctx.setPosition,
    mount: 'unmount',
  });
  if (!isPresent) return null;
  return useRender<{ side: Side; align: Align }>({
    render,
    defaultTag: 'div',
    props: { ...rest, ...positionerProps },
    state,
    children,
  });
}
```

3. Fix imports: remove `usePosition`, `usePresence`, `mergeRefs`, AND `useLayoutEffect` (in tooltip.tsx the only `useLayoutEffect` uses are the two effects now inside the hook). Keep `type PositionState` (Root `useState`) and `Side`/`Align`. Note `usePosition` and `type PositionState` are imported together from `../use-position.js`; keep that import but drop only `usePosition`, e.g.:

```ts
import type { Side, Align, PositionState } from '../use-position.js';
```

Add:

```ts
import { usePositioner } from '../use-positioner.js';
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0. Fix any `noUnusedLocals`/missing-symbol error exactly as named and re-run.

- [ ] **Step 3: Run the Tooltip tests**

Run: `pnpm exec vitest run packages/ui/src/__tests__/tooltip-popup.test.tsx packages/ui/src/__tests__/tooltip-presence.test.tsx packages/ui/src/__tests__/tooltip-safe-area.test.tsx packages/ui/src/__tests__/tooltip-ssr.test.tsx packages/ui/src/__tests__/tooltip-trigger.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/tooltip/tooltip.tsx
git commit -m "refactor(ui): TooltipPositioner onto usePositioner; require Popover API"
```

---

### Task 4: Refactor `MenuPositioner` onto the hook

**Files:**
- Modify: `packages/ui/src/menu/menu.tsx`

- [ ] **Step 1: Replace the Positioner body, delete `supportsPopover`, fix imports**

In `packages/ui/src/menu/menu.tsx`:

1. Delete the `supportsPopover` helper:

```ts
function supportsPopover(el: HTMLElement): boolean {
  return typeof el.showPopover === 'function';
}
```

2. Replace the whole `MenuPositioner` function with (note the `getAnchorRect: ctx.getAnchorRect` — Menu shares this context with ContextMenu, whose pointer anchor lives there):

```tsx
export function MenuPositioner(props: MenuPositionerProps): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = useMenuContext('Positioner');
  const { isPresent, positionerProps, state } = usePositioner({
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    getAnchorRect: ctx.getAnchorRect,
    setPosition: ctx.setPosition,
    mount: 'unmount',
  });
  if (!isPresent) return null;
  return useRender<{ side: Side; align: Align }>({
    render,
    defaultTag: 'div',
    props: { ...rest, ...positionerProps },
    state,
    children,
  });
}
```

3. Fix imports: remove `usePosition`, `usePresence`, `mergeRefs`. Keep `useLayoutEffect` (used by the open-focus effect elsewhere in the file) and `type { Side, Align, PositionState }`. Add:

```ts
import { usePositioner } from '../use-positioner.js';
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0. Fix any flagged import/symbol exactly and re-run.

- [ ] **Step 3: Run the Menu + ContextMenu tests (they share `MenuPositioner`)**

Run: `pnpm exec vitest run packages/ui/src/__tests__/menu-structure.test.tsx packages/ui/src/__tests__/menu-navigation-dom.test.tsx packages/ui/src/__tests__/menu-presence.test.tsx packages/ui/src/__tests__/menu-ssr.test.tsx packages/ui/src/__tests__/menu-submenu.test.tsx packages/ui/src/__tests__/menu-submenu-safe-area.test.tsx packages/ui/src/__tests__/menu-trigger.test.tsx packages/ui/src/__tests__/menu-item.test.tsx packages/ui/src/__tests__/menu-checkable.test.tsx packages/ui/src/__tests__/context-menu.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/menu/menu.tsx
git commit -m "refactor(ui): MenuPositioner onto usePositioner; require Popover API"
```

---

### Task 5: Refactor `SelectPositioner` onto the hook

**Files:**
- Modify: `packages/ui/src/select/select.tsx`

- [ ] **Step 1: Replace the Positioner body, delete `supportsPopover`, fix imports**

In `packages/ui/src/select/select.tsx`:

1. Delete the `supportsPopover` helper:

```ts
function supportsPopover(el: HTMLElement): boolean {
  return typeof el.showPopover === 'function';
}
```

2. Replace the whole `SelectPositioner` function with (`mount: 'hidden'` — the listbox stays mounted while closed so options keep registering their labels for the trigger auto-label):

```tsx
export function SelectPositioner(props: SelectPositionerProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useSelectContext('Positioner');
  // Always rendered (mount: 'hidden') so options register their labels; the
  // hook drives `hidden` while not present, which composes with the top-layer
  // promotion (active only while present).
  const { positionerProps, state } = usePositioner({
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    setPosition: ctx.setPosition,
    mount: 'hidden',
  });
  return useRender<{ side: Side; align: Align }>({
    render,
    defaultTag: 'div',
    props: { ...rest, ...positionerProps },
    state,
    children,
  });
}
```

3. Fix imports: remove `usePosition`, `usePresence`, `mergeRefs`. Keep `useLayoutEffect` (Trigger open-focus + Option registration) and `type { Side, Align, PositionState }`. Add:

```ts
import { usePositioner } from '../use-positioner.js';
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0. Fix any flagged import/symbol exactly and re-run.

- [ ] **Step 3: Run the Select tests**

Run: `pnpm exec vitest run packages/ui/src/__tests__/select-trigger.test.tsx packages/ui/src/__tests__/select-option.test.tsx packages/ui/src/__tests__/select-nav.test.tsx packages/ui/src/__tests__/select-form.test.tsx packages/ui/src/__tests__/select-presence.test.tsx packages/ui/src/__tests__/select-ssr.test.tsx packages/ui/src/__tests__/listbox-selection.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/select/select.tsx
git commit -m "refactor(ui): SelectPositioner onto usePositioner; require Popover API"
```

---

### Task 6: Refactor `ComboboxPositioner` onto the hook

**Files:**
- Modify: `packages/ui/src/combobox/combobox.tsx`

- [ ] **Step 1: Replace the Positioner body, fix imports (no `supportsPopover` here)**

In `packages/ui/src/combobox/combobox.tsx`:

1. Replace the whole `ComboboxPositioner` function with (keeps its local `getAnchorRect`; positions against `inputRef`; `mount: 'hidden'`):

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
  const { positionerProps, state } = usePositioner({
    open: ctx.open,
    anchorRef: ctx.inputRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    getAnchorRect,
    setPosition: ctx.setPosition,
    mount: 'hidden',
  });
  return useRender<{ side: Side; align: Align }>({
    render,
    defaultTag: 'div',
    props: { ...rest, ...positionerProps },
    state,
    children,
  });
}
```

2. Fix imports: remove `usePosition`, `usePresence`, `mergeRefs`. Keep `useCallback` (still used by the local `getAnchorRect` and elsewhere), `useLayoutEffect`, and `type { Side, Align, PositionState }`. Add:

```ts
import { usePositioner } from '../use-positioner.js';
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0. Fix any flagged import/symbol exactly and re-run.

- [ ] **Step 3: Run the Combobox tests**

Run: `pnpm exec vitest run packages/ui/src/__tests__/combobox-root.test.tsx packages/ui/src/__tests__/combobox-input.test.tsx packages/ui/src/__tests__/combobox-popup.test.tsx packages/ui/src/__tests__/combobox-option.test.tsx packages/ui/src/__tests__/combobox-value.test.tsx packages/ui/src/__tests__/combobox-status.test.tsx packages/ui/src/__tests__/combobox-autocomplete.test.ts packages/ui/src/__tests__/combobox-inline.test.tsx packages/ui/src/__tests__/combobox-controls.test.tsx packages/ui/src/__tests__/combobox-anchor-focus.test.tsx packages/ui/src/__tests__/combobox-presence.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/combobox/combobox.tsx
git commit -m "refactor(ui): ComboboxPositioner onto usePositioner"
```

---

### Task 7: Update the Popover-API browser-support note in docs

**Files:**
- Modify: `apps/site/src/pages/docs/components/index.mdx`

- [ ] **Step 1: Replace the browser-support paragraph**

In `apps/site/src/pages/docs/components/index.mdx`, replace this paragraph (currently lines 3-8):

```mdx
hono-preact ships a set of headless, accessible UI primitives that lean on the
platform: the native `<dialog>` element and top layer, a battle-tested positioning
library, and a thin ARIA, keyboard, and collection layer on top. Every
primitive works on all current browser versions; newer platform features such
as the Popover API and CSS anchor positioning are used only as progressive
enhancement.
```

with:

```mdx
hono-preact ships a set of headless, accessible UI primitives that lean on the
platform: the native `<dialog>` element and top layer, a battle-tested positioning
library, and a thin ARIA, keyboard, and collection layer on top. The popup
components (Popover, Tooltip, Menu, Select, Combobox) promote their surfaces into
the top layer with the Popover API and require it; Dialog builds on the native
`<dialog>` element. Positioning is computed in JavaScript, so CSS anchor
positioning is not used.
```

- [ ] **Step 2: Build the site to confirm the MDX still compiles**

Run: `pnpm --filter site build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/pages/docs/components/index.mdx
git commit -m "docs(ui): note the popup components require the Popover API"
```

---

### Task 8: Full CI mirror + final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full CI mirror in CI order**

Run each, expecting exit 0:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm --filter site build
```

Expected: all pass. `pnpm test` should report the full unit suite green including the new `use-positioner.test.tsx` (5 tests) and all five components' suites. If `format:check` fails, run `pnpm format`, re-run `format:check`, and commit the formatting fix:

```bash
git add -A && git commit -m "chore(ui): pnpm format"
```

- [ ] **Step 2: Confirm the diff is what was intended**

Run: `git diff main...HEAD --stat`
Expected: `use-positioner.ts` + its test added; the 5 component files shrunk (Positioner bodies + `supportsPopover` removed); `index.mdx` paragraph changed. No `client-size-config.mjs` / `client-size-report.json` changes.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/ui-positioner-dedup
gh pr create --base main --head feat/ui-positioner-dedup \
  --title "refactor(ui): dedup the 5 Positioners into usePositioner; require Popover API" \
  --body "<summarize: usePositioner hook extraction, per-component thin wrappers, supportsPopover gate removed (Popover API now required for all popup components), docs note, behavior-preserving except the gate removal; full CI mirror green>"
```

---

## Post-merge follow-up (NOT part of this plan's commits)

- Update the `project_browser_support_constraint` memory to record that the Popover API is now a hard dependency for the popup components (CSS anchor positioning remains unused).

## Notes for the implementer

- **Keep tests green at every task.** This is a behavior-preserving refactor (except the gate removal, which no existing test exercises, since happy-dom implements `showPopover` and SSR runs no layout effects). If any component test goes red after its refactor, the refactor diverged from the original, compare against `git show main:packages/ui/src/<file>` and reconcile before committing.
- **`useRender` is hook-free** (just `cloneElement`/`h`), so the conditional `useRender` call after `if (!isPresent) return null` in unmount-mode components is safe.
- **Do not add `use-positioner` to the size config or regenerate baselines.** Shared internal modules are attributed per-component (the `use-position` / `listbox/selection` precedent); the post-merge build job regenerates the size report.

---

## Self-review

**Spec coverage:**
- Shared `usePositioner` hook (spec §Design/The hook) → Task 1. ✔
- Per-component thin wrappers with the variation mapping (spec §Design/wrappers + table) → Tasks 2-6 (Popover/Tooltip = unmount/anchorRef; Menu = unmount/anchorRef/`ctx.getAnchorRect`; Select = hidden/anchorRef; Combobox = hidden/inputRef/local getAnchorRect). ✔
- Popover API required: gate + four `supportsPopover` helpers removed, unconditional top-layer effect (spec §Design/Popover API now required) → hook in Task 1 + helper deletions in Tasks 2-5 (Combobox has none). ✔
- Throw on unsupported browser → hook calls `showPopover()` unconditionally. ✔
- Docs note in one shared location (spec §Design + §Files) → Task 7. ✔
- Testing: existing suites stay green + new direct hook test (spec §Testing) → Tasks 2-6 run per-component suites; Task 1 adds `use-positioner.test.tsx`; Task 8 full suite. ✔
- Memory update (spec §Files, post-merge) → noted in Post-merge follow-up. ✔

**Placeholder scan:** No TBD/TODO. The only "fix what typecheck names" steps are deterministic verification procedures with the exact symbols to remove already listed per task; no code step omits its code.

**Type consistency:** `usePositioner` / `UsePositionerOptions` / `UsePositionerResult` / `PositionerProps` names match across Task 1 and every consumer in Tasks 2-6. Hook opts (`open`, `anchorRef`, `floatingRef`, `arrowRef`, `side`, `align`, `offset`, `getAnchorRect?`, `setPosition`, `mount`) match every call site. Return (`isPresent`, `positionerProps`, `state`) destructured consistently (unmount tasks take `isPresent`; hidden tasks omit it). `mount` values `'unmount'`/`'hidden'` used consistently.
