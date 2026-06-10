# `useMenuCore` Root dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the triplicated `MenuContextValue` setup + assembly from `MenuRoot`, `SubmenuRoot`, and `ContextMenuRoot` into one internal `useMenuCore` hook, collapsing each Root to a thin wrapper.

**Architecture:** A new `packages/ui/src/menu/use-menu-core.ts` owns `useControllableState`, the five refs, the ids, `activeId`/`position` state, the `closeAll` default, the ContextMenu pointer-anchor machinery (`pointRef`/`getAnchorRect`/`openAt`, gated by a `pointerAnchored` flag so the hook owns the `setOpen`/`pendingEdgeRef` they close over), and the assembled `MenuContextValue`. Each Root resolves its own prop defaults and calls the hook. Pure dedup, no behavior change.

**Tech Stack:** Preact, Vitest + happy-dom + `@testing-library/preact`.

**Spec:** `docs/superpowers/specs/2026-06-10-menu-core-dedup-design.md`

---

## File structure

- **`packages/ui/src/menu/use-menu-core.ts`** (new) — the hook. One responsibility: build a `MenuContextValue` + expose the raw pieces. Internal (not exported from `index.ts`).
- **`packages/ui/src/__tests__/use-menu-core.test.tsx`** (new) — direct hook unit test.
- **`packages/ui/src/menu/menu.tsx`** (modify `MenuRoot` only).
- **`packages/ui/src/context-menu/context-menu.tsx`** (modify `ContextMenuRoot` only).
- **`packages/ui/src/menu/submenu.tsx`** (modify `SubmenuRoot` only; keep its hover timer + `submenuCtx`).

No `index.ts` change. **Do NOT touch** `scripts/client-size-config.mjs` or any `client-size-report.json` (shared internal module, attributed per-component; the post-merge build job regenerates baselines).

---

### Task 1: Create the `useMenuCore` hook

**Files:**
- Test: `packages/ui/src/__tests__/use-menu-core.test.tsx`
- Create: `packages/ui/src/menu/use-menu-core.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/__tests__/use-menu-core.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useMenuCore, type UseMenuCoreOptions } from '../menu/use-menu-core.js';
import type { MenuContextValue } from '../menu/context.js';

afterEach(cleanup);

const BASE: UseMenuCoreOptions = {
  side: 'bottom',
  align: 'start',
  offset: 8,
  loop: true,
  typeahead: true,
};

function renderCore(opts: UseMenuCoreOptions) {
  const cap: { ctx: MenuContextValue } = {
    ctx: undefined as unknown as MenuContextValue,
  };
  function Harness() {
    const core = useMenuCore(opts);
    cap.ctx = core.menuCtx;
    return <span data-testid="open">{String(core.open)}</span>;
  }
  const utils = render(<Harness />);
  return { cap, utils };
}

describe('useMenuCore', () => {
  it('closeAll defaults to setOpen(false)', () => {
    const { cap, utils } = renderCore({ ...BASE, defaultOpen: true });
    expect(cap.ctx.open).toBe(true);
    act(() => cap.ctx.closeAll());
    expect(utils.getByTestId('open').textContent).toBe('false');
  });

  it('uses an injected closeAll instead of the default', () => {
    const closeAll = vi.fn();
    const { cap, utils } = renderCore({ ...BASE, defaultOpen: true, closeAll });
    act(() => cap.ctx.closeAll());
    expect(closeAll).toHaveBeenCalledTimes(1);
    // open is unchanged: the injected closeAll did not touch our state
    expect(utils.getByTestId('open').textContent).toBe('true');
  });

  it('passes through parentDismissId (default null)', () => {
    const a = renderCore({ ...BASE });
    expect(a.cap.ctx.parentDismissId).toBeNull();
    cleanup();
    const b = renderCore({ ...BASE, parentDismissId: 'parent-9' });
    expect(b.cap.ctx.parentDismissId).toBe('parent-9');
  });

  it('pointerAnchored: openAt captures the point, opens, pends first; getAnchorRect returns the point rect', () => {
    const { cap, utils } = renderCore({ ...BASE, pointerAnchored: true });
    expect(cap.ctx.open).toBe(false);
    const { openAt, getAnchorRect } = cap.ctx;
    expect(openAt).toBeTypeOf('function');
    expect(getAnchorRect).toBeTypeOf('function');
    act(() => openAt?.(10, 20));
    expect(utils.getByTestId('open').textContent).toBe('true');
    expect(cap.ctx.pendingEdgeRef.current).toBe('first');
    expect(getAnchorRect?.()).toMatchObject({
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      right: 10,
      bottom: 20,
      width: 0,
      height: 0,
    });
  });

  it('without pointerAnchored, getAnchorRect and openAt are undefined', () => {
    const { cap } = renderCore({ ...BASE });
    expect(cap.ctx.getAnchorRect).toBeUndefined();
    expect(cap.ctx.openAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/use-menu-core.test.tsx`
