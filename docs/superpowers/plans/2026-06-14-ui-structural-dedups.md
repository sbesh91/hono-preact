# UI structural dedups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the four remaining duplicated structural patterns in `@hono-preact/ui` (Positioner body ×5, OptionGroup ×2, description registry ×2, option-registration effect ×2) into shared units, behavior-preserving.

**Architecture:** Mirror the merged #100 Arrow/PositionerContext dedup: extract each duplicated unit into a shared module; components delegate to it. Re-export the shared unit under each component's existing name where there is no per-component context dependency (so namespaces stay unchanged); use a thin per-component wrapper where the component must read its own context (the Positioner).

**Tech Stack:** Preact, TypeScript, Vitest + @testing-library/preact (happy-dom), `@hono-preact/ui` (private, unpublished `0.0.0`).

**Spec:** `docs/superpowers/specs/2026-06-14-ui-structural-dedups-design.md`

**Conventions for every task:**
- Work on the feature branch (verify `git branch --show-current` before each commit; never commit to `main`).
- Run `pnpm format` before committing so the committed state is Prettier-clean.
- `noUnusedLocals`/`noUnusedParameters` are ON: after removing a usage, delete the now-orphaned import or `tsc` fails (that failure is the signal).
- Focused test: `pnpm exec vitest run <path>`. Per-package typecheck: `pnpm --filter @hono-preact/ui exec tsc --noEmit`. Whole ui suite: `pnpm exec vitest run packages/ui`.

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/ui/src/positioner.tsx` (new) | Shared `Positioner` component (the uniform Positioner body) | 1 |
| `packages/ui/src/use-positioner.ts` | Rename internal `PositionerProps` → `PositionerElementProps` | 1 |
| `packages/ui/src/index.ts` | Update the barrel export name | 1 |
| `packages/ui/src/__tests__/positioner.test.tsx` (new) | Tests for the shared `Positioner` | 1 |
| `packages/ui/src/{popover,tooltip,menu,select,combobox}/*.tsx` | Thin Positioner wrappers | 2 |
| `packages/ui/src/option-group.tsx` (new) | Shared `OptionGroup`/`OptionGroupLabel` + `OptionGroupContext` | 3 |
| `packages/ui/src/__tests__/option-group.test.tsx` (new) | Tests for the shared OptionGroup | 3 |
| `packages/ui/src/{select,combobox}/{select,combobox}.tsx,context.ts` | Re-export OptionGroup, delete per-component contexts | 4 |
| `packages/ui/src/use-description-registry.ts` (new) | `useDescriptionRegistry` hook | 5 |
| `packages/ui/src/{dialog,popover}/{dialog,popover}.tsx` | Use the registry hook | 5 |
| `packages/ui/src/listbox/selection.ts` | Add `useRegisterOption` hook | 6 |
| `packages/ui/src/{select,combobox}/{select,combobox}.tsx` | Use `useRegisterOption` | 6 |

The `*/index.ts` namespace files are NOT modified: each component re-exports the shared units under its old names.

---

## Task 1: Shared Positioner component (+ free the `PositionerProps` name)

**Files:**
- Modify: `packages/ui/src/use-positioner.ts`, `packages/ui/src/index.ts`
- Create: `packages/ui/src/positioner.tsx`
- Test: `packages/ui/src/__tests__/positioner.test.tsx`

### Step 1: Rename the internal element-attrs type to free `PositionerProps`

`use-positioner.ts` currently exports `interface PositionerProps { ... }` (the element-attribute bag returned as `positionerProps`) and uses it in `UsePositionerResult` (`positionerProps: PositionerProps`). The public barrel re-exports it. Rename it so the new component can own `PositionerProps`.

- [ ] In `packages/ui/src/use-positioner.ts`: rename `export interface PositionerProps` → `export interface PositionerElementProps`, and update its single use in `UsePositionerResult` to `positionerProps: PositionerElementProps`.
- [ ] In `packages/ui/src/index.ts`: change the re-export line `type PositionerProps,` (in the `from './use-positioner.js'` block) to `type PositionerElementProps,`.

Verify nothing else references the old name:

Run: `rg -n "\bPositionerProps\b" packages/ui/src` — expect ONLY the new occurrences you are about to add in `positioner.tsx` (none yet at this step). If any other file references `PositionerProps`, update it to `PositionerElementProps`.

### Step 2: Write the failing test

Create `packages/ui/src/__tests__/positioner.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { Positioner } from '../positioner.js';
import { Arrow } from '../arrow.js';

