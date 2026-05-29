# View Transitions toolkit

## Summary

A consumer-facing toolkit built on top of the framework's existing automatic root View Transition (`packages/iso/src/internal/route-change.ts`). Four cohesive modules that together let an app scale View Transitions across many elements, hook into the navigation lifecycle, target CSS by direction, and persist live DOM across route changes:

- **A. Named elements.** Polymorphic `<ViewTransitionName>` / `<ViewTransitionGroup>` components inspired by Base UI's `useRender`, plus underlying `useViewTransitionName` / `useViewTransitionClass` hooks. Maps to the platform's `view-transition-name` and `view-transition-class` CSS properties via a ref callback, with no style-prop coupling.
- **B. Lifecycle hooks.** A four-phase `useViewTransitionLifecycle` API (`onBeforeTransition`, `onBeforeSwap`, `onAfterSwap`, `onAfterTransition`) over a synthesized event. Many subscribers per phase, global, mount-order; any subscriber can `event.skip()` to bypass the transition for one navigation.
- **C. Types and direction.** `useViewTransitionTypes` for declaratively adding `viewTransition.types` strings, and a per-nav direction signal (`'initial' | 'push' | 'replace' | 'back' | 'forward'`) computed once and shared across all hooks. Framework also adds default `nav-*` types so CSS-only consumers get useful behavior on day one.
- **D. Persistent elements.** `<Persist id>` plus an auto-mounted `<PersistHost />`. A registry-backed portal that keeps a DOM subtree alive across SPA navigations so an audio player, chat widget, or toast container retains JS state.

No compiler magic. All four modules build on the framework's existing `__dispatchRouteChange` plumbing and the browser's native View Transitions API. The toolkit is purely additive: existing apps continue to get today's automatic root transition with zero changes.

## Goals

- Give consumers ergonomic primitives to opt elements into View Transitions at scale (lists, hero shared elements, list-to-detail patterns), without forcing a style prop or a compiler.
- Provide synthesized navigation lifecycle events that cover the moments the framework controls (preparation, swap, post-swap, finished).
- Expose navigation direction and View Transition types so CSS can drive forward vs back animations using `:active-view-transition-type()` without app-level JS.
- Persist live DOM (media element state in particular) across route changes through an explicit, registry-backed primitive.
- Compose cleanly: B's lifecycle is the substrate the rest of the toolkit uses; A, C, and D each lower to lifecycle subscriptions.

## Non-goals

- A compiler transform for JSX (no `vt:name`, no `transition:persist` attribute rewriting).
- Cross-document (MPA) View Transitions support. The framework is SPA-first; cross-document is a docs-only story.
- SSR rendering of persisted children into the `<PersistHost />` slot. v1 ships client-only persistence; SSR renders Persist children inline at their declared position and persistence kicks in after the first navigation.
- A `ttlMs` on `<Persist>`. Persisted entries live for the app lifetime by design.
- Replacement of the existing automatic root transition behavior. It continues to fire as today; the toolkit layers on top.
- "Inline DOM-move" persistence (Astro's pattern where a persisted node is reparented into the new layout's flow). Out of scope for v1; portal-style persistence covers the common use cases.

## Architecture overview

Today, `packages/iso/src/internal/route-change.ts` exposes:

```ts
function __dispatchRouteChange(to: string, from: string | undefined): void;
function __subscribeRouteChange(sub: Sub): () => void;
```

`__dispatchRouteChange` calls `document.startViewTransition(() => flushSync(() => {}))` unconditionally when the API exists. The whole toolkit reshapes this single chokepoint:

1. **Direction tracking.** A small history-shim module (loaded once at client entry) patches `history.pushState` / `history.replaceState` to stamp a monotonic counter into `state.__hpVtIdx`, and listens for `popstate` to compare counters and infer back/forward. Direction is exposed via a synchronous getter the lifecycle dispatcher reads.

2. **Phase dispatcher.** `__dispatchRouteChange` is rewritten to build a `ViewTransitionEvent`, walk subscribers in four phases (`beforeTransition`, `beforeSwap`, `afterSwap`, `afterTransition`), and either call `document.startViewTransition` (with `event.types` applied inside the callback) or skip it when any subscriber called `event.skip()` or when the API is unavailable.

3. **Public hooks** (`useViewTransitionLifecycle`, `useViewTransitionTypes`, `useViewTransitionName`, `useViewTransitionClass`) are thin `useEffect` wrappers that register/unregister callbacks in the phase dispatcher's subscriber sets, or in the case of name/class, write a CSS property to a ref'd DOM node.

