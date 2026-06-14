# UI structural dedups (Section E Group 1 remainder) design

**Section:** Primitives DX review, Section E ("UI: move the dedup trigger from fifth copy to second copy"), Group 1, the remaining structural dedups after the Arrow + PositionerContext slice (PR #100).

**Source:** `docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md` (Section 3 residue: "OptionGroup/GroupLabel labelId-context pattern x3; Option registration layout-effect x2; description registration x2 (`dialog.tsx`, `popover.tsx`); on-open highlight-selected effect x2"; plus the Positioner body now uniform after #100).

## Goal

Collapse the remaining duplicated structural patterns in `@hono-preact/ui` into shared units, following the proven shape of the #100 Arrow/PositionerContext dedup. Pure internal refactor, behavior-preserving. `@hono-preact/ui` is private/unpublished (`0.0.0`), so there are no external consumers.

## Approach

Mirror #100: extract each duplicated unit into a shared module; components delegate to it. Re-export the shared unit under each component's existing name where there is no per-component context dependency (so the namespaces and `*/index.ts` stay unchanged); use a thin per-component wrapper where the component must read its own context.

Four dedups ship in one PR. A fifth candidate (on-open-highlight) is deferred with reasoning (see Deferred work).

## Dedup 1: Shared Positioner surface

After #100 every `XPositioner` has the same body, varying only in: which context hook it reads, the anchor ref (Combobox uses `inputRef`; others use `anchorRef`), the `getAnchorRect` (Menu reads `ctx.getAnchorRect`; Combobox builds one; others none), and the `mount` mode (`'unmount'` for Popover/Tooltip/Menu, `'hidden'` for Select/Combobox).

Create `packages/ui/src/positioner.tsx` exporting a shared `Positioner` component:

```tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import { useMemo } from 'preact/hooks';
import type { RefObject } from 'preact';
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

export function Positioner(props: PositionerProps): VNode | null {
  const { open, anchorRef, floatingRef, side, align, offset, getAnchorRect, mount, render, children, ...rest } = props;
  const { isPresent, positionerProps, state, position, arrowRef } = usePositioner({
    open, anchorRef, floatingRef, side, align, offset, getAnchorRect, mount,
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

Each `XPositioner` becomes a thin wrapper that reads its own context (preserving the component-specific "must be used within Root" error) and forwards:

```tsx
export function PopoverPositioner(props: PopoverPositionerProps) {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Positioner');
  return h(Positioner, {
    open: ctx.open, anchorRef: ctx.anchorRef, floatingRef: ctx.floatingRef,
    side: ctx.side, align: ctx.align, offset: ctx.offset, mount: 'unmount',
    render, children, ...rest,
  });
}
```

Menu forwards `getAnchorRect: ctx.getAnchorRect`; Combobox keeps building its `getAnchorRect` `useCallback` and forwards it plus `anchorRef: ctx.inputRef`; Select/Combobox pass `mount: 'hidden'`. The shared `Positioner` keeps the `mount === 'unmount' && !isPresent` gate so `'hidden'` components always render (their listbox stays mounted).

**Naming:** `use-positioner.ts` currently exports a `PositionerProps` interface for the element-attribute bag the hook returns (`positionerProps`). Rename that internal type to `PositionerElementProps` to free `PositionerProps` for the new component. Confirm at plan time it is not consumed under the old name elsewhere (it is internal to `use-positioner.ts`).

## Dedup 2: Shared OptionGroup

Select and Combobox have byte-identical `OptionGroup`/`OptionGroupLabel` pairs differing only in which `{labelId}` context they use. Create `packages/ui/src/option-group.tsx`:

```tsx
export interface OptionGroupContextValue { labelId: string; }
export const OptionGroupContext = createContext<OptionGroupContextValue | null>(null);

export function OptionGroup(props: OptionGroupProps): VNode {
  const { render, children, ...rest } = props;
  const labelId = useId();
  const node = renderElement({
    render, defaultTag: 'div',
    props: { ...rest, role: 'group', 'aria-labelledby': labelId },
    children,
  });
  return h(OptionGroupContext.Provider, { value: { labelId } }, node);
}

export function OptionGroupLabel(props: OptionGroupLabelProps): VNode {
  const { render, children, ...rest } = props;
  const group = useContext(OptionGroupContext);
  return renderElement({ render, defaultTag: 'div', props: { ...rest, id: group?.labelId }, children });
}
```

`OptionGroupProps` / `OptionGroupLabelProps` carry `render?: RenderProp` + `children?` + `Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>`. Select and Combobox re-export under their names (`export { OptionGroup as SelectOptionGroup, type OptionGroupProps as SelectOptionGroupProps } from '../option-group.js'`, etc.), so `Select.OptionGroup`/`Combobox.OptionGroup` and the `*/index.ts` namespaces are unchanged. Delete `SelectOptionGroupContext` and `ComboboxOptionGroupContext` from the two context modules (only their own OptionGroup/Label referenced them). One shared context is correct: `OptionGroupLabel` reads the nearest provider, and groups never nest across Select/Combobox in one tree.

## Dedup 3: Shared description registry

Dialog and Popover Roots have an identical description-count registry. Create `packages/ui/src/use-description-registry.ts`:

```tsx
export interface DescriptionRegistry {
  hasDescription: boolean;
  registerDescription: () => () => void;
}

export function useDescriptionRegistry(): DescriptionRegistry {
  const [count, setCount] = useState(0);
  const registerDescription = useCallback(() => {
    setCount((c) => c + 1);
    return () => setCount((c) => c - 1);
  }, []);
  return { hasDescription: count > 0, registerDescription };
}
```

Dialog Root and Popover Root call it and spread `hasDescription`/`registerDescription` into their context (replacing the inline `descriptionCount` state + `registerDescription` callback + `descriptionCount` memo-dep). The one-line `useLayoutEffect(() => ctx.registerDescription(), [ctx.registerDescription])` in each Description part stays as-is (it reads the component's own context; not worth a wrapper).

## Dedup 4: Shared option-registration effect

Select's and Combobox's `Option` register their label via an identical layout effect. Add a `useRegisterOption` hook to `packages/ui/src/listbox/selection.ts` (its natural home: it pairs with the `registerOption` that `useListboxSelection` already produces there):

```tsx
export function useRegisterOption(
  register: (id: string, value: unknown, label: string) => () => void,
  id: string,
  value: unknown,
  label: string
): void {
  useLayoutEffect(() => register(id, value, label), [id, value, label, register]);
}
```

Select Option and Combobox Option replace their inline `useLayoutEffect(() => { ...; return ctx.registerOption(id, value, label); }, [...])` with `useRegisterOption(ctx.registerOption, id, value, stringLabel)`. Each component still computes its own `stringLabel` (its text content) and passes it in.

## Behavior

All four dedups are behavior-preserving: the rendered output, ARIA wiring, registration lifecycle, and mount semantics are unchanged. The shared `Positioner` reproduces the per-component body exactly (including the `mount`-driven gate). The shared `OptionGroup` reproduces the `role="group"`/`aria-labelledby`/`id` wiring exactly. No public surface changes (re-exports keep every namespace identical).

## Testing

- Existing per-component suites (popover/tooltip/menu/select/combobox/dialog) must stay green unchanged.
- Add focused unit tests:
  - `Positioner`: `'unmount'` mode returns null when closed and the element when open; `'hidden'` mode always renders; provides `PositionerContext` (an Arrow inside reads it); forwards `getAnchorRect`.
  - `OptionGroup`/`OptionGroupLabel`: the label's `id` matches the group's `aria-labelledby`; nesting reads the nearest group.
  - `useDescriptionRegistry`: `hasDescription` flips with register/unregister; multiple registrations count correctly.
  - `useRegisterOption`: registers on mount, deregisters on unmount, re-registers when inputs change.
- Full six-step CI before push.

## Scope boundaries

In scope: the four dedups above.

Deferred (tracked, NOT dismissed):
- **Unify the on-open-highlight effect (x2).** Select sets the active descendant on open via `useListNavigation`'s `getItems`/`setActiveItem`; Combobox does it via `ctx.setActiveId` with its own lookup. Same intent, different mechanism. Unifying requires reconciling those two navigation paths; worth doing once that reconciliation is designed, but out of scope here to keep this PR mechanical and low-risk.
- **Cross-package iso+ui `renderElement` duplication** (`packages/iso/src/internal/use-render.ts` vs `packages/ui/src/use-render.ts`): a separate slice (spans iso internals).

Out of scope entirely: Section E Group 2 (contract standardization) and Section F.
