# @hono-preact/ui: machinery + Dialog vertical slice (design spec)

**Status:** Design spec (ready for implementation plan)
**Date:** 2026-06-01
**Author:** Steven Beshensky (with Claude)
**Follows:** [Headless components investigation](./2026-05-31-headless-components-investigation.md)

---

## 1. Goal and scope

Stand up a new standalone package, **`@hono-preact/ui`**, and prove the headless-component architecture end to end through one component: a **modal Dialog built on the native `<dialog>` element**. This is the first vertical slice of the larger headless library. It builds only the foundational primitives the Dialog needs and leans on the platform for everything the browser already does well (focus trap, `inert`, top layer, Escape).

Success criteria:

1. A consumer can install `@hono-preact/ui` (peer-dep `preact` only) and render an accessible modal Dialog.
2. The Dialog ships **unstyled** and exposes state via a `data-state` contract, with full `render`-prop composition and class/style/ref passthrough.
3. A `/docs/dialog` page carries a live demo plus copyable **CSS** and **Tailwind** examples, using reusable docs scaffolding built in this slice.
4. The foundational primitives (`useRender`/`mergeRefs`, `useControllableState`, id wiring, the `data-state` contract) exist as the reusable base for later components.
5. All of the above is test-driven; platform behaviors happy-dom cannot emulate are documented as manual-verification items.

**In scope:** the package, the four foundational primitives, the modal Dialog, SSR-correct rendering, entry-only animation hooks, the docs scaffolding, and the Dialog docs page.

**Out of scope (deferred, see Section 12):** non-modal dialog, exit animation, `LayerHost`/dismissal-registry/`FocusScope`/positioning/collections, any second component, CLI/registry tooling, the `hono-preact/ui` umbrella re-export, and release/publish integration.

---

## 2. Architecture decisions (locked)

| Decision | Choice |
|---|---|
| Package | New `packages/ui` → `@hono-preact/ui`, public, standalone, peer-dep `preact` only |
| Component API | Compound parts (`Dialog.Root/Trigger/Popup/Title/Description/Close`), each accepts `render` |
| Dialog substrate | Native `<dialog>.showModal()` (browser supplies focus trap, `inert`, top layer, Esc) |
| Variants | Modal only this slice; non-modal deferred |
| Composition | Base UI-style `render` prop; `@hono-preact/ui` owns its own `useRender`/`mergeRefs` (no dependency on `@hono-preact/iso/internal`) |
| State contract | `data-state="open" \| "closed"` (Radix style) |
| Open state | `useControllableState` (controlled `open`/`onOpenChange` + uncontrolled `defaultOpen`) |
| Animation | Entry via `@starting-style` (CSS only); exit deferred |
| Tests | TDD with Testing Library + happy-dom; platform behaviors flagged for manual verification |

---

## 3. Package layout

```
packages/ui/
  package.json          # @hono-preact/ui, public, peerDeps: preact >=10.11.0
  tsconfig.json         # extends root, rootDir src, outDir dist, declaration + declarationMap
  README.md
  src/
    index.ts            # public barrel
    use-render.ts       # useRender + RenderProp type (public)
    merge-refs.ts       # mergeRefs (public)
    use-controllable-state.ts
    dialog/
      context.ts        # DialogContext + useDialogContext
      dialog.tsx        # Root, Trigger, Popup, Title, Description, Close + `Dialog` namespace
      index.ts
    __tests__/
      use-render.test.tsx
      merge-refs.test.ts
      use-controllable-state.test.ts
      dialog.test.tsx
      dialog-ssr.test.tsx
```

**package.json essentials:** `"type": "module"`, `"sideEffects": false`, `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`, `"files": ["dist","README.md"]`, `"scripts": { "build": "tsc", "dev": "tsc --watch", "prepublishOnly": "tsc" }`, `"peerDependencies": { "preact": ">=10.11.0" }` (10.11.0 is the floor for SSR-stable `useId`), `"license": "MIT"`, `repository.directory: "packages/ui"`, `engines.node >= 20`.