4. **Polymorphic components** (`<ViewTransitionName>`, `<ViewTransitionGroup>`, `<Persist>`) use a shared `useRender` helper modeled on Base UI's. They accept a `render` prop (string tag, element, or function), merge framework-controlled props (ref, class), and render the resulting tree. The "control" they contribute is the ref callback from the underlying hook.

5. **PersistHost.** A single `<PersistHost />` is auto-mounted by the framework's generated client entry into a stable container appended to `<body>`. It subscribes to a module-level registry; `<Persist>` components write into the registry on mount. Because the host DOM is stable and the child VNode is identical across navigations, Preact's diff preserves the rendered DOM nodes.

Module dependency order is therefore: history shim → phase dispatcher → lifecycle hook → (types, name, class hooks) → (components) → PersistHost. Implementation also ships in this order.

## Detailed design

### Module A: Named elements at scale

**Public surface** (exported from `hono-preact`):

```ts
export function useViewTransitionName(name: string | null | undefined): (node: Element | null) => void;
export function useViewTransitionClass(cls: string | string[] | null | undefined): (node: Element | null) => void;
export function ViewTransitionName(props: VTNameProps): VNode;
export function ViewTransitionGroup(props: VTGroupProps): VNode;

interface VTNameProps {
  name: string | null | undefined;
  groupClass?: string | string[];
  render?: VNode | string | ((props: Record<string, unknown>) => VNode);
  children?: ComponentChildren;
}
interface VTGroupProps {
  class: string | string[];
  render?: VNode | string | ((props: Record<string, unknown>) => VNode);
  children?: ComponentChildren;
}
```

**Hook semantics.** `useViewTransitionName(name)` returns a stable ref callback. When attached to a DOM node, the callback writes `node.style.setProperty('view-transition-name', name)` and remembers the node so it can clear the property on unmount, on a `name` change, or when `name` becomes nullish. `useViewTransitionClass(cls)` does the same for `view-transition-class`, accepting a string or string array which it joins. Both hooks no-op on the server.

The hooks are written to the live DOM via JS, not the JSX style prop, so consumers retain full control of their `style` and `class` props. The ref callback composes with consumer refs through a small `mergeRefs` helper exported privately and used by the components.

**Component semantics.** `<ViewTransitionName>` and `<ViewTransitionGroup>` use a `useRender` helper:

```ts
function useRender(options: {
  render?: VNode | string | ((props: Record<string, unknown>) => VNode);
  defaultTag: string;
  props: Record<string, unknown>;
}): VNode;
```

`useRender` resolves the target element in this order: `render` function (called with merged props), `render` element (cloned with merged props), `render` string (treated as a tag and the merged props are spread), or `defaultTag` (with the merged props). Prop merging: refs are composed via `mergeRefs`, `class` is joined, all other framework-controlled props win over consumer values (none currently except the ref). `style` is never merged into; the underlying hook writes to the live DOM.

`<ViewTransitionName>` calls `useViewTransitionName(name)` to get a ref, optionally `useViewTransitionClass(groupClass)` for a second ref, composes them via `mergeRefs`, and feeds the result into `useRender({ render, defaultTag: 'div', props: { ref } })`. `<ViewTransitionGroup>` is the same shape with `class` only.

**SSR.** Components render the resolved element tree as usual. The ref callback runs only on the client after hydration; SSR markup does not include `view-transition-name` inline. This matches today's behavior where transitions are entirely client-driven.

**Scaling pattern: list-to-detail.** Documented recipe combining A and C:

```tsx
// list page
{posts.map((post) => (
  <ViewTransitionName
    key={post.id}
    name={`post-${post.id}`}
    groupClass="post-card"
    render={<article class="card" />}
  >
    <h2>{post.title}</h2>
  </ViewTransitionName>
))}

// detail page
<ViewTransitionName name={`post-${post.id}`} render={<header />}>
  <h1>{post.title}</h1>
</ViewTransitionName>
```

```css
::view-transition-group(.post-card) { animation-duration: 0.4s; }
:active-view-transition-type(into-post) ::view-transition-group(.post-card) {
  animation: zoom-into-card 0.4s ease;
}
```

### Module B: Lifecycle hooks

**Public surface:**