afterEach(cleanup);

function Harness(props: {
  open: boolean;
  mount: 'unmount' | 'hidden';
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  return (
    <div>
      <button ref={anchorRef}>anchor</button>
      <Positioner
        open={props.open}
        anchorRef={anchorRef}
        floatingRef={floatingRef}
        side="bottom"
        align="start"
        offset={8}
        mount={props.mount}
        data-testid="positioner"
      >
        <Arrow data-testid="arrow" />
      </Positioner>
    </div>
  );
}

describe('Positioner', () => {
  it("unmount mode: renders nothing when closed, the element when open", () => {
    const closed = render(<Harness open={false} mount="unmount" />);
    expect(closed.queryByTestId('positioner')).toBeNull();
    cleanup();
    const open = render(<Harness open mount="unmount" />);
    expect(open.queryByTestId('positioner')).not.toBeNull();
    expect(open.getByTestId('positioner').getAttribute('data-side')).toBe('bottom');
  });

  it('hidden mode: always renders, hidden while closed', () => {
    const closed = render(<Harness open={false} mount="hidden" />);
    const el = closed.getByTestId('positioner');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
  });

  it('provides PositionerContext so a nested Arrow renders', () => {
    const { getByTestId } = render(<Harness open mount="unmount" />);
    // The Arrow reads PositionerContext; if the provider were missing it would throw.
    expect(getByTestId('arrow').getAttribute('data-side')).toBe('bottom');
  });
});
```

### Step 3: Run the test to verify it fails

Run: `pnpm exec vitest run packages/ui/src/__tests__/positioner.test.tsx`
Expected: FAIL (`Cannot find module '../positioner.js'`).

### Step 4: Create the shared Positioner

Create `packages/ui/src/positioner.tsx`:

```tsx
import { h, type ComponentChildren, type JSX, type RefObject, type VNode } from 'preact';
import { useMemo } from 'preact/hooks';
import { renderElement, type RenderProp } from './use-render.js';
import { usePositioner } from './use-positioner.js';
import type { Side, Align, ClientRectGetter } from './use-position.js';
import { PositionerContext } from './positioner-context.js';

export type PositionerProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  side: Side;
  align: Align;
  offset: number;
  getAnchorRect?: ClientRectGetter;
  mount: 'unmount' | 'hidden';
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

// The shared overlay-positioning surface: runs usePositioner, publishes the
// resolved position + arrow ref via PositionerContext, and renders the
// positioned element. Each component's XPositioner is a thin wrapper that reads
// its own context and forwards the resolved values here.
export function Positioner(props: PositionerProps): VNode | null {
  const {
    open,
    anchorRef,
    floatingRef,
    side,
    align,
    offset,
    getAnchorRect,
    mount,
    render,
    children,
    ...rest
  } = props;
  const { isPresent, positionerProps, state, position, arrowRef } =
    usePositioner({
      open,
      anchorRef,
      floatingRef,
      side,
      align,
      offset,
      getAnchorRect,
      mount,
    });
  const positionerValue = useMemo(() => ({ position, arrowRef }), [position]);
  if (mount === 'unmount' && !isPresent) return null;
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

### Step 5: Run the test to verify it passes

Run: `pnpm exec vitest run packages/ui/src/__tests__/positioner.test.tsx`
Expected: PASS (3 tests).

### Step 6: Typecheck

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS (the `PositionerElementProps` rename resolved everywhere; the new `Positioner` typechecks).

### Step 7: Commit

```bash
pnpm format
git add packages/ui/src/positioner.tsx packages/ui/src/use-positioner.ts packages/ui/src/index.ts packages/ui/src/__tests__/positioner.test.tsx
git commit -m "feat(ui): add shared Positioner component"
```

---

## Task 2: Migrate the five Positioner wrappers

**Files:**
- Modify: `packages/ui/src/popover/popover.tsx`, `packages/ui/src/tooltip/tooltip.tsx`, `packages/ui/src/menu/menu.tsx`, `packages/ui/src/select/select.tsx`, `packages/ui/src/combobox/combobox.tsx`

Each `XPositioner` currently calls `usePositioner` + `useMemo` + wraps in `PositionerContext.Provider` + `renderElement`. Replace each body with a thin wrapper delegating to the shared `Positioner`. After this, each file no longer references `usePositioner` or `PositionerContext` directly (remove those imports; `tsc` will flag them). Add `import { Positioner } from '../positioner.js';`. Keep `renderElement` (other parts use it) and `useMemo` (the Roots use it).

- [ ] **Step 1: Popover** — replace the `PopoverPositioner` function body with:

```tsx
export function PopoverPositioner(props: PopoverPositionerProps) {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Positioner');
  return h(Positioner, {
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    mount: 'unmount',
    render,
    children,
    ...rest,
  });
}
```
Update imports: remove `usePositioner` and `PositionerContext`; add `import { Positioner } from '../positioner.js';`.

- [ ] **Step 2: Tooltip** — same shape as Popover, with `useTooltipContext('Positioner')` and `mount: 'unmount'`. Replace the `TooltipPositioner` body and fix imports (remove `usePositioner`/`PositionerContext`, add `Positioner`).

```tsx
export function TooltipPositioner(props: TooltipPositionerProps) {
  const { render, children, ...rest } = props;
  const ctx = useTooltipContext('Positioner');
  return h(Positioner, {
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    mount: 'unmount',
    render,
    children,
    ...rest,
  });
}
```

- [ ] **Step 3: Menu** — like Popover but forward `getAnchorRect: ctx.getAnchorRect` (ContextMenu's pointer anchor). Replace the `MenuPositioner` body and fix imports.

```tsx
export function MenuPositioner(props: MenuPositionerProps) {
  const { render, children, ...rest } = props;
  const ctx = useMenuContext('Positioner');
  return h(Positioner, {
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    getAnchorRect: ctx.getAnchorRect,
    mount: 'unmount',
    render,
    children,
    ...rest,
  });
}
```
(SubmenuPositioner renders `MenuPositioner`, so it is migrated automatically; do not edit `submenu.tsx`.)

- [ ] **Step 4: Select** — `mount: 'hidden'` (no gate needed; the shared `Positioner` only gates on `unmount`). Replace the `SelectPositioner` body and fix imports.

```tsx
export function SelectPositioner(props: SelectPositionerProps) {
  const { render, children, ...rest } = props;
  const ctx = useSelectContext('Positioner');
  return h(Positioner, {
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    mount: 'hidden',
    render,
    children,
    ...rest,
  });
}
```

- [ ] **Step 5: Combobox** — `mount: 'hidden'`, `anchorRef: ctx.inputRef`, and keep building `getAnchorRect`. Replace the `ComboboxPositioner` body and fix imports (keep `useCallback`).

```tsx
export function ComboboxPositioner(props: ComboboxPositionerProps) {
  const { render, children, ...rest } = props;
  const ctx = useComboboxContext('Positioner');
  // Anchor to the <Combobox.Anchor> field if one is rendered, else the input.
  const getAnchorRect = useCallback(
    () =>
      (ctx.anchorRef.current ?? ctx.inputRef.current)?.getBoundingClientRect() ??
      null,
    [ctx.anchorRef, ctx.inputRef]
  );
  return h(Positioner, {
    open: ctx.open,
    anchorRef: ctx.inputRef,
    floatingRef: ctx.floatingRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    getAnchorRect,
    mount: 'hidden',
    render,
    children,
    ...rest,
  });
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS. If it flags an unused `usePositioner`/`PositionerContext`/`Side`/`Align` import in any file, remove it. (`Side`/`Align` are still used by the `XPositionerProps` render-prop generic, so they stay.)

- [ ] **Step 7: Run the affected suites**

Run: `pnpm exec vitest run packages/ui`
Expected: PASS (whole ui suite — every overlay's positioner + the Arrow-in-Positioner tests).

- [ ] **Step 8: Commit**

```bash
pnpm format
git add packages/ui/src/popover/ packages/ui/src/tooltip/ packages/ui/src/menu/ packages/ui/src/select/ packages/ui/src/combobox/
git commit -m "refactor(ui): migrate Positioners onto the shared Positioner"
```

---

## Task 3: Shared OptionGroup

**Files:**
- Create: `packages/ui/src/option-group.tsx`
- Test: `packages/ui/src/__tests__/option-group.test.tsx`

### Step 1: Write the failing test

Create `packages/ui/src/__tests__/option-group.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { OptionGroup, OptionGroupLabel } from '../option-group.js';

afterEach(cleanup);

describe('OptionGroup', () => {
  it("wires the label id to the group's aria-labelledby", () => {
    const { container } = render(
      <OptionGroup data-testid="group">
        <OptionGroupLabel data-testid="label">Citrus</OptionGroupLabel>
      </OptionGroup>
    );
    const group = container.querySelector('[data-testid="group"]') as HTMLElement;
    const label = container.querySelector('[data-testid="label"]') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    const labelledby = group.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    expect(label.id).toBe(labelledby);
  });

  it('a label outside any group gets no id', () => {
    const { container } = render(<OptionGroupLabel data-testid="label">X</OptionGroupLabel>);
    const label = container.querySelector('[data-testid="label"]') as HTMLElement;
    expect(label.id).toBe('');
  });
});
```

### Step 2: Run the test to verify it fails

Run: `pnpm exec vitest run packages/ui/src/__tests__/option-group.test.tsx`
Expected: FAIL (`Cannot find module '../option-group.js'`).

### Step 3: Create the shared OptionGroup

Create `packages/ui/src/option-group.tsx`:

```tsx
import {
  createContext,
  h,
  type ComponentChildren,
  type JSX,
  type VNode,
} from 'preact';
import { useContext, useId } from 'preact/hooks';
import { renderElement, type RenderProp } from './use-render.js';

export interface OptionGroupContextValue {
  labelId: string;
}
export const OptionGroupContext =
  createContext<OptionGroupContextValue | null>(null);

export type OptionGroupProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function OptionGroup(props: OptionGroupProps): VNode {
  const { render, children, ...rest } = props;
  const labelId = useId();
  const node = renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, role: 'group', 'aria-labelledby': labelId },
    children,
  });
  return h(OptionGroupContext.Provider, { value: { labelId } }, node);
}

