# usePresence Exit Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `usePresence` primitive built on `Element.getAnimations()` to `@hono-preact/ui` and wire it into all seven overlay components so they animate out as they close.

**Architecture:** A single hook runs a phase state machine (`open` → `closing` → `closed`). On close it keeps the element mounted/shown, lets the `[data-state="closed"]` CSS exit animation run, awaits `getAnimations({subtree:true}).finished` (raced against a timeout), then finalizes (unmount for custom overlays; `close()` via `onExitComplete` for the native dialog). Animation is opt-in CSS, so a consumer with no closing rule gets an empty animation set and finalizes synchronously, i.e. today's behavior.

**Tech Stack:** Preact (`preact/hooks`), TypeScript, Vitest + `@testing-library/preact` (happy-dom), the existing `mergeRefs` helper.

**Spec:** `docs/superpowers/specs/2026-06-08-use-presence-exit-animations-design.md`

**Base branch:** Build on a branch off `origin/main` (commit `3c2c0f5` or later) so the Combobox source is present. The spec commit (`52c22aa`) is local/unpushed on `main`; carry it onto the feature branch (cherry-pick) or push it so it rides the PR.

---

## File Structure

**Created:**
- `packages/ui/src/use-presence.ts` — the hook + its phase state machine.
- `packages/ui/src/__tests__/use-presence.test.tsx` — unit tests.
- `packages/ui/src/__tests__/presence-helpers.ts` — shared `getAnimations` mock (not a `.test.*` file, so not collected as a suite; reused by integration tests).
- `apps/site/src/pages/docs/components/use-presence.mdx` — Foundations docs page.
- `apps/site/src/components/docs/UsePresenceDemo.tsx` — live demo for the docs page.

**Modified (one edit each, integration):**
- `packages/ui/src/dialog/dialog.tsx` — defer `close()` to `onExitComplete`; intercept `cancel`.
- `packages/ui/src/popover/popover.tsx` — `PopoverPositioner`.
- `packages/ui/src/tooltip/tooltip.tsx` — `TooltipPositioner`.
- `packages/ui/src/menu/menu.tsx` — `MenuPositioner` (covers Menu, Submenu, ContextMenu).
- `packages/ui/src/select/select.tsx` — `SelectPositioner`.
- `packages/ui/src/combobox/combobox.tsx` — `ComboboxPositioner`.

**Modified (wiring/docs):**
- `packages/ui/src/index.ts` — export `usePresence`.
- `scripts/client-size-config.mjs` — `UI_CORE_MODULES` + `CHUNK_PREFIXES`.
- `apps/site/src/pages/docs/nav.ts` — Foundations nav entry.
- `apps/site/src/styles/root.css` — exit-animation CSS for the seven demos.
- The seven component `.mdx` pages — exit rule in each `## Styling` CSS tab.

---

## Task 1: The `usePresence` primitive

**Files:**
- Create: `packages/ui/src/use-presence.ts`
- Create: `packages/ui/src/__tests__/presence-helpers.ts`
- Create: `packages/ui/src/__tests__/use-presence.test.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Write the test helper (the `getAnimations` mock)**

Create `packages/ui/src/__tests__/presence-helpers.ts`:

```ts
import { vi } from 'vitest';

// A controllable stand-in for a CSS Animation. happy-dom has no getAnimations,
// so usePresence finalizes instantly there unless we install fakes like these.
export interface FakeAnimation {
  finished: Promise<void>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
  effect: { getComputedTiming: () => { endTime: number; iterations: number } };
}

export function makeAnimation(opts: { endTime?: number; iterations?: number } = {}): FakeAnimation {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const finished = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = (reason?: unknown) => rej(reason);
  });
  // Swallow rejection so an unresolved/abandoned animation never logs an
  // unhandled rejection in the test runner.
  finished.catch(() => {});
  return {
    finished,
    resolve,
    reject,
    effect: {
      getComputedTiming: () => ({
        endTime: opts.endTime ?? 200,
        iterations: opts.iterations ?? 1,
      }),
    },
  };
}

// Install a getAnimations() on Element.prototype that returns the given fakes.
// Test-only DOM-API stub: the structural mismatch with the real Animation type
// is an accepted mock boundary. Returns a restore() to remove it.
export function installGetAnimations(animations: FakeAnimation[]): () => void {
  const value = vi.fn(() => animations);
  Object.defineProperty(Element.prototype, 'getAnimations', {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    Reflect.deleteProperty(Element.prototype, 'getAnimations');
  };
}

// Force matchMedia('(prefers-reduced-motion: reduce)') to a fixed result.
export function installReducedMotion(matches: boolean): () => void {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
    configurable: true,
    writable: true,
  });
  return () => {
    Object.defineProperty(window, 'matchMedia', {
      value: original,
      configurable: true,
      writable: true,
    });
  };
}
```

- [ ] **Step 2: Write the failing unit tests**

Create `packages/ui/src/__tests__/use-presence.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { usePresence } from '../use-presence.js';
import {
  makeAnimation,
  installGetAnimations,
  installReducedMotion,
} from './presence-helpers.js';

afterEach(cleanup);

function Harness({
  present,
  onExitComplete,
}: {
  present: boolean;
  onExitComplete?: () => void;
}) {
  const p = usePresence(present, { onExitComplete });
  return (
    <div>
      <span data-testid="status">{p.status}</span>
      {p.isPresent ? (
        <div
          ref={p.ref}
          data-testid="box"
          data-state={p.status === 'open' ? 'open' : 'closed'}
        />
      ) : null}
    </div>
  );
}

const flush = () => act(async () => {});

