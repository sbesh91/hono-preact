# Home page: an RPC-connection scroll experience

Date: 2026-07-05
Status: Design, pending review
Area: `apps/site` (docs/marketing site), home route only

## 1. Goal

Replace the current static home page (`apps/site/src/pages/home.tsx`: hero shader + a
code-block grid + four feature cards) with a **scroll-driven visual storytelling page**
that shows how hono-preact assembles a page and moves data. The page teaches by letting
the reader **scrub time with their own scroll**: a browser preview reacts on one side, the
real connection (a network-style timeline) plays on the other.

The reference is the classic remix.run v1 marketing page, whose power was direct
manipulation (scroll is the playhead), spatial correspondence (the preview sits above the
bar that produced it), before/after shape that argues pre-verbally, and a reused DevTools
mental model. **We riff on that spirit; we do not copy its content.** Every chapter tells a
story that is literally true of hono-preact today, in our own brand language, and several
chapters tell things Remix's page never could (view transitions, realtime sockets, edge).

### Non-goals

- No change to any framework package. This is `apps/site` home-route work only.
- No new marketing claims that aren't already true and documented in `/docs`.
- Not a rebuild of the docs or demo sections, the nav, or the theme system.
- No heavy animation library. The scroll kit is small, hand-rolled Preact + rAF.

## 2. Principles (the "riff, don't copy" rules)

1. **True to the framework.** Every chapter maps to a real capability with a real API
   snippet and, where possible, a live `/demo` route the copy can point to. Claims are
   taken from the framework's own docs (sources catalogued in section 11).
2. **Scroll is the scrubber.** The primary mechanic is scroll position, computed in JS
   (`scrollY` relative to a pinned stage), not CSS scroll-timeline (that is only Newly
   Available; see browser-support constraint). Reversible, deterministic, SSR-safe.