export type OptionGroupLabelProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function OptionGroupLabel(props: OptionGroupLabelProps): VNode {
  const { render, children, ...rest } = props;
  const group = useContext(OptionGroupContext);
  return renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, id: group?.labelId },
    children,
  });
}
```

### Step 4: Run the test to verify it passes

Run: `pnpm exec vitest run packages/ui/src/__tests__/option-group.test.tsx`
Expected: PASS (2 tests).

### Step 5: Commit

```bash
pnpm format
git add packages/ui/src/option-group.tsx packages/ui/src/__tests__/option-group.test.tsx
git commit -m "feat(ui): add shared OptionGroup"
```

---

## Task 4: Migrate Select + Combobox OptionGroup

**Files:**
- Modify: `packages/ui/src/select/select.tsx`, `packages/ui/src/select/context.ts`, `packages/ui/src/combobox/combobox.tsx`, `packages/ui/src/combobox/context.ts`

### Step 1: Select

- [ ] In `packages/ui/src/select/select.tsx`: delete the `SelectOptionGroup` function, the `SelectOptionGroupLabel` function, and the `SelectOptionGroupProps`/`SelectOptionGroupLabelProps` type declarations. Replace them with a re-export:

```tsx
export {
  OptionGroup as SelectOptionGroup,
  OptionGroupLabel as SelectOptionGroupLabel,
  type OptionGroupProps as SelectOptionGroupProps,
  type OptionGroupLabelProps as SelectOptionGroupLabelProps,
} from '../option-group.js';
```
Remove the now-unused `SelectOptionGroupContext` import. If `useId`/`useContext` are no longer used elsewhere in `select.tsx`, remove them (let `tsc` confirm).

- [ ] In `packages/ui/src/select/context.ts`: delete the `SelectOptionGroupContextValue` interface and the `SelectOptionGroupContext` export (the two lines defining the context). Nothing else references them.

### Step 2: Combobox

- [ ] In `packages/ui/src/combobox/combobox.tsx`: delete the `ComboboxOptionGroup`/`ComboboxOptionGroupLabel` functions and their prop types; replace with:

```tsx
export {
  OptionGroup as ComboboxOptionGroup,
  OptionGroupLabel as ComboboxOptionGroupLabel,
  type OptionGroupProps as ComboboxOptionGroupProps,
  type OptionGroupLabelProps as ComboboxOptionGroupLabelProps,
} from '../option-group.js';
```
Remove the now-unused `ComboboxOptionGroupContext` import. Leave `useId`/`useContext` if still used elsewhere (let `tsc` confirm).

- [ ] In `packages/ui/src/combobox/context.ts`: delete the `ComboboxOptionGroupContextValue` interface and the `ComboboxOptionGroupContext` export.

### Step 3: Typecheck

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS. Remove any unused import it flags.

### Step 4: Run the Select + Combobox suites

Run: `pnpm exec vitest run packages/ui/src/__tests__/select-option.test.tsx packages/ui/src/__tests__/combobox-option.test.tsx packages/ui/src/__tests__/select-ssr.test.tsx packages/ui/src/__tests__/combobox-popup.test.tsx`
Expected: PASS (the OptionGroup is exercised via the Select/Combobox option-rendering tests). If an OptionGroup-specific test exists, it stays green.

### Step 5: Commit

```bash
pnpm format
git add packages/ui/src/select/ packages/ui/src/combobox/
git commit -m "refactor(ui): migrate Select/Combobox OptionGroup to the shared one"
```

---

## Task 5: Shared description registry

**Files:**
- Create: `packages/ui/src/use-description-registry.ts`
- Test: `packages/ui/src/__tests__/use-description-registry.test.tsx`
- Modify: `packages/ui/src/dialog/dialog.tsx`, `packages/ui/src/popover/popover.tsx`

### Step 1: Write the failing test

Create `packages/ui/src/__tests__/use-description-registry.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useDescriptionRegistry } from '../use-description-registry.js';

