# Headless UI Components for hono-preact: a decision/research investigation

**Status:** Investigation (decision doc, no code)
**Date:** 2026-05-31
**Author:** Steven Beshensky (with Claude)
**Audience:** Framework author deciding whether to take on a standalone, Preact-native headless component library, and how to architect it if so.

---

## How to read this doc

This is a research/decision document, not an implementation spec. It is anchored on four choices already made going in, so it argues *how to execute them well* rather than relitigating them:

1. **Standalone** Preact headless library, usable by any Preact app; the framework merely ships it. No runtime dependency on React or on the reference libraries.
2. **Build native** to Preact: we own the interaction and accessibility logic, drawing inspiration from Radix UI, Base UI, Headless UI, and React Aria, but not depending on them.
3. **Scope** is the hard behavioral cluster: Dialog, Popover, Tooltip, Menu/Dropdown, Select (listbox), Combobox, plus the shared machinery they all need.
4. **Styling** is not mandated. Components ship unstyled and expose state for styling. An *optional* styling primitive is evaluated separately, informed by Remix v3's direction.

Claims are cited inline by source number; the full source list with access notes is at the end. Dates are attached to anything time-sensitive (browser support, library status), because this space moves fast.

> **Research provenance.** Findings were gathered by fanning out web searches and fetching primary sources (official docs, source repos, specs, maintainer posts) from the main session, then cross-checking. Library-internal claims (who uses Floating UI, Base UI's lineage) are corroborated across at least two sources. Where a primary source could not be pinned (notably Remix v3's styling primitive, which is not yet publicly specified), the doc says so explicitly rather than guessing.

---

## 1. Thesis and recommendation

**Recommendation: proceed, conditionally, with a platform-as-baseline posture.** Build a small standalone Preact-native headless library for the hard cluster, leaning on the browser for the genuinely hard, churny pieces *to the extent those platform features are safe to depend on across all currently-used browser versions, not just the latest*. That qualifier is load-bearing; it is the first hard condition below. What the platform safely gives us today, because it is Baseline **Widely Available** (past the 30-month interoperability mark [S36]):

- **`<dialog>`** (interoperable since March 2022): modal focus containment, `inert`-ing the rest of the page, top-layer stacking, Escape handling, implicit `aria-modal`, initial focus, `::backdrop` [S14]. **Safe to depend on.**
- **`inert`** (interoperable since April 2023): background-inerting for any hand-rolled overlay path [S36]. **Safe to depend on.**

What the platform offers but we may **not** depend on as a *base* mechanism, because it is only Baseline **Newly Available** (in current versions, but not in older-but-still-current versions that the support requirement covers):

- **The Popover API** (Newly Available Jan 2025): top-layer placement, light-dismiss, `::backdrop`, `:popover-open` [S12]. **Progressive enhancement only.**
- **CSS anchor positioning** (Newly Available early 2026; Safari `@position-try` only in 18.4+) [S11][S15]. **Progressive enhancement only.**

So the build is neither "reimplement Radix + Floating UI + React Aria" nor "assume the bleeding-edge platform." It is: **depend on the Widely-Available platform primitives (`<dialog>`, `inert`); use the framework-agnostic `@floating-ui/dom` as the *primary* positioning engine so positioning works on every current browser; layer the Newly-Available platform features (Popover API, CSS anchor positioning) on top as feature-detected progressive enhancement; and write our own thin ARIA + keyboard + collection layer.** That last layer is the actual product, a few thousand lines, not tens of thousands.

**Three hard conditions on the recommendation:**

1. **Every primitive must work on all currently-used browser versions, not just the latest.** This is a non-negotiable requirement. Operationally it means: depend only on features that are Baseline **Widely Available** (the web.dev definition: 30 months past the date all core browsers, Chrome/Edge/Firefox/Safari on desktop and mobile, became interoperable [S36]). Anything merely Baseline **Newly Available** (Popover API, CSS anchor positioning) or below is permitted *only* as progressive enhancement, layered over a baseline that already delivers the behavior without it, and gated by feature detection (`@supports`, capability checks). The 30-month bar is the operational proxy for "all current versions"; if the team has a concrete analytics-driven support target (an explicit browserslist), substitute that, but it should be at least this conservative. Concrete consequences: `@floating-ui/dom` is the primary positioning engine and CSS anchor positioning is opt-in; a JS-driven portal + light-dismiss is the baseline for non-modal overlays and the Popover API is an enhancement; `<dialog>.showModal()` and `inert` are fine to depend on.
2. **Scope the accessibility bar honestly.** Target WAI-ARIA APG conformance plus a real screen-reader test matrix (NVDA, JAWS, VoiceOver). Do *not* promise React Aria's depth: Adobe's library carries years of i18n (RTL, locale-aware collation), touch, and screen-reader-quirk work that a small team will not match [S6][S20]. Match the *pattern correctness* bar, not the *Adobe-grade i18n* bar, and document the difference.
3. **Accept this is a long-tail maintenance commitment, not a one-time build.** The recurring cost is not writing the components; it is the endless tail of Safari focus bugs, IME/composition handling in the combobox, and screen-reader regressions [S21]. If the team cannot fund the tail, the better call is "document `preact/compat` + an existing library" (alternative B below).

**Confidence:** medium-high on feasibility (the Preact-native primitives are verified present [S1-source][S2-source][S3-source][S4-source][S5-source]; the platform primitives are real and shipping). Medium on the cost/benefit being worth it, because that turns on how much the team values a tiny, compat-free, framework-integrated library versus the maintenance it signs up for.

