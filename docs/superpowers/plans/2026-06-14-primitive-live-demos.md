# Primitive live demos (Section F2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every public `@hono-preact/ui` primitive docs page a live, interactive `<Example>` demo, and create the missing `use-typeahead` page, so every public primitive is documented and compiled against its real types by the site build.

**Architecture:** Each demo is a small self-contained component in `apps/site/src/components/docs/<Name>Demo.tsx` consuming only the primitive's public API. Styling is plain `.docs-*` CSS in `apps/site/src/styles/root.css`. Each existing page gets two prepended imports and an inserted `## Demo` section (`<Example><XDemo /></Example>`) after its lead paragraph; nothing existing is rewritten (one correctness exception: the `use-positioner.mdx` Signature/Options/Example are stale post-#100 and are corrected in Task 2). Verification is the site build (type-checks + compiles every demo) plus the route↔nav parity test for the new page.

**Tech Stack:** Preact, MDX, `@hono-preact/ui` (the primitives), the site's existing `Example`/`docs-example` docs components and `root.css`.

**Conventions (verified against `use-presence.mdx` / `PopoverDemo.tsx`):**
- Import path from `apps/site/src/pages/docs/components/*.mdx` to a demo is `../../../components/docs/<Name>Demo.js` (note `.js`).
- Imports precede the `# Title`. The `## Demo` section goes after the lead paragraph, before the first `##` section. The existing `## Signature`/`## Options`/`## Example` content is untouched.
- `class` (not `className`); `useId` from `preact/hooks`.
- Demos are not unit-tested; the site build is their test. Run `pnpm format` before every commit (the recurring format-check trap).

---

## Task 1: Pure-utility demos (useControllableState, mergeRefs, renderElement)

**Files:**
- Create: `apps/site/src/components/docs/UseControllableStateDemo.tsx`
- Create: `apps/site/src/components/docs/MergeRefsDemo.tsx`
- Create: `apps/site/src/components/docs/RenderElementDemo.tsx`
- Modify: `apps/site/src/styles/root.css` (append `.docs-toggle`, `.docs-mergerefs*`, `.docs-renderel*`)
- Modify: `apps/site/src/pages/docs/components/use-controllable-state.mdx`
- Modify: `apps/site/src/pages/docs/components/merge-refs.mdx`
- Modify: `apps/site/src/pages/docs/components/render-element.mdx`

- [ ] **Step 1: Create `UseControllableStateDemo.tsx`**

```tsx
import { useControllableState } from '@hono-preact/ui';

// A live On/Off toggle built on useControllableState. Uncontrolled here: it owns
// its own state from defaultValue and the setter is stable across renders.
// Styling: .docs-toggle in root.css.
export function UseControllableStateDemo() {
  const [on, setOn] = useControllableState<boolean>({ defaultValue: false });
  return (
    <button
      type="button"
      class="docs-toggle"
      aria-pressed={on}
      data-pressed={on ? '' : undefined}
      onClick={() => setOn(!on)}
    >
      {on ? 'On' : 'Off'}
    </button>
  );
}
```

- [ ] **Step 2: Create `MergeRefsDemo.tsx`**

```tsx
import { mergeRefs } from '@hono-preact/ui';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

// One input node feeds two refs at once via mergeRefs: an internal ref used to
// focus it, and a measuring ref used to read its width. Both receiving the same
// node is the visible proof. Styling: .docs-mergerefs* in root.css.
export function MergeRefsDemo() {
  const focusRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div class="docs-mergerefs">
      <input
        ref={mergeRefs(focusRef, measureRef)}
        class="docs-mergerefs-input"
        defaultValue="resize me"
        aria-label="Demo input"
      />
      <button
        type="button"
        class="docs-mergerefs-btn"
        onClick={() => focusRef.current?.focus()}
      >
        Focus (internal ref)
      </button>
      <span class="docs-mergerefs-readout">
        measured width: {width != null ? `${Math.round(width)}px` : '…'}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Create `RenderElementDemo.tsx`**

```tsx
import { renderElement, type RenderProp } from '@hono-preact/ui';
import type { ComponentChildren, JSX, VNode } from 'preact';
import { useState } from 'preact/hooks';