afterEach(cleanup);

describe('useDescriptionRegistry', () => {
  it('hasDescription is false until something registers, true while registered', () => {
    let registry: ReturnType<typeof useDescriptionRegistry> | undefined;
    function Probe() {
      registry = useDescriptionRegistry();
      return <span data-testid="has">{String(registry.hasDescription)}</span>;
    }
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('has').textContent).toBe('false');

    let unregister: () => void = () => {};
    act(() => {
      unregister = registry!.registerDescription();
    });
    expect(getByTestId('has').textContent).toBe('true');

    act(() => {
      unregister();
    });
    expect(getByTestId('has').textContent).toBe('false');
  });

  it('counts multiple registrations (stays true until all unregister)', () => {
    let registry: ReturnType<typeof useDescriptionRegistry> | undefined;
    function Probe() {
      registry = useDescriptionRegistry();
      return <span data-testid="has">{String(registry.hasDescription)}</span>;
    }
    const { getByTestId } = render(<Probe />);
    let a: () => void = () => {};
    let b: () => void = () => {};
    act(() => {
      a = registry!.registerDescription();
      b = registry!.registerDescription();
    });
    expect(getByTestId('has').textContent).toBe('true');
    act(() => a());
    expect(getByTestId('has').textContent).toBe('true');
    act(() => b());
    expect(getByTestId('has').textContent).toBe('false');
  });
});
```

### Step 2: Run the test to verify it fails

Run: `pnpm exec vitest run packages/ui/src/__tests__/use-description-registry.test.tsx`
Expected: FAIL (`Cannot find module '../use-description-registry.js'`).

### Step 3: Create the hook

Create `packages/ui/src/use-description-registry.ts`:

```ts
import { useCallback, useState } from 'preact/hooks';