Expected: FAIL — cannot resolve `'../menu/use-menu-core.js'` / `useMenuCore is not a function`.

- [ ] **Step 3: Create the hook**

Create `packages/ui/src/menu/use-menu-core.ts`:

```ts
import type { RefObject } from 'preact';
import { useCallback, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align, PositionState } from '../use-position.js';
import type { MenuContextValue } from './context.js';

export interface UseMenuCoreOptions {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Resolved values — each Root applies its own prop defaults before calling.
  side: Side;
  align: Align;
  offset: number;
  loop: boolean;
  typeahead: boolean;
  // Default: a hook-owned () => setOpen(false). SubmenuRoot passes parent.closeAll
  // so activating a nested item collapses the whole tree.
  closeAll?: () => void;
  // Default: null. SubmenuRoot passes parent.dismissId to link the dismiss tree.
  parentDismissId?: string | null;
  // ContextMenu only (default false): position against a captured pointer via a
  // virtual anchor and expose openAt(x, y).
  pointerAnchored?: boolean;
}

export interface MenuCore {
  menuCtx: MenuContextValue;
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  popupRef: RefObject<HTMLElement>;
  arrowRef: RefObject<HTMLElement>;
  pendingEdgeRef: RefObject<'first' | 'last'>;
  baseId: string;
  triggerId: string;
  popupId: string;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  position: PositionState;
  setPosition: (p: PositionState) => void;
}

export function useMenuCore(opts: UseMenuCoreOptions): MenuCore {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    side,
    align,
    offset,
    loop,
    typeahead,
    closeAll: closeAllProp,
    parentDismissId = null,
    pointerAnchored = false,
  } = opts;

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

  // closeAll defaults to closing this menu; a parent's closeAll is injected for
  // submenus. ownCloseAll is always created (hooks can't be conditional).
  const ownCloseAll = useCallback(() => setOpen(false), [setOpen]);
  const closeAll = closeAllProp ?? ownCloseAll;

  // Pointer-anchor machinery (ContextMenu): always created but only wired into
  // the context when pointerAnchored. The hook owns setOpen + pendingEdgeRef +
  // pointRef, so it can build openAt/getAnchorRect itself.
  const pointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const getAnchorRect = useCallback(() => {
    const { x, y } = pointRef.current;
    return { width: 0, height: 0, x, y, top: y, left: x, right: x, bottom: y };
  }, []);
  const openAt = useCallback(
    (x: number, y: number) => {
      pointRef.current = { x, y };
      pendingEdgeRef.current = 'first';
      setOpen(true);
    },
    [setOpen]
  );

  const menuCtx = useMemo<MenuContextValue>(
    () => ({
      open,
      setOpen,
      closeAll,
      dismissId: baseId,
      parentDismissId,
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
      getAnchorRect: pointerAnchored ? getAnchorRect : undefined,
      openAt: pointerAnchored ? openAt : undefined,
    }),
    [
      open,
      setOpen,
      closeAll,
      baseId,
      parentDismissId,
      activeId,
      side,
      align,
      offset,
      loop,
      typeahead,
      position,
      pointerAnchored,
      getAnchorRect,
      openAt,
    ]
  );

  return {
    menuCtx,
    open,
    setOpen,
    anchorRef,
    floatingRef,
    popupRef,
    arrowRef,
    pendingEdgeRef,
    baseId,
    triggerId,
    popupId,
    activeId,
    setActiveId,
    position,
    setPosition,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/use-menu-core.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Build + typecheck**

Run: `pnpm --filter '@hono-preact/*' build && pnpm typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/menu/use-menu-core.ts packages/ui/src/__tests__/use-menu-core.test.tsx
git commit -m "feat(ui): add useMenuCore hook (shared Menu Root context assembly)"
```

---

### Task 2: Refactor `MenuRoot` onto the hook

**Files:**
- Modify: `packages/ui/src/menu/menu.tsx`

- [ ] **Step 1: Replace `MenuRoot` and fix imports**

In `packages/ui/src/menu/menu.tsx`, replace the entire `MenuRoot` function (the `closeAll` `useCallback`, the refs, ids, `activeId`/`position` state, and the `ctx` `useMemo`) with:

```tsx
export function MenuRoot(props: MenuRootProps) {
  const {
    open,
    defaultOpen,
    onOpenChange,
    side = 'bottom',
    align = 'start',
    offset = 8,
    loop = true,
    typeahead = true,
    children,
  } = props;
  const core = useMenuCore({
    open,
    defaultOpen,
    onOpenChange,
    side,
    align,
    offset,
    loop,
    typeahead,
  });
  return h(MenuContext.Provider, { value: core.menuCtx }, children);
}
```

Then fix imports. Add:

```ts
import { useMenuCore } from './use-menu-core.js';
```

Remove the now-orphaned imports (MenuRoot was their only user in this file): from the `preact/hooks` import remove `useCallback`, `useRef`, `useState` (keep `useContext`, `useId`, `useLayoutEffect`, `useMemo` — all still used by other parts). From the `../use-position.js` type import remove `PositionState` (keep `Side`, `Align`). Keep `useControllableState` (used by `MenuCheckboxItem`/`MenuRadioGroup`).

- [ ] **Step 2: Typecheck (authority on imports)**

Run: `pnpm typecheck`
Expected: exit 0. If it flags an unused import or a missing symbol (`noUnusedLocals`), fix exactly what it names and re-run until clean.

- [ ] **Step 3: Run the Menu + ContextMenu tests (ContextMenu shares this file's parts indirectly; run both to be safe)**

Run: `pnpm exec vitest run packages/ui/src/__tests__/menu-structure.test.tsx packages/ui/src/__tests__/menu-navigation-dom.test.tsx packages/ui/src/__tests__/menu-trigger.test.tsx packages/ui/src/__tests__/menu-item.test.tsx packages/ui/src/__tests__/menu-checkable.test.tsx packages/ui/src/__tests__/menu-presence.test.tsx packages/ui/src/__tests__/menu-ssr.test.tsx packages/ui/src/__tests__/menu-submenu.test.tsx packages/ui/src/__tests__/menu-submenu-safe-area.test.tsx packages/ui/src/__tests__/context-menu.test.tsx`
Expected: PASS (behavior preserved).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/menu/menu.tsx
git commit -m "refactor(ui): MenuRoot onto useMenuCore"
```