**tsconfig.json:** mirror `packages/iso/tsconfig.json` (extends root, `rootDir: src`, `outDir: dist`, `declaration`, `declarationMap`, `exclude` `__tests__`), inheriting the monorepo's Preact JSX config from the root tsconfig.

**CI/tooling:** `pnpm-workspace.yaml` already globs `packages/*`, so the package is auto-included. The CI build step `pnpm --filter '@hono-preact/*' ...` already globs `@hono-preact/*`, so `@hono-preact/ui` is built without changes; `pnpm typecheck` (`-r exec tsc`) and `pnpm format` (`packages/**`) cover it automatically. **Version stays `0.0.0` and the package is not wired into `scripts/release.mjs`; publishing is deferred.**

---

## 4. Foundational primitives

### 4.1 `useRender` / `mergeRefs` (render-prop composition)

Adapted from the existing `@hono-preact/iso` internal `useRender`/`mergeRefs`, with one extension: the function form receives component **state** as a second argument.

```ts
export type RenderProp<State = Record<never, never>> =
  | VNode
  | string
  | ((props: Record<string, unknown>, state: State) => VNode)
  | undefined;

export function useRender<State>(opts: {
  render?: RenderProp<State>;
  defaultTag: string;
  props: Record<string, unknown>;   // framework-controlled props (ref, aria-*, data-*, handlers)
  state?: State;                     // passed to the function form
  children?: ComponentChildren;
}): VNode;

export function mergeRefs<T>(...refs: (Ref<T> | null | undefined)[]): (node: T | null) => void;
```

Merge rules (unchanged from the iso version): `class`/`className` are joined, `ref` is merged via `mergeRefs`, all other framework props override. Element render uses `cloneElement`; function render is called with `(mergedProps, state)`; string render is the tag; otherwise `defaultTag`.

### 4.2 `useControllableState`

```ts
export function useControllableState<T>(opts: {
  value?: T;            // controlled; when defined, component is controlled
  defaultValue: T;      // uncontrolled initial value
  onChange?: (value: T) => void;
}): [T, (next: T) => void];
```

When `value` is provided the hook is controlled (internal state is ignored for reads; `onChange` is the only way out). When absent it is uncontrolled (internal `useState(defaultValue)`). The setter always calls `onChange` and, in uncontrolled mode, updates internal state. Dialog uses it as `useControllableState<boolean>({ value: open, defaultValue: defaultOpen ?? false, onChange: onOpenChange })`.

### 4.3 id wiring (SSR-stable)

Ids come from Preact `useId` (10.11.0+), generated during render so they are server/client stable.

- **Name (required):** `Dialog.Root` generates `titleId` via `useId`. `Dialog.Title` renders with `id={titleId}`. `Dialog.Popup` sets `aria-labelledby={titleId}` unless the consumer passes an explicit `aria-label` (then `aria-labelledby` is omitted). A dialog must have one or the other (documented; APG requirement).
- **Description (optional):** `Dialog.Root` generates `descriptionId`. `Dialog.Description`, when rendered, uses `id={descriptionId}` and registers its presence in context (layout-effect). `Dialog.Popup` sets `aria-describedby={descriptionId}` only when a Description is present. The name (`aria-labelledby`) is wired eagerly and is SSR-correct; the optional description attaches after hydration, which is acceptable for supplementary text.

### 4.4 `data-state` contract

Every stateful part carries `data-state="open" | "closed"`. CSS targets `[data-state="open"]`; Tailwind uses `data-[state=open]:`. This is the cross-cutting contract for all future components.

---

## 5. Dialog component

### 5.1 Parts and props