3. **The clock is decoupled from the renderer.** The same primitives can be driven by
   scroll (scrub-to-learn) or by a live rAF clock (the realtime chapter, which must keep
   moving on its own because a monotonic scrub can't fairly show a duplex, ongoing stream).
4. **Progressive enhancement is non-negotiable.** With no JS or before hydration, the page
   renders a coherent, representative static frame of every chapter (real headings, copy,
   and code are server-rendered text). `prefers-reduced-motion` gets the same static frames
   and disables scrubbing and the live clock. This mirrors Remix's `fallbackFrame`.
5. **Our visual language, not theirs.** Orange-to-magenta "orangenta" gradient, Selawik,
   the existing light/dark token system, and the existing motion vocabulary
   (`--spring-soft`, view transitions). No Fakebooks, no Spinnageddon copy, no blue/green
   DevTools palette; our network wire uses brand hues plus a semantic done/in-flight/cancel
   set that clears WCAG AA in both themes.
6. **Responsive by requirement.** Mobile and short viewports are a first-class target, not
   an afterthought. Every chapter has a defined small-screen presentation (section 4.4);
   nothing clips, tap targets are reachable, and the page body never scrolls horizontally at
   any width.

## 3. The chapter arc (locked: "Arrangement A")

Twelve chapters. Legend: ◆ big scroll-scrubbed device · ○ calm connective section ·
★ live-clock (not scrub) · ✦ optional flourish. "Riff" names the Remix device reinterpreted;
"net-new" means Remix's page had no equivalent.

| # | Chapter | Type | Riff / origin | The true claim (headline) |
|---|---------|------|---------------|---------------------------|
| 1 | Hero | ○ | Remix split hero | One framework, edge to browser. |
| 2 | Runs on the platform, at the edge | ○ | "Break through the static" | A Web-Fetch app on Hono; the same source runs on Cloudflare or Node. |
| 3 | Routing is a manifest | ◆ | InteractiveRoutes | Routes are a data structure; nested layouts stay mounted; each node owns its data + code-split. |
| 4 | SSR, no client waterfall | ◆ | Without/With Remix (Spinnageddon) | Loaders run in parallel on the server; one HTML document streams; the client never staircases. |
| 5 | Streaming, live | ◆ | Remix `defer`, surpassed | A loader can be an `async function*`; each yield streams (SSR-pumped inline, or SSE) and folds into live UI, out of order. |
| 6 | Mutations without the cliff | ◆ | Remix `<Form>` + actions | A mutation is a `<Form>` + `defineAction`: optimistic now, server settles, loaders revalidate by reference, works without JS. |
| 7 | Resilience | ◆ | Route error boundaries / BSOD | Loading, revalidating, and error are data you match on (SWR, keep-last-good); a route boundary contains a failure to its pane. |
| 8 | Instant navigation | ◆ | Simulated-cursor prefetch | Hover warms the cache via the browser-native Speculation Rules API + typed `usePrefetch`; zero loading state. |
| 9 | View transitions | ◆ | **net-new** (signature) | Automatic on every route change, direction-aware, with shared-element morphs. Free. |
| 10 | Realtime | ◆★ | **net-new** | One typed duplex socket per client; rooms with presence; SSE for push, WebSocket for duplex. |
| 11 | One package, typed throughout | ○ | web-fundamentals thesis | `hono-preact` + `/server` + `/vite` + `/adapter-*`; typed end to end; per-feature client-JS budget. |
| 12 | Closing CTA | ○ | "Go Play!" | Go build. The button dogfoods the Speculation Rules from chapter 8. |
| ✦ | Konami-style easter egg | ✦ | Konami cheat code | Optional personality beat; only if it earns its place. |

Chapter 7 (Resilience) is the first candidate to cut if length becomes a concern; it can
also fold its "loader states as data" half into chapter 5 and keep only the error-boundary
containment demo. Flagged for the reviewer.

### Per-chapter device detail (the ◆ chapters)

Each ◆ chapter is a `ScrollStage` (see section 4) with the shared **browser + wire** kit:
a `BrowserFrame` preview on one side, a `Wire` network timeline on the other, a `Playhead`
that tracks scroll progress, and a `Caption` that names the beat.

- **3 · Routing is a manifest.** A sticky browser renders a small nested app (root → section
  → list → detail). Scrubbing auto-cycles the highlighted segment; hover/focus/click on a
  route node in a shown `routes.ts` overrides it. Selecting a node rings the matching nested
  pane, colorizes its URL segment, and shows that it *stays mounted* while its child swaps.
  Snippet: `defineRoutes([{ path: '/projects', layout, children: [{ path: ':id', view }] }])`.
  Points at `/demo/projects`.

- **4 · SSR, no client waterfall.** The A/B device, reframed to *our* truth. Left: "fetch in
  components" — a staircase of chained requests with a cascade of spinners, UI arrives late.
  Right: "hono-preact SSR" — `document (HTML)` + `loaders ∥ (server)` start together as a
  parallel block; the invoice UI snaps in early. Staircase vs block carries the argument.
  This is the SSR beat. Snippet: `serverLoaders = { default: defineLoader(async ({ signal }) => getProjects({ signal })) }`
  and `.View(({ data }) => …)`; note the client-nav path is a transparent POST to `/__loaders`
  returning typed `Serialize<T>`. Points at `/demo/projects/:projectId`.

- **5 · Streaming, live.** One document bar plus several boundary bars that **complete out of
  order**; each flips its preview region skeleton → content in place as its bar turns "done".
  A counter ticks. Snippet: `defineLoader(async function* ({ signal }) { while (!signal.aborted) yield await snapshot(); })`
  consumed with `.View(render, { initial, reduce })` over a `StreamState` union; mention
  SSR-pumped inline chunks vs `{ live: true }` SSE and `liveStream`. Points at
  `/demo/projects/:projectId/tasks/:taskId`.

- **6 · Mutations without the cliff.** Browser shows a `<Form>`; scrubbing plays: optimistic
  row appears instantly (dashed/dim), a `POST /projects` bar runs, a duplicate resubmission
  bar is **cancelled** (semantic cancel color) to show race handling, then a
  `POST /__loaders ↻` revalidation bar fires and the row settles solid. Punchline caption:
  the same markup **works with JS disabled** (native form POST, server re-renders,
  `useActionResult`). Snippet: `useAction(serverActions.addTask, { invalidate: 'auto', onMutate, onError })`
  and `<Form action={stub}>`. Points at `/demo/projects/:projectId/tasks/:taskId` and
  `/demo/login` (the no-JS form).

- **7 · Resilience.** Browser shows a nested app where one pane throws and is replaced by an
  inline "something broke" boundary while the surrounding chrome stays fully usable; a small
  state chip cycles `loading → success → revalidating → error (keeps last value)`. Snippet:
  the `LoaderState` discriminated union and a colocated route error boundary. Points at
  `/demo/projects/:projectId/tasks/:taskId`.

- **8 · Instant navigation.** A simulated cursor (driven by scroll thresholds, no real
  pointer) glides to a link; on "hover" a prefetch popover lists parallel warm requests
  completing; a click ripple fires and the destination renders with **zero loading state**.
  Caption one-ups Remix: we hand this to the browser-native Speculation Rules API. Snippet:
  `defineApp({ speculation: true })` and `usePrefetch(href, loaders)`. Points at `/docs`
  (the live site already runs `speculation: true`).

- **9 · View transitions (signature).** In-page, contained demo using the **real** web
  platform primitive: a local widget with two/three "pages" whose swap is wrapped in
  `document.startViewTransition`, with `view-transition-name` on a card so it **morphs** into
  a detail hero, and direction classes so forward slides left / back slides right. This
  mirrors what the framework does automatically on every route change (no per-link opt-in).
  Copy references the framework's automatic + direction-aware + shared-element behavior.
  Points at `/demo/projects` (which does exactly this for real).

- **10 · Realtime (live clock).** NOT scrub-driven. A live rAF clock runs while the chapter
  is in view: two cursors move, a tally rises, up/down frames tick on a `WS /__sockets` lane
  that stays "open". Caption states the two-transport model (SSE for server→client push,
  WebSocket for duplex + presence) and that on Cloudflare it fans out through one
  framework-provided Durable Object. Snippet: `defineSocket`/`useSocket` and
  `defineRoom`/`useRoom` (presence). Points at `/demo/cursors` (WS) and `/demo/live-tally`
  (SSE `liveStream` + `publish`).

## 4. Architecture: the scroll kit

A small, self-contained kit under `apps/site/src/components/home/scroll/`. No external deps.

### 4.1 Primitives

- **`ScrollStage({ pages, children })`** renders a spacer `div` of height `pages × 100svh`
  whose single inner panel is `position: sticky; top: 0; height: 100svh` (pins to the
  viewport while the reader scrolls `pages` screen-heights past it). It measures its own
  offset and publishes a normalized progress `0 → 1` on a context, computed as
  `clamp((scrollY − stageTop) / (pages × innerHeight), 0, 1)`, updated on an rAF-throttled
  scroll/resize handler. Provides `progress` and `pinned` (whether it currently owns the
  viewport).
- **`Actor({ start, end, children })`** slices `[start, end]` of the parent progress and
  **re-normalizes** to a fresh local `0 → 1`, republished on the same context. This is what
  lets one scroll clock drive many independently-timed sub-scenes. Actors nest.
- **Leaf renderers**, each reading `useStageProgress()`:
  - `Wire` / `Lane` / `Bar` — a network timeline; a bar has `{ start, size }` and its width
    is `clamp((progress − start) / size, 0, 1)`; state is `idle | in-flight | done | cancel`
    (a `cancelAt` freezes width and flags cancel).
  - `Playhead` — a thin line + triangle thumb at `left: progress × 100%`.
  - `BrowserFrame` — chrome + URL bar + body; body regions gate skeleton→content on
    progress thresholds.
  - `Reveal` — fade/rise-in for connective copy (IntersectionObserver, not scrub).
- **Clock abstraction.** `ScrollStage` provides the scroll clock. `LiveStage` provides an
  identical context shape driven by an rAF timestamp loop (only while in view), so the
  realtime chapter reuses `Wire`/`BrowserFrame`/etc. unchanged. Same renderers, two clocks.

### 4.2 SSR / no-JS / reduced-motion

- Every primitive renders a **representative static frame** during SSR from a
  `fallbackProgress` prop (e.g. a mid-or-final frame that reads as coherent). So the page is
  meaningful as plain HTML: headings, paragraphs, code samples, and a sensible diagram state
  are all present for SEO, crawlers, and no-JS users.
- On mount, if `matchMedia('(prefers-reduced-motion: reduce)').matches`, the kit **keeps the
  static frame**, does not attach scroll/rAF listeners, and does not pin (stages fall back to
  normal document flow so there is no empty scroll distance). Chapters become stacked static
  panels.
- The framework's `prefers-reduced-motion` handling for its own view transitions already
  exists in `root.css`; chapter 9's local `startViewTransition` demo must guard on it too.

### 4.3 File layout

```
apps/site/src/pages/home.tsx                      # composes the chapters, meta/title, CTAs
apps/site/src/components/home/
  scroll/ScrollStage.tsx  useStageProgress.ts  Actor.tsx  LiveStage.tsx
  scroll/Wire.tsx  BrowserFrame.tsx  Playhead.tsx  Reveal.tsx
  chapters/ChapterHero.tsx  ChapterEdge.tsx  ChapterRouting.tsx  ChapterSSR.tsx
  chapters/ChapterStreaming.tsx  ChapterMutations.tsx  ChapterResilience.tsx
  chapters/ChapterPrefetch.tsx  ChapterTransitions.tsx  ChapterRealtime.tsx
  chapters/ChapterOnePackage.tsx  ChapterCTA.tsx
apps/site/src/styles/home.css                     # kit + chapter styles, via existing tokens
```

Each chapter is a single-responsibility component with its content (copy + code snippet +
device config) local to it, so chapters can be reordered, cut, or edited in isolation. The
hero keeps the existing `HeroShader`.

### 4.4 Small viewports (mobile and short screens)

Mobile responsiveness is a design requirement, not a follow-up. The kit degrades on several
axes, chosen per chapter:

- **Reflow, don't shrink-to-fit.** The two-panel `browser | wire` layout stacks vertically
  (browser above wire) below a ~48rem breakpoint. Chapter 4 (the A/B device, the only scene
  with two browsers side by side) stacks "fetch in components" above "hono-preact SSR" so the
  staircase-vs-block contrast reads top-to-bottom instead of being squeezed to unreadable.
- **Fit the pinned scene to the real viewport.** Pinned stages are sized in `svh`
  (small-viewport-height) units, not `vh`, so the mobile address-bar show/hide can't make a
  scene overflow and clip. Type and padding shrink via `clamp()` at small sizes.
- **Shorten the scrub.** `ScrollStage` takes a smaller `pages` count on narrow screens so
  each device plays over less finger-scrolling (a 3.4-screen desktop stage need not be 3.4
  screens on a phone).
- **Last resort: unpin.** If a scene still cannot fit legibly at a target width, it drops
  pinning below that breakpoint and falls back to the reveal-on-enter stepped presentation
  (the same static-frame path as reduced motion, section 4.2). Correctness never depends on
  the pin.
- **Touch parity.** Every pointer interaction has a touch/tap equivalent: the routing
  explorer (chapter 3) is tap- and focus-operable; the simulated cursor (chapter 8) is
  autoplay and needs no real pointer. Interactive targets meet a >=44px tap-target size.
- **No horizontal body scroll, ever.** Wide content (the A/B panels, code samples) lives in
  its own `overflow-x: auto` container so the page body never scrolls sideways at any width.

Target widths to verify in build: ~360px (small phone), ~768px (tablet / breakpoint edge),
and a short-landscape phone (to exercise the `svh` fit). The realtime chapter's live clock
must also stay cheap on mobile CPUs (see section 7).

## 5. Visual design language

- **Color.** Existing tokens only (`root.css`): orangenta gradient for emphasis and "done/
  live" bars; `--accent`/`--muted`/`--surface`/`--border` for structure. New semantic wire
  states: in-flight = `--accent`, done = a green that clears AA in both themes, cancel = an
  amber/orange that clears AA in both themes. Add these as tokens (light + dark) beside the
  existing badge tokens, per the WCAG-AA-over-brand rule.
- **Type.** Selawik (already loaded via `root.css` `@font-face`), existing scale; big scroll
  headlines use the 700 weight; code uses `ui-monospace`.
- **Motion.** Reuse `--spring-soft`/`--spring-duration` for reveals; the shader stays as the
  hero backdrop. Keep flourishes tasteful; the network wire and browser previews carry the
  page, not gratuitous effects.
- **Layout.** Content column `min(64rem, 100% - 3rem)`; pinned scenes center in the
  viewport and are sized in `svh` so mobile browser chrome cannot clip them; two-panel
  devices stack vertically below ~48rem (section 4.4); wide devices (the A/B two-panel, code)
  get `overflow-x: auto` guards so the body never scrolls sideways at any width.

## 6. Accessibility

- Decorative animation layers are `aria-hidden`; every claim exists as real, readable text.
- The routing explorer (chapter 3) is operable by keyboard: route nodes are buttons with
  focus states and `aria-current`-style indication; hover and focus both drive selection.
- Respect `prefers-reduced-motion` everywhere (section 4.2).
- Focus-visible uses the existing `--ring` outline.
- Chapter 9's local view-transition demo must be operable and meaningful without motion.

## 7. Performance and bundle

The home route is LCP-critical and Lighthouse-tracked (CI `lighthouse` job) and its client
JS is measured by the `client-size` job. Constraints:

- **Keep the kit small.** Hand-rolled Preact + rAF, no animation library. Target: the whole
  home experience adds a small, reviewable client-JS delta (report the measured number in
  the PR; investigate if it is large).
- **LCP stays fast.** The hero (existing shader + headline) is above the fold and must paint
  immediately; below-fold chapters initialize lazily (IntersectionObserver) so their setup
  does not block first paint.
- **Code-split.** The home experience is dynamically imported for the `/` route only; it must
  not enter the shared chunk that other routes pay for.
- **Browser support** (per project constraint: Baseline Widely Available; Newly Available =
  progressive enhancement). Primary mechanic is JS `scrollY` + rAF (works everywhere). Do
  NOT depend on CSS `animation-timeline` / scroll-driven animations for correctness (Newly
  Available); if used at all, only as an enhancement over the JS baseline. `position: sticky`,
  CSS grid, `color-mix`, and `startViewTransition` (chapter 9, already progressively
  enhanced by the framework) are all fine as used.

## 8. Testing

Update `apps/site/src/pages/__tests__/home.test.tsx` (happy-dom cannot run scroll/rAF, so
tests assert the **static SSR structure and copy**, not animation):

- Keep: primary CTA links to `/docs/quick-start`; secondary CTA links to `/demo`; the hero
  shader mounts.
- Add: each chapter renders its heading and its true-claim copy (guards the SEO/no-JS text).
- Add: the reduced-motion / no-JS path renders a coherent static frame (render with a stub
  that reports reduced motion; assert chapters are present and not visually-hidden).
- Add: the routing explorer renders its default selected state and its route-node buttons
  are focusable.
- Add: decorative layers are `aria-hidden`; claims are present as text.
- Add: the responsive fallback is wired. At narrow widths the two-panel scenes carry their
  stacked-layout markup, and a scene that unpins renders the reveal-on-enter static frame.
  happy-dom cannot measure layout, so assert the structural branch/classes exist (the
  responsive and unpinned code paths), not pixels. Real breakpoint behavior is verified by
  hand at the section 4.4 target widths during build.

Full pre-push CI parity per the repo runbook (`format:check`, `typecheck`, `test:types`,
`test:coverage`, `test:integration`, `apps/site build`). No framework package changes, so no
package suites are affected, but the `apps/site` build and the home test must pass.

## 9. Risks and open questions

1. **Mobile pinned scrub.** Pinned scenes can overflow on small viewports (the prototypes
   clipped). This is now a designed requirement, not an open risk: the responsive strategy in
   section 4.4 (reflow, `svh` fit, shorter scrub, unpin-as-last-resort, touch parity, no
   horizontal body scroll) covers it. Residual work is verification at the target widths
   during build; the two-panel A/B (chapter 4) is the tightest and gets checked first.
2. **Bundle budget.** Twelve chapters of bespoke devices could grow client JS. Mitigations:
   shared kit, lazy init, code-split, and reading the `client-size` PR comment. If the delta
   is large, tier the rollout (land core chapters first).
3. **Chapter 9 authenticity.** Showing real view transitions in-page without navigating away
   uses a local `startViewTransition` widget. Confirm this reads as "the framework does this
   automatically" and not as a hand-rolled one-off; the copy must connect it to the automatic
   route-change behavior and link to `/demo/projects` where it is real.
4. **Length/pacing.** This is a long page by design (Arrangement A). Alternating ○ calm and
   ◆ scrubbed chapters is the pacing device that keeps it breathing; if it still feels long
   in build, cut chapter 7 first (section 3).
5. **The existing prototypes** (the two Artifacts produced during brainstorming) are
   throwaway feel-tests, not the implementation. Their copy contains em-dashes and
   illustrative timings; the real build follows house style and the true claims here.

## 10. Not in scope / follow-ups

- Rewriting the docs or demo IA, the top nav, or the theme.
- New framework capabilities. If a chapter wants something not-yet-true, cut the chapter,
  do not stretch the claim.
- A dedicated "testimonials/social proof" section (Remix had one; we have nothing true to
  show yet). Omitted deliberately.

## 11. Sources (claims are grounded, not invented)

Framework truth was inventoried from the repo docs and source; per-chapter primary docs:
`/docs/routes`, `/docs/layouts`, `/docs/active-links`, `apps/site/src/pages/docs/loaders.mdx`,
`streaming.mdx`, `actions.mdx`, `loading-states.mdx`, `websockets.mdx`, `rooms.mdx`,
`realtime.mdx`, `live-loaders.mdx`, `deployment.mdx`, `/docs/view-transitions`,
`/docs/prefetch`, `/docs/link-prefetch`, and `scripts/measure-framework-size.mjs`.
Remix device reference: archived remix.run (web.archive.org, late 2021 / early 2022) and the
un-minified `remix-run/remix-website` `app/ui/homepage-scroll-experience.tsx` + `stage.tsx`.
```