type DemoButtonProps = {
  render?: RenderProp<{ pressed: boolean }>;
  pressed?: boolean;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

// The render-prop Button from the docs page, built on renderElement.
function DemoButton({
  render,
  pressed = false,
  children,
  ...rest
}: DemoButtonProps): VNode {
  return renderElement<{ pressed: boolean }>({
    render,
    defaultTag: 'button',
    props: { ...rest, type: 'button', 'data-pressed': pressed ? '' : undefined },
    state: { pressed },
    children,
  });
}

// The same Button rendered three ways: the default <button>, an <a> to clone
// (a real anchor, opens in a new tab), and the function form that reads the
// component's state. Styling: .docs-renderel* in root.css.
export function RenderElementDemo() {
  const [pressed, setPressed] = useState(false);
  return (
    <div class="docs-renderel">
      <DemoButton
        class="docs-renderel-btn"
        pressed={pressed}
        onClick={() => setPressed((p) => !p)}
      >
        {pressed ? 'pressed' : 'default <button>'}
      </DemoButton>

      <DemoButton
        class="docs-renderel-btn"
        render={
          <a
            href="https://preactjs.com"
            target="_blank"
            rel="noreferrer noopener"
          />
        }
      >
        render=&lt;a&gt;
      </DemoButton>

      <DemoButton
        class="docs-renderel-btn"
        pressed={pressed}
        onClick={() => setPressed((p) => !p)}
        render={(props, state) => (
          <span {...props} role="button" tabIndex={0}>
            {state.pressed ? 'pressed (fn)' : 'render=fn'}
          </span>
        )}
      />
    </div>
  );
}
```

- [ ] **Step 4: Append demo CSS to `apps/site/src/styles/root.css`**

```css
/* useControllableState demo */
.docs-toggle {
  appearance: none;
  font: inherit;
  font-weight: 600;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.docs-toggle[data-pressed] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast, #fff);
}

/* mergeRefs demo */
.docs-mergerefs {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.docs-mergerefs-input {
  font: inherit;
  padding: 0.4rem 0.6rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text);
}
.docs-mergerefs-btn {
  appearance: none;
  font: inherit;
  font-size: 0.875rem;
  padding: 0.45rem 0.8rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.docs-mergerefs-readout {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* renderElement demo */
.docs-renderel {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.docs-renderel-btn {
  appearance: none;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  padding: 0.45rem 0.85rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.docs-renderel-btn[data-pressed] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast, #fff);
}
```

> Note: `--accent-contrast` may not exist; if not, use the project's existing on-accent text token (check what `.docs-popover-trigger` or similar uses) or `#fff`. Match the surrounding token vocabulary in `root.css`.

- [ ] **Step 5: Wire `use-controllable-state.mdx`**

Prepend imports above `# useControllableState`:

```mdx
import { Example } from '../../../components/docs/Example.js';
import { UseControllableStateDemo } from '../../../components/docs/UseControllableStateDemo.js';
```

Insert after the lead paragraph (before `## Signature`):

```mdx
## Demo

<Example>
  <UseControllableStateDemo />
</Example>
```

- [ ] **Step 6: Wire `merge-refs.mdx`**

Prepend:

```mdx
import { Example } from '../../../components/docs/Example.js';
import { MergeRefsDemo } from '../../../components/docs/MergeRefsDemo.js';
```

Insert after the lead paragraph (before `## Signature`):

```mdx
## Demo

<Example>
  <MergeRefsDemo />
</Example>
```

- [ ] **Step 7: Wire `render-element.mdx`**

Prepend:

```mdx
import { Example } from '../../../components/docs/Example.js';
import { RenderElementDemo } from '../../../components/docs/RenderElementDemo.js';
```

Insert after the lead paragraph (before `## Signature`):

```mdx
## Demo

<Example>
  <RenderElementDemo />
</Example>
```

- [ ] **Step 8: Verify the build**

Run: `pnpm --filter site build`
Expected: PASS (compiles + type-checks all three demos and the three pages).

- [ ] **Step 9: Format + commit**

```bash
pnpm format
git add apps/site/src/components/docs/UseControllableStateDemo.tsx \
  apps/site/src/components/docs/MergeRefsDemo.tsx \
  apps/site/src/components/docs/RenderElementDemo.tsx \
  apps/site/src/styles/root.css \
  apps/site/src/pages/docs/components/use-controllable-state.mdx \
  apps/site/src/pages/docs/components/merge-refs.mdx \
  apps/site/src/pages/docs/components/render-element.mdx
git commit -m "docs(site): live demos for useControllableState, mergeRefs, renderElement"
```

---

## Task 2: Positioning demos (usePosition, usePositioner) + fix stale usePositioner page

**Files:**
- Create: `apps/site/src/components/docs/UsePositionDemo.tsx`
- Create: `apps/site/src/components/docs/UsePositionerDemo.tsx`
- Modify: `apps/site/src/styles/root.css` (append `.docs-useposition*`, `.docs-usepositioner*`)
- Modify: `apps/site/src/pages/docs/components/use-position.mdx`
- Modify: `apps/site/src/pages/docs/components/use-positioner.mdx` (demo + correct the stale API)

**Context — the `usePositioner` page is stale.** The real signature (`packages/ui/src/use-positioner.ts`) is `usePositioner({ open, anchorRef, floatingRef, side, align, offset, getAnchorRect?, mount })` and it RETURNS `{ isPresent, positionerProps, state, position, arrowRef }`. The Arrow+PositionerContext dedup (PR #100) removed the `setPosition` option and the `arrowRef` *input*; the hook now owns its arrow ref internally and returns it. The current `use-positioner.mdx` Options table and Example still document the old `setPosition`/`arrowRef`-input API and must be corrected (Steps 6–7). `usePosition` (`packages/ui/src/use-position.ts`) applies `position:fixed`/`left`/`top` to the floating element itself, so a demo only needs a `ref` and visual styling.

- [ ] **Step 1: Create `UsePositionDemo.tsx`**

```tsx
import { usePosition } from '@hono-preact/ui';
import { useRef, useState } from 'preact/hooks';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const ALIGNS = ['start', 'center', 'end'] as const;

// Bare placement: usePosition anchors the floating box to the button and applies
// position:fixed/left/top itself, resolving a final side/align after collision
// handling (the readout shows the resolved values, which can differ from the
// requested side near a viewport edge). Deliberately not a popover. Styling:
// .docs-useposition* in root.css.
export function UsePositionDemo() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<(typeof SIDES)[number]>('bottom');
  const [align, setAlign] = useState<(typeof ALIGNS)[number]>('center');

  const pos = usePosition({ open, anchorRef, floatingRef, side, align });

  return (
    <div class="docs-useposition">
      <div class="docs-useposition-controls">
        <fieldset class="docs-useposition-group">
          <legend>side</legend>
          {SIDES.map((s) => (
            <label key={s}>
              <input
                type="radio"
                name="docs-useposition-side"
                checked={s === side}
                onChange={() => setSide(s)}
              />
              {s}
            </label>
          ))}
        </fieldset>
        <fieldset class="docs-useposition-group">
          <legend>align</legend>
          {ALIGNS.map((a) => (
            <label key={a}>
              <input
                type="radio"
                name="docs-useposition-align"
                checked={a === align}
                onChange={() => setAlign(a)}
              />
              {a}
            </label>
          ))}
        </fieldset>
      </div>
      <button
        ref={anchorRef}
        type="button"
        class="docs-useposition-anchor"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide' : 'Show'} box
      </button>
      {open ? (
        <div
          ref={floatingRef}
          class="docs-useposition-box"
          data-side={pos.side}
          data-align={pos.align}
        >
          resolved: {pos.side} / {pos.align}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create `UsePositionerDemo.tsx`**

```tsx
import { usePositioner } from '@hono-preact/ui';
import { useRef, useState } from 'preact/hooks';

// A complete custom anchored overlay built directly on usePositioner: it composes
// floating placement, the open/close presence lifecycle, native top-layer
// promotion (Popover API), and the UA [popover] style resets, so the demo only
// wires open state and side-aware styling. positionerProps already carries the
// merged ref, position style, and data-side/data-align. Styling: .docs-usepositioner*.
export function UsePositionerDemo() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  const { isPresent, positionerProps, state } = usePositioner({
    open,
    anchorRef,
    floatingRef,
    side: 'bottom',
    align: 'center',
    offset: 8,
    mount: 'unmount',
  });

  return (
    <div class="docs-usepositioner">
      <button
        ref={anchorRef}
        type="button"
        class="docs-usepositioner-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Close' : 'Open'} overlay
      </button>
      {isPresent ? (
        <div {...positionerProps}>
          <div class="docs-usepositioner-popup" data-side={state.side}>
            Built on usePositioner, anchored {state.side}.
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Append demo CSS to `root.css`**

```css
/* usePosition demo */
.docs-useposition {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}
.docs-useposition-controls {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  justify-content: center;
}
.docs-useposition-group {
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  padding: 0.35rem 0.6rem;
  display: flex;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.docs-useposition-group legend {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.docs-useposition-anchor {
  appearance: none;
  font: inherit;
  font-weight: 600;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.docs-useposition-box {
  /* usePosition sets position:fixed + left/top; this is visual styling only. */
  z-index: 50;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: var(--text);
  color: var(--surface);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
}

/* usePositioner demo */
.docs-usepositioner-trigger {
  appearance: none;
  font: inherit;
  font-weight: 600;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.docs-usepositioner-popup {
  z-index: 50;
  padding: 0.6rem 0.85rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
  max-width: 16rem;
}
```

- [ ] **Step 4: Wire `use-position.mdx`**

Prepend:

```mdx
import { Example } from '../../../components/docs/Example.js';
import { UsePositionDemo } from '../../../components/docs/UsePositionDemo.js';
```

Insert after the lead paragraph (before `## Signature`):

```mdx
## Demo

<Example>
  <UsePositionDemo />
</Example>
```

- [ ] **Step 5: Wire `use-positioner.mdx` (add the demo)**

Prepend:

```mdx
import { Example } from '../../../components/docs/Example.js';
import { UsePositionerDemo } from '../../../components/docs/UsePositionerDemo.js';
```

Insert after the lead paragraph (before `## Signature`):

```mdx
## Demo

<Example>
  <UsePositionerDemo />
</Example>
```

- [ ] **Step 6: Correct the stale Options table in `use-positioner.mdx`**

Remove the `arrowRef` and `setPosition` rows (those are no longer inputs). The corrected Options table keeps exactly these rows:

```mdx
| Option          | Type                     | Notes                                                                                                                              |
| --------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `open`          | `boolean`                | The overlay's open state; drives the presence lifecycle.                                                                           |
| `anchorRef`     | `RefObject<HTMLElement>` | The element the overlay is positioned against.                                                                                     |
| `floatingRef`   | `RefObject<HTMLElement>` | The positioned overlay element.                                                                                                    |
| `side`          | `Side`                   | Preferred side: `top`, `right`, `bottom`, or `left`.                                                                               |
| `align`         | `Align`                  | Alignment along the side: `start`, `center`, or `end`.                                                                             |
| `offset`        | `number`                 | Gap in pixels between anchor and overlay.                                                                                          |
| `getAnchorRect` | `ClientRectGetter`       | Optional. Position against a point or virtual element instead of `anchorRef` (e.g. a pointer position).                            |
| `mount`         | `'unmount' \| 'hidden'`  | `'unmount'`: branch on `isPresent` and return `null` while closed. `'hidden'`: keep the element mounted and `hidden` while closed. |
```

Replace the result-description paragraph so it matches the real return shape:

```mdx
`usePositioner` returns `{ isPresent, positionerProps, state, position, arrowRef }`:
spread `positionerProps` onto your positioner element (it already carries the
merged ref including `floatingRef`, Popover-API promotion, the UA `[popover]`
style resets, and `data-side` / `data-align`), branch on `isPresent` when `mount`
is `'unmount'`, and read `state.side` / `state.align` for side-aware styling. For
a custom arrow, attach the returned `arrowRef` to your arrow element and read
`position.arrowX` / `position.arrowY` for its offset (this is what the built-in
`Arrow` part does).
```

- [ ] **Step 7: Correct the stale Example in `use-positioner.mdx`**

Replace the existing `## Example` code block with the real API (no `setPosition`; `arrowRef` comes from the hook):

```tsx
import { usePositioner } from '@hono-preact/ui';
import { useRef, useState } from 'preact/hooks';

function Anchored({ open }: { open: boolean }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLElement>(null);

  const { isPresent, positionerProps, state } = usePositioner({
    open,
    anchorRef,
    floatingRef,
    side: 'bottom',
    align: 'center',
    offset: 8,
    mount: 'unmount',
  });

  return (
    <>
      <button ref={anchorRef}>anchor</button>
      {isPresent && (
        <div {...positionerProps} data-side={state.side}>
          overlay contents
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 8: Verify the build**

Run: `pnpm --filter site build`
Expected: PASS. (If the page still referenced `setPosition`/`PositionState` imports that are now unused, the build / lint surfaces it; remove any now-dead import line.)

- [ ] **Step 9: Format + commit**

```bash
pnpm format
git add apps/site/src/components/docs/UsePositionDemo.tsx \
  apps/site/src/components/docs/UsePositionerDemo.tsx \
  apps/site/src/styles/root.css \
  apps/site/src/pages/docs/components/use-position.mdx \
  apps/site/src/pages/docs/components/use-positioner.mdx
git commit -m "docs(site): live demos for usePosition + usePositioner; fix stale usePositioner API docs"
```

---

## Task 3: Overlay-behavior demos (useDismiss, useFocusReturn, useSafeArea)

**Files:**
- Create: `apps/site/src/components/docs/UseDismissDemo.tsx`
- Create: `apps/site/src/components/docs/UseFocusReturnDemo.tsx`
- Create: `apps/site/src/components/docs/UseSafeAreaDemo.tsx`
- Modify: `apps/site/src/styles/root.css` (append `.docs-dismiss*`, `.docs-focusreturn*`, `.docs-safearea*`)
- Modify: `apps/site/src/pages/docs/components/use-dismiss.mdx`
- Modify: `apps/site/src/pages/docs/components/use-focus-return.mdx`
- Modify: `apps/site/src/pages/docs/components/use-safe-area.mdx`

- [ ] **Step 1: Create `UseDismissDemo.tsx`**

```tsx
import { useDismiss, type DismissReason } from '@hono-preact/ui';
import { useRef, useState } from 'preact/hooks';

// A panel registered with the dismissal stack. Pressing Escape or clicking
// outside the panel dismisses it; the readout shows which path fired.
// Styling: .docs-dismiss* in root.css.
export function UseDismissDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DismissReason | null>(null);

  useDismiss({
    enabled: open,
    refs: [ref],
    onDismiss: (r) => {
      setReason(r);
      setOpen(false);
    },
  });

  return (
    <div class="docs-dismiss">
      <button
        type="button"
        class="docs-dismiss-trigger"
        onClick={() => {
          setReason(null);
          setOpen(true);
        }}
      >
        Open panel
      </button>
      {open ? (
        <div
          ref={ref}
          class="docs-dismiss-panel"
          role="dialog"
          aria-label="Dismissable panel"
        >
          Press Escape or click outside to dismiss.
        </div>
      ) : null}
      {reason ? (
        <p class="docs-dismiss-readout">
          dismissed via: <strong>{reason}</strong>
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create `UseFocusReturnDemo.tsx`**

```tsx
import { useDismiss, useFocusReturn } from '@hono-preact/ui';
import { useRef, useState } from 'preact/hooks';

// When the panel opens, useFocusReturn moves focus to its first button; when it
// closes, focus returns to the trigger. Paired with useDismiss so Escape closes
// it (useFocusReturn is not a focus trap). Styling: .docs-focusreturn* in root.css.
export function UseFocusReturnDemo() {
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useFocusReturn({ open, popupRef });
  useDismiss({ enabled: open, refs: [popupRef], onDismiss: () => setOpen(false) });

  return (
    <div class="docs-focusreturn">
      <button
        type="button"
        class="docs-focusreturn-trigger"
        onClick={() => setOpen(true)}
      >
        Open (focus moves in)
      </button>
      {open ? (
        <div
          ref={popupRef}
          class="docs-focusreturn-panel"
          role="dialog"
          aria-label="Focus panel"
        >
          <p>Focus jumped to the first button.</p>
          <button type="button" onClick={() => setOpen(false)}>
            First
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Second
          </button>
        </div>
      ) : null}
      <p class="docs-focusreturn-hint">
        Close it (Escape or a button) and focus returns to the trigger.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Create `UseSafeAreaDemo.tsx`**

```tsx
import { useSafeArea } from '@hono-preact/ui';
import { useRef, useState } from 'preact/hooks';

// A hover-opened card sitting across a diagonal gap from its trigger. useSafeArea
// keeps it open while the pointer travels the corridor toward it, even on a
// diagonal that does not aim straight at the card, and closes it after the grace
// period once the pointer leaves the safe region. The card is CSS-placed to the
// lower-right with a deliberate gap. Styling: .docs-safearea* in root.css.
export function UseSafeAreaDemo() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useSafeArea({
    enabled: open,
    anchorRef,
    floatingRef,
    onClose: () => setOpen(false),
  });

  return (
    <div class="docs-safearea">
      <button
        ref={anchorRef}
        type="button"
        class="docs-safearea-trigger"
        onPointerEnter={() => setOpen(true)}
      >
        Hover me
      </button>
      {open ? (
        <div
          ref={floatingRef}
          class="docs-safearea-card"
          role="group"
          aria-label="Hover card"
        >
          Move diagonally here. The corridor keeps me open across the gap; leave
          it and I close after a moment.
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Append demo CSS to `root.css`**

```css
/* useDismiss demo */
.docs-dismiss {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
}
.docs-dismiss-trigger,
.docs-focusreturn-trigger,
.docs-safearea-trigger {
  appearance: none;
  font: inherit;
  font-weight: 600;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.docs-dismiss-panel,
.docs-focusreturn-panel {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.12);
}
.docs-dismiss-readout,
.docs-focusreturn-hint {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0;
}

/* useFocusReturn demo */
.docs-focusreturn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
}
.docs-focusreturn-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.docs-focusreturn-panel button {
  appearance: none;
  font: inherit;
  font-size: 0.85rem;
  padding: 0.35rem 0.8rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border-color);
  background: var(--bg, var(--surface));
  color: var(--text);
  cursor: pointer;
}

/* useSafeArea demo */
.docs-safearea {
  position: relative;
  width: 100%;
  min-height: 7rem;
}
.docs-safearea-trigger {
  position: absolute;
  top: 0;
  left: 0;
}
.docs-safearea-card {
  position: absolute;
  top: 3.5rem;
  left: 6rem;
  max-width: 16rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.14);
}
```

> Note: confirm `--text-muted`, `--surface`, `--border-color`, `--text` are the tokens used elsewhere in `root.css`; if a token name differs, use the established one.

- [ ] **Step 5: Wire `use-dismiss.mdx`** — prepend the two imports (`Example`, `UseDismissDemo`) and insert a `## Demo` section with `<Example><UseDismissDemo /></Example>` after the "See also" line / lead, before `## Signature`.

- [ ] **Step 6: Wire `use-focus-return.mdx`** — prepend imports (`Example`, `UseFocusReturnDemo`); insert `## Demo` with `<Example><UseFocusReturnDemo /></Example>` after the lead, before `## Signature`.

- [ ] **Step 7: Wire `use-safe-area.mdx`** — it already imports `SafeAreaDiagram`; add the two imports (`Example`, `UseSafeAreaDemo`) alongside. Insert `## Demo` with `<Example><UseSafeAreaDemo /></Example>` after the lead, before `## How it works` (so the live demo leads and the diagram explains it below).

- [ ] **Step 8: Verify the build**

Run: `pnpm --filter site build`
Expected: PASS.

- [ ] **Step 9: Format + commit**

```bash
pnpm format
git add apps/site/src/components/docs/UseDismissDemo.tsx \
  apps/site/src/components/docs/UseFocusReturnDemo.tsx \
  apps/site/src/components/docs/UseSafeAreaDemo.tsx \
  apps/site/src/styles/root.css \
  apps/site/src/pages/docs/components/use-dismiss.mdx \
  apps/site/src/pages/docs/components/use-focus-return.mdx \
  apps/site/src/pages/docs/components/use-safe-area.mdx
git commit -m "docs(site): live demos for useDismiss, useFocusReturn, useSafeArea"
```

---

## Task 4: Collection demos (useListNavigation, useListboxSelection)

**Files:**
- Create: `apps/site/src/components/docs/UseListNavigationDemo.tsx`
- Create: `apps/site/src/components/docs/UseListboxSelectionDemo.tsx`
- Modify: `apps/site/src/styles/root.css` (append `.docs-listnav*`, `.docs-listboxsel*`)
- Modify: `apps/site/src/pages/docs/components/use-list-navigation.mdx`
- Modify: `apps/site/src/pages/docs/components/use-listbox-selection.mdx`

- [ ] **Step 1: Create `UseListNavigationDemo.tsx`**

```tsx
import { useListNavigation } from '@hono-preact/ui';
import { useId, useRef, useState } from 'preact/hooks';

const OPTIONS = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Violet'];

// An activedescendant listbox: the trigger keeps DOM focus while ArrowUp/Down,
// Home/End, and typeahead move aria-activedescendant over the options (wrapping
// at the ends, scrolling into view). Styling: .docs-listnav* in root.css.
export function UseListNavigationDemo() {
  const listRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const nav = useListNavigation({
    enabled: open,
    containerRef: listRef,
    itemSelector: '[role="option"]',
    activeId,
    setActiveId,
    mode: 'activedescendant',
  });

  return (
    <div class="docs-listnav">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? (activeId ?? undefined) : undefined}
        class="docs-listnav-trigger"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (open) nav.onKeyDown(e);
        }}
      >
        {open ? 'Arrow / Home / End / type a letter' : 'Open list'}
      </button>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        class="docs-listnav-list"
        hidden={!open}
      >
        {OPTIONS.map((opt) => {
          const id = `${baseId}-${opt}`;
          return (
            <div
              key={opt}
              id={id}
              role="option"
              aria-selected={activeId === id}
              data-active={activeId === id ? '' : undefined}
              class="docs-listnav-option"
            >
              {opt}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `UseListboxSelectionDemo.tsx`**

```tsx
import { useListboxSelection } from '@hono-preact/ui';
import { useId, useLayoutEffect, useState } from 'preact/hooks';

const FRUITS = ['Apple', 'Banana', 'Cherry', 'Date'];

// A small option row that registers itself in the selection's label registry and
// reflects/toggles its own selected state.
function Option(props: {
  value: string;
  isSelected: (v: string) => boolean;
  toggle: (v: string) => void;
  register: (id: string, value: string, label: string) => () => void;
}) {
  const { value, isSelected, toggle, register } = props;
  const id = useId();
  useLayoutEffect(
    () => register(id, value, value),
    [id, value, register]
  );
  const selected = isSelected(value);
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      data-selected={selected ? '' : undefined}
      class="docs-listboxsel-option"
      onClick={() => toggle(value)}
    >
      {value}
    </li>
  );
}

// The selection core shared by Select and Combobox: single/multi value tracking,
// a label registry resolving display labels in DOM order, and hidden form-field
// serialization. Toggle multi-select; the readout shows selectedLabels() and the
// hidden fields render below. Styling: .docs-listboxsel* in root.css.
export function UseListboxSelectionDemo() {
  const [multiple, setMultiple] = useState(false);
  const [value, setValue] = useState<string | string[] | undefined>(undefined);
  const [, setOpen] = useState(true);

  const sel = useListboxSelection<string>({
    value,
    setValue: (next) => setValue(next),
    multiple,
    setOpen,
    name: 'fruit',
  });

  return (
    <div class="docs-listboxsel">
      <label class="docs-listboxsel-mode">
        <input
          type="checkbox"
          checked={multiple}
          onChange={(e) => {
            setMultiple(e.currentTarget.checked);
            setValue(undefined);
          }}
        />
        multiple
      </label>
      <ul role="listbox" aria-multiselectable={multiple} class="docs-listboxsel-list">
        {FRUITS.map((f) => (
          <Option
            key={f}
            value={f}
            isSelected={sel.isSelected}
            toggle={sel.toggle}
            register={sel.registerOption}
          />
        ))}
      </ul>
      <p class="docs-listboxsel-readout">
        selected: <strong>{sel.selectedLabels().join(', ') || '(none)'}</strong>
      </p>
      {sel.hiddenFields}
    </div>
  );
}
```

- [ ] **Step 3: Append demo CSS to `root.css`**

```css
/* useListNavigation demo */
.docs-listnav {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.docs-listnav-trigger {
  appearance: none;
  font: inherit;
  font-weight: 600;
  font-size: 0.85rem;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.docs-listnav-list {
  width: 12rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--surface);
  padding: 0.25rem;
  max-height: 9rem;
  overflow: auto;
}
.docs-listnav-option {
  padding: 0.35rem 0.6rem;
  border-radius: 0.35rem;
  font-size: 0.85rem;
  color: var(--text);
  cursor: default;
}
.docs-listnav-option[data-active] {
  background: var(--accent);
  color: var(--accent-contrast, #fff);
}

/* useListboxSelection demo */
.docs-listboxsel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.docs-listboxsel-mode {
  font-size: 0.8rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.docs-listboxsel-list {
  list-style: none;
  margin: 0;
  padding: 0.25rem;
  width: 11rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--surface);
}
.docs-listboxsel-option {
  padding: 0.35rem 0.6rem;
  border-radius: 0.35rem;
  font-size: 0.85rem;
  cursor: pointer;
}
.docs-listboxsel-option[data-selected] {
  background: var(--accent);
  color: var(--accent-contrast, #fff);
}
.docs-listboxsel-readout {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0;
}
```

- [ ] **Step 4: Wire `use-list-navigation.mdx`** — prepend imports (`Example`, `UseListNavigationDemo`); insert `## Demo` with `<Example><UseListNavigationDemo /></Example>` after the lead, before `## Signature`. (The page's existing "Companion exports" table that points to `useTypeahead` gets a link to the new page in Task 5.)

- [ ] **Step 5: Wire `use-listbox-selection.mdx`** — prepend imports (`Example`, `UseListboxSelectionDemo`); insert `## Demo` with `<Example><UseListboxSelectionDemo /></Example>` after the "See also" line / lead, before `## Signature`.

- [ ] **Step 6: Verify the build**

Run: `pnpm --filter site build`
Expected: PASS.

- [ ] **Step 7: Format + commit**

```bash
pnpm format
git add apps/site/src/components/docs/UseListNavigationDemo.tsx \
  apps/site/src/components/docs/UseListboxSelectionDemo.tsx \
  apps/site/src/styles/root.css \
  apps/site/src/pages/docs/components/use-list-navigation.mdx \
  apps/site/src/pages/docs/components/use-listbox-selection.mdx
git commit -m "docs(site): live demos for useListNavigation + useListboxSelection"
```

---

## Task 5: New `use-typeahead` page + demo + nav entry

**Files:**
- Create: `apps/site/src/components/docs/UseTypeaheadDemo.tsx`
- Create: `apps/site/src/pages/docs/components/use-typeahead.mdx`
- Modify: `apps/site/src/pages/docs/nav.ts` (add the Foundations entry after `useListNavigation`)
- Modify: `apps/site/src/pages/docs/components/use-list-navigation.mdx` (link the Companion-exports table to the new page)
- Modify: `apps/site/src/styles/root.css` (append `.docs-typeahead*`)

- [ ] **Step 1: Create `UseTypeaheadDemo.tsx`**

```tsx
import { useTypeahead } from '@hono-preact/ui';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

const ITEMS = ['Argon', 'Boron', 'Calcium', 'Carbon', 'Cobalt', 'Neon'];

// useTypeahead returns an onChar(char) callback that accumulates printable
// characters into a query and resets after an idle gap (default 500ms). Type
// while the list is focused to jump to the first matching item. The buffer
// readout shows the accumulation and the idle reset. Styling: .docs-typeahead*.
export function UseTypeaheadDemo() {
  const onChar = useTypeahead();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const handleKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLUListElement>) => {
    if (e.key.length !== 1) return; // ignore non-printable keys (Arrow, Enter, …)
    const q = onChar(e.key);
    setQuery(q);
    const idx = ITEMS.findIndex((it) =>
      it.toLowerCase().startsWith(q.toLowerCase())
    );
    if (idx >= 0) setActiveIndex(idx);
  };

  return (
    <div class="docs-typeahead">
      <ul
        class="docs-typeahead-list"
        tabIndex={0}
        role="listbox"
        aria-label="Elements"
        aria-activedescendant={`docs-typeahead-${activeIndex}`}
        onKeyDown={handleKeyDown}
      >
        {ITEMS.map((it, i) => (
          <li
            key={it}
            id={`docs-typeahead-${i}`}
            role="option"
            aria-selected={i === activeIndex}
            data-active={i === activeIndex ? '' : undefined}
            class="docs-typeahead-option"
          >
            {it}
          </li>
        ))}
      </ul>
      <p class="docs-typeahead-readout">
        buffer: <code>{query || '(empty)'}</code>
        <span class="docs-typeahead-hint">
          focus the list and type; it resets after 500ms idle
        </span>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Create `use-typeahead.mdx`**

```mdx
import { Example } from '../../../components/docs/Example.js';
import { UseTypeaheadDemo } from '../../../components/docs/UseTypeaheadDemo.js';

# useTypeahead

`useTypeahead` is the type-to-select hook [useListNavigation](/docs/components/use-list-navigation)
uses internally, exported for composing your own keyboard navigation. It returns
an `onChar(char)` callback that accumulates printable characters into a query
string and returns the current query; the buffer resets after a short idle gap.
The caller matches the returned query against its item labels and moves the
active item.

## Demo

<Example>
  <UseTypeaheadDemo />
</Example>

## Signature

```ts
import { useTypeahead } from '@hono-preact/ui';

function useTypeahead(opts?: UseTypeaheadOptions): (char: string) => string;

interface UseTypeaheadOptions {
  idleMs?: number; // reset the buffer after this idle gap, default 500
}
```

Call the returned function with each printable character (for example from a
`keydown` handler, skipping non-printable keys); it appends the character to the
buffer, schedules a reset after `idleMs` of no input, and returns the current
query.

## Options

| Option   | Type     | Default | Notes                                            |
| -------- | -------- | ------- | ------------------------------------------------ |
| `idleMs` | `number` | `500`   | Reset the accumulated query after this idle gap. |

Returns `(char: string) => string`: a stable callback that accumulates `char`
into the query and returns it.

## Example

Type-to-select against a list, matching the accumulated query as a prefix:

```tsx
import { useTypeahead } from '@hono-preact/ui';
import { useState } from 'preact/hooks';

const ITEMS = ['Argon', 'Boron', 'Calcium', 'Carbon'];

function Typeahead() {
  const onChar = useTypeahead();
  const [active, setActive] = useState(0);

  return (
    <ul
      tabIndex={0}
      role="listbox"
      onKeyDown={(e) => {
        if (e.key.length !== 1) return; // printable characters only
        const query = onChar(e.key);
        const idx = ITEMS.findIndex((it) =>
          it.toLowerCase().startsWith(query.toLowerCase())
        );
        if (idx >= 0) setActive(idx);
      }}
    >
      {ITEMS.map((it, i) => (
        <li key={it} role="option" aria-selected={i === active}>
          {it}
        </li>
      ))}
    </ul>
  );
}
```

See also: [useListNavigation](/docs/components/use-list-navigation), which folds
typeahead together with arrow-key and Home/End navigation.
```

> Note: in the MDX file the inner code fences above must be real triple-backtick
> blocks (` ```ts ` / ` ```tsx `). Match the fence style of the sibling pages.

- [ ] **Step 3: Add the nav entry in `apps/site/src/pages/docs/nav.ts`**

Insert immediately after the `useListNavigation` entry in the `Foundations` section:

```ts
          {
            title: 'useTypeahead',
            route: '/docs/components/use-typeahead',
          },
```

- [ ] **Step 4: Link the new page from `use-list-navigation.mdx`**

In the "Companion exports" table, make the `useTypeahead` export name a link to the new page. Change the first cell from `useTypeahead` to:

```mdx
| [`useTypeahead`](/docs/components/use-typeahead) |
```

(Keep the rest of that table row's columns unchanged.)

- [ ] **Step 5: Append demo CSS to `root.css`**

```css
/* useTypeahead demo */
.docs-typeahead {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.docs-typeahead-list {
  list-style: none;
  margin: 0;
  padding: 0.25rem;
  width: 11rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--surface);
}
.docs-typeahead-list:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.docs-typeahead-option {
  padding: 0.35rem 0.6rem;
  border-radius: 0.35rem;
  font-size: 0.85rem;
  color: var(--text);
}
.docs-typeahead-option[data-active] {
  background: var(--accent);
  color: var(--accent-contrast, #fff);
}
.docs-typeahead-readout {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0;
}
.docs-typeahead-hint {
  font-size: 0.72rem;
}
```

- [ ] **Step 6: Verify the build + route↔nav parity**

Run: `pnpm --filter site build`
Expected: PASS.

Run the docs route↔nav parity test (the add-docs-page skill's check). Use the site's test runner, e.g. `pnpm exec vitest run apps/site/src/pages/docs/__tests__`.
Expected: PASS (the new route resolves and the nav entry matches).

- [ ] **Step 7: Format + commit**

```bash
pnpm format
git add apps/site/src/components/docs/UseTypeaheadDemo.tsx \
  apps/site/src/pages/docs/components/use-typeahead.mdx \
  apps/site/src/pages/docs/nav.ts \
  apps/site/src/pages/docs/components/use-list-navigation.mdx \
  apps/site/src/styles/root.css
git commit -m "docs(site): add useTypeahead page + demo and nav entry"
```

---

## Task 6: Whole-branch verification (full six-step CI)

**Files:** none (verification only).

- [ ] **Step 1: Run the full CI sequence (per `CLAUDE.md`), in order**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all six PASS. If `format:check` fails, run `pnpm format`, re-stage, and amend the relevant commit.

- [ ] **Step 2: Confirm scope and parity**

- `git status` clean (no format-dirty files left by per-task commits).
- 11 new `*Demo.tsx` files exist under `apps/site/src/components/docs/`.
- All 10 existing primitive pages plus the new `use-typeahead.mdx` contain a `## Demo` with an `<Example>` (grep `grep -L "<Example>" apps/site/src/pages/docs/components/use-*.mdx` returns nothing except, intentionally, none).
- `use-positioner.mdx` no longer mentions `setPosition`.

- [ ] **Step 3: Dispatch the final whole-branch deep review**

Per `CLAUDE.md` and subagent-driven-development: a whole-branch reviewer checks each demo uses only public API, every page edit is additive (except the intended `use-positioner.mdx` correction), no demo re-implements a primitive, and the new page satisfies the three docs pillars. Address findings before finishing.

---

## Self-review notes (for the controller)

- **Spec coverage:** Task 1 covers the 3 pure utilities; Task 2 the positioning pair (+ the stale-doc correction the spec flagged as the one non-additive exception); Task 3 the overlay-behavior trio; Task 4 the two collection hooks; Task 5 the new `use-typeahead` page+demo+nav; Task 6 is verification. All 11 demos + the new page are accounted for. `use-presence` is intentionally excluded (already done).
- **Token sanity:** `--accent`, `--accent-contrast`, `--surface`, `--text`, `--text-muted`, `--border-color` are assumed to match `root.css`. The implementer must confirm each against the file and substitute the established token name where one differs (the `> Note:` callouts mark this). This is the one place hand-written CSS can drift.
- **Type consistency:** Demo signatures use the verified public APIs: `useControllableState<boolean>({ defaultValue })`, `mergeRefs(a, b)`, `renderElement<State>({...})`, `usePosition({ open, anchorRef, floatingRef, side, align })` (applies styles itself), `usePositioner({ open, anchorRef, floatingRef, side, align, offset, mount })` returning `{ isPresent, positionerProps, state, position, arrowRef }`, `useDismiss({ enabled, refs, onDismiss })` with `DismissReason`, `useFocusReturn({ open, popupRef })`, `useListNavigation({ enabled, containerRef, itemSelector, activeId, setActiveId, mode })`, `useListboxSelection<string>({ value, setValue, multiple, setOpen, name })` with `registerOption`/`selectedLabels`/`hiddenFields`, `useTypeahead()` returning `(char) => string`.
- **No casts:** the `usePositioner` demo omits a manual arrow specifically to avoid the `RefObject<HTMLElement>` → `Ref<HTMLDivElement>` mismatch (the built-in `Arrow` attaches `arrowRef` inside `renderElement`'s untyped `props` bag, which a hand-written demo would have to cast around). Per `CLAUDE.md`, reshape over cast: dropping the arrow is the reshape.