```ts
interface DialogRootProps {
  open?: boolean;                 // controlled
  defaultOpen?: boolean;          // uncontrolled (default false)
  onOpenChange?: (open: boolean) => void;
  children?: ComponentChildren;
}

interface DialogTriggerProps {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
  // plus passthrough props spread onto the element
}

interface DialogPopupProps {
  render?: RenderProp<{ open: boolean }>;
  'aria-label'?: string;          // alternative to a Title
  closeOnBackdropClick?: boolean; // default true
  children?: ComponentChildren;
}

interface DialogTitleProps { render?: RenderProp; children?: ComponentChildren; }
interface DialogDescriptionProps { render?: RenderProp; children?: ComponentChildren; }
interface DialogCloseProps { render?: RenderProp<{ open: boolean }>; children?: ComponentChildren; }
```

Exported both as named (`DialogRoot`, ...) and as a namespace object `Dialog = { Root, Trigger, Popup, Title, Description, Close }`.

### 5.2 Behavior

- **Root:** provides `DialogContext` (`open`, `setOpen`, `dialogRef`, `titleId`, `descriptionId`, `triggerId`, `popupId`, description-presence registration). Renders nothing itself (a Fragment of children).
- **Trigger:** default `<button type="button">`. `onClick` → `setOpen(true)`. Attributes: `aria-haspopup="dialog"`, `aria-expanded={open}`, `aria-controls={popupId}`, `id={triggerId}`, `data-state`. Stays in normal document flow.
- **Popup:** renders the native `<dialog id={popupId} data-state aria-labelledby={...} aria-describedby={...}>`. A `useLayoutEffect` syncs the element to state: `open && !el.open` → `el.showModal()`; `!open && el.open` → `el.close()`. A `close` event listener calls `setOpen(false)` so native dismissal (Esc, programmatic) stays in sync. When `closeOnBackdropClick` (default true), a `click` listener closes when `event.target === el` (the backdrop region of a modal `<dialog>` reports clicks as targeting the element itself). No portal and no custom backdrop element; the browser top layer and `::backdrop` handle both.
- **Title:** default `<h2 id={titleId}>`.
- **Description:** default `<p id={descriptionId}>`; registers presence so Popup wires `aria-describedby`.
- **Close:** default `<button type="button">`; `onClick` → `setOpen(false)`.

### 5.3 Rendered DOM (default tags)

```html
<button type="button" aria-haspopup="dialog" aria-expanded="true"
        aria-controls="«p»" id="«t»" data-state="open">Open</button>

<dialog id="«p»" data-state="open" aria-labelledby="«title»" aria-describedby="«desc»">
  <h2 id="«title»">Title</h2>
  <p id="«desc»">Description</p>
  <button type="button" data-state="open">Close</button>
</dialog>
```

`role="dialog"` and `aria-modal="true"` are implicit from `<dialog>` + `showModal()`, so they are not set manually.

---

## 6. SSR and hydration

- Server renders with `open = defaultOpen ?? false`, almost always `false`, so the `<dialog>` is emitted without the `open` attribute (closed, `display: none`). No `showModal()` on the server (it lives in a layout-effect, client-only), so there is no `window`/DOM access during SSR.
- `useId` keeps `titleId`/`descriptionId`/`triggerId`/`popupId` stable across server and client, so the `aria-labelledby` wiring matches on hydration.
- Edge case (documented): `defaultOpen: true` renders **closed** on the server and opens modally only after hydration (a server cannot enter the top layer). This is an accepted limitation for the slice.

---

## 7. Animation

Entry only, CSS-driven through the `data-state` contract plus `@starting-style`. Because `showModal()`/`close()` toggle the element between displayed and `display: none`, the copyable examples animate entry with `@starting-style` on the open state and degrade to no-animation where `@starting-style` is unsupported (it is Baseline Newly Available but degrades cleanly). **Exit animation is deferred**: closing removes the dialog from the top layer immediately. No `transition-behavior: allow-discrete` dependency (not yet reliable for `display: none` across current browsers).