---

### Task 3: Refactor `ContextMenuRoot` onto the hook

**Files:**
- Modify: `packages/ui/src/context-menu/context-menu.tsx`

- [ ] **Step 1: Replace `ContextMenuRoot` and fix imports**

In `packages/ui/src/context-menu/context-menu.tsx`, replace the entire `ContextMenuRoot` function (the refs, `pointRef`, ids, `activeId`/`position` state, `closeAll`, `getAnchorRect`, `openAt`, and the `ctx` `useMemo`) with:

```tsx
export function ContextMenuRoot(props: ContextMenuRootProps) {
  const {
    open,
    defaultOpen,
    onOpenChange,
    side = 'bottom',
    align = 'start',
    offset = 0,
    loop = true,
    typeahead = true,
    children,
  } = props;
  const core = useMenuCore({
    open,
    defaultOpen,
    onOpenChange,
    side,
    align,
    offset,
    loop,
    typeahead,
    pointerAnchored: true,
  });
  return h(MenuContext.Provider, { value: core.menuCtx }, children);
}
```

Then fix imports:
- Remove the entire `import { useCallback, useId, useMemo, useRef, useState } from 'preact/hooks';` line — after the refactor `ContextMenuTrigger` uses no `preact/hooks` (it uses `useMenuContext` + `useRender`).
- Remove `import { useControllableState } from '../use-controllable-state.js';`.
- From `import type { Side, Align, PositionState } from '../use-position.js';` remove `PositionState` (keep `Side`, `Align` — used by `ContextMenuRootProps`).
- Add: `import { useMenuCore } from '../menu/use-menu-core.js';`.
- Keep `import { h, type ComponentChildren, type JSX, type VNode } from 'preact';` and `import { MenuContext, useMenuContext } from '../menu/context.js';` (still used).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0. Fix any flagged import/symbol exactly and re-run.