describe('usePresence', () => {
  it('renders open immediately when present is true', () => {
    const { getByTestId } = render(<Harness present />);
    expect(getByTestId('status').textContent).toBe('open');
    expect(getByTestId('box').getAttribute('data-state')).toBe('open');
  });

  it('renders nothing when present is false on first mount (no exit on mount)', () => {
    const { getByTestId, queryByTestId } = render(<Harness present={false} />);
    expect(getByTestId('status').textContent).toBe('closed');
    expect(queryByTestId('box')).toBeNull();
  });

  it('finalizes synchronously when there is no animation (empty set)', async () => {
    const restore = installGetAnimations([]);
    const { rerender, queryByTestId } = render(<Harness present />);
    await act(async () => rerender(<Harness present={false} />));
    expect(queryByTestId('box')).toBeNull();
    restore();
  });

  it('stays present in closing while an animation runs, then unmounts', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const { rerender, getByTestId, queryByTestId } = render(<Harness present />);
    await act(async () => rerender(<Harness present={false} />));
    // Still mounted, marked closing/closed for the exit CSS.
    expect(getByTestId('status').textContent).toBe('closing');
    expect(getByTestId('box').getAttribute('data-state')).toBe('closed');
    await act(async () => {
      anim.resolve();
    });
    expect(queryByTestId('box')).toBeNull();
    restore();
  });

  it('fires onExitComplete before unmounting', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const seenWhileMounted: boolean[] = [];
    const onExitComplete = vi.fn(() => {
      seenWhileMounted.push(document.querySelector('[data-testid="box"]') != null);
    });
    const { rerender } = render(<Harness present onExitComplete={onExitComplete} />);
    await act(async () => rerender(<Harness present={false} onExitComplete={onExitComplete} />));
    await act(async () => {
      anim.resolve();
    });
    expect(onExitComplete).toHaveBeenCalledTimes(1);
    // The box was still in the DOM at the moment onExitComplete ran.
    expect(seenWhileMounted).toEqual([true]);
    restore();
  });

  it('cancels the exit and stays open when reopened mid-exit', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const { rerender, getByTestId } = render(<Harness present />);
    await act(async () => rerender(<Harness present={false} />));
    expect(getByTestId('status').textContent).toBe('closing');
    await act(async () => rerender(<Harness present />)); // reopen
    expect(getByTestId('status').textContent).toBe('open');
    // Resolving the stale animation must not unmount.
    await act(async () => {
      anim.resolve();
    });
    expect(getByTestId('box').getAttribute('data-state')).toBe('open');
    restore();
  });

  it('finalizes synchronously under prefers-reduced-motion', async () => {
    const anim = makeAnimation();
    const restoreAnim = installGetAnimations([anim]);
    const restoreRM = installReducedMotion(true);
    const { rerender, queryByTestId } = render(<Harness present />);
    await act(async () => rerender(<Harness present={false} />));
    expect(queryByTestId('box')).toBeNull(); // did not wait for anim
    restoreRM();
    restoreAnim();
  });

  it('ignores infinite-iteration animations (treats as empty)', async () => {
    const anim = makeAnimation({ iterations: Infinity });
    const restore = installGetAnimations([anim]);
    const { rerender, queryByTestId } = render(<Harness present />);
    await act(async () => rerender(<Harness present={false} />));
    expect(queryByTestId('box')).toBeNull();
    restore();
  });

  it('finalizes via the timeout when an animation never resolves', async () => {
    vi.useFakeTimers();
    const anim = makeAnimation({ endTime: 200 });
    const restore = installGetAnimations([anim]);
    const { rerender, queryByTestId } = render(<Harness present />);
    rerender(<Harness present={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(queryByTestId('box')).toBeNull();
    restore();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/ui/src/__tests__/use-presence.test.tsx`
Expected: FAIL — `Failed to resolve import "../use-presence.js"` (the module does not exist yet).

- [ ] **Step 4: Implement the hook**

Create `packages/ui/src/use-presence.ts`:

```ts
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';

export type PresenceStatus = 'open' | 'closing' | 'closed';

export interface UsePresenceOptions {
  // Fires when the exit animation resolves, immediately before isPresent flips
  // false. Dialog passes close() here so native focus return runs before unmount.
  onExitComplete?: () => void;
  // Hard cap (ms) on the exit-timeout race; guards a stuck or under-reported
  // animation, or a backgrounded tab. Default 3000.
  timeoutCap?: number;
}

export interface UsePresenceResult {
  // Render the element while true (open OR animating out).
  isPresent: boolean;
  // 'open' | 'closing' | 'closed'. Map to data-state: closing -> "closed".
  status: PresenceStatus;
  // Attach to the element carrying the exit transition. Merge with the
  // component's own ref via mergeRefs.
  ref: (node: Element | null) => void;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function exitTimeout(animations: Animation[], cap: number): number {
  let max = 0;
  for (const a of animations) {
    const timing = a.effect?.getComputedTiming();
    const end = typeof timing?.endTime === 'number' ? timing.endTime : 0;
    if (end > max) max = end;
  }
  return Math.min(max > 0 ? max + 100 : cap, cap);
}

export function usePresence(
  present: boolean,
  options: UsePresenceOptions = {}
): UsePresenceResult {
  const { onExitComplete, timeoutCap = 3000 } = options;

  const [status, setStatus] = useState<PresenceStatus>(
    present ? 'open' : 'closed'
  );

  const nodeRef = useRef<Element | null>(null);
  const prevPresent = useRef(present);
  const genRef = useRef(0);

  // Keep the latest callback/cap without re-running the exit effect.
  const onExitCompleteRef = useRef(onExitComplete);
  onExitCompleteRef.current = onExitComplete;
  const timeoutCapRef = useRef(timeoutCap);
  timeoutCapRef.current = timeoutCap;

  const ref = useCallback((node: Element | null) => {
    nodeRef.current = node;
  }, []);

  // React to present transitions. On first mount prevPresent === present, so
  // this never produces a 'closing' on the initial render (no exit on mount/SSR).
  useLayoutEffect(() => {
    if (present === prevPresent.current) return;
    prevPresent.current = present;
    genRef.current++;
    setStatus(present ? 'open' : 'closing');
  }, [present]);

  // Entering 'closing' runs this AFTER the data-state=closed render commits, so
  // the exit animation is live in the DOM when we read it.
  useLayoutEffect(() => {
    if (status !== 'closing') return;
    const myGen = genRef.current;
    const node = nodeRef.current;

    const finalize = () => {
      if (genRef.current !== myGen) return; // reopened mid-exit; abandon
      onExitCompleteRef.current?.();
      setStatus('closed');
    };

    if (
      !node ||
      typeof node.getAnimations !== 'function' ||
      prefersReducedMotion()
    ) {
      finalize();
      return;
    }

    // Forced reflow so the just-applied closed-state styles register as an
    // animation/transition. Use getBoundingClientRect (Element) to avoid a cast;
    // never rAF (throttled/paused in background tabs).
    node.getBoundingClientRect();

    const animations = node
      .getAnimations({ subtree: true })
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);

    if (animations.length === 0) {
      finalize();
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, exitTimeout(animations, timeoutCapRef.current));
    });
    void Promise.race([
      Promise.allSettled(animations.map((a) => a.finished)),
      timeout,
    ]).then(() => {
      if (timer !== undefined) clearTimeout(timer);
      finalize();
    });

    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [status]);

  return {
    isPresent: present || status === 'closing',
    status,
    ref,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/ui/src/__tests__/use-presence.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 6: Export from the package barrel**

In `packages/ui/src/index.ts`, after the `useFocusReturn` export (currently lines 17-20) and before `useSafeArea` (line 21), add:

```ts
export {
  usePresence,
  type UsePresenceOptions,
  type UsePresenceResult,
  type PresenceStatus,
} from './use-presence.js';
```

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter '@hono-preact/*' build && pnpm typecheck`
Expected: no errors.

```bash
git add packages/ui/src/use-presence.ts packages/ui/src/__tests__/use-presence.test.tsx packages/ui/src/__tests__/presence-helpers.ts packages/ui/src/index.ts
git commit -m "feat(ui): usePresence exit-animation primitive

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Dialog integration (validator)

Dialog keeps the native `<dialog>` mounted and finalizes via `close()`. We move the `close()` out of the open-effect and into `onExitComplete`, keep `showModal()`, intercept the native `cancel` (Esc) so it animates, and merge `presence.ref` onto the dialog.

**Files:**
- Modify: `packages/ui/src/dialog/dialog.tsx`
- Test: `packages/ui/src/__tests__/dialog-presence.test.tsx` (create)

- [ ] **Step 1: Write the failing integration test**

Create `packages/ui/src/__tests__/dialog-presence.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Dialog } from '../dialog/index.js';
import {
  makeAnimation,
  installGetAnimations,
} from './presence-helpers.js';

afterEach(cleanup);

function Setup() {
  return (
    <Dialog.Root>
      <Dialog.Trigger>open</Dialog.Trigger>
      <Dialog.Popup data-testid="dlg">
        <Dialog.Title>Title</Dialog.Title>
        <Dialog.Close>close</Dialog.Close>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

describe('Dialog exit animation', () => {
  it('defers close() until the exit animation resolves', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const { getByText, getByTestId } = render(<Setup />);
    await act(async () => fireEvent.click(getByText('open')));
    const dlg = getByTestId('dlg') as HTMLDialogElement;
    expect(dlg.open).toBe(true);

    await act(async () => fireEvent.click(getByText('close')));
    // Still open (deferred), marked closed for the exit CSS.
    expect(dlg.open).toBe(true);
    expect(dlg.getAttribute('data-state')).toBe('closed');

    await act(async () => {
      anim.resolve();
    });
    expect(dlg.open).toBe(false);
    restore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/dialog-presence.test.tsx`
Expected: FAIL — `dlg.open` is `false` right after the close click (close is not deferred yet).

- [ ] **Step 3: Edit `dialog.tsx` — imports**

At the top of `packages/ui/src/dialog/dialog.tsx`, add `mergeRefs` and `usePresence` imports after the existing `useControllableState` import (line 12):

```ts
import { mergeRefs } from '../merge-refs.js';
import { usePresence } from '../use-presence.js';
```

- [ ] **Step 4: Edit `DialogPopup` — defer close(), add presence + cancel interception**

In `DialogPopup`, after the `openRef` block (lines 145-146) add the presence hook:

```ts
  const presence = usePresence(ctx.open, {
    onExitComplete: () => ctx.dialogRef.current?.close(),
  });
```

Replace the open-effect (current lines 150-155) so it only opens (the `close()` now runs in `onExitComplete` after the exit animation):

```ts
  // Open imperatively; the close is deferred to the exit animation
  // (usePresence.onExitComplete), so the dialog stays in the top layer with
  // inert/focus-trap/::backdrop intact while it animates out.
  useLayoutEffect(() => {
    const el = ctx.dialogRef.current;
    if (!el) return;
    if (ctx.open && !el.open) el.showModal();
  }, [ctx.open]);
```

After the existing native-`close` listener effect (current lines 161-169), add a `cancel` interceptor so Esc routes through the animated close instead of the native instant close:

```ts
  // Esc fires `cancel` then natively closes instantly. Intercept it and route
  // through state so the close animates like every other close path.
  useEffect(() => {
    const el = ctx.dialogRef.current;
    if (!el) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      ctx.setOpen(false);
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [ctx.setOpen]);
```

In the `useRender` props (current line 184), merge the presence ref onto the dialog:

```ts
      ref: mergeRefs(ctx.dialogRef, presence.ref),
```

(The `data-state` line stays `ctx.open ? 'open' : 'closed'` — `ctx.open` is already false during the exit, so it renders `"closed"`. An external `close()` / `method="dialog"` submit still fires the existing `close` listener, which sets state false; the dialog is already closed so `getAnimations` is empty and finalize is instant.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/dialog-presence.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full Dialog suite (no regressions)**

Run: `pnpm exec vitest run dialog`
Expected: PASS (existing Dialog tests still green).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/dialog/dialog.tsx packages/ui/src/__tests__/dialog-presence.test.tsx
git commit -m "feat(ui): animate Dialog out via usePresence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Popover integration

`PopoverPositioner` is mount-on-open. Drive the mount gate, the `showPopover` effect, and `usePosition` off `presence.isPresent` so the popup stays positioned and in the top layer through the exit; merge `presence.ref` onto `floatingRef`. `data-state` (on the Popup) stays keyed to `ctx.open`.

**Files:**
- Modify: `packages/ui/src/popover/popover.tsx`
- Test: `packages/ui/src/__tests__/popover-presence.test.tsx` (create)

- [ ] **Step 1: Write the failing integration test**

Create `packages/ui/src/__tests__/popover-presence.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Popover } from '../popover/index.js';
import {
  makeAnimation,
  installGetAnimations,
} from './presence-helpers.js';

afterEach(cleanup);

function Setup() {
  return (
    <Popover.Root>
      <Popover.Trigger>open</Popover.Trigger>
      <Popover.Positioner>
        <Popover.Popup data-testid="pop">hi</Popover.Popup>
      </Popover.Positioner>
    </Popover.Root>
  );
}

describe('Popover exit animation', () => {
  it('keeps the popup mounted through the exit, then unmounts', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const { getByText, queryByTestId } = render(<Setup />);
    await act(async () => fireEvent.click(getByText('open')));
    expect(queryByTestId('pop')).not.toBeNull();

    await act(async () => fireEvent.click(getByText('open'))); // toggle closed
    // Still mounted, marked closed for the exit CSS.
    expect(queryByTestId('pop')).not.toBeNull();
    expect(queryByTestId('pop')!.getAttribute('data-state')).toBe('closed');

    await act(async () => {
      anim.resolve();
    });
    expect(queryByTestId('pop')).toBeNull();
    restore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/popover-presence.test.tsx`
Expected: FAIL — the popup unmounts immediately on close (no closing phase yet).

- [ ] **Step 3: Edit imports**

In `packages/ui/src/popover/popover.tsx`, add after the `useControllableState` import (line 15):

```ts
import { mergeRefs } from '../merge-refs.js';
import { usePresence } from '../use-presence.js';
```

- [ ] **Step 4: Edit `PopoverPositioner`**

At the top of `PopoverPositioner` (after `const ctx = usePopoverContext('Positioner');`, line 174), add:

```ts
  const presence = usePresence(ctx.open);
```

Change the `usePosition` call (line 176-184) `open` argument from `ctx.open` to `presence.isPresent`:

```ts
  const position = usePosition({
    open: presence.isPresent,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
  });
```

Change the `showPopover` effect (lines 193-205) to key on `presence.isPresent`:

```ts
  useLayoutEffect(() => {
    const el = ctx.floatingRef.current;
    if (!presence.isPresent || !el || !supportsPopover(el)) return;
    el.setAttribute('popover', 'manual');
    el.showPopover();
    return () => {
      el.hidePopover();
      el.removeAttribute('popover');
    };
  }, [presence.isPresent]);
```

Change the mount gate (line 207):

```ts
  if (!presence.isPresent) return null;
```

In the `useRender` props (line 212-213), merge the presence ref onto `floatingRef`:

```ts
      ref: mergeRefs(ctx.floatingRef, presence.ref),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/popover-presence.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full Popover suite**

Run: `pnpm exec vitest run popover`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/popover/popover.tsx packages/ui/src/__tests__/popover-presence.test.tsx
git commit -m "feat(ui): animate Popover out via usePresence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Tooltip integration

Identical pattern to Popover, in `TooltipPositioner`.

**Files:**
- Modify: `packages/ui/src/tooltip/tooltip.tsx`
- Test: `packages/ui/src/__tests__/tooltip-presence.test.tsx` (create)

- [ ] **Step 1: Write the failing integration test**

Create `packages/ui/src/__tests__/tooltip-presence.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Tooltip } from '../tooltip/index.js';
import {
  makeAnimation,
  installGetAnimations,
} from './presence-helpers.js';

afterEach(cleanup);

function Setup() {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger>hover</Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Popup data-testid="tip">hi</Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}

describe('Tooltip exit animation', () => {
  it('keeps the popup mounted through the exit, then unmounts', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const { getByText, queryByTestId } = render(<Setup />);
    await act(async () => fireEvent.focus(getByText('hover')));
    expect(queryByTestId('tip')).not.toBeNull();

    await act(async () => fireEvent.blur(getByText('hover')));
    expect(queryByTestId('tip')).not.toBeNull();
    expect(queryByTestId('tip')!.getAttribute('data-state')).toBe('closed');

    await act(async () => {
      anim.resolve();
    });
    expect(queryByTestId('tip')).toBeNull();
    restore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/tooltip-presence.test.tsx`
Expected: FAIL — the tooltip unmounts immediately on blur.

- [ ] **Step 3: Edit imports**

In `packages/ui/src/tooltip/tooltip.tsx`, add (after the existing render/state imports, matching Popover's import block):

```ts
import { mergeRefs } from '../merge-refs.js';
import { usePresence } from '../use-presence.js';
```

- [ ] **Step 4: Edit `TooltipPositioner`**

After `const ctx = useTooltipContext('Positioner');` add:

```ts
  const presence = usePresence(ctx.open);
```

If `TooltipPositioner` calls `usePosition`, change its `open` argument from `ctx.open` to `presence.isPresent` (same as Popover Step 4).

Change the `showPopover` effect (lines 213-225) to key on `presence.isPresent`:

```ts
  useLayoutEffect(() => {
    const el = ctx.floatingRef.current;
    if (!presence.isPresent || !el || !supportsPopover(el)) return;
    el.setAttribute('popover', 'manual');
    el.showPopover();
    return () => {
      el.hidePopover();
      el.removeAttribute('popover');
    };
  }, [presence.isPresent]);
```

Change the mount gate (line 227):

```ts
  if (!presence.isPresent) return null;
```

In the `useRender` props, merge the presence ref onto `floatingRef`:

```ts
      ref: mergeRefs(ctx.floatingRef, presence.ref),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/tooltip-presence.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full Tooltip suite**

Run: `pnpm exec vitest run tooltip`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/tooltip/tooltip.tsx packages/ui/src/__tests__/tooltip-presence.test.tsx
git commit -m "feat(ui): animate Tooltip out via usePresence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Menu family integration (Menu + Submenu + ContextMenu)

Submenu wraps `MenuPositioner` with its own context, and ContextMenu provides a `MenuContext` the consumer composes with `MenuPositioner`. So editing `MenuPositioner` once covers all three; `ctx.open` is the right open state for each (submenu's is `sub.open` via `menuCtx`).

**Files:**
- Modify: `packages/ui/src/menu/menu.tsx`
- Test: `packages/ui/src/__tests__/menu-presence.test.tsx` (create)

- [ ] **Step 1: Write the failing integration test**

Create `packages/ui/src/__tests__/menu-presence.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Menu } from '../menu/index.js';
import {
  makeAnimation,
  installGetAnimations,
} from './presence-helpers.js';

afterEach(cleanup);

function Setup() {
  return (
    <Menu.Root>
      <Menu.Trigger>open</Menu.Trigger>
      <Menu.Positioner>
        <Menu.Popup data-testid="menu">
          <Menu.Item>One</Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Root>
  );
}

describe('Menu exit animation', () => {
  it('keeps the popup mounted through the exit, then unmounts', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const { getByText, queryByTestId } = render(<Setup />);
    await act(async () => fireEvent.click(getByText('open')));
    expect(queryByTestId('menu')).not.toBeNull();

    await act(async () => fireEvent.click(getByText('open'))); // toggle closed
    expect(queryByTestId('menu')).not.toBeNull();
    expect(queryByTestId('menu')!.getAttribute('data-state')).toBe('closed');

    await act(async () => {
      anim.resolve();
    });
    expect(queryByTestId('menu')).toBeNull();
    restore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/menu-presence.test.tsx`
Expected: FAIL — the menu unmounts immediately on close.

- [ ] **Step 3: Edit imports**

In `packages/ui/src/menu/menu.tsx`, add (matching the existing import block):

```ts
import { mergeRefs } from '../merge-refs.js';
import { usePresence } from '../use-presence.js';
```

- [ ] **Step 4: Edit `MenuPositioner`**

After `const ctx = useMenuContext('Positioner');` (near the top of `MenuPositioner`), add:

```ts
  const presence = usePresence(ctx.open);
```

If `MenuPositioner` calls `usePosition`, change its `open` argument from `ctx.open` to `presence.isPresent`.

Change the `showPopover` effect (lines 273-285) to key on `presence.isPresent`:

```ts
  useLayoutEffect(() => {
    const el = ctx.floatingRef.current;
    if (!presence.isPresent || !el || !supportsPopover(el)) return;
    el.setAttribute('popover', 'manual');
    el.showPopover();
    return () => {
      el.hidePopover();
      el.removeAttribute('popover');
    };
  }, [presence.isPresent]);
```

Change the mount gate (line 287):

```ts
  if (!presence.isPresent) return null;
```

In the `useRender` props, merge the presence ref onto `floatingRef`:

```ts
      ref: mergeRefs(ctx.floatingRef, presence.ref),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/menu-presence.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the Menu, Submenu, and ContextMenu suites (all three ride MenuPositioner)**

Run: `pnpm exec vitest run menu`
Expected: PASS (the `menu` filter also matches `context-menu` and submenu test files).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/menu/menu.tsx packages/ui/src/__tests__/menu-presence.test.tsx
git commit -m "feat(ui): animate Menu/Submenu/ContextMenu out via usePresence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Select integration

`SelectPositioner` keeps the listbox always-mounted and toggles `hidden` (for label registration). Drive `hidden` off `presence.isPresent` (visible through the exit, hidden on finalize), key `showPopover` on `presence.isPresent`, and merge `presence.ref` onto `floatingRef`. `data-state` (on `SelectPopup`) stays keyed to `ctx.open`. There is no mount gate to change.

**Files:**
- Modify: `packages/ui/src/select/select.tsx`
- Test: `packages/ui/src/__tests__/select-presence.test.tsx` (create)

- [ ] **Step 1: Write the failing integration test**

Create `packages/ui/src/__tests__/select-presence.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Select } from '../select/index.js';
import {
  makeAnimation,
  installGetAnimations,
} from './presence-helpers.js';

afterEach(cleanup);

function Setup() {
  return (
    <Select.Root>
      <Select.Trigger>
        <Select.Value placeholder="Pick" />
      </Select.Trigger>
      <Select.Positioner>
        <Select.Popup data-testid="lb">
          <Select.Option value="a">A</Select.Option>
        </Select.Popup>
      </Select.Positioner>
    </Select.Root>
  );
}

describe('Select exit animation', () => {
  it('keeps the listbox visible through the exit, then hides it', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const { getByTestId, getByRole } = render(<Setup />);
    await act(async () => fireEvent.click(getByRole('combobox')));
    const lb = getByTestId('lb');
    expect(lb.hidden).toBe(false);

    await act(async () => fireEvent.click(getByRole('combobox'))); // toggle closed
    // Still visible (animating), marked closed for the exit CSS.
    expect(lb.hidden).toBe(false);
    expect(lb.getAttribute('data-state')).toBe('closed');

    await act(async () => {
      anim.resolve();
    });
    expect(lb.hidden).toBe(true);
    restore();
  });
});
```

(If `getByRole('combobox')` does not resolve the trigger in this setup, query the trigger by its text/testid instead; the Select trigger has `role="combobox"` per the listbox-select ARIA pattern.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/select-presence.test.tsx`
Expected: FAIL — `lb.hidden` becomes `true` immediately on close.

- [ ] **Step 3: Edit imports**

In `packages/ui/src/select/select.tsx`, add (matching the existing import block):

```ts
import { mergeRefs } from '../merge-refs.js';
import { usePresence } from '../use-presence.js';
```

(`mergeRefs` may already be imported for the listbox ref; if so, do not duplicate it.)

- [ ] **Step 4: Edit `SelectPositioner`**

After `const ctx = useSelectContext('Positioner');` (near the top of `SelectPositioner`), add:

```ts
  const presence = usePresence(ctx.open);
```

If `SelectPositioner` calls `usePosition`, change its `open` argument from `ctx.open` to `presence.isPresent`.

Change the `showPopover` effect (lines 320-329) to key on `presence.isPresent`:

```ts
  useLayoutEffect(() => {
    const el = ctx.floatingRef.current;
    if (!presence.isPresent || !el || !supportsPopover(el)) return;
    el.setAttribute('popover', 'manual');
    el.showPopover();
    return () => {
      el.hidePopover();
      el.removeAttribute('popover');
    };
  }, [presence.isPresent]);
```

Change the `hidden` attribute (line 340) from `ctx.open` to `presence.isPresent`:

```ts
      hidden: presence.isPresent ? undefined : true,
```

In the `useRender` props for the Positioner element, merge the presence ref onto `floatingRef`. If the element already passes `ref: ctx.floatingRef`, change it to:

```ts
      ref: mergeRefs(ctx.floatingRef, presence.ref),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/select-presence.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full Select suite**

Run: `pnpm exec vitest run select`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/select/select.tsx packages/ui/src/__tests__/select-presence.test.tsx
git commit -m "feat(ui): animate Select listbox out via usePresence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Combobox integration

Same always-mounted/`hidden` pattern as Select. Combobox calls `showPopover()` **unconditionally** (no `supportsPopover` guard, by design); preserve that and only re-key the effect.

**Files:**
- Modify: `packages/ui/src/combobox/combobox.tsx`
- Test: `packages/ui/src/__tests__/combobox-presence.test.tsx` (create)

- [ ] **Step 1: Write the failing integration test**

Create `packages/ui/src/__tests__/combobox-presence.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Combobox } from '../combobox/index.js';
import {
  makeAnimation,
  installGetAnimations,
} from './presence-helpers.js';

afterEach(cleanup);

function Setup() {
  return (
    <Combobox.Root>
      <Combobox.Input data-testid="input" />
      <Combobox.Positioner>
        <Combobox.Popup data-testid="lb">
          <Combobox.Option value="a">A</Combobox.Option>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

describe('Combobox exit animation', () => {
  it('keeps the listbox visible through the exit, then hides it', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const { getByTestId } = render(<Setup />);
    await act(async () => fireEvent.focus(getByTestId('input'))); // openOnFocus default
    const lb = getByTestId('lb');
    expect(lb.hidden).toBe(false);

    await act(async () => fireEvent.keyDown(getByTestId('input'), { key: 'Escape' }));
    expect(lb.hidden).toBe(false);
    expect(lb.getAttribute('data-state')).toBe('closed');

    await act(async () => {
      anim.resolve();
    });
    expect(lb.hidden).toBe(true);
    restore();
  });
});
```

(If `Escape` does not close in one press given the Model-A two-stage Escape, close by toggling focus/clicking out instead; the point is to assert the listbox stays visible until the animation resolves.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/combobox-presence.test.tsx`
Expected: FAIL — `lb.hidden` becomes `true` immediately on close.

- [ ] **Step 3: Edit imports**

In `packages/ui/src/combobox/combobox.tsx`, add (matching the existing import block; do not duplicate `mergeRefs` if already imported):

```ts
import { mergeRefs } from '../merge-refs.js';
import { usePresence } from '../use-presence.js';
```

- [ ] **Step 4: Edit `ComboboxPositioner`**

After `const ctx = useComboboxContext('Positioner');` add:

```ts
  const presence = usePresence(ctx.open);
```

If `ComboboxPositioner` calls `usePosition`, change its `open` argument from `ctx.open` to `presence.isPresent`.

Change the `showPopover` effect (lines 287-296) to key on `presence.isPresent` (keep the unconditional `showPopover()`):

```ts
  useLayoutEffect(() => {
    const el = ctx.floatingRef.current;
    if (!presence.isPresent || !el) return;
    el.setAttribute('popover', 'manual');
    el.showPopover();
    return () => {
      el.hidePopover();
      el.removeAttribute('popover');
    };
  }, [presence.isPresent]);
```

Change the `hidden` attribute (line 304) from `ctx.open` to `presence.isPresent`:

```ts
      hidden: presence.isPresent ? undefined : true,
```

Merge the presence ref onto `floatingRef` in the Positioner's `useRender` props:

```ts
      ref: mergeRefs(ctx.floatingRef, presence.ref),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/combobox-presence.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full Combobox suite**

Run: `pnpm exec vitest run combobox`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/combobox/combobox.tsx packages/ui/src/__tests__/combobox-presence.test.tsx
git commit -m "feat(ui): animate Combobox listbox out via usePresence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Size tracking config

`usePresence` is used by all overlays, so it goes in the UI core floor. Config-only on the branch; do NOT regenerate `client-size-report.json` / history (the post-merge build-and-tag job does that — keeping the baseline equal to main's).

**Files:**
- Modify: `scripts/client-size-config.mjs`

- [ ] **Step 1: Add to `UI_CORE_MODULES`**

In `scripts/client-size-config.mjs`, change `UI_CORE_MODULES` (lines 64-68) to:

```javascript
export const UI_CORE_MODULES = [
  'use-render.js',
  'merge-refs.js',
  'use-controllable-state.js',
  'use-presence.js',
];
```

- [ ] **Step 2: Add the docs-chunk prefix**

In `CHUNK_PREFIXES`, after the `['use-controllable-state', 'components'],` entry, add:

```javascript
  ['use-presence', 'components'],
```

- [ ] **Step 3: Verify the config loads**

Run: `node -e "import('./scripts/client-size-config.mjs').then(m => console.log(m.UI_CORE_MODULES))"`
Expected: prints the array including `use-presence.js`.

- [ ] **Step 4: Commit**

```bash
git add scripts/client-size-config.mjs
git commit -m "chore(size): track use-presence in the UI core floor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Foundations docs page + demo

Match the sibling Foundations hook pages (e.g. `use-focus-return.mdx`): H1, prose, `## Signature`, `## Options`, explanation, `## Example`. Add a small live `## Demo` since exit animation is visual.

**Files:**
- Create: `apps/site/src/components/docs/UsePresenceDemo.tsx`
- Create: `apps/site/src/pages/docs/components/use-presence.mdx`
- Modify: `apps/site/src/pages/docs/nav.ts`
- Modify: `apps/site/src/styles/root.css` (demo styles)

- [ ] **Step 1: Create the demo component**

Create `apps/site/src/components/docs/UsePresenceDemo.tsx`:

```tsx
import { usePresence } from '@hono-preact/ui';
import { useState } from 'preact/hooks';

// A box that mounts on open and animates out on close using usePresence. The
// styling lives in apps/site/src/styles/root.css (.docs-presence*).
export function UsePresenceDemo() {
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  return (
    <div class="docs-presence">
      <button class="docs-presence-trigger" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : 'Show'}
      </button>
      {presence.isPresent ? (
        <div
          ref={presence.ref}
          class="docs-presence-box"
          data-state={presence.status === 'open' ? 'open' : 'closed'}
        >
          I fade + slide out before unmounting.
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add demo styles**

In `apps/site/src/styles/root.css`, append (near the other `.docs-*` demo blocks):

```css
/* usePresence docs demo */
.docs-presence {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: flex-start;
}
.docs-presence-box {
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--surface);
  color: var(--foreground);
}
.docs-presence-box[data-state='open'] {
  animation: docs-presence-in 160ms ease-out;
}
.docs-presence-box[data-state='closed'] {
  animation: docs-presence-out 160ms ease-in forwards;
}
@keyframes docs-presence-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
}
@keyframes docs-presence-out {
  to {
    opacity: 0;
    transform: translateY(-6px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .docs-presence-box[data-state='open'],
  .docs-presence-box[data-state='closed'] {
    animation: none;
  }
}
```

- [ ] **Step 3: Create the docs page**

Create `apps/site/src/pages/docs/components/use-presence.mdx`:

```mdx
import { Example } from '../../../components/docs/Example.js';
import { UsePresenceDemo } from '../../../components/docs/UsePresenceDemo.js';

# usePresence

`usePresence` keeps an element mounted while it animates out, then unmounts it.
It is the primitive every overlay in this library uses to run a closing
animation: on close it holds the element in the DOM, lets a `[data-state="closed"]`
CSS animation run, and unmounts only once the animation finishes. Animation is
opt-in: with no closing rule the element unmounts immediately, exactly as before.

## Demo

<Example>
  <UsePresenceDemo />
</Example>

## Signature

```ts
import { usePresence } from '@hono-preact/ui';

function usePresence(
  present: boolean,
  options?: UsePresenceOptions,
): UsePresenceResult;

interface UsePresenceOptions {
  onExitComplete?: () => void; // fires when the exit resolves, before unmount
  timeoutCap?: number; // ms cap on the exit wait (default 3000)
}

interface UsePresenceResult {
  isPresent: boolean; // render the element while true (open or animating out)
  status: 'open' | 'closing' | 'closed'; // map to data-state (closing -> "closed")
  ref: (node: Element | null) => void; // attach to the animated element
}
```

## Options

| Option           | Type         | Default | Notes                                                                 |
| ---------------- | ------------ | ------- | --------------------------------------------------------------------- |
| `present`        | `boolean`    | none    | The desired visibility. Flip it to false to start the exit animation. |
| `onExitComplete` | `() => void` | none    | Runs when the exit resolves, immediately before `isPresent` is false. |
| `timeoutCap`     | `number`     | `3000`  | Safety cap (ms) so a stuck animation can never block teardown.        |

Gate rendering on `isPresent`, attach `ref` to the element that carries the
transition, and map `status` to `data-state` (both `closing` and `closed` map to
`"closed"`, so one `[data-state="closed"]` rule styles the exit). It reads
`Element.getAnimations()` after a forced reflow, races the animations' `finished`
promises against `timeoutCap`, and short-circuits under
`prefers-reduced-motion`. There is no exit on first mount or during SSR.

## Example

```tsx
import { usePresence } from '@hono-preact/ui';
import { useState } from 'preact/hooks';

function Panel() {
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)}>Toggle</button>
      {presence.isPresent ? (
        <div
          ref={presence.ref}
          data-state={presence.status === 'open' ? 'open' : 'closed'}
        >
          Content
        </div>
      ) : null}
    </div>
  );
}
```

```css
[data-state='open'] {
  animation: panel-in 160ms ease-out;
}
[data-state='closed'] {
  animation: panel-out 160ms ease-in forwards;
}
@keyframes panel-in {
  from { opacity: 0; transform: translateY(-6px); }
}
@keyframes panel-out {
  to { opacity: 0; transform: translateY(-6px); }
}
@media (prefers-reduced-motion: reduce) {
  [data-state='open'],
  [data-state='closed'] { animation: none; }
}
```
```

- [ ] **Step 4: Register the nav entry**

In `apps/site/src/pages/docs/nav.ts`, in the Foundations `entries` array, add after the `useFocusReturn` entry:

```typescript
        {
          title: 'usePresence',
          route: '/docs/components/use-presence',
        },
```

- [ ] **Step 5: Build the site to verify the page compiles and routes**

Run: `pnpm --filter '@hono-preact/*' build && pnpm --filter site build`
Expected: build succeeds; no MDX/route errors.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/components/docs/UsePresenceDemo.tsx apps/site/src/pages/docs/components/use-presence.mdx apps/site/src/pages/docs/nav.ts apps/site/src/styles/root.css
git commit -m "docs(ui): usePresence Foundations page + live demo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Exit-animation sweep across the seven component demos

Each demo currently animates entry only, via `@keyframes docs-<x>-in` on `.docs-<x>[data-state='open']` (see `.docs-popover` lines 821-829, `.docs-tooltip` lines 922-929). Add the mirrored exit half so the live demos and copyable examples show the close animation that `usePresence` now enables.

**Pattern to apply per component** (read the existing `@keyframes docs-<x>-in` to mirror the same opacity/transform):

```css
.docs-<x>[data-state='closed'] {
  animation: docs-<x>-out <same-duration> ease-in forwards;
}
@keyframes docs-<x>-out {
  to {
    /* the END state of the entry's `from` (e.g. opacity: 0; transform: translateY(-4px);) */
  }
}
```

And update each component's reduced-motion rule to cover both states with matching specificity:

```css
@media (prefers-reduced-motion: reduce) {
  .docs-<x>[data-state='open'],
  .docs-<x>[data-state='closed'] {
    animation: none;
  }
}
```

**Files:**
- Modify: `apps/site/src/styles/root.css`
- Modify: each of `apps/site/src/pages/docs/components/{dialog,popover,tooltip,menu,context-menu,select,combobox}.mdx`

- [ ] **Step 1: Popover (worked example)**

In `apps/site/src/styles/root.css`, after the `@keyframes docs-popover-in` block (line 829), add:

```css
.docs-popover[data-state='closed'] {
  animation: docs-popover-out 120ms ease-in forwards;
}
@keyframes docs-popover-out {
  to {
    opacity: 0;
    transform: translateY(-4px);
  }
}
```

And change the popover reduced-motion rule (lines 879-883) to:

```css
@media (prefers-reduced-motion: reduce) {
  .docs-popover[data-state='open'],
  .docs-popover[data-state='closed'] {
    animation: none;
  }
}
```

- [ ] **Step 2: Apply the same pattern to the other six demos in `root.css`**

For each of `tooltip`, `menu`, `context-menu` (if it has its own `.docs-*` block; otherwise it reuses the menu block), `select`, `combobox`, and `dialog`:
- Read the existing `@keyframes docs-<x>-in` (the `from {}` state) and `.docs-<x>[data-state='open']` rule.
- Add the mirrored `.docs-<x>[data-state='closed'] { animation: docs-<x>-out <dur> ease-in forwards; }` + `@keyframes docs-<x>-out { to { <the from-state values> } }`.
- Update the reduced-motion rule to list both `[data-state='open']` and `[data-state='closed']`.

For **Dialog**, the entry animates `.docs-dialog[open]` and its `::backdrop`. Add `.docs-dialog[data-state='closed'] { animation: docs-dialog-out <dur> ease-in forwards; }` (the dialog stays `[open]` during the deferred close, so key the exit on `[data-state='closed']`), plus a `::backdrop` exit if the entry animates the backdrop. Tooltip example (opacity only):

```css
.docs-tooltip[data-state='closed'] {
  animation: docs-tooltip-out 100ms ease-in forwards;
}
@keyframes docs-tooltip-out {
  to {
    opacity: 0;
  }
}
```

- [ ] **Step 3: Mirror the exit rule into each component page's Styling CSS tab**

Each component `.mdx` has a `## Styling` `<CodeTabs labels={['CSS','Tailwind']}>` whose CSS tab is the copyable class rules. Add the same `[data-state='closed']` exit rule (and the reduced-motion update) to the CSS tab of each page so what's documented matches the live demo. The Tailwind tab stays the bare markup stub (no change).

- [ ] **Step 4: Build the site to verify CSS + MDX compile**

Run: `pnpm --filter site build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/styles/root.css apps/site/src/pages/docs/components/
git commit -m "docs(ui): exit animations on the overlay demos and copyable examples

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Full verification (CI mirror)

Run the same six checks CI runs, in order (per the repo's pre-push guidance).

- [ ] **Step 1: Build framework dist**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: success.

- [ ] **Step 2: Format check**

Run: `pnpm format:check`
Expected: pass. If it fails, run `pnpm format` and commit the result.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Unit tests + coverage**

Run: `pnpm test:coverage`
Expected: all green, including the 9 `use-presence` unit tests and the 6 component presence integration tests.

- [ ] **Step 5: Integration tests**

Run: `pnpm test:integration`
Expected: pass.

- [ ] **Step 6: Site build**

Run: `pnpm --filter site build`
Expected: success.

- [ ] **Step 7: Manual-verification checklist (real browser; happy-dom cannot emulate `getAnimations()`)**

Document these as PR checklist items to verify with `pnpm --filter site dev`:
- Each overlay visibly fades/slides out on close (Dialog, Popover, Tooltip, Menu, ContextMenu, submenu, Select, Combobox).
- The Dialog retains its top layer / `inert` / focus trap during the exit, and focus returns to the trigger after it finishes; `::backdrop` fades (best-effort).
- Esc on the Dialog animates the close (does not snap shut).
- Reopening an overlay mid-exit reverses cleanly (no fl:cker, element never unmounts).
- `prefers-reduced-motion: reduce` (toggle in devtools) makes every close instant.
- The popup does not jump position during the exit (positioning persists because `usePosition` is keyed on `presence.isPresent`).

---

## Notes for the implementer

- **`act()` for raw events.** Where a test dispatches a raw event or resolves a fake animation that triggers `setState`, wrap it in `act(...)` from `@testing-library/preact` (Preact reschedules renders on a microtask). The provided tests already do this.
- **`getAnimations` is absent in happy-dom.** Tests that don't install the mock will see `usePresence` finalize synchronously (the `typeof node.getAnimations !== 'function'` guard), which is the correct fallback. Only the exit-timing tests install the mock.
- **No `client-size-report.json` regen.** Task 8 is config-only; the baseline stays equal to main's.
- **Run `pnpm format` once at the end** (it globs `packages/**`), then re-run `format:check`, to avoid orphaning format changes in sibling files across per-task commits.
- **If `usePosition` reset-on-close needs handling:** Tasks 3-7 key `usePosition`'s `open` on `presence.isPresent` precisely so positioning persists through the exit. If a component's `usePosition` call uses a differently-named flag, apply the same substitution.
</content>