**Planned exit-animation approach (deferred to a separate `usePresence` increment; design vetted 2026-06-01, not in this slice).** When exit animations are added, use a `usePresence` primitive built on `Element.getAnimations()` (Baseline Widely Available since ~2020), not CSS `allow-discrete`/`overlay` (the `overlay` property is Chromium-only, so a CSS-only exit shows no animation on any Firefox or Safari and fails the all-current-browsers bar). Mechanism: on close, keep the native `<dialog>` genuinely open (the browser keeps the real top layer, focus trap, `inert`, Esc, and `::backdrop` for the whole exit), flip `data-state="closed"`, run a plain CSS transition, await `getAnimations({ subtree: true })`, then call `close()` and only then unmount. The same primitive serves the future custom overlays (finalize is unmount instead of `close()`); `data-state` stays `open`/`closed` (the closing phase also renders `closed`, so authors write one `[data-state=closed]` rule). Load-bearing details that must not be skipped:

1. Read `getAnimations()` only **after a forced style flush** (`el.offsetHeight` / `getComputedStyle`), never synchronously in the same task and never via `requestAnimationFrame` (throttled or paused in background tabs); otherwise the set is empty and the dialog closes instantly on every browser.
2. Always race the `.finished` promises against a **timeout derived from the declared timings** (with a hard cap around 3s) so an infinite child animation, an under-reported pseudo, or a backgrounded tab can never leave the modal stuck open blocking the page.
3. An **empty animation set finalizes synchronously** (no exit). Never gate finalize on a `transitionend`/`animationend` event, which never fires in the empty case and hangs the dialog open.
4. `::backdrop` requires `{ subtree: true }` and pseudo coverage still varies, so key finalize timing off the dialog element and treat the backdrop fade as best-effort/cosmetic.
5. Tag each exit with a **generation token** and use `Promise.allSettled` so reopen-mid-exit reverses cleanly (the element was never closed) and a cancelled `.finished` (`AbortError`) is handled, not thrown.
6. Filter out infinite-iteration animations (`getComputedTiming().iterations === Infinity`) before awaiting.
7. Call `close()` **before** unmount so the native focus-return lands on the trigger, not `<body>`.
8. Intercept native Esc: listen for `cancel`, `preventDefault()`, and route through the same animated close path; detect a desynced external `close()` / `method="dialog"` and finalize instantly.
9. No exit on **first mount / SSR** (first-run guard, phase derived synchronously from `open`), and short-circuit to instant finalize under `prefers-reduced-motion` (examples also zero the transition under the media query).

happy-dom cannot emulate `getAnimations()`/real transitions, so unit-test the state machine with `getAnimations()` mocked and flag the real exit animation, top-layer retention during the deferred close, Esc interception, and `::backdrop` as manual-verification items.

---

## 8. Docs example scaffolding

Reusable MDX components added under `apps/site/src/components/docs/`:

- **`<Example>`** renders a live demo (children) in a bordered frame.
- **`<CopyButton text={...} />`** copies a code string to the clipboard with feedback.
- **`<CodeTabs>`** shows labeled tabs; this slice uses **CSS** and **Tailwind** tabs, each with a `<CopyButton>`.

`apps/site/package.json` gains a `@hono-preact/ui: "workspace:*"` dependency so the demo can import `Dialog`.

---

## 9. Dialog docs page

`apps/site/src/pages/docs/dialog.mdx` (route `/docs/dialog`, auto-registered via the pages glob):

- One-paragraph intro: what it is, that it is unstyled and built on native `<dialog>`.
- Usage code (compound parts).
- Live demo via `<Example>` importing `Dialog` from `@hono-preact/ui`.
- Copyable styling in `<CodeTabs>`: a **CSS** flavor (`dialog[data-state="open"]`, `::backdrop`, `@starting-style`) and a **Tailwind** flavor (`data-[state=open]:`, `backdrop:` utilities).
- Accessibility notes and a **manual-verification checklist** (focus trap, `inert` background, Esc, top-layer stacking, screen-reader name/description).

