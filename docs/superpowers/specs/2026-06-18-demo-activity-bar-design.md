# Persistent live-activity bar for `/demo`

Status: design approved 2026-06-18. Prototype. Scope: `apps/site` only (no framework
or npm-package changes), so no release implications.

## Goal

Dogfood the framework's `Persist` component (built but never used in the app) and its
streaming story with a single feature: a slim bar pinned to the bottom of the `/demo`
viewport that shows "changes happening" on the task board as a live, server-driven feed.

The feature is chosen to make `Persist` *visibly earn its keep*: the bar owns a live
streaming connection and an accumulating feed, and because it is persisted **outside the
router**, both survive every intra-`/demo` navigation (board ↔ task ↔ project list) with
no reconnect, reset, or flicker. A non-persisted bar would remount and drop its
connection on every SPA hop.

## Non-goals

- No new framework/package surface. This is an app-level prototype.
- Simulated teammate events are **display-only**; they do not mutate the in-memory demo
  store or the board. (A future enhancement could make them mutate + invalidate the
  board loader, but that is out of scope and would make the board rearrange under the
  user.)
- No persistence across cold starts / isolates beyond what the existing demo store
  already does. The demo is a feature showcase, not a saved tool.

## Decisions locked during brainstorming

1. **Data source: hybrid.** A server-driven SSE stream emits simulated teammate activity
   on a jittered timer (the always-on heartbeat that proves async streaming), AND echoes
   the user's *real* actions when the action request and the open stream share an
   isolate. On Cloudflare the two can land on different isolates, so real-action echo is
   best-effort; the simulated heartbeat guarantees the bar is never dead. Documented as
   such.
2. **Shape: bottom-docked + expand.** Slim full-width fixed bar. Collapsed: live pulse
   dot + latest event line + event count + expand chevron. Click expands a scrollable
   recent-feed panel upward.
3. **Feed scope: global across all projects** (always has content; survives project
   switches). Each row shows which project it belongs to.
4. **Transport: native `EventSource`** (auto-reconnect, dead simple) against an SSE
   endpoint, rather than `fetch` + `ReadableStream`.

## Why not the framework's streaming-loader API

The headline streaming primitive (`route.loader(async function* …)` consumed via
`loader.View`) is **route-bound**: it is initiated by the router when a route mounts and
re-runs on every navigation. A component that must *outlive* routes cannot ride it, and
there is no public client API to subscribe to a loader's stream from outside the router.

So the bar uses the same SSE substrate the framework's own loader-streaming and internal
SSE codec (`packages/server/src/sse.ts`) are built on: Hono's `streamSSE`
(`hono/streaming`, present in hono 4.12.14) server-side and native `EventSource`
client-side. The framework's `sseGeneratorResponse` is server-internal (not exported),
so app code uses Hono's helper directly rather than reaching into framework internals.

If this pattern proves valuable, a small client hook to subscribe to a streaming endpoint
outside the router is a natural Section-C-style primitive candidate (the way the existing
site-discovered primitives were found). That is explicitly **out of scope** here.

## Architecture

Three new files + small edits to four existing files. All under `apps/site`.

### 1. `apps/site/src/demo/activity-stream.ts` (new) — event model + in-memory bus

The shared event type and a tiny pub/sub the server action layer publishes to and the SSE
endpoint subscribes to.

```ts
import type { TaskStatus } from './data.js';

export type ActivityEvent = {
  id: string;            // stable client key (counter + suffix)
  kind: 'task-created' | 'task-moved' | 'comment-added';
  at: number;            // epoch ms
  actor: string;         // display name ("Alice", "Bob", or the signed-in user)
  taskId: string;
  taskTitle: string;
  projectSlug: string;
  to?: TaskStatus;       // only for 'task-moved'
  simulated: boolean;    // true = fabricated teammate event (display-only)
};

export function publishActivity(e: ActivityEvent): void;       // fan out to subscribers
export function subscribeActivity(cb: (e: ActivityEvent) => void): () => void;
export function recentActivityEvents(limit?: number): ActivityEvent[]; // seed backfill
export function __resetActivityForTesting(): void;             // test-only
```

