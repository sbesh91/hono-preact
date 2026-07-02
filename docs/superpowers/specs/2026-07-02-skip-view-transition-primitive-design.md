# Skip-view-transition primitive (#165)

**Status:** approved design, pre-implementation
**Issue:** #165 (follow-up to #148, #164)
**Scope:** one public primitive, three entry points, plus the docs TOC adoption that closes #148.

## Problem

The client nav scheduler (`scheduleRender` in
`packages/iso/src/internal/route-change.ts`) wraps the next render in
`document.startViewTransition` whenever `location.href !== lastHref`. Every URL
change followed by a render therefore animates as a full navigation, and there
is no opt-out. Several cases legitimately want to change the URL without the
animation:

- In-page anchor nav (docs TOC, heading permalinks). Today the TOC scrolls
  *without* writing the hash, specifically to dodge the flash (#148), at the
  cost that `#section` never lands in the address bar (not shareable).
- Programmatic URL sync: reflecting UI state (active tab, filter, sort,
  pagination) into the query string should update the URL silently.

The default ("transition on URL change") stays. This is strictly an opt-out.

## Mechanism

The decision point is `route-change.ts`:

```ts
lastHref = href;
const start = navigated ? getStartViewTransition() : undefined;
if (!start) { defaultSchedule(process); return; } // plain render, no VT
runNavTransition(process, start);
```

We add a module-level one-shot flag that, when set, forces `start = undefined`
for the next *navigated* flush while still advancing `lastHref`:

```ts
let skipNextTransition = false;

/**
 * Arm the next navigated flush to commit without a view transition. Public API;
 * `navigate({ transition: false })` and `<NavLink transition={false}>` call it
 * too. Call immediately before the URL write.
 */
export function skipNextNavTransition(): void {
  skipNextTransition = true;
}

// inside scheduleRender, after `navigated` is computed:
const skip = navigated && skipNextTransition;
if (navigated) skipNextTransition = false; // one-shot: consumed on the nav flush
lastHref = href;
const start = navigated && !skip ? getStartViewTransition() : undefined;
```

Consuming the flag only on a `navigated` flush (not on the constant stream of
non-navigation re-render flushes) is what makes "arm, then write history" work.
The documented contract is to call `skipNextNavTransition()` **immediately
before** the URL write, so the very next navigated flush is the intended one.

## Public surface — three entry points, one function

`skipNextNavTransition()` is the single primitive. `navigate` and `NavLink`
import it internally from `route-change.ts`; `index.ts` re-exports it publicly.

### 1. `skipNextNavTransition()` — low-level escape hatch

For callers that write history directly:

```ts
skipNextNavTransition();
location.hash = 'section-3'; // URL updates, no VT flash
```

### 2. `navigate(href, { transition: false })` — programmatic

`NavigateOptions` gains `transition?: boolean` (default, when omitted, is the
current behavior: transition on). In `use-navigate.ts`, when `transition ===
false`, call `skipNextNavTransition()` immediately before `route(...)`:

```ts
export interface NavigateOptions {
  replace?: boolean;
  reload?: boolean;
  /** Set false to update the URL without a view transition. Default: animate. */
  transition?: boolean;
}
```

`reload` (hard navigation) ignores `transition` — a full-page load has no VT to
suppress. Only the soft-nav path honors it.

### 3. `<NavLink transition={false}>` — declarative

`NavLinkProps` gains `transition?: boolean`. `NavLink` renders a plain `<a>` and
relies on preact-iso's global click interceptor for the soft-nav, so the prop
works via a composed `onClick`: on a plain left-click (the same conditions under
which preact-iso will actually soft-navigate) it arms the flag, then lets the
click proceed to the interceptor in the bubble phase.

```tsx
<a
  {...rest}
  href={href}
  onClick={(e) => {
    if (transition === false && isPlainLeftClick(e)) skipNextNavTransition();
    onClickProp?.(e); // preserve a caller-provided handler
  }}
/>
```

`isPlainLeftClick`: `e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey
&& !e.altKey && !e.defaultPrevented` and the link has no `target` (or
`target="_self"`). Guarding this way means a modifier-click / new-tab / external
click never leaves the flag armed for a later navigation.

## Resolved design questions

- **Lifecycle semantics.** Skipping suppresses the *whole* view transition, not
  just the animation: no `beforeSwap`/`afterSwap`/types events fire (it is the
  plain `start = undefined` render path). The opt-out callers initiate the
  change and run their own post-write logic (scroll/focus), so a "transition
  fired but didn't animate" half-state would be surprising and more complex.
  Contract: `transition: false` ⇒ no view transition at all for that URL change.
- **#148 relationship.** #165 supersedes the #148 workaround. The docs TOC
  (`apps/site/src/components/docs/TableOfContents.tsx`) adopts
  `skipNextNavTransition()` to write `#section` without a flash, making sections
  shareable/bookmarkable. That swap ships in this PR as the real-world exercise
  of the primitive and closes #148.
- **`replaceUrl`/`setUrl` dropped.** A third "change the URL" verb overlaps
  `navigate(href, { replace: true, transition: false })` and introduces a second
  name for an existing concept. YAGNI.

## Known interactions

- **Stale-`lastHref` quirk (#148).** A native `#` jump changes `href` with no
  render, so `lastHref` can go stale; this is pre-existing and unchanged. The
  TOC's adoption goes through the framework (arm + hash write), not a raw native
  jump, so it advances `lastHref` on its flush.
- **Arm-but-no-nav.** If a caller arms the flag and then no navigation follows,
  the flag stays set and the next navigation would be wrongly skipped. Mitigated
  by (a) the documented "arm immediately before the write" contract, and (b) the
  NavLink guard only arming on a plain left-click that will soft-navigate.

## Testing

Unit tests in `packages/iso/src/__tests__`, driving the scheduler through the
existing `__resetTransitionStateForTesting` harness:

- a flagged navigated flush takes the no-VT path (`defaultSchedule`, no
  `startViewTransition`) while `lastHref` advances;
- an unflagged navigated flush still starts a VT (regression guard);
- the flag is one-shot: after a skipped nav, the next nav transitions again;
- `skipNextNavTransition()` set with no following navigation does not suppress a
  non-navigation re-render (the flag is only consumed on a navigated flush).

Component/behavior:

- `<NavLink transition={false}>` arms the flag on a plain left-click and does
  not arm on a modifier-click; a caller-provided `onClick` still fires.
- `navigate(href, { transition: false })` arms before `route`; `{ reload: true,
  transition: false }` does not (hard nav).

Type-level (`*.test-d.ts` under `pnpm test:types`): `NavigateOptions.transition`
and `NavLinkProps.transition` are optional booleans.

Every scheduler assertion is mutation-checked (break the skip branch, confirm
the test fails, restore).

## Docs

- A short "Opting out of the view transition" section in the navigation docs
  covering all three entry points, alongside the existing view-transition docs.
- New public exports (`skipNextNavTransition`, the two new prop/option fields)
  are picked up by the (now tightened, #177) docs-coverage and AGENTS.md gates;
  update `AGENTS.md` and the docs corpus accordingly.