export interface DescriptionRegistry {
  // True while at least one Description part is mounted.
  hasDescription: boolean;
  // Call from a Description part's layout effect; returns the deregister cleanup.
  registerDescription: () => () => void;
}

// Reference-counted description presence, shared by Dialog and Popover so the
// Popup wires aria-describedby only when a Description is actually rendered.
export function useDescriptionRegistry(): DescriptionRegistry {
  const [count, setCount] = useState(0);
  const registerDescription = useCallback(() => {
    setCount((c) => c + 1);
    return () => setCount((c) => c - 1);
  }, []);
  return { hasDescription: count > 0, registerDescription };
}
```

### Step 4: Run the test to verify it passes

Run: `pnpm exec vitest run packages/ui/src/__tests__/use-description-registry.test.tsx`
Expected: PASS (2 tests).

### Step 5: Migrate Dialog Root

In `packages/ui/src/dialog/dialog.tsx`, in `DialogRoot`: delete the `const [descriptionCount, setDescriptionCount] = useState(0);` block and the `const registerDescription = useCallback(...)` block; replace with:

```tsx
const { hasDescription, registerDescription } = useDescriptionRegistry();
```
Then in the `ctx` memo object, change `hasDescription: descriptionCount > 0,` to `hasDescription,` (leave `registerDescription,` as is). In the memo dependency array, replace `descriptionCount,` with `hasDescription,` (keep `registerDescription,`).

Add `import { useDescriptionRegistry } from '../use-description-registry.js';`. If `useState`/`useCallback` are no longer used elsewhere in `dialog.tsx`, remove them (let `tsc` confirm — `useState` is likely still used for `open` via `useControllableState`? check; if unused, remove).

### Step 6: Migrate Popover Root

In `packages/ui/src/popover/popover.tsx`, in `PopoverRoot`: same change — delete the `descriptionCount` `useState` + `registerDescription` `useCallback`, add `const { hasDescription, registerDescription } = useDescriptionRegistry();`, change `hasDescription: descriptionCount > 0,` to `hasDescription,` in the ctx object, and replace `descriptionCount,` with `hasDescription,` in the memo deps. Add the import. Remove `useState`/`useCallback` only if now unused (let `tsc` confirm).

### Step 7: Typecheck + suites

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS.

Run: `pnpm exec vitest run packages/ui/src/__tests__/dialog-describe.test.tsx packages/ui/src/__tests__/dialog-popup.test.tsx packages/ui/src/__tests__/popover-parts.test.tsx packages/ui/src/__tests__/popover-popup.test.tsx`
Expected: PASS (the aria-describedby wiring still works).

### Step 8: Commit

```bash
pnpm format
git add packages/ui/src/use-description-registry.ts packages/ui/src/__tests__/use-description-registry.test.tsx packages/ui/src/dialog/ packages/ui/src/popover/
git commit -m "refactor(ui): share the description registry between Dialog and Popover"
```

---

## Task 6: Shared option-registration effect

`SelectOption` and `ComboboxOption` each run an identical layout effect that registers the option's label. Crucially, the original reads the label INSIDE the effect: for string children it uses the string; for non-string children it reads `document.getElementById(id)?.textContent` (which only works post-mount, hence the effect). The shared hook must preserve this exactly, so it takes `stringLabel` (the resolved string, or `undefined`) and does the DOM fallback inside the effect.

**Files:**
- Modify: `packages/ui/src/listbox/selection.ts`, `packages/ui/src/select/select.tsx`, `packages/ui/src/combobox/combobox.tsx`
- Test: `packages/ui/src/__tests__/register-option.test.tsx` (new)

### Step 1: Write the failing test

Create `packages/ui/src/__tests__/register-option.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRegisterOption } from '../listbox/selection.js';