- [ ] **Step 3: Run the ContextMenu tests**

Run: `pnpm exec vitest run packages/ui/src/__tests__/context-menu.test.tsx`
Expected: PASS (the pointer-anchor `openAt`/`getAnchorRect` now come from the hook).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/context-menu/context-menu.tsx
git commit -m "refactor(ui): ContextMenuRoot onto useMenuCore"
```

---

### Task 4: Refactor `SubmenuRoot` onto the hook

**Files:**
- Modify: `packages/ui/src/menu/submenu.tsx`

- [ ] **Step 1: Replace `SubmenuRoot` and fix imports**

In `packages/ui/src/menu/submenu.tsx`, replace the entire `SubmenuRoot` function. Keep the submenu-only machinery (the hover open-timer and the `submenuCtx`); drop the shared setup (`useControllableState`, the five refs, `baseId`/ids, `activeId`/`position` state) and the `menuCtx` `useMemo`:

```tsx
export function SubmenuRoot(props: SubmenuRootProps) {
  const {
    open,
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

  const core = useMenuCore({
    open,
    defaultOpen,
    onOpenChange,
    side,
    align,
    offset,
    loop: parent.loop,
    typeahead: parent.typeahead,
    closeAll: parent.closeAll,
    parentDismissId: parent.dismissId,
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
    openTimer.current = setTimeout(() => core.setOpen(true), openDelay);
  }, [cancelOpen, core.setOpen, openDelay]);
  // Clear a pending open if the SubmenuRoot unmounts mid-delay.
  useEffect(() => cancelOpen, [cancelOpen]);

  const submenuCtx = useMemo<SubmenuContextValue>(
    () => ({
      menuCtx: core.menuCtx,
      open: core.open,
      setOpen: core.setOpen,
      triggerId: core.triggerId,
      popupId: core.popupId,
      anchorRef: core.anchorRef,
      floatingRef: core.floatingRef,
      pendingEdgeRef: core.pendingEdgeRef,
      scheduleOpen,
      cancelOpen,
      closeDelay,
    }),
    [
      core.menuCtx,
      core.open,
      core.setOpen,
      core.triggerId,
      core.popupId,
      scheduleOpen,
      cancelOpen,
      closeDelay,
    ]
  );

  return h(SubmenuContext.Provider, { value: submenuCtx }, children);
}
```

Then fix imports. Add:

```ts
import { useMenuCore } from './use-menu-core.js';
```

Remove the now-orphaned imports: `import { useControllableState } from '../use-controllable-state.js';` (only `SubmenuRoot` used it); from the `preact/hooks` import remove `useId` and `useState` (keep `useCallback`, `useContext`, `useEffect`, `useMemo`, `useRef` — all still used by the timer / `submenuCtx` / `SubmenuTrigger`). From `import type { Side, Align, PositionState } from '../use-position.js';` remove `PositionState` (keep `Side`, `Align`). Keep the `type MenuContextValue` import from `./context.js` (the `SubmenuContextValue` interface still references it).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0. Fix any flagged import/symbol exactly and re-run.

- [ ] **Step 3: Run the Submenu tests**

Run: `pnpm exec vitest run packages/ui/src/__tests__/menu-submenu.test.tsx packages/ui/src/__tests__/menu-submenu-safe-area.test.tsx packages/ui/src/__tests__/menu-structure.test.tsx`
Expected: PASS (the hover timer + submenu nesting behavior preserved).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/menu/submenu.tsx
git commit -m "refactor(ui): SubmenuRoot onto useMenuCore"
```

---

### Task 5: Full CI mirror + PR

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

If `format:check` fails, run `pnpm format`, re-run `format:check`, and commit:

```bash
git add -A && git commit -m "chore(ui): pnpm format"
```

Expected: all pass. `pnpm test` should report the full unit suite green including the new `use-menu-core.test.tsx` (5 tests) and all menu/submenu/context-menu suites.

- [ ] **Step 2: Confirm scope**

Run: `git diff main...HEAD --stat`
Expected: `use-menu-core.ts` + its test added; `menu.tsx` / `submenu.tsx` / `context-menu.tsx` each net-reduced (Root setup + assembly removed). No `index.ts` / `client-size-config.mjs` / `client-size-report.json` changes.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/ui-menu-core-dedup
gh pr create --base main --head feat/ui-menu-core-dedup \
  --title "refactor(ui): dedup the 3 Menu Roots into useMenuCore" \
  --body "<summarize: useMenuCore hook extraction, MenuRoot/ContextMenuRoot/SubmenuRoot collapsed onto it, pointer-anchor machinery (openAt/getAnchorRect) moved into the hook behind a pointerAnchored flag, behavior-preserving pure dedup, full CI mirror green>"
```

---

## Notes for the implementer

- **Keep tests green at every task.** This is a behavior-preserving refactor. If any menu/submenu/context-menu test goes red after its Root refactor, the refactor diverged, compare against `git show main:packages/ui/src/<file>` and reconcile before committing.
- **Imports:** `noUnusedLocals` is on, so `pnpm typecheck` is the authority. The per-task import guidance above is the expected set, but always let typecheck confirm and name anything missed.
- **Do not add `use-menu-core` to the size config or regenerate baselines.**
- The `SubmenuRoot` `submenuCtx` `useMemo` dep array intentionally omits the stable refs (`anchorRef`/`floatingRef`/`pendingEdgeRef`) — they are present in the object body but not the deps, matching the pre-PR code (stable `RefObject`s).

---

## Self-review

**Spec coverage:**
- `useMenuCore` hook owning controllable-state + setup + closeAll default + pointer machinery + assembly (spec §Design/The hook) → Task 1. ✔
- Pointer-anchor wrinkle resolved via the hook owning setOpen/pendingEdgeRef/pointRef, gated by `pointerAnchored` (spec §Design + §Open questions) → Task 1 hook body + Task 3 ContextMenu. ✔
- Each Root collapse with the right per-Root opts (spec §Design/Each Root + variation table): MenuRoot (defaults, no flags) → Task 2; ContextMenuRoot (`pointerAnchored: true`, offset 0) → Task 3; SubmenuRoot (`closeAll: parent.closeAll`, `parentDismissId: parent.dismissId`, `loop`/`typeahead` from parent, keeps timer + submenuCtx) → Task 4. ✔
- Submenu hover timer + `submenuCtx` stay component-specific (spec §Non-goals) → Task 4 preserves them. ✔
- Testing: existing suites stay green + new direct hook test (spec §Testing) → Tasks 2-4 run the suites; Task 1 adds `use-menu-core.test.tsx`; Task 5 full suite. ✔
- No `index.ts`/size-config change (spec §Files) → File structure note + Task 5 Step 2 check. ✔

**Placeholder scan:** No TBD/TODO. Import-cleanup steps name the exact symbols to add/remove, with typecheck as the deterministic verifier; no code step omits its code.

**Type consistency:** `useMenuCore`/`UseMenuCoreOptions`/`MenuCore` names match across Task 1 and every call site (Tasks 2-4). Opts (`open`/`defaultOpen`/`onOpenChange`/`side`/`align`/`offset`/`loop`/`typeahead`/`closeAll?`/`parentDismissId?`/`pointerAnchored?`) match every Root's call. Return fields (`menuCtx`, `open`, `setOpen`, the four refs + `pendingEdgeRef`, `baseId`/`triggerId`/`popupId`, `activeId`/`setActiveId`, `position`/`setPosition`) match `SubmenuRoot`'s usage in Task 4. `MenuContextValue` shape (from `menu/context.ts`) unchanged.