```ts
export interface ViewTransitionEvent {
  readonly to: string;
  readonly from: string | undefined;
  readonly direction: NavDirection;
  readonly types: string[];               // mutable
  readonly transition: ViewTransition | null;  // null in onBeforeTransition and when skipped/unsupported
  readonly reason?: 'skipped' | 'unsupported' | 'aborted';
  skip(): void;                           // legal in onBeforeTransition only
}
export type NavDirection = 'initial' | 'push' | 'replace' | 'back' | 'forward';

export interface ViewTransitionLifecycle {
  onBeforeTransition?: (event: ViewTransitionEvent) => void;
  onBeforeSwap?: (event: ViewTransitionEvent) => void;
  onAfterSwap?: (event: ViewTransitionEvent) => void;
  onAfterTransition?: (event: ViewTransitionEvent) => void | Promise<void>;
}
export function useViewTransitionLifecycle(lifecycle: ViewTransitionLifecycle): void;
```

**Phase semantics:**

| Phase | Fires when | DOM state | Notes |
|---|---|---|---|
| `onBeforeTransition` | Synchronously inside `__dispatchRouteChange`, before any call to `startViewTransition`. | Old page. | May `event.skip()`. May mutate `event.types`. May read/write a synchronous registry on `event` (see "Stashing data" below). `transition` is `null`. |
| `onBeforeSwap` | Synchronously inside the `startViewTransition` callback, before `flushSync`. | Old page (browser has already snapshotted the old frame at this point). | Last chance to mutate the DOM before the new render flushes. `transition` is the live `ViewTransition`. |
| `onAfterSwap` | Synchronously inside the callback, after `flushSync` returns. | New page. | New DOM is committed; the browser will snapshot the new frame after this returns. `transition` is the live `ViewTransition`. |
| `onAfterTransition` | Async, after `transition.finished` settles. | New page. | May be async. If the transition was skipped, fires immediately after the synchronous flush with `event.reason = 'skipped'`. If the browser lacks the API, fires immediately after the flush with `event.reason = 'unsupported'`. If aborted, `event.reason = 'aborted'`. |

**Multiple subscribers.** Each phase has its own `Set<Sub>`. All subscribers in a phase fire in registration (mount) order. If any `onBeforeTransition` subscriber calls `event.skip()`, the framework skips `startViewTransition`, runs `flushSync` directly, and fires `onAfterTransition` once with `reason = 'skipped'`. `onBeforeSwap` and `onAfterSwap` are not fired on a skip.

**Stashing data across phases.** `ViewTransitionEvent` carries a `Map`-backed registry (`event.set(key, value)` / `event.get(key)`) so a consumer can stash scroll positions or DOM snapshots in `onBeforeSwap` and read them in `onAfterSwap`. Documented as a small named API rather than ad hoc properties. Keys may be any value (string, symbol, object); typical usage is a module-local symbol per consumer to avoid collisions.