afterEach(cleanup);

describe('useRegisterOption', () => {
  it('registers the string label on mount and deregisters on unmount', () => {
    const deregister = vi.fn();
    const register = vi.fn(() => deregister);
    function Opt() {
      useRegisterOption(register, 'id1', 'v1', 'Label 1');
      return <div />;
    }
    const { unmount } = render(<Opt />);
    expect(register).toHaveBeenCalledWith('id1', 'v1', 'Label 1');
    expect(deregister).not.toHaveBeenCalled();
    unmount();
    expect(deregister).toHaveBeenCalledTimes(1);
  });

  it('falls back to the element text content when stringLabel is undefined', () => {
    const register = vi.fn(() => () => {});
    function Opt() {
      useRegisterOption(register, 'id1', 'v1', undefined);
      return <div id="id1">From DOM</div>;
    }
    render(<Opt />);
    expect(register).toHaveBeenCalledWith('id1', 'v1', 'From DOM');
  });

  it('re-registers when the label changes', () => {
    const register = vi.fn(() => () => {});
    function Opt(props: { label: string }) {
      useRegisterOption(register, 'id1', 'v1', props.label);
      return <div />;
    }
    const { rerender } = render(<Opt label="A" />);
    expect(register).toHaveBeenLastCalledWith('id1', 'v1', 'A');
    rerender(<Opt label="B" />);
    expect(register).toHaveBeenLastCalledWith('id1', 'v1', 'B');
  });
});
```

### Step 2: Run the test to verify it fails

Run: `pnpm exec vitest run packages/ui/src/__tests__/register-option.test.tsx`
Expected: FAIL (`useRegisterOption` not exported).

### Step 3: Add the hook

In `packages/ui/src/listbox/selection.ts`, ensure `useLayoutEffect` is imported from `preact/hooks`, then add at the end:

```ts
// Shared by Select.Option and Combobox.Option: register an option's label with
// the listbox registry on mount, re-register when its identity/label changes,
// and deregister on unmount. For non-string children stringLabel is undefined
// and the label is read from the element's textContent at effect time (post-
// mount), matching the original per-component behavior.
export function useRegisterOption(
  register: (id: string, value: unknown, label: string) => () => void,
  id: string,
  value: unknown,
  stringLabel: string | undefined
): void {
  useLayoutEffect(() => {
    const label = stringLabel ?? document.getElementById(id)?.textContent ?? '';
    return register(id, value, label);
  }, [id, value, stringLabel, register]);
}
```

### Step 4: Run the test to verify it passes

Run: `pnpm exec vitest run packages/ui/src/__tests__/register-option.test.tsx`
Expected: PASS (3 tests).

### Step 5: Migrate Select Option

In `packages/ui/src/select/select.tsx`, in `SelectOption`, replace this block:

```tsx
  const stringLabel = typeof children === 'string' ? children : undefined;
  useLayoutEffect(() => {
    const label = stringLabel ?? document.getElementById(id)?.textContent ?? '';
    return ctx.registerOption(id, value, label);
  }, [id, value, stringLabel, ctx.registerOption]);