**The honest counter-signal:** the industry is *consolidating*, not fragmenting. Base UI launched v1.0 in December 2025 explicitly "from the creators of Radix, Floating UI, and Material UI," with 35 components and a full-time team of seven [S18][S19]. The people who built three of our four reference libraries pooled into one. Building a fifth, on Preact, runs against that current. The justification has to be the things consolidation does not give a Preact framework: zero `preact/compat` tax, a tiny footprint consistent with the "small framework" ethos, and deep integration with hono-preact's SSR, streaming, and View Transitions story.

---

## 2. Why this matters

The gravitational pull toward React for application work is, in large part, a *components* pull. A team reaches for React not because the renderer is better but because `npm i` buys a battle-tested Dialog, Combobox, and Menu that are accessible, keyboard-correct, and positioned right. Preact gets you the renderer and `preact/compat` gets you *most* of those React libraries, but compat is a tax (bundle, subtle behavioral mismatches, and a dependency on React-shaped APIs) and it undercuts the "small framework" pitch.

hono-preact already demonstrates a house style of small, typed, SSR-aware primitives: loaders, actions, guards, forms, a View Transitions toolkit, and a `Persist`/`PersistHost` registry pattern. The gap between "we have a great router/data/forms story" and "...and here is your accessible Combobox" is exactly the gap that sends people back to React. Closing it, even partially, materially strengthens the framework's reason to exist.

The risk of *not* doing this is status quo: users either pull in `preact/compat` + Radix/React Aria (works, but heavy and off-brand) or hand-roll overlays (and ship inaccessible ones). The risk of doing it badly is worse: shipping components that *look* accessible but fail in JAWS, which is actively harmful. That tension is what Sections 4 and 7 are about.

---

## 3. Comparative teardown of the four reference libraries

This section reads each library on the hard problems and extracts what to borrow and what to reject for a clean-room Preact build.

### 3.1 Focus management

| Library | Mechanism | Notable |
|---|---|---|
| **Floating UI** (`@floating-ui/react`) | `FloatingFocusManager` traps focus with sentinel **focus guards**; `modal` (default) fully contains, non-modal lets focus escape; `initialFocus`, `returnFocus` (default true), `restoreFocus`, and `visuallyHiddenDismiss` for touch screen-reader users [S1] | Guards can be disabled (`guards={false}`) to behave like a native dialog [S1] |
| **React Aria** | `FocusScope` with `contain` / `restoreFocus` / `autoFocus`; `useFocusManager` exposes `focusNext`/`focusPrevious` with wrap [S4] | Cleanest separation of "scope" from "manager"; nested-scope coordination is implicit |
| **Radix** | `FocusScope` primitive used inside Dialog/Popover; sentinel-guard approach similar to Floating UI | Pairs with `DismissableLayer` (below) |
| **Headless UI** | `FocusTrap` component | Simpler, fewer escape hatches |

**Borrow:** the sentinel-guard focus trap, the modal-vs-non-modal split, and the `initialFocus`/`returnFocus`/`restoreFocus` triad. Crucially, the `visuallyHiddenDismiss` idea (a visually hidden dismiss button so VoiceOver/touch users without an Escape key can close a modal) is a detail small libraries forget [S1].

**Reject / replace with platform:** for *modal* dialogs, you can largely skip the hand-rolled focus trap by using `<dialog>.showModal()`, which contains focus, `inert`s the background, and handles Escape natively [S14]. Reserve the JS focus scope for non-modal overlays (menus, listboxes, comboboxes) and for the focus-restoration-on-close logic the platform does not fully cover.

### 3.2 Dismissal and layering

- **Floating UI `useDismiss`** is the reference design: `outsidePressEvent` defaults to `pointerdown` (eager) and can be `click` (lazy); `escapeKey` on by default; `ancestorScroll` to dismiss on scroll; and a `bubbles` option controlling whether Escape/outside-press propagate to ancestor floating elements [S2].
- **Nested overlays** are coordinated by **`FloatingTree`**: nested floating elements that are *not* DOM-nested register via `useFloatingNodeId` / `FloatingNode`, and an event emitter lets parents and children coordinate dismissal (so closing a submenu does not close its parent, and vice versa) [S3]. Turning off Escape/outside-press bubbling *requires* a `FloatingTree` [S2].
- **Radix** has the analogous `DismissableLayer` with a layer stack.
- **React Aria** uses `useOverlay` + `usePreventScroll` + a modal provider to manage outside-interaction dismissal and scroll locking.

**Borrow:** the `useDismiss` option surface (pointerdown-vs-click, escape, ancestor-scroll, bubbles) and the **tree/layer registry** for nested coordination. This is the single most important machinery decision; nested menus and "popover-inside-dialog" are where naive implementations break.

**Local precedent worth noting:** hono-preact's `Persist`/`PersistHost` is already a registry + subscribe + single-host-renders-entries pattern, with SSR rendering inline and the client host owning the DOM [S16]. A `LayerHost` + dismissable-layer registry is the same shape. We have built this pattern before in this codebase.

**Reject:** do not invent a bespoke z-index scheme. Use the **top layer** so stacking is browser-managed: via `<dialog>` (Widely Available, safe to depend on) for modals, and via the Popover API as progressive enhancement (Newly Available) over a portal-based baseline for non-modal overlays [S12][S14]. The portal baseline must stand on its own on browsers without the Popover API.

### 3.3 Positioning and anchoring

This is the most important "reuse, don't rebuild" call in the whole investigation.