**Why not the browser's own `ViewTransition` lifecycle events?** The browser does not expose `before-swap` / `after-swap` events; it exposes `transition.ready`, `transition.updateCallbackDone`, and `transition.finished` promises. Our phases are synthesized around the moments *we* control, which is exactly what Astro does. The doc will be explicit that our `onBeforeSwap` is narrower than Astro's same-named event (we don't own the DOM swap, preact-iso does).

**Implementation note.** The current `subs: Set<Sub>` collapses into four phase sets. The existing `__subscribeRouteChange` public hook (`useRouteChange`) keeps working as a thin shim that subscribes to `onAfterSwap` (closest analog to the current single-phase behavior). Documented in the release notes.

### Module C: Types and direction

**Public surface:**

```ts
export function useViewTransitionTypes(
  typesOrFactory:
    | string
    | string[]
    | ((nav: { to: string; from: string | undefined; direction: NavDirection }) => string | string[] | null | undefined)
): void;

export function getViewTransitionDirection(): NavDirection; // imperative read; rare
```

**Default types.** The framework adds the following to every transition's `types`:

- `nav-initial` on the first navigation only (first dispatch after hydrate).
- Exactly one of `nav-push`, `nav-replace`, `nav-back`, `nav-forward` per navigation.
- `nav-same-origin` always (the SPA only navigates within its origin).

Consumer types are added on top (via `useViewTransitionTypes` or by mutating `event.types` in `onBeforeTransition`). All types are written to `viewTransition.types` inside the `startViewTransition` callback, feature-detected at runtime.

**Direction tracking.** A module-loaded shim (`packages/iso/src/internal/history-shim.ts`) runs once at client entry:

```ts
let counter = readCounterFromState() ?? 0;
let lastDirection: NavDirection = 'initial';

const origPush = history.pushState.bind(history);
const origReplace = history.replaceState.bind(history);

history.pushState = (state, title, url) => {
  counter += 1;
  origPush({ ...(state ?? {}), __hpVtIdx: counter }, title, url);
  lastDirection = 'push';
};
history.replaceState = (state, title, url) => {
  origReplace({ ...(state ?? {}), __hpVtIdx: counter }, title, url);
  lastDirection = 'replace';
};
window.addEventListener('popstate', (e) => {
  const incoming = (e.state as { __hpVtIdx?: number } | null)?.__hpVtIdx ?? 0;
  lastDirection = incoming < counter ? 'back' : incoming > counter ? 'forward' : 'replace';
  counter = incoming;
}, { capture: true });
```

The dispatcher reads `lastDirection` at the start of `__dispatchRouteChange` and includes it in the event. On the first dispatch after hydrate, direction is `'initial'`.

We preserve the original push/replace references in module scope so we cooperate with other libraries that also patch `history`. The shim is loaded by the framework's generated client entry before preact-iso's `LocationProvider` mounts. The shim is a no-op on the server.

**Sharp edge.** `viewTransition.types` is a `DOMTokenList` not universally supported in older versions of the View Transitions API (Chrome ≤127 shipped the API without `types`). The dispatcher feature-detects `('types' in viewTransition)` and silently no-ops the types path on older browsers; direction is still computed and available via the lifecycle event so consumers can do their own CSS-class swap.

### Module D: Persistent elements

**Public surface:**

```ts
export interface PersistProps {
  id: string;
  viewTransitionName?: string;
  children?: ComponentChildren;
}
export function Persist(props: PersistProps): VNode | null;
export function PersistHost(): VNode | null; // auto-mounted by the generated client entry
```

**Registry.** Module-level:

```ts
type PersistEntry = { children: ComponentChildren; viewTransitionName: string | undefined };
const registry = signal<Map<string, PersistEntry>>(new Map());
```

A small `bumpRegistry` helper writes an entry and notifies subscribers (a single subscriber in practice: `<PersistHost />`).

**Persist component.** On mount and on prop change, `useLayoutEffect` writes `{ children, viewTransitionName }` into `registry[id]`. Returns `null` for its own render output. **Does not** clear the entry on unmount; that's the whole point. If the next render of any route mounts a new `<Persist id="player">`, it overwrites the entry; if no route does, the previous content stays live.

**PersistHost component.** Subscribes to the registry signal. Renders a stable container per id:

```tsx
function PersistHost() {
  const map = registry.value;
  return (
    <>
      {Array.from(map.entries()).map(([id, entry]) => (
        <PersistSlot key={id} id={id} entry={entry} />
      ))}
    </>
  );
}
```

`<PersistSlot>` is responsible for applying `viewTransitionName` via `useViewTransitionName(entry.viewTransitionName)` and rendering `{entry.children}`. Because the host's DOM container and the child VNode reference are stable across navigations, Preact's diff preserves the underlying DOM nodes including media element internals.

**Where PersistHost lives.** The framework's generated client entry (`packages/vite/src/client-entry.ts`) appends a `<div id="__hp_persist_root">` to `<body>` if not present, then `render(<PersistHost />, host)`. Stable across all route changes because it sits outside the SPA's hydrate root.

**SSR behavior (v1).** Server-side render of `<Persist>` returns `<>{children}</>` inline at the declared position; the SSR'd HTML reaches the browser at the same place it does today. On hydrate, the `<PersistHost />` is empty (no registry entries yet); after the first navigation, the registry is populated and the persisted DOM lives under the host. The SSR'd inline copy is unmounted by the page swap on first navigation. For audio/video, no flash occurs because they don't play during SSR; for chat widgets, the widget initializes on hydrate and re-initializes after the first nav (acceptable in v1 and documented).

**Sharp edges in spec:**

1. **Last write wins.** If two simultaneously-mounted `<Persist>` instances share an id (nested route compositions, parallel renders), the later mount overwrites the earlier. In normal SPA use this doesn't happen.
2. **Memory.** Registry entries leak by design. Documented; `ttlMs` deferred to v2.
3. **DevTools placement.** Persisted children appear under `<PersistHost>`, not under the page that declared them. Spec calls this out; `<PersistSlot>` gets a displayName for clarity.

## Wire format / type-surface changes

None. All four modules are additive; no existing types change shape. New exports:

- From `hono-preact`: `useViewTransitionName`, `useViewTransitionClass`, `useViewTransitionLifecycle`, `useViewTransitionTypes`, `getViewTransitionDirection`, `ViewTransitionName`, `ViewTransitionGroup`, `Persist`.
- Types: `ViewTransitionEvent`, `NavDirection`, `ViewTransitionLifecycle`, `PersistProps`.
- Internal (`packages/iso/src/internal/`): `useRender` helper, history shim, phase dispatcher (replaces the current `route-change.ts` body but preserves its public exports).

The legacy `useRouteChange` keeps its current signature, implemented as `useViewTransitionLifecycle({ onAfterSwap: cb })`. The stub `ViewTransitions()` export in `packages/iso/dist/view-transitions.d.ts` is removed; the file existed only as a placeholder and is not part of any documented surface.

## Testing strategy

Per module:

- **A.** Unit tests for `useViewTransitionName` / `useViewTransitionClass`: mount, change, unmount; verifies live `node.style.viewTransitionName` matches. Component tests for `<ViewTransitionName>`: default tag, `render` element clone, `render` function, ref composition, class merging. Verify the consumer's `style` prop is untouched.
- **B.** Phase dispatcher unit tests: registration order, multi-subscriber, `skip()` semantics, `event.reason` in skipped/unsupported/aborted paths, `transition` field nullability per phase. Integration test: a fake `document.startViewTransition` implementation drives a full happy-path sequence and asserts phases fire in order.
- **C.** Direction tests: shim correctly classifies push/replace/back/forward via a scripted sequence of `pushState`/`replaceState`/`popstate`. Types tests: `useViewTransitionTypes` factory called per nav, results applied to the event, default `nav-*` types present, feature-detection no-ops on a stubbed older browser.
- **D.** Persist tests: registry writes on mount, survives a simulated route swap (mount new component, unmount old, assert registry entry preserved and rendered children identity-preserved). `<PersistHost />` integration: renders entries, applies `view-transition-name`, stable host DOM across multiple route changes. Verify media element state preserved through a `<video>` test where `currentTime` is non-zero before nav and identical after.

Cross-cutting integration test in `packages/iso/src/__tests__`: a single test wires up A + B + C + D against a stubbed `startViewTransition` and asserts the full timeline (event direction set, types applied, name ref attached, persist host populated, lifecycle phases called in order).

## Implementation phases

Strictly sequential because B underlies C, and A + D both consume B/C primitives:

1. **History shim** (`packages/iso/src/internal/history-shim.ts`) and **phase dispatcher rework** (`packages/iso/src/internal/route-change.ts`). Public exports preserved; `useRouteChange` becomes an `onAfterSwap` shim. Test coverage: dispatcher phases, history shim direction classification.

2. **Module B**: export `useViewTransitionLifecycle` and `ViewTransitionEvent` type from `hono-preact`. Test coverage as above.

3. **Module C**: history-shim direction wired into the event; `useViewTransitionTypes` exported; default `nav-*` types applied by the dispatcher; feature detection for `viewTransition.types`. Test coverage as above.

4. **Module A**: `useRender` helper, `useViewTransitionName` / `useViewTransitionClass`, `<ViewTransitionName>` / `<ViewTransitionGroup>` components. Test coverage as above.

5. **Module D**: registry, `<Persist>`, `<PersistHost />`; client-entry change to mount the host into `<body>`. Test coverage as above.

6. **Docs**: new `apps/site/src/pages/docs/view-transitions.mdx` (or expand the existing mention in `pages.mdx`) covering each module with the list-to-detail recipe, audio-player Persist recipe, and direction-driven CSS recipe. Updates to `apps/site/src/pages/docs/optimistic-ui.mdx` are not required; `transition: true` continues to work as today.

Each phase is one PR. The split keeps replacement parity reviewable (the dispatcher rework in phase 1 is the highest-risk change and ships isolated; A/C/D are additive).

## Open questions deferred

- A `<Persist>` `ttlMs` for explicit teardown. Out of scope for v1; tracked in the post-merge follow-up.
- True SSR-portal-slot rendering for Persist. Out of scope for v1; tracked.
- Cross-document (`@view-transition { navigation: auto }`) story. Likely a separate spec; the four modules above are agnostic to whether the navigation is same-document or cross-document, but cross-document brings its own constraints (no JS lifecycle on the outgoing page, no Preact state preservation).