```
with:
```tsx
  const stringLabel = typeof children === 'string' ? children : undefined;
  useRegisterOption(ctx.registerOption, id, value, stringLabel);
```
Add `useRegisterOption` to the existing import from `'../listbox/selection.js'` (or add a new import if there isn't one). Remove the now-unused `useLayoutEffect` import only if nothing else in `select.tsx` uses it (the Trigger's on-open-highlight effect still does, so it stays — let `tsc` confirm).

### Step 6: Migrate Combobox Option

In `packages/ui/src/combobox/combobox.tsx`, `ComboboxOption` has the identical effect. Replace it the same way:
```tsx
  const stringLabel = typeof children === 'string' ? children : undefined;
  useRegisterOption(ctx.registerOption, id, value, stringLabel);
```
Add the `useRegisterOption` import. Combobox has several other layout effects, so `useLayoutEffect` stays.

### Step 7: Typecheck + suites

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS.

Run: `pnpm exec vitest run packages/ui/src/__tests__/register-option.test.tsx packages/ui/src/__tests__/select-option.test.tsx packages/ui/src/__tests__/combobox-option.test.tsx packages/ui/src/__tests__/select-trigger.test.tsx packages/ui/src/__tests__/combobox-value.test.tsx`
Expected: PASS (option label registration still drives the trigger auto-label / value->label cache).

### Step 8: Commit

```bash
pnpm format
git add packages/ui/src/listbox/selection.ts packages/ui/src/__tests__/register-option.test.tsx packages/ui/src/select/ packages/ui/src/combobox/
git commit -m "refactor(ui): share the option-registration effect"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Dedup sanity**