- `publishActivity` / `subscribeActivity` are a `Set<cb>` fan-out. No buffering between
  events; the SSE endpoint queues what it receives.
- `recentActivityEvents(limit = 5)` derives a few most-recent events from the existing
  demo store (across all projects) by reading `listAllTasks` / `listComments` /
  `getUser` / `getProject`, so a freshly-connected bar is immediately populated with
  real-looking history rather than waiting 4-8s for the first simulated tick. Marked
  `simulated: false` (it is real seed history). Read-only; mutates nothing.
- `id` generation: a module-level monotonic counter plus a short suffix so keys are
  unique and stable.
- `data.ts` gains one tiny read helper, `listAllTasks(): Task[]` (`store.tasks.slice()`),
  consumed by the backfill and the simulator. No other `data.ts` changes.

Import direction: `activity-stream.ts` imports **types** from `data.ts`
(`import type`) and the read helpers at runtime; `data.ts` does **not** import
`activity-stream.ts` (the store stays a pure data module). Publishing is done from the
server action layer, not the store mutators — see below.

### 2. `apps/site/src/demo/activity-sim.ts` (new) — simulated teammate generator

```ts
import type { ActivityEvent } from './activity-stream.js';
export function simulateActivity(): ActivityEvent | null;
```

- Picks a random real task from `listAllTasks()`, resolves its project slug, picks a
  random actor name from the seed users, and builds either a `task-moved` (to a random
  status different from the task's current one) or a `comment-added` event. Returns
  `null` only if the store is empty.
- Limited to `task-moved` / `comment-added` so every simulated event references a **real
  existing task** (real `taskId` + `taskTitle`). `task-created` is reserved for real user
  actions (a fabricated create would need a fake `taskId`).
- Marked `simulated: true`. Does **not** mutate the store. Uses `Math.random` (fine at
  app runtime).

### 3. `apps/site/src/api.ts` (new) — SSE endpoint, auto-mounted ahead of framework handlers

The framework loads `src/api.ts` (default option `api: 'src/api.ts'`) if present and
mounts its default-exported Hono app ahead of its own handlers. A specific path does not
trip the catch-all-shadowing build check. The site has no `api.ts` today; this is the
first.

```ts
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { subscribeActivity, recentActivityEvents, type ActivityEvent } from './demo/activity-stream.js';
import { simulateActivity } from './demo/activity-sim.js';

const app = new Hono();

app.get('/api/demo/activity', (c) =>
  streamSSE(c, async (stream) => {
    const queue: ActivityEvent[] = [];
    let wake!: () => void;
    let wakeP = new Promise<void>((r) => (wake = r));
    const unsub = subscribeActivity((e) => { queue.push(e); wake(); });
    stream.onAbort(() => { unsub(); wake(); });           // break the loop promptly

    for (const e of recentActivityEvents(5)) {            // immediate backfill
      await stream.writeSSE({ data: JSON.stringify(e) });
    }
    try {
      while (!stream.aborted) {
        while (queue.length) await stream.writeSSE({ data: JSON.stringify(queue.shift()!) });
        const tick = 4000 + Math.floor(Math.random() * 4000);   // 4-8s jitter
        await Promise.race([wakeP, stream.sleep(tick)]);
        wakeP = new Promise<void>((r) => (wake = r));
        if (stream.aborted) break;
        if (queue.length === 0) {                          // timer path → simulate
          const e = simulateActivity();
          if (e) await stream.writeSSE({ data: JSON.stringify(e) });
        }
        // queue non-empty → loop top drains real events first
      }
    } finally {
      unsub();
    }
  })
);

export default app;
```

Design notes:
- **Event-driven loop racing a jittered timer against the real-event bus.** Real events
  (echoed user actions) flush near-immediately via `wake()`; absent any, a simulated
  event emits every 4-8s. Abort-aware via `stream.aborted` + `onAbort` (closes the
  subscription and breaks the race).
- Known benign race: if a `wake()` lands in the narrow window between the race resolving
  and `wakeP` being reassigned, that event waits until the next timer tick (≤ 8s) when the
  loop-top drain catches it. Acceptable for a demo; noted.
- Each frame is a JSON-encoded `data:` line — the same `text/event-stream` shape the
  framework's SSE codec emits.

### 4. `apps/site/src/components/demo/ActivityBar.tsx` (new) — the persistent bar

Rendered via `<Persist id="demo-activity-bar">` (placed in the demo layout). Lives in
`PersistHost`'s tree, i.e. **outside the router**, so it cannot use `useRoute` /
`useParams` / `useNavigate`. It therefore:

- Opens its **own** `EventSource('/api/demo/activity')` in an effect, parses each message,
  and prepends to capped state (`events`, newest first, max ~50). The connection and the
  accumulated feed survive intra-`/demo` navigation because the component instance
  persists in `PersistHost`. **This is the showcase.**
- Learns the current path from `window.location.pathname` on mount and from
  `subscribeViewTransitionTypes((nav) => setPath(nav.to))` (public, non-hook, fires on
  every navigation including outside a mounted router; the callback returns `undefined`
  so it adds no transition types — used purely for the `nav.to` side-effect).
- Derives `isDemo = path.startsWith('/demo')`. The `EventSource` effect is keyed on
  `isDemo`: it stays open across all intra-`/demo` hops (dep unchanged → effect does not
  re-run), and closes when the user leaves `/demo` (and reopens on return). The
  accumulated `events` array is retained across a `/docs` round-trip because the component
  instance lives on; only the live wire reconnects.
- **Renders `null` when `!isDemo` or on the server** (`typeof window === 'undefined'`), so
  it never appears over the docs/home and is purely a client-side progressive
  enhancement. Server render contributes nothing; the bar fills in post-hydration.
- Collapsed UI: fixed bottom bar — live pulse dot (animated while connected), latest event
  line, event count, expand chevron. Expanded UI: a panel slides up (plain CSS, not a
  route transition) showing the recent feed (scrollable, newest first) with per-row
  project tag + relative time, a connection-status header, and a collapse control.
- Styling reuses the existing demo Tailwind tokens (`bg-background`, `text-foreground`,
  `border-border`, `bg-surface-subtle`, `text-muted`, `bg-accent`, …). The root element
  carries the plain CSS class `demo-activity-bar` for view-transition isolation (below).

### Edits to existing files

- **`apps/site/src/pages/demo/demo-layout.tsx`**: render `<Persist id="demo-activity-bar"><ActivityBar /></Persist>`
  alongside `{children}`. The demo layout wraps every `/demo` route and stays mounted
  across all demo navigations, so it is the correct host. **No `viewTransitionName` prop
  on `Persist`** (see isolation section).
- **`apps/site/src/demo/data.ts`**: add `listAllTasks(): Task[]`.
- **`apps/site/src/pages/demo/project-board.server.ts`** and **`task.server.ts`**: after a
  successful mutating action (`createTask`, `patchTask`/`setStatus` for moves,
  `addComment`), call `publishActivity(...)` with a `simulated: false` event built from the
  action's known inputs (resolving task title / project slug / actor name via existing
  reads). Publishing lives in the **action layer**, not the store, so `data.ts` stays a
  pure store and the broadcast concern is localized to where user intent is known.