- **Floating UI** is the de-facto positioning engine of the ecosystem: it underlies Radix (via `@radix-ui/react-popper` → `@floating-ui/react-dom`), Headless UI v2, and Mantine, among others [S17]. Its model is a **middleware queue**: `offset`, `flip`, `shift`, `size`, `arrow`, `autoPlacement`, `hide`, `inline`, executed in order, with `flip`/`size` resetting the lifecycle so later middleware do not run on stale coordinates [S10]. `computePosition()` does a one-shot calculation; `autoUpdate()` keeps it synced on scroll/resize.
- **Critically for us, the package is split:** `@floating-ui/dom` is the framework-agnostic core (positioning only); `@floating-ui/react-dom` adds the React positioning hook; and `@floating-ui/react` adds the *interactions* (`useDismiss`, `useListNavigation`, `useTypeahead`, `FloatingFocusManager`, `FloatingPortal`, `FloatingTree`) [S9]. **`@floating-ui/dom` has no React dependency and is directly consumable from Preact.**
- **React Aria** is the outlier: it ships its own positioning (`useOverlayPosition`), not Floating UI.
- **CSS anchor positioning** is the emerging native alternative: `anchor-name`, `position-anchor`, `anchor()`, `position-area`, and `position-try` fallbacks for collision handling, now Baseline (early 2026) at ~91% traffic, though Safari's `@position-try` flip lags to 18.4+ [S11][S15].

**Recommendation:** `@floating-ui/dom` is the **primary** positioning engine, with CSS anchor positioning layered on as opt-in progressive enhancement where present. This ordering follows directly from the browser-support rule (condition 1, Section 1): CSS anchor positioning is only Baseline Newly Available, and Safari's `@position-try` flip lags to 18.4+ [S15], so it cannot be the *base* mechanism if positioning must work on every current browser version. `@floating-ui/dom` works everywhere, carries no framework lock-in, and is the most-shared positioning core in the ecosystem [S9][S17]. Reusing it is the one pragmatic exception to "zero dependencies" worth making: positioning math is genuinely hard, and re-deriving it is the worst use of the team's time. Treat CSS anchor positioning as a future-facing enhancement (behind `@supports`) that can shed JS work as it crosses into Widely Available (on the 30-month rule, roughly 2028).

### 3.4 Collections, typeahead, and roving tabindex

- Two navigation models exist: **roving tabindex** (real DOM focus moves between items; exactly one item has `tabindex=0`, the rest `-1`; the group "remembers" the last-focused item) and **`aria-activedescendant`** (focus stays on the container, a pointer attribute names the active item) [S8]. Roving suits menus/toolbars where focus genuinely moves; activedescendant suits comboboxes where focus must stay in the text input.
- Item registration is a **context + ref-collection** pattern: items self-register on mount into a `Map`/ordered list keyed by id, and the collection derives order from the DOM (e.g. `querySelectorAll`) [S8]. Radix has a `Collection` util; Base UI has `Composite`/`CompositeList`; React Aria has a full `Collection` API with `useCollator` for locale-aware typeahead.
- **Typeahead** (type-to-focus) is APG-recommended for listboxes and menus [S22].

**Borrow:** the context + ref-collection registration, both navigation models (the combobox *needs* activedescendant; the menu wants roving), and typeahead. **Reject** React Aria's full virtualized Collection API as over-scoped for a first version; add virtualization only if a real use case demands it.

### 3.5 Accessibility depth (the ARIA-correct vs actually-works gap)

- **React Aria is the consensus gold standard**, precisely because it invests past "ARIA-correct markup" into real screen-reader behavior, touch, and i18n (RTL, collation) [S6][S20]. This is the bar a small team should *not* claim to meet.
- The gap is real and well-documented by practitioners: Sarah Higley notes that `role="tooltip"` "does not appear to affect screen reader announcements in any meaningful way" (the `aria-describedby`/`aria-labelledby` wiring does the work), and that tooltips are "fundamentally inaccessible on touch devices when attached to buttons or links" [S23]. Adrian Roselli's long-standing point is that the APG menu pattern (`role=menu`/`menuitem`) is routinely misapplied to site navigation, where it actively harms keyboard/SR users [S24].
- Even the APG is not gospel: its **tooltip pattern is explicitly "work in progress" without task-force consensus** [S25].

**Borrow:** the discipline of testing in real screen readers, not just auditing markup. **Reject:** the assumption that following the APG is sufficient. Treat the APG as a floor, layer practitioner guidance on top (Higley, Roselli, Heydon Pickering), and *test*.

### 3.6 SSR and id stability

- Radix's guidance: ids for ARIA wiring come from `useId` on React 18+; pre-18 it relied on hydration-time id generation, which delayed screen-reader readiness [S26]. All Radix primitives are SSR-compatible.
- The universal failure mode is non-deterministic ids (`Math.random()`, counters that diverge between server and client) producing hydration mismatches in `aria-labelledby`/`aria-controls` [S27].

**Borrow:** `useId`-based id wiring, full stop. Preact's `useId` is SSR-stable (Section 4), so this is a solved problem for us *provided* Preact renders both server and client.

### 3.7 Styling stance and composition (polymorphism)

This directly informs Section 6. Every library converges on the same core idea (expose state via data-attributes) and diverges on the composition mechanism:

| Library | State exposure | Composition primitive |
|---|---|---|
| **Radix** | `data-state`, `data-side`, etc. | **`asChild` + `Slot`**: merges props onto the child; child event handlers take precedence; `Slottable` for multi-child cases; child must `forwardRef` and spread props [S29][S30] |
| **Base UI** | `data-open`/`data-closed`/`data-side`/`data-align`/`data-starting-style`/... | **`render` prop** (function or element) [S31] |
| **React Aria (RAC)** | `data-hovered`/`data-pressed`/`data-selected` that work *consistently across mouse/touch/keyboard* | **render-prop children** + functional `className`/`style`; `defaultClassName`/`defaultStyle`/`defaultChildren`; optional Tailwind plugin [S20] |
| **Headless UI** | `data-open`/`data-focus`/`data-disabled` | **`as` prop** + render-prop children exposing `active`/`focus`/`disabled`/`open`/`close` [S32] |