Run: `rg -n "function \w*Positioner\b" packages/ui/src -g '*.tsx' -g '!**/__tests__/**'`
Expected: the five thin `XPositioner` wrappers + `Positioner` in `positioner.tsx` + `SubmenuPositioner` (which wraps `MenuPositioner`). No `usePositioner(`/`PositionerContext.Provider` left in component files:

Run: `rg -n "usePositioner\(|PositionerContext" packages/ui/src/{popover,tooltip,menu,select,combobox}/*.tsx`
Expected: no matches (only `positioner.tsx` uses them).

Run: `rg -n "OptionGroupContext|descriptionCount" packages/ui/src/{select,combobox,dialog,popover}`
Expected: no matches (per-component OptionGroup contexts deleted; description count moved into the hook).

- [ ] **Step 2: Six-step CI (per CLAUDE.md)**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: all six PASS. If `format:check` fails, `pnpm format`, commit, re-run.

- [ ] **Step 3: Final state review**

```bash
git status            # clean
git log --oneline main..HEAD
```
Expected: clean tree; the commit series from Tasks 1-6.

---

## Notes for the final reviewer

- **Replacement parity (Positioner):** the shared `Positioner` must reproduce the per-component body exactly: `usePositioner` options, the memoized `{position, arrowRef}`, the `mount==='unmount' && !isPresent` gate (so `'hidden'` components always render), the `PositionerContext.Provider` wrap, and the `renderElement` with `{...rest, ...positionerProps}` + `state`. Compare against a pre-PR `XPositioner` via git history.
- **Replacement parity (OptionGroup):** `role="group"` + `aria-labelledby={labelId}` on the group, `id={labelId}` on the label; identical to the deleted Select/Combobox versions.
- **Replacement parity (option registration):** `useRegisterOption` keeps the DOM-`textContent` fallback for non-string children and the exact dependency array `[id, value, stringLabel, register]`.
- **Cross-cutting:** the `aria-describedby` wiring (Dialog/Popover) still flips with Description presence; `Select.OptionGroup`/`Combobox.OptionGroup` namespaces unchanged; Submenu still works (it wraps `MenuPositioner`).
- **No public surface change** beyond the intended `PositionerProps` → `PositionerElementProps` rename (ui is unpublished). Confirm the barrel still exports a coherent set.
