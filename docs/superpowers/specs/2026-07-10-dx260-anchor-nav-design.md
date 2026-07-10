> DECISION (maintainer, 2026-07-10): Full option C. Classifier keys on pathname+search (hash-only changes never animate, no opt-back-in), skipNextNavTransition gains an optional URL key (no-arg semantics preserved), navigate() becomes fragment-aware. TOC hazard comment deleted; nav-link comment shrinks.

# Design brief: first-class anchor navigation without stranding the transition skip

Issue #260 finding 6 (subsumes #219, follows #148). Investigated on the worktree at
`.claude/worktrees/dx260-anchor-nav` (origin/main @ 93e480b6). All file:line anchors below
are from that tree; all paths are repo-relative under it.

## 1. Problem statement

The view-transition scheduler treats **any** `location.href` change as a navigation, hash
included. In-page anchor navigation (writing `#section` into the URL for shareability) must
therefore suppress the resulting whole-page view transition, and the only tool for that is
`skipNextNavTransition()` (`packages/iso/src/internal/route-change.ts:218-220`), a one-shot
global boolean consumed only by the next **navigated** render flush
(`route-change.ts:319-320`). If the caller arms it and no navigated flush follows, the flag
strands and silently suppresses a *later*, unrelated navigation's transition.

The cost of that hazard today:

- `packages/iso/src/nav-link.tsx:25-39` carries a 16-line comment explaining why
  `willSoftNavigate` must refuse a same-URL click (line 52): preact-iso pushes the same URL
  but Preact bails out with no navigated flush, so the arm would strand.
- `packages/iso/src/use-navigate.ts:5-16` re-implements the same guard
  (`resolvesToCurrentUrl`) for the imperative path.
- `apps/site/src/components/docs/TableOfContents.tsx:82-91` re-derives Preact render-flush
  bailout semantics in **app** code: it arms the skip only when `setActiveId` will actually
  re-render (`if (activeId !== id) skipNextNavTransition()`), because a no-op `setActiveId`
  schedules no flush to consume the flag.

And the workaround is not even complete. Two residual defects exist on this tree:

- **TOC deferred flash.** When the clicked heading is already active but the hash differs
  (e.g. first click on the initially-active heading), TableOfContents pushes the hash
  *without* arming (`TableOfContents.tsx:88-91`, deliberately, to avoid the strand). The
  scheduler's `lastHref` (`route-change.ts:205,321`) is now stale, so the **next render flush
  of any origin** (a scroll-spy `setActiveId`, anything) satisfies `href !== lastHref`
  (`route-change.ts:280-281`) and runs inside a surprise whole-page view transition.
- **Heading-permalink flash.** Docs headings get plain appended `<a href="#slug">` anchors
  from rehype-autolink-headings (`apps/site/src/mdx-plugins.ts:59`). preact-iso ignores
  bare-hash links (`node_modules/.../preact-iso/src/router.js:44`), so the browser performs a
  native same-document fragment navigation: `location.href` changes with no flush, `lastHref`
  goes stale, and the next flush flashes exactly as above. No app code arms anything here,
  and none could reliably.

Separately, the "obvious" API is broken: `useNavigate()('#id')` goes through preact-iso's
`route()`, whose reducer stores `'#id'` as the URL state; `LocationProvider` then resolves it
with `new URL(url, location.origin)` (`router.js:106-107`), yielding path `/`. The history
entry is correct (relative `pushState`, `router.js:62`) but the router renders the **home
page**. So there is no first-class anchor API at all today.