**Borrow:** the **data-attribute contract** as the universal styling surface (it pairs with plain CSS, CSS Modules, Tailwind, or anything); React Aria's insight that states should be modality-consistent (a single `data-pressed` that behaves the same for mouse, touch, and keyboard [S20]); and **Base UI's `render` prop as the single composition + polymorphism primitive** [S31]. The decisive reason here is local, not abstract: hono-preact already ships exactly this pattern as the internal `useRender` (paired with `mergeRefs`), and the View Transitions components (`ViewTransitionName`, `ViewTransitionGroup`) are built on it cleanly [S37]. `render` accepts an element, a function, or a tag string, and the primitive merges framework props/class/ref onto it. Standardize the component library on this: promote `useRender`/`mergeRefs` from `internal` to a public composition primitive, and extend the function form to also receive component **state** (`(props, state) => VNode`), so one API covers both polymorphism and state-exposed styling, the job Radix splits across `asChild`/`Slot` plus a separate render-prop-children mechanism.

**Reject:** Radix's `Slot`/`asChild` (not because it is bad, but because the Base UI-style `render` prop is what we already use and it unifies polymorphism with state access in one API), and Headless UI's `as`-prop polymorphism. One honest caveat about the `render` prop: deeply nested composition (a button that is simultaneously a tooltip trigger and a dialog trigger) reads slightly more verbosely than nested `asChild`. This has not been a problem in the View Transitions usage and is an acceptable trade for the single-API consistency [S37].

---

## 4. The Preact-native angle

The headline question, "can the techniques these React libraries depend on be reproduced natively on Preact?", resolves to **yes, and Preact's model actively suits a platform-leaning library.** The core primitives are present under `preact/compat` (verified, high confidence, against the Preact hooks guide and compat source [S1-source]):

**What works natively:**