- **`apps/site/src/styles/root.css`**: the isolation rules + a pulse keyframe for the live
  dot + a slide-up keyframe/transition for the expand panel + bottom padding on the demo
  content area so the collapsed bar never covers the last board row.

## View-transition isolation (mirrors the sidebar, with one fixed-position twist)

A persistent fixed bar that is not isolated gets captured into `::view-transition-old/new
(root)` and visibly slides/fades with the page on every navigation. The sidebar avoids
this (`apps/site/src/styles/root.css:601-612`); the bar gets the same treatment:

```css
/* Lift the bar out of the root snapshot so root slide/fade can't drag it. */
.demo-activity-bar { view-transition-name: demo-activity-bar; }

/* Within demo (bar present in both snapshots) freeze it: only page content transitions.
   Scoped to demo-within ONLY — on enter/leave the bar is in one snapshot and should keep
   the default fade, not freeze a stale copy on screen (same reasoning as .demo-sidebar). */
html:active-view-transition-type(demo-within)::view-transition-group(demo-activity-bar),
html:active-view-transition-type(demo-within)::view-transition-old(demo-activity-bar),
html:active-view-transition-type(demo-within)::view-transition-new(demo-activity-bar) {
  animation: none;
}
```

**The fixed-position twist:** the `view-transition-name` must sit on the bar's **own fixed
element** (the `.demo-activity-bar` class on `ActivityBar`'s root), **not** on `Persist`'s
`viewTransitionName` prop. That prop names the `PersistSlot` wrapper `<div>`
(`persist.tsx:50-57`); because the bar is `position: fixed` (out of flow), that wrapper
collapses to zero height, captures nothing, and the fixed child falls back into the root
snapshot anyway. So:

- Name the bar element directly via the `.demo-activity-bar` class (mirrors `.demo-sidebar`).
- Add the matching `demo-within` `animation: none` freeze.
- Leave `<Persist viewTransitionName>` **unset** to avoid a second, empty named group.
- The collapsed bar and the expand panel live under one fixed root so they isolate as a
  single group.
- Streaming content updates are not navigations, so they never trigger the route VT; the
  "new event" / expand affordances are plain CSS transitions, kept separate from the route
  transition machinery.

## SSR / non-blocking guarantees

- `ActivityBar` returns `null` on the server, so SSR emits nothing for it; the page is
  fully rendered and usable immediately. No loader/page data is touched.
- `EventSource` opens post-hydration in an effect; the feed fills in asynchronously, so
  the page never looks like it is waiting to finish loading.
- `PersistHost` is a separate client-only root mounted into an appended container, so there
  is no SSR HTML for it to mismatch against — no hydration warning from rendering the bar
  client-only. The demo layout's `Persist` renders nothing inline on the client (browser
  path), matching the empty server contribution.