Goal (from #260): a first-class anchor API and/or a skip keyed to its target URL so
stranding is impossible. Success criterion: the hazard comment is **deleted** from
TableOfContents and nav-link's comment **shrinks**.

## 2. The mechanism today

Client boot (`packages/iso/src/boot-client.ts:17-21`) installs, in order:

1. **History shim** (`packages/iso/src/internal/history-shim.ts:37-93`): patches
   `history.pushState`/`replaceState` and listens to `popstate` (capture). Every push,
   replace, or popstate stamps a direction counter and synchronously calls the registered
   nav listeners (`notifyNavigation`, line 20-22) *before* any re-render.
2. **Nav-transition scheduler** (`route-change.ts:268-277`): takes over
   `options.debounceRendering`. Its `scheduleRender` (`route-change.ts:279-328`) classifies a
   flush as "navigated" iff `location.href !== lastHref` (line 280-281); a navigated flush is
   wrapped in `document.startViewTransition` unless the one-shot `skipNextTransition` boolean
   is armed (lines 319-322), in which case the flush commits plainly. The boolean is consumed
   only on a navigated flush; non-navigation flushes leave it armed
   (`__tests__/skip-view-transition.test.ts:81-92` pins this). The shim's nav listener
   (`onNavObserved`, `route-change.ts:241-254`) exists only to abandon an in-flight
   transition when a *new* navigation arrives; today it fires for **any** push/replace/pop,
   hash-only included.

The VT **event** model already ignores hashes: `currentPath()` (`route-change.ts:42-46`) and
`lastPath` are `pathname + search`, so `ViewTransitionEvent.to/from` never contain a hash.
Only the *navigated* classification (`lastHref`, full href) is hash-sensitive. That asymmetry
is the root of #148.

Consumers:

- `NavLink` (`nav-link.tsx:80-84`): on click, if `transition === false` and
  `willSoftNavigate(e, href)`, arm the skip. `willSoftNavigate` (lines 40-54) mirrors
  preact-iso's `handleNav` link gate plus the same-URL refusal (line 52).
- `useNavigate` (`use-navigate.ts:44-54`): `navigate(path, { transition: false })` arms the
  skip unless `resolvesToCurrentUrl(path)`, then calls preact-iso `route(path)`, which owns
  the `pushState` (`router.js:62`, through the shim's patched pushState).
- TableOfContents (site app code): owns its own `history.pushState(null, '', '#id')` plus the
  conditional arm described above; preact-iso never sees the write (it only listens to
  click/popstate, `router.js:118-126`).

Documented public pattern (`apps/site/src/pages/docs/view-transitions.mdx`, "Opting out of
the transition"): "The transition is on by default for every URL change", and the escape
hatch example is literally `skipNextNavTransition(); history.pushState(null, '', '#section-3')`.

## 3. Options

### Option A: hash-aware navigation classification + fragment-aware `navigate`

**Core idea.** Stop classifying hash-only URL changes as navigations. The scheduler keys
"navigated" on `pathname + search` (which `currentPath()` already computes for the event
model) instead of full `href`. A hash-only write, from any source (raw `pushState`, native
anchor click, `navigate('#id')`), can then never start a view transition and never needs the
skip. On top of that, fix `useNavigate` so a same-document fragment target is handled first
class instead of being mis-routed to `/`.

**Signatures.** No new exports. `NavigateOptions` unchanged
(`transition: false` stays meaningful for path/search navigations and becomes a documented
no-op for same-document fragments).

```ts
// use-navigate.ts (behavior change, same signature)
navigate('#usage');                    // same-doc fragment: pushState + scroll, no route()
navigate('/docs/routing#loaders');     // path change: route() as today, VT as today
```

**Who owns pushState.** For fragments, `useNavigate` itself calls `history.pushState(null,
'', target.hash)` (through the shim's patched pushState, so the direction counter stays
coherent) and then `el.scrollIntoView({ block: 'start' })` to match the native anchor
default; `scroll-behavior` CSS still controls smoothness. For path navigations, preact-iso's
`route()` keeps owning it, unchanged. App code that owns its own hash `pushState`
(TableOfContents, which needs its custom smooth-scroll and scroll-lock) is now simply *safe*:
no arming, no flush requirement, no comment.

**Scheduler / shim interaction.** `lastHref` becomes `lastNavKey = currentPath()`
(`route-change.ts:205, 273, 280-281, 321`). `onNavObserved` (`route-change.ts:241-254`) gains
one guard: return early when `currentPath() === lastNavKey`, so a hash write during an
in-flight cold navigation no longer aborts that transition (the shim notifies after the URL
is updated, so the comparison is well-defined; at the moment a real path push fires, the
flush that would update `lastNavKey` has not run yet, so real navigations still abandon
correctly).

**Rapid successive anchor clicks.** Each click is a plain pushState; none engages the VT
machinery at all. N clicks produce N history entries (native-like), the smooth scroll simply
retargets. No coalescing hazard exists because there is nothing to consume.

**Before/after (real site code).** `TableOfContents.tsx:82-91` collapses to:

```ts
// before (lines 82-91): 6-line hazard comment + conditional arm
if (location.hash !== `#${id}`) {
  if (activeId !== id) skipNextNavTransition();
  history.pushState(null, '', `#${id}`);
}

// after: hazard comment deleted, import deleted
if (location.hash !== `#${id}`) history.pushState(null, '', `#${id}`);
```

Heading permalinks (`mdx-plugins.ts:59`) are fixed with zero app changes.

**Edges.** SSR: no change (scheduler installs only when `document`/`location` exist,
`route-change.ts:270-271`; the fragment branch in `useNavigate` runs in click handlers,
client-only, and keeps the existing `typeof window` style guard used at
`use-navigate.ts:46`). A cross-page link `/docs/x -> /docs/x#section` via preact-iso is a
same-path URL-state change: a flush occurs (reducer state string changes), but it is no
longer classified as navigated, so it commits without a VT; that is the #148-desired
behavior, but note it is a *behavior change* for anyone who wanted that animation.

**What it does NOT fix.** The strand hazard itself survives for path/search targets:
nav-link line 52 and its rationale stay; `resolvesToCurrentUrl` stays; and the documented
escape-hatch pattern (`skipNextNavTransition()` before a hash write) becomes actively
harmful, because a hash flush can no longer consume the flag. A alone would have to ship
with a docs rewrite that *removes* that pattern, and any straggler caller strands worse
than today.

**Files.** `route-change.ts` (~10 lines), `use-navigate.ts` (~15 lines),
`view-transitions.mdx`, `TableOfContents.tsx` (deletion), tests.

### Option B: URL-keyed one-shot skip (`skipNextNavTransition(target?)`)

**Core idea.** Keep classification as-is (hash changes still count as navigations). Make the
skip self-expiring by keying it to its target: consumed (applied) only when the navigated
flush commits at the armed URL; cleared without applying at the first navigated flush to any
other URL. Stranding becomes structurally impossible: a never-consumed arm can only ever
suppress a navigation to the exact URL it was armed for.

**Signature.**

```ts
// route-change.ts, exported from hono-preact (index.ts:228)
export function skipNextNavTransition(target?: string): void;
```

- No argument: exact current semantics (wildcard, consumed by the next navigated flush
  whatever its URL). Fully backward compatible; existing callers and the documented pattern
  keep working, hazard included.
- With `target`: resolved at arm time via `new URL(target, location.href).href` (relative
  fragments therefore key to the current page). Stored as `armed: { href: string | null }`.
  On a navigated flush (`route-change.ts:319-322`): if `armed.href === null` or
  `armed.href === location.href`, skip; either way, clear.

**Consumption walkthrough for the TOC case** (this is the subtle win): arm `'#usage'`
(resolves to `/docs/x#usage`), then `pushState('#usage')`.

- A flush follows (active section changed): flush is navigated at `/docs/x#usage`, key
  matches, VT skipped. Same as today.
- No flush follows (the strand case today): `lastHref` is stale, so the *next* flush of any
  origin is misclassified as navigated, exactly the deferred-flash defect. But that flush
  commits at `location.href === /docs/x#usage`, which **is** the armed key, so the skip
  applies and the flash is suppressed too. The keyed arm fixes both the strand and the
  deferred flash in one move.
- Next real navigation to `/other`: key mismatch, cleared, transition animates. No strand.

**Before/after.** TableOfContents arms unconditionally, one-line comment:

```ts
// suppress the framework view transition for this URL write
skipNextNavTransition(`#${id}`);
history.pushState(null, '', `#${id}`);
```

`nav-link.tsx` drops the same-URL refusal (line 52) and the strand rationale (comment shrinks
from 16 lines to roughly 4: the remaining gate is just "do not arm when the browser handles
the click": modifier keys, `target`, `download`, cross-origin, bare `#`), and arms with the
resolved `a.href` as the key. `use-navigate.ts` deletes `resolvesToCurrentUrl` and passes
`path` as the key.

**Edges.** Rapid successive arms: re-arming overwrites (last writer wins), which is correct
for coalesced flushes (arm `/a`, then user navigates to `/b` before the flush: single flush
at `/b`, mismatch, `/b` animates; today's boolean would wrongly suppress it, so keying is a
strict improvement here). Modifier-click misfire window: arming keyed on a cmd-click that
opens a new tab could suppress a later same-URL soft nav; keeping NavLink's cheap
modifier/target gates closes it. SSR: with no `location`, the function no-ops (arming is
meaningless server-side; today's boolean is equally inert because the scheduler never
installs). Shim: untouched.

**What it does NOT fix.** Hash writers must still *know* to arm: heading permalinks
(native anchor navigation, no framework code runs) still cause the deferred flash, and every
future hash writer must remember the call. `navigate('#id')` stays broken. The "URL change
means view transition" model that caused #148 survives.

**Files.** `route-change.ts` (~15 lines), `nav-link.tsx`, `use-navigate.ts`,
`TableOfContents.tsx`, `view-transitions.mdx`, tests.

### Option C: both, layered (recommended)

Classification fix (A) as the semantic foundation; keyed skip (B) as the strand-proofing for
the surface that still needs a skip, namely path/search navigations; fragment-aware
`navigate` as the public first-class anchor API. Concretely:

1. `route-change.ts`: `lastNavKey = currentPath()` classification + `onNavObserved` same-path
   guard (from A), and `skipNextNavTransition(target?)` keyed consumption (from B). Under C
   the key comparison uses `pathname + search` of the armed URL vs the committing flush,
   since hash never participates in classification anymore.
2. `use-navigate.ts`: same-document fragment branch owns `pushState` + native-default scroll;
   `transition: false` for path navs arms keyed with the resolved target;
   `resolvesToCurrentUrl` and its strand comment are deleted (subsumed by keying).
3. `nav-link.tsx`: `handleClick` arms keyed with `a.href`; `willSoftNavigate` keeps only the
   browser-handled-click gates; the 16-line strand comment reduces to ~3 lines.
4. `TableOfContents.tsx`: arming deleted entirely (not merely simplified); raw hash
   `pushState` is inert to the VT machinery. Import of `skipNextNavTransition` removed from
   the site.
5. `view-transitions.mdx`: "on by default for every URL change" becomes "for every route
   change (path or query); hash-only changes never animate", the hash escape-hatch example is
   replaced by `navigate('#id')` / plain `pushState`, and the escape hatch documents the
   optional target.

Under C, the residual uses of the no-arg wildcard are exactly the legacy ones; every
framework call site passes a key. #219 retires because (a) hash writes can no longer strand
anything (they are outside the skip's jurisdiction entirely), and (b) a path-keyed arm that
never consumes expires harmlessly at the next navigation.

## 4. Tradeoff table

| | A: classification only | B: keyed skip only | C: both |
|---|---|---|---|
| TOC hazard comment deleted (issue criterion) | Yes (arming itself deleted) | Partly (conditional deleted, arm + 1-line comment remain) | Yes (arming deleted) |
| nav-link comment shrinks (issue criterion) | No (same-URL refusal must stay) | Yes (16 -> ~4 lines) | Yes (16 -> ~3 lines) |
| Strand structurally impossible | No (path-target arms can still strand; legacy hash pattern strands worse) | Yes | Yes |
| TOC deferred flash (`TableOfContents.tsx:88-91`) | Fixed | Fixed (via key match on the misclassified flush) | Fixed |
| Heading-permalink flash (`mdx-plugins.ts:59`) | Fixed, zero app code | Not fixed | Fixed |
| `navigate('#id')` routes to `/` bug | Fixed | Not fixed | Fixed |
| Docs' existing escape-hatch pattern | Becomes harmful (must be scrubbed) | Keeps working | Becomes unnecessary (hash) / improved (paths) |
| Behavior change risk | Hash-only navs stop animating (no opt-back-in) | None (additive) | Same as A |
| New public surface | None | Optional param on existing export | Optional param on existing export |
| Implementation size | Small | Small | Small+small; touches the same ~5 files once |

## 5. Recommendation

**Option C.** A and B are not competing designs; they fix different halves of the same
defect, and each alone fails one of the issue's two success criteria. The classification fix
is the honest model: the VT event system already defines a navigation as `pathname + search`
(`route-change.ts:42-46`), and #148 was the symptom of the classifier disagreeing with the
event model. It is also the only option that fixes the two flash defects that no amount of
app-side arming can reach (native permalink clicks). The keyed skip is then a small,
additive hardening of the escape hatch that remains for path/search targets, and it is what
lets nav-link and use-navigate delete their hand-rolled bailout heuristics rather than keep
maintaining them. Bundling them is not speculative scope: every piece is exercised by
existing call sites on this tree, and shipping A without B leaves the currently *documented*
pattern (`view-transitions.mdx` escape-hatch example) as a fresh footgun. The fragment branch
in `useNavigate` is the issue's literal ask and repairs a verified mis-route to `/`.

## 6. Breaking changes and docs impact

No export is removed or renamed; `skipNextNavTransition` gains an optional parameter with
no-arg behavior preserved. Three behavior changes, all bug-fix-flavored but visible:

1. **Hash-only URL changes never run a view transition** (including a preact-iso soft nav
   whose target differs only in hash). There is deliberately no opt-in to animate a
   hash-only change afterward; a release-note line is required. This is the #148 behavior
   users were told to want.
2. **`navigate('#id')` anchors instead of rendering `/`.** Anyone depending on the old
   behavior was depending on a mis-route.
3. **The documented raw-hash escape hatch changes.** `view-transitions.mdx` "Opting out"
   section must be rewritten (hash example removed, keyed target documented, "every URL
   change" wording corrected). Per the docs style rule, describe the new behavior only, no
   migration breadcrumbs.

Site impact: `TableOfContents.tsx` loses its framework import and hazard comment (the issue's
success criterion); `use-hash-scroll.ts` is untouched (it keys off `hashchange` and VT
lifecycle, both still fire appropriately; with fewer spurious transitions its afterSwap path
simply runs less). Note in passing (out of scope, worth a follow-up line in #260): a native
permalink click also resets the shim's direction counter (`history-shim.ts:77-83`, popstate
with null state reads `incoming = 0`), which mis-reports `NavDirection` for the next pop;
this design does not change that.

## 7. Testing strategy

View transitions cannot be verified visually here (startViewTransition is skipped for
backgrounded documents), so everything is specified as state-machine tests in the existing
harness: happy-dom, a stubbed `document.startViewTransition` spy, flushes driven through
`options.debounceRendering`, navigations via real `history.pushState`
(`packages/iso/src/__tests__/skip-view-transition.test.ts:12-31` is the template, with
`__resetTransitionStateForTesting` / `resetHistoryShimForTesting` between cases).

Extend `skip-view-transition.test.ts` (scheduler state machine):

- hash-only push then flush: `startViewTransition` not called, render commits.
- hash-only push, **no** flush, then unrelated flush: not called (deferred-flash regression,
  the `TableOfContents.tsx:88-91` case).
- hash push during an in-flight cold navigation does not abandon it (drive via the existing
  cold-flush machinery; assert the cold transition still receives its content flush).
- path and search-only pushes still transition (regression guards for the reclassification).
- keyed arm consumed on matching commit; keyed arm cleared, not applied, on a mismatched
  commit, and the *following* matching nav still animates (self-expiry).
- arm `/a` then coalesced flush at `/b`: `/b` animates (last-writer/coalescing case).
- no-arg arm keeps exact legacy semantics (existing four tests must stay green unmodified
  except the hash-URL one if any).

`use-navigate.test.tsx` (conventions at lines 37-95): fragment target calls `pushState` with
the fragment and does **not** call `route()`; scrolls the target element; path target with
`transition: false` arms keyed; same-URL target no longer needs its dedicated guard test
(replace lines 76-85's case with a keyed-expiry assertion); no crash when `location` is
absent (SSR import safety).

`nav-link.test.tsx`: the same-URL click test (line 283) flips from "does not arm" to "arms
keyed, and a subsequent different-URL nav still transitions"; modifier/download/cross-origin
gates (lines 136-226) unchanged.

Site: `TableOfContents.test.tsx` drops its arming assertions and keeps the
hash-write/scroll-lock behavior tests (lines 87, 113 anchor the existing expectations).

All of the above are deterministic unit tests; no browser MCP or visual check is required.