`apps/site/src/pages/docs/nav.ts` gains a new **"Components"** nav section (a 7th section beyond the six in the `add-docs-page` skill) with a `{ title: 'Dialog', route: '/docs/dialog' }` entry. Update the local `add-docs-page` skill's section table to include "Components" so the convention stays documented.

---

## 10. Testing plan (TDD)

Co-located `src/__tests__`, Testing Library + happy-dom (which implements `HTMLDialogElement`). Write tests first.

**Primitives**
- `useRender`: element render merges `class`/`className`, merges `ref`, overrides other props; function render receives `(props, state)`; string render uses the tag; default tag when no `render`; children passthrough.
- `mergeRefs`: function refs called, object refs assigned, `null`/`undefined` skipped.
- `useControllableState`: uncontrolled updates internal state and calls `onChange`; controlled reflects `value` and does not self-update; setter always calls `onChange`.

**Dialog (happy-dom)**
- Trigger click opens: assert state and that `HTMLDialogElement.prototype.showModal` is called (spy).
- Close button calls `close()` and sets state closed.
- Native `close` event (programmatic/Esc) syncs state to closed.
- `aria-labelledby` points at the Title id; `aria-label` on Popup suppresses `aria-labelledby`.
- `aria-describedby` is set only when a Description is rendered.
- `data-state` reflects open/closed on Trigger and Popup.
- Trigger has `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`.
- `render` prop on each part swaps the element and merges props/handlers/ref.
- `closeOnBackdropClick`: a click whose target is the dialog element closes; a click on inner content does not.

**SSR (`preact-render-to-string`)**
- Renders a closed `<dialog>` (no `open` attribute), stable ids, no thrown error (no `window` access).

**Manual-verification only (documented in the docs page, not automated):** real focus trap, background `inert`, top-layer stacking, `::backdrop` appearance, `@starting-style` entry animation, and screen-reader announcement of name/description. happy-dom does not faithfully emulate these.

---

## 11. File-by-file work

**New package `packages/ui/`:** `package.json`, `tsconfig.json`, `README.md`, `src/index.ts`, `src/use-render.ts`, `src/merge-refs.ts`, `src/use-controllable-state.ts`, `src/dialog/context.ts`, `src/dialog/dialog.tsx`, `src/dialog/index.ts`, and the five test files in `src/__tests__/`.

**`apps/site`:** `src/components/docs/Example.tsx`, `CopyButton.tsx`, `CodeTabs.tsx`; `src/pages/docs/dialog.mdx`; edit `src/pages/docs/nav.ts` (add "Components" section); edit `package.json` (add `@hono-preact/ui` workspace dep).

**Repo:** edit `.claude/skills/add-docs-page.md` (add the "Components" section to the table). No changes needed to `pnpm-workspace.yaml`, the CI build filter, or the release script.

---

## 12. Deferred / non-goals

Non-modal Dialog (`show()`), exit animation and `allow-discrete`, `LayerHost`/dismissal-registry/`FocusScope`/positioning/collections (arrive with Popover/Menu), any second component, a browser/Playwright test layer, CLI/registry tooling, the `hono-preact/ui` umbrella re-export, and publishing/release-script integration (the package stays `0.0.0`, unpublished).

---

## 13. References

- Investigation and rationale: [2026-05-31-headless-components-investigation.md](./2026-05-31-headless-components-investigation.md) (platform-as-baseline posture, browser-support rule, `render`-prop decision, `data-state` contract, copyable-examples model).
- Local precedent for `useRender`/`mergeRefs`: `packages/iso/src/internal/use-render.ts`, `merge-refs.ts`; consumed by `packages/iso/src/view-transition-name.ts`.
- Native `<dialog>`: Baseline Widely Available; `inert`: Baseline Widely Available; `@starting-style`: dependable with graceful degradation.