- Fixed positioning means the bar has no place in document flow, so its client-only mount
  causes zero layout shift; bottom padding on the demo content area reserves space under
  the collapsed bar.

## Testing

Prototype-appropriate, focused on the pure logic + the component's own behavior. The
persistence-across-navigation and the view-transition isolation are integration/visual
concerns verified manually in the running app (and per project memory, MCP browsers can't
visually verify view transitions — only DOM swaps / console — so VT isolation is checked
by reading computed `view-transition-name` and by eye).

- `activity-stream.test.ts`: `publishActivity` reaches subscribers; unsubscribe stops
  delivery; `recentActivityEvents(n)` returns ≤ n most-recent, well-formed events from the
  seeded store.
- `activity-sim.test.ts`: over many runs, `simulateActivity()` returns a well-formed event
  whose `taskId` exists in the store and whose `projectSlug` matches that task's project;
  `kind` ∈ {`task-moved`, `comment-added`}; `simulated === true`; never mutates the store.
- `ActivityBar.test.tsx`: with a stubbed global `EventSource`, dispatching messages
  accumulates events and renders the latest line + count; the expand toggle reveals the
  feed; the bar renders `null` when the path is outside `/demo`.

## Verification (pre-push)

Mirror CI's six steps in order (per project CLAUDE.md): framework build →
`pnpm format:check` → `pnpm typecheck` → `pnpm test:coverage` → `pnpm test:integration` →
`pnpm --filter site build`. Plus manual run (`verify`/`run` skill) to confirm: the bar
streams and fills in without blocking first paint; the connection + feed survive
board↔task↔project navigation; the bar stays rock-steady (no slide/fade) during
`demo-within` transitions; it disappears on `/docs` and reappears on return.

## File summary

New:
- `apps/site/src/api.ts`
- `apps/site/src/demo/activity-stream.ts`
- `apps/site/src/demo/activity-sim.ts`
- `apps/site/src/components/demo/ActivityBar.tsx`
- `apps/site/src/demo/__tests__/activity-stream.test.ts`
- `apps/site/src/demo/__tests__/activity-sim.test.ts`
- `apps/site/src/components/demo/__tests__/ActivityBar.test.tsx`

Edited:
- `apps/site/src/pages/demo/demo-layout.tsx`
- `apps/site/src/demo/data.ts` (add `listAllTasks`)
- `apps/site/src/pages/demo/project-board.server.ts` (publish on mutating actions)
- `apps/site/src/pages/demo/task.server.ts` (publish on mutating actions)
- `apps/site/src/styles/root.css` (VT isolation + keyframes + content bottom padding)