- **`useId`** exists since Preact **10.11.0** and produces ids consistent across server and client, enabling stable SSR `aria-labelledby`/`aria-controls` wiring. It requires Preact on both server and client and `preact-render-to-string` 5.2.4+ [S1-source]. hono-preact already renders Preact on both ends, so this is satisfied.
- **`useSyncExternalStore`** is available via `preact/compat`, the same external-store subscription primitive React Aria/Radix/Floating UI use. Its one gap is the third `getServerSnapshot` argument, which Preact does not support [S3-source]. This rarely bites: per-instance interaction state has deterministic server-and-initial values, so a server snapshot is not needed. Where it does (browser-API reads like media queries or `document.dir`), a ~10-line wrapper bridges it by selecting the server snapshot until hydration completes, gated on a Suspense-aware `useIsHydrated` (a small module-flag hook built on Preact's `options` hooks, after Jovi De Croock's `pracht` [S38]; this matches the framework's existing `options` usage, e.g. the View Transitions `debounceRendering` scheduler). Use the module-flag `useIsHydrated`, not a per-component `useState`+`useEffect` flag: the latter replays the server snapshot for a frame on overlays mounted *after* initial hydration, whereas the module flag returns true immediately for late mounts. No Preact fork required.
- **`useLayoutEffect`** runs after diff and before paint, the correct timing for a Floating UI positioning binding to measure and place in a single paint (no pop-in) [S4-source].
- **`useImperativeHandle`** is native in `preact/hooks`, for ref-exposed methods like `.focus()` [S5-source].

**Two differences from React, both of which help here rather than hurt:**

1. **No concurrent mode, and we do not need it.** `useDeferredValue` is a passthrough, `useTransition` a no-op (`isPending` always false, `startTransition` runs synchronously), and `useInsertionEffect` is aliased to `useLayoutEffect` under `preact/compat` [S2-source]. None of this affects a headless interaction library: these libraries do not rely on concurrent features for correctness, and the one common consumer of `useInsertionEffect`, runtime CSS-in-JS style injection, is something we have already decided not to build (Section 6). Treat this as a simplification to lean into, not a caveat to engineer around.
2. **Native DOM events that do not bubble through Portals, which is the behavior we want.** Preact has no synthetic event system; events bubble through the real DOM, and a portaled overlay's events propagate to its actual DOM location, not back to the virtual component that rendered the portal [S33]. In React, synthetic events reparent to bubble through the vnode tree, which routinely surprises people (a click inside a portaled dropdown fires handlers on React ancestors that live elsewhere in the DOM), and libraries carry workarounds for it. Preact's model is DOM-faithful, so it matches exactly how you reason when leaning on the platform: our dismissal and layering build on document-level capture-phase `pointerdown`/`click` listeners plus the explicit layer-stack registry (Section 5), which is the robust approach Floating UI and Radix converge on regardless, and we get it with no portal-bubbling quirk to undo. (Minor: use `onInput`, not React's `onChange`, for the combobox text input [S33].)

This is the through-line of the whole recommendation: **lean on the platform as far as it will take us.** Native events, the native top layer (`<dialog>`), `@floating-ui/dom` for the one genuinely hard primitive, and progressive enhancement toward Popover/anchor positioning as they reach Widely Available. We own only the irreducible ARIA + keyboard + collection logic that the platform still does not provide.

**Positioning binding:** consume `@floating-ui/dom` directly and drive it from a `useLayoutEffect` binding (optionally signal-backed). Do **not** reach for `@floating-ui/react`; its value is the interactions layer, which we are writing ourselves, and it is React-bound [S9].

**Signals:** note that hono-preact today is **hooks-based and does not depend on `@preact/signals`** (verified: no signals import anywhere in the packages). A component library *may* use signals internally for its state machines, but it is not required and would add a dependency. Recommendation: keep the public API hooks-and-props shaped (matching the rest of the framework and maximizing standalone reach), and treat signals as an optional internal implementation detail at most.

**Precedent gap:** the research surfaced no mature *Preact-native* headless library. The non-React headless efforts cluster in other ecosystems: Melt UI (Svelte builders) and Bits UI built on it; Zag.js (framework-agnostic interaction **state machines** with React/Vue/Solid adapters) and Ark UI built on it; Kobalte/Corvu (Solid); Ariakit (React); Reka UI / Radix Vue (Vue) [S35]. The absence of a Preact entry is both a risk (no trail to follow) and the actual opportunity (a real, unfilled niche).

---

## 5. Shared machinery design sketch

The components are thin; the machinery underneath is the product. Proposed units, each independently testable, each with one job:

1. **`LayerHost` + dismissable-layer registry.** A single host renders registered overlay layers into a portal target by default (the baseline that works on every current browser), promoting to the native top layer via `<dialog>`/Popover where available, maintaining a stack. Layers register/unregister; the stack drives Escape and outside-press routing (innermost first) and nested coordination (the `FloatingTree` idea). *Directly modeled on the existing `PersistHost` registry pattern [S16].*
2. **`useDismiss`-equivalent.** Document-level capture listeners for outside-press (pointerdown default, click option) and Escape, with `bubbles`-style control over whether dismissal propagates up the layer stack [S2]. Preact-safe by construction (document listeners, not portal bubbling).
3. **`FocusScope`.** Sentinel-guard containment + `initialFocus`/`returnFocus`/`restoreFocus`, used for non-modal overlays. Modal dialogs delegate to native `<dialog>.showModal()` for containment/inert and only use the scope for restoration [S1][S14].
4. **Positioning binding.** `@floating-ui/dom` (`offset`/`flip`/`shift`/`size`/`arrow` + `autoUpdate`) as the primary engine, driven from a layout-effect; CSS anchor positioning layered behind feature detection as a future enhancement [S9][S10][S11].
5. **Collection + navigation.** Context + ref-collection registration; pluggable navigation strategy (roving tabindex for menus, `aria-activedescendant` for comboboxes); typeahead [S8][S22].
6. **Id/SSR wiring.** `useId`-based helpers for `aria-labelledby`/`aria-controls`/`aria-describedby` [S1-source][S26].
7. **`render`-prop composition primitive + state-data-attribute helpers.** Promote the existing internal `useRender`/`mergeRefs` (the Base UI-style `render` prop already used by the View Transitions components [S37]) to a public primitive, extended so the function form receives component `state`; plus prop/class/ref merging and a consistent `data-*` state contract, modality-consistent in the React Aria sense [S20][S37].

Each hard component (Section 8) is then an assembly of these units plus its specific ARIA wiring and keyboard map. That is what keeps the per-component code small and the surface area auditable.

---

## 6. The styling story

### 6.1 The unstyled-component contract (not optional, this is the foundation)

Components ship **zero CSS** and expose state exclusively through **data-attributes** (`data-state="open"`, `data-side="bottom"`, `data-disabled`, etc.), modality-consistent per React Aria's model [S20]. This is the lowest common denominator that every styling approach can target: plain CSS, CSS Modules, Tailwind, vanilla-extract, anything. Plus the `render`-prop composition primitive (the existing `useRender` [S37]) and full `class`/`style`/`ref` passthrough. This contract alone satisfies "I don't want to mandate a styling system, I'd prefer normal styles." Nothing beyond this section is required for the library to be useful.

### 6.2 What Remix v3 actually does (and the honest unknown)

Remix v3 (the ground-up rewrite announced in the "Wake up, Remix!" post, May 2025) forks Preact, drops React, and builds its own component model on web primitives like `EventTarget`, under six principles: **Model-First, Build on Web APIs, Religiously Runtime, Avoid Dependencies (goal: zero), Demand Composition, Distribute Cohesively** [S13]. "Religiously Runtime" specifically means *not designing around bundlers/compilers*; all code must run without a build step [S13].

**The honest finding: Remix v3's styling primitive is not publicly specified as of this writing.** The announcement post contains zero styling specifics [S13], and searches for a concrete mechanism surface only Remix *v2* / styled-components material, not a v3 primitive. What we *can* infer from the stated principles is directional, not literal: a framework that prizes runtime-over-build-step and web standards and zero dependencies is philosophically biased **away** from a heavy build-time CSS compiler and **toward** plain CSS plus runtime-bound class/style objects. That inference aligns neatly with the user's own instinct ("just use normal styles"), but it should be treated as inference, not as a documented Remix API. Re-check when v3 publishes styling docs.

### 6.3 Candidate styling-primitive mechanisms

If we offer an *optional* primitive beyond the data-attribute contract, the field is:

| Mechanism | Runtime cost | SSR/stream | Notes |
|---|---|---|---|
| **Data-attributes + plain CSS / CSS Modules** | none | trivial | The baseline. Already covered by 6.1. CSS Modules adds scoping with zero runtime. |
| **Class/variant utility** (clsx + cva / tailwind-variants) + the `render` prop | tiny runtime | trivial | Ergonomic variant API; no build step; pairs with the data-attribute contract. Matches the "runtime, no compiler" bias. |
| **Build-time CSS extraction** (vanilla-extract, Linaria, StyleX) | zero runtime | great | Static stylesheets, colocated authoring, but introduces a build transform. Against the "religiously runtime" bias; *optional* at most. |
| **Runtime CSS-in-JS** (styled-components/Emotion style) | meaningful runtime | poor with streaming | Declining across the industry (RSC pressure, runtime cost, streaming-SSR friction) [S34]. **Do not build this.** |

### 6.4 Recommendation for the styling layer

A **layered, un-mandated** approach. **Decided (2026-06-01):** option 1 is the styling layer the library ships; option 2 is explicitly deferred as future-optional; option 3 stands as a non-goal.

1. **DECIDED, ship it: the data-attribute contract + the `render` prop + class/style passthrough.** This is the whole requirement. Works with everything, mandates nothing, matches the framework ethos. This is the locked styling layer for the initial library.
2. **Deferred (future-optional): a tiny runtime variant helper** (a `cx`/variants function plus the `render`-prop primitive), shipped as a separate optional entry point. Runtime, no compiler, consistent with the inferred Remix v3 direction and the user's "normal styles" preference. *Not in the initial scope.* Revisit only if real consumer friction with hand-written `class` strings shows up; the data-attribute contract (option 1) must remain fully usable without it.
3. **Do not** mandate or build a CSS-in-JS runtime. **Do not** mandate build-time extraction; if a team wants vanilla-extract-style extraction, the existing hono-preact `vite` package is the natural place to offer it as an *opt-in* transform later, but it should never be required to use a component.

The styling primitive, in other words, is mostly a *contract* (data-attributes) plus a *very small* runtime helper, not a styling system. That is the most defensible reading of "told through a primitive of our own, similar to how Remix v3 is approaching styling."

### 6.5 Copyable styled examples (the Base UI distribution model)

**Decided (2026-06-01).** Because the library ships unstyled (6.1), the styling story is completed not by a styling system but by **copyable styled examples**, exactly as Base UI does it. Each component's documentation page carries a live, styled demo with a **copy button**, and the styles are offered in two flavors via tabs:

- **Plain CSS** (vanilla stylesheet, data-attribute selectors), and
- **Tailwind** (utility classes plus `data-[state=open]:`-style variant selectors).

The consumer copies whichever flavor fits their app and adapts it. There is **no CLI and no registry** (rejected: shadcn-style tooling and a separate examples package both add infrastructure the docs-site model does not need). The docs site is the single canonical source of the styled examples.

**Why this completes the styling story:** the data-attribute state contract (6.1) is what makes the examples expressive with **minimal JavaScript**. State is exposed as `data-state="open"`, `data-side="bottom"`, `data-disabled`, etc., so the examples drive appearance and motion almost entirely in CSS:

- **Baseline (depend on it):** data-attribute selectors + CSS `transition` for state changes on elements that stay mounted (e.g. a tooltip fading on `data-state`). This works on every current browser and carries no JS animation code.
- **Progressive enhancement only:** enter/exit animation of elements that mount/unmount (`@starting-style`, `transition-behavior: allow-discrete`) is Baseline *Newly Available*, so per Section 1 condition 1 it is layered on top behind feature detection, never the base mechanism. Examples must look correct (just without the enter/exit animation) when these are absent.

This keeps the examples honest with the browser-support rule while still showcasing the data-attribute contract's payoff: rich, CSS-driven state and motion with almost no JavaScript.

---

## 7. Risks, maintenance cost, and the accessibility bar

**The cost is the tail, not the build.** Writing six components on top of the Section 5 machinery is a bounded, weeks-to-a-few-months effort. The unbounded part is maintenance: Safari/iOS focus and scroll-lock bugs, IME/composition handling in the combobox, screen-reader regressions across NVDA/JAWS/VoiceOver versions, and browser behavior changes [S21]. This is a *standing* commitment. The reference libraries each have substantial open issue tails precisely here.

**The bus-factor and consolidation reality.** Floating UI, the engine half the ecosystem depends on, is largely one maintainer's work [S17]. Radix originated at Modulz and is now under WorkOS; Headless UI is Tailwind Labs; React Aria is an Adobe team [S6]. And the strongest signal: **Base UI v1.0 (Dec 2025) pooled the creators of Radix, Floating UI, and Material UI into a single seven-person full-time team** [S18][S19]. The market is concentrating expertise, not spreading it. A solo/small-team Preact library is swimming against that, which is fine *if* the differentiators (Preact-native, tiny, framework-integrated) are worth it and the maintenance tail is funded.

**The accessibility bar, stated honestly.** Target: APG pattern conformance for each component [S22], verified against a real screen-reader matrix (NVDA + Firefox/Chrome, JAWS + Chrome, VoiceOver + Safari), with documented keyboard maps. Explicitly *out of scope* for a first version: React Aria-grade i18n (locale-aware collation for typeahead, full RTL), advanced touch screen-reader handling, and virtualized collections. Document these as known limitations. The failure mode to avoid at all costs is shipping components that pass an automated axe scan but fail in JAWS; that is worse than shipping nothing, because it gives a false sense of accessibility [S6][S23].

**Patterns that are genuinely hard (plan extra time):** the **Combobox** (the APG combobox pattern, `aria-activedescendant` + `aria-autocomplete` semantics, IME, and the documented gap between markup and screen-reader reality [S28][S6]) and a custom **Select/listbox** (Sarah Higley's "Select Your Poison" work documents how hard a credible custom select is versus the native element [S20-higley]). The **Tooltip** is deceptively hard for a different reason: WCAG 1.4.13 requires hoverable/dismissible/persistent behavior, `role="tooltip"` does little for screen readers, and tooltips on interactive controls are simply inaccessible on touch [S23]. Consider recommending native `<dialog>`/popover-backed alternatives where the pattern allows.

---

## 8. Proposed roadmap and tiering (if we proceed)

Build the machinery first, then components in increasing difficulty, each leaning on the platform as far as it goes:

**Phase 0, machinery (Section 5).** `LayerHost` + dismissable registry, `useDismiss`, `FocusScope`, positioning binding (`@floating-ui/dom` + CSS anchor), collection/navigation/typeahead, id-wiring helpers, the `render`-prop primitive + data-attribute contract. Establish the screen-reader test harness here. *Nothing ships until the machinery and test harness exist.*

**Phase 1, Dialog.** Easiest because the platform does the most: build on `<dialog>.showModal()` for modal containment/inert/Escape/top-layer [S14], add labelling, restoration, and a non-modal variant. Validates the focus + id + layer machinery end to end.

**Phase 2, Popover + Tooltip.** Exercises the positioning binding and dismissal. Tooltip ships with the WCAG 1.4.13 behaviors and explicit touch limitations documented [S23].

**Phase 3, Menu / Dropdown.** Roving tabindex, typeahead, nested submenu coordination via the layer tree [S2][S3][S8]. First real test of nested dismissal.

**Phase 4, Select (listbox).** `aria-activedescendant` navigation, selection model, typeahead [S22]; consider a native-`<select>`-backed escape hatch given how hard custom selects are [S20-higley].

**Phase 5, Combobox.** The hardest: `aria-autocomplete` semantics, manual vs list/inline autocomplete, IME, and the markup-vs-screen-reader gap [S28][S6]. Do this last, with the most test budget.

Ship per-phase; do not gate the whole library on the combobox. **Each phase's definition of done includes its copyable docs examples (6.5) in both CSS and Tailwind flavors** (not a later documentation pass): a component is not "shipped" until a consumer can copy a working styled example for it. The Phase 0 docs harness should therefore stand up the example-page scaffolding (live demo + copy button + CSS/Tailwind tabs) so each component phase only fills in its own example.

### Alternatives considered (and why not)

- **Alternative A, build everything from scratch including positioning and not leaning on the platform.** Rejected: re-deriving Floating UI's positioning math and ignoring `<dialog>`/popover is the worst use of a small team's time and the main way this effort fails [S10][S14].
- **Alternative B, don't build; document `preact/compat` + Radix/React Aria.** The honest fallback if the maintenance tail cannot be funded. Cheapest, immediately accessible, but carries the compat tax and is off-brand for a "small framework." Keep this in the back pocket.
- **Alternative C, adapt Zag.js** (framework-agnostic interaction state machines) **with a Preact adapter** [S35]. Lighter than writing every machine from scratch and battle-tested, but it is a substantial dependency that cuts against the build-native/zero-dependency ethos, and it would shape our public API around Zag's model. Worth a spike before committing to fully hand-rolled machines, but not the default.

---

## Sources

Primary sources fetched and read for this investigation (access notes where relevant). Library-internal and time-sensitive claims are corroborated across at least two sources.

- **[S1] Floating UI, FloatingFocusManager**: https://floating-ui.com/docs/FloatingFocusManager (focus guards, modal/non-modal, initialFocus/returnFocus/restoreFocus, visuallyHiddenDismiss)
- **[S2] Floating UI, useDismiss**: https://floating-ui.com/docs/useDismiss (outsidePressEvent pointerdown/click, escapeKey, ancestorScroll, bubbles)
- **[S3] Floating UI, FloatingTree**: https://floating-ui.com/docs/floatingtree (nested non-DOM-nested coordination)
- **[S4] React Aria, FocusScope**: https://react-aria.adobe.com/FocusScope (contain/restoreFocus/autoFocus, useFocusManager)
- **[S6] React Aria (general / a11y posture)**: https://react-aria.adobe.com/ and Adobe react-spectrum repo (gold-standard a11y/i18n)
- **[S8] Roving tabindex (Joshua Wootonn)**: https://www.joshuawootonn.com/react-roving-tabindex (roving vs activedescendant, ref-collection)
- **[S9] Floating UI, React package split**: https://floating-ui.com/docs/react (@floating-ui/dom agnostic core vs @floating-ui/react interactions)
- **[S10] Floating UI, middleware**: https://floating-ui.com/docs/middleware (offset/flip/shift/size/arrow, lifecycle reset)
- **[S11] CSS anchor positioning (MDN)**: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_anchor_positioning (page last modified 2026-03-24; anchor-name/position-anchor/anchor()/position-area/position-try)
- **[S12] Popover API (MDN)**: https://developer.mozilla.org/en-US/docs/Web/API/Popover_API (Baseline 2025; auto/manual/hint, light-dismiss, top layer, limits for menus/comboboxes)
- **[S13] "Wake up, Remix!" (Remix blog)**: https://remix.run/blog/wake-up-remix (six principles; forks Preact; no styling specifics) + InfoQ coverage https://www.infoq.com/news/2025/08/remix-run-v3-drops-react/
- **[S14] Native `<dialog>` (MDN)**: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog (Baseline since 2022-03; showModal vs show, inert, top layer, ::backdrop, closedby)
- **[S15] CSS anchor positioning support**: https://caniuse.com/css-anchor-positioning and OddBird Fall 2025 update https://www.oddbird.net/2025/10/13/anchor-position-area-update/ (Chrome 125+, Firefox 147 on 2026-01-13, Safari 18.2+/18.4+; ~91% traffic)
- **[S16] hono-preact local precedent**: `packages/iso/src/persist.tsx` (`Persist`/`PersistHost` registry+subscribe host pattern) and `packages/iso/src/is-browser.tsx` (SSR/browser guard)
- **[S17] Positioning-engine adoption**: Floating UI underlies Radix (`@radix-ui/react-popper` → `@floating-ui/react-dom`), Headless UI v2, Mantine (corroborated via ecosystem sources; PkgPulse 2026 comparison)
- **[S18] Base UI repo**: https://github.com/mui/base-ui ("from the creators of Radix, Floating UI, and Material UI")
- **[S19] Base UI v1.0 (InfoQ, 2026-02)**: https://www.infoq.com/news/2026/02/baseui-v1-accessible/ (35 components, MUI-backed, ~7-person team)
- **[S20] React Aria Components styling**: https://react-aria.adobe.com/styling (modality-consistent data-* states, functional className/style, render props, Tailwind plugin)
- **[S20-higley] "Select Your Poison" (Sarah Higley)**: https://sarahmhigley.com/writing/select-your-poison/ → 24a11y.com/2019/select-your-poison/ (custom select difficulty, usability testing)
- **[S21] Maintenance-tail evidence**: open-issue tails on radix-ui/primitives, adobe/react-spectrum, floating-ui (focus/IME/SR edge cases)
- **[S22] WAI-ARIA APG patterns**: Dialog (Modal) https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/, Menu Button https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/, Listbox https://www.w3.org/WAI/ARIA/apg/patterns/listbox/, Tooltip https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/
- **[S23] Tooltips (Sarah Higley)**: https://sarahmhigley.com/writing/tooltips-in-wcag-21/ (WCAG 1.4.13 hoverable/dismissible/persistent; role=tooltip limits; touch inaccessibility)
- **[S24] ARIA menu roles for nav (Adrian Roselli)**: https://adrianroselli.com/2017/10/dont-use-aria-menu-roles-for-site-nav.html
- **[S25] APG tooltip "work in progress"**: note on https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/ (no task-force consensus)
- **[S26] Radix SSR guide**: https://www.radix-ui.com/primitives/docs/guides/server-side-rendering (useId-based ids)
- **[S27] Hydration id-mismatch (Radix issue #3700 et al.)**: https://github.com/radix-ui/primitives/issues/3700
- **[S28] APG Combobox**: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/ (roles/states, aria-autocomplete none/list/both, manual vs autocomplete)
- **[S29] Radix Slot**: https://www.radix-ui.com/primitives/docs/utilities/slot (prop/handler/ref merge, child precedence, Slottable)
- **[S30] Radix composition guide**: https://www.radix-ui.com/primitives/docs/guides/composition (asChild requires forwardRef + spread props)
- **[S31] Base UI Popover**: https://base-ui.com/react/components/popover (parts model, render prop, data-* attributes)
- **[S32] Headless UI Menu**: https://headlessui.com/react/menu (`as` prop, render-prop state, data-* attributes)
- **[S33] Preact differences to React**: https://preactjs.com/guide/v10/differences-to-react/ (native DOM events, no synthetic system, events do not bubble through Portals, onInput vs onChange)
- **[S34] CSS-in-JS decline**: Josh Comeau "CSS in RSC" https://www.joshwcomeau.com/react/css-in-rsc/ and "Why We're Breaking Up with CSS-in-JS" https://dev.to/srmagura/why-were-breaking-up-wiht-css-in-js-4g9b
- **[S35] Non-React headless precedents**: Zag.js https://zagjs.com/overview/introduction (framework-agnostic state machines; React/Vue/Solid adapters), Melt UI / Bits UI (Svelte), Kobalte/Corvu (Solid), Ariakit (React), Reka UI/Radix Vue (Vue)
- **[S36] Baseline model + `inert`**: web.dev Baseline https://web.dev/baseline ("Newly available" = interoperable across all core browsers; "Widely available" = 30 months later) and `inert` (MDN) https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert (Baseline Widely Available, interoperable since April 2023)
- **[S38] `useIsHydrated` (pracht, Jovi De Croock)**: https://github.com/JoviDeCroock/pracht/blob/main/packages/framework/src/hydration.ts (module-level hydration flag maintained via Preact `options` hooks `__c`/`__e`, Suspense-aware: returns false during SSR and the initial hydration render, flips to true after the app including all Suspense boundaries commits, and reads true immediately for components mounted post-hydration). Not a Preact core API; a small vendorable hook.
- **[S37] In-repo `render`-prop precedent (Base UI-style composition)**: `packages/iso/src/internal/use-render.ts` (`useRender`: `render` accepts element/function/tag string; merges framework props/class/ref) and `packages/iso/src/internal/merge-refs.ts`, consumed by `packages/iso/src/view-transition-name.ts` (`ViewTransitionName`/`ViewTransitionGroup`). Modeled on Base UI's `render` prop [S31]. Currently `internal`; the recommendation promotes it to a public primitive and extends the function form to receive component `state`.

**Preact-native feasibility findings (verified high-confidence, from the deep-research pass against `https://preactjs.com/guide/v10/hooks/` and `preactjs/preact` compat source):**

- **[S1-source]** Preact `useId` since 10.11.0, SSR-consistent, needs `preact-render-to-string` 5.2.4+ (vote 3-0). Sources: preactjs.com/guide/v10/hooks/, preact release 10.11.0.
- **[S2-source]** Concurrent hooks stubbed under `preact/compat`: `useDeferredValue` passthrough, `useTransition` no-op, `useInsertionEffect` = `useLayoutEffect` (vote 3-0). Sources: preactjs.com/guide/v10/hooks/, compat/src/hooks.js.
- **[S3-source]** `useSyncExternalStore` available via `preact/compat`; `getServerSnapshot` 3rd arg gap (#4972) (vote 3-0).
- **[S4-source]** `useLayoutEffect` runs before paint, correct for a Floating UI positioning binding (vote 3-0).
- **[S5-source]** `useImperativeHandle` native in `preact/hooks` (vote 2-1; substance independently confirmed).

> Methodology note: an automated six-workflow deep-research harness was run first; its fetch phase failed in the subagent sandbox (search worked, page-fetch returned empty), so the substantive primary-source reading was redone from the main session, except the Preact-native workflow, which completed and produced the verified findings above. The curated URL set the harness surfaced seeded the manual fetch list.
