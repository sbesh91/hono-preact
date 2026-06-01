# Design: `subscribeViewTransitionTypes` public API

**Date:** 2026-05-31
**Status:** Approved (brainstorming complete)

## Problem

The site's docs pages use a calm fade+zoom view-transition (`docs` type) instead
of the global directional page slide, and freeze the docs sidebar within docs
(`docs-within` type). To cover entering AND leaving `/docs` (not just docs->docs),
the type rule must be an always-on subscriber: a `useViewTransitionTypes` hook in
a layout only catches within-section navigations, because it isn't subscribed yet
when you navigate IN (its effect runs a tick after the transition reads its types)
and is already torn down when you navigate OUT.

There is no site-owned component mounted across all top-level routes, and wrapping
all routes in a root layout collides with the framework's v0.1 layout-nesting
validation in `packages/iso/src/define-routes.tsx`. So the docs feature currently
reaches into the framework's internal escape hatch.

**Current stopgap to replace:** `apps/site/src/docs-transition.ts` registers a
client-only `__subscribePhase('beforeTransition', ...)` (from `hono-preact/internal`),
imported for side effects by `apps/site/src/routes.ts`.

## Goal

Add a **public**, non-hook framework API for registering a global, route-aware
view-transition type rule, so app code can express "add these types to every
navigation based on `from`/`to`" without a mounted component and without the
internal escape hatch.

## API

A new exported function in `packages/iso/src/view-transition-types.ts` (same file
as the existing hook):

```ts
export function subscribeViewTransitionTypes(
  input: ViewTransitionTypesInput
): () => void
```

- **Input:** the existing `ViewTransitionTypesInput` union
  (`string | string[] | ((nav: ViewTransitionTypesNav) => string | string[] | null | undefined)`),
  for symmetry with `useViewTransitionTypes` and so the hook can delegate to it.
- **Return:** an unsubscribe `() => void`.
- **SSR self-guard:** when `typeof document === 'undefined'`, register nothing and
  return a no-op unsubscribe. Callers (including `docs-transition.ts`, which is
  side-effect-imported on the server too) drop their own `typeof document` guard.
- **Body:** the current hook's resolver logic, lifted out: subscribe to the
  `beforeTransition` phase, resolve `input` against `{ to, from, direction }`, and
  push the result onto `event.types` (string pushed directly; array spread-pushed;
  `null`/`undefined` contributes nothing).

The resolver surface is intentionally reduced: it receives `{ to, from, direction }`
and RETURNS the types to add. It cannot read or mutate the full event. This is the
whole surface; no priority/ordering, no de-dup, no new event fields (YAGNI).

## Hook refactor (single code path)

`useViewTransitionTypes` keeps its ref (so the latest closure is used each nav) and
its `useEffect` now delegates to the new function:

```ts
export function useViewTransitionTypes(input: ViewTransitionTypesInput): void {
  const ref = useRef(input);
  ref.current = input;
  useEffect(
    () =>
      subscribeViewTransitionTypes((nav) => {
        const v = ref.current;
        return typeof v === 'function' ? v(nav) : v;
      }),
    []
  );
}
```

The delegated resolver is a function that re-reads `ref.current` each navigation,
preserving the hook's "latest input wins" behavior. No behavior change; the hook's
existing tests prove parity.

### Relationship between the two (for docs + reviewer context)

Both register a GLOBAL rule that fires on every navigation. They differ only in
lifetime:

- `useViewTransitionTypes(input)` — lifetime bounded by a component's mount
  (auto-unsubscribe on unmount); reacts to component state via the closure. Use
  when the rule should apply only while a component is on screen.
- `subscribeViewTransitionTypes(input)` — app lifetime (manual or never
  unsubscribe). Use for cross-route rules that must survive entering/leaving a
  section, where no single component spans the boundary.

There is no third variant: a hook that outlives its own component is a
contradiction, which is exactly the gap the always-on function fills.

## Export surface

- Add `subscribeViewTransitionTypes` to the public barrel in
  `packages/iso/src/index.ts`, next to `useViewTransitionTypes` (re-exported
  through `hono-preact`).
- Do NOT add it to `internal.ts`; it is a front-door API now.

## Migration: `apps/site/src/docs-transition.ts`

Before:

```ts
import { __subscribePhase } from 'hono-preact/internal';

function isDocsPath(p: string | undefined): boolean {
  return p === '/docs' || (p?.startsWith('/docs/') ?? false);
}

if (typeof document !== 'undefined') {
  __subscribePhase('beforeTransition', (event) => {
    const toDocs = isDocsPath(event.to);
    const fromDocs = isDocsPath(event.from);
    if (toDocs || fromDocs) event.types.push('docs');
    if (toDocs && fromDocs) event.types.push('docs-within');
  });
}
```

After:

```ts
import { subscribeViewTransitionTypes } from 'hono-preact';

function isDocsPath(p: string | undefined): boolean {
  return p === '/docs' || (p?.startsWith('/docs/') ?? false);
}

subscribeViewTransitionTypes((nav) => {
  const toDocs = isDocsPath(nav.to);
  const fromDocs = isDocsPath(nav.from);
  const types: string[] = [];
  if (toDocs || fromDocs) types.push('docs');
  if (toDocs && fromDocs) types.push('docs-within');
  return types;
});
```

Changes: internal import -> front-door import; drop the `typeof document` guard
(now handled by the API); "mutate the event" (`event.types.push`) -> "return the
types to add" (`event.to`/`event.from` become `nav.to`/`nav.from`). `isDocsPath`
and the enter/leave (`docs`) vs. within (`docs-within`) logic are unchanged.
Behavior is equivalent: same types emitted for the same navigations. The returned
unsubscribe is ignored (module registers once for the app lifetime, same as the
old code ignored `__subscribePhase`'s return). Comments updated to explain the
always-on rationale without referencing the removed internal export.

## Tests

- `packages/iso/src/__tests__/view-transition-types.test.tsx`: add a
  `describe('subscribeViewTransitionTypes')` covering:
  - static string adds that type
  - static array adds each type
  - resolver called per-nav with `{ to, from, direction }`
  - resolver returning `null`/`undefined` contributes nothing
  - the returned unsubscribe stops further contributions
  - SSR no-op: with `document` undefined, returns a no-op unsubscribe and does not
    throw or register
- `packages/iso/src/__tests__/public-exports.test.ts`: assert
  `typeof iso.subscribeViewTransitionTypes === 'function'`.
- The existing `useViewTransitionTypes` tests stay green unchanged (parity proof).

## Docs

`apps/site/src/pages/docs/view-transitions.mdx`, in the "Direction-driven CSS via
types" section: after the existing `useViewTransitionTypes` example, add a short
note + example for `subscribeViewTransitionTypes` as the non-hook, always-on form
for route-aware rules that must cover entering/leaving a section (the case a layout
hook can't). Follow the project convention: describe what it is, not what it
replaces. Check the local `add-docs-page` skill conventions before editing.

## Out of scope (YAGNI)

No priority/ordering controls, no de-dup of types, no new event fields. The
resolver returns types to add; that is the whole surface.
