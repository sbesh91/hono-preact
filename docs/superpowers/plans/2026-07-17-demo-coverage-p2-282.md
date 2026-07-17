# Demo Coverage P2 (#282) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every P2 checkbox of issue #282 plus the drift-guard, so the site demo exercises the remaining dark framework APIs: Toast + standalone `useOptimistic` undo, direct `invalidate()`, streaming action `onChunk`, `useFieldErrors`/`useFieldErrorProps`, `NavLink`/`useRouteMatch` + the view-transition tail, head APIs + `useHonoContext`, `AppConfig.use` + `defineStreamObserver`, `api.ts` + `upgradeWebSocket`, Popover, and an exports-vs-imports coverage guard.

**Architecture:** All changes live in `apps/site` (no `packages/` changes). Server logic lands in existing `*.server.ts` modules (ONLY the four server-map exports; helpers go in sibling plain modules), UI in the demo pages/components, app-level wiring in `app-config.ts`/`api.ts`, and the drift guard as a vitest test over the demo source tree.

**Tech Stack:** hono-preact (workspace), hono-preact-ui (Toast, Popover), valibot, vitest + @testing-library/preact, Tailwind v4.

## Global Constraints

- Worktree: all paths are relative to `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/demo-coverage-p2-282/`. Always use that absolute prefix in Read/Edit/Write/Bash. Never touch the primary checkout; never use Serena MCP tools.
- No em-dashes in prose, code comments, or commit messages. No inline `as` value casts (`as const` on a fresh literal is fine).
- **`.server` modules may only export `serverActions` / `serverLoaders` / `serverRooms` / `serverSockets` as runtime named exports** (type-only exports are fine). The boot walker enforces this at runtime, and unit tests DO NOT catch violations (they import the modules directly). Every helper a `.server` module needs must live in a sibling plain module. This burned the P1 branch; do not repeat it.
- Test command: `pnpm test -- run` from the worktree root (apps/site has NO test script; `pnpm --filter site test` is a silent no-op). Read vitest's own summary line.
- `pnpm typecheck` after any change to shared types or `*.server.ts`; `pnpm format:check` before every commit (`pnpm format` to fix).
- TDD: failing test first, observe the failure, implement, observe the pass.
- Commit after each task (commits on this worktree branch are pre-authorized).
- Match surrounding comment density; comments state constraints, not narration.

## Facts established during planning (do not re-derive)

- **Toast**: `toast(message, opts?)` / `toast.success|error|info|warning|loading(message, opts?)` / `toast.promise(p, {loading,success,error})` / `toast.dismiss(id?)`; `ToastOptions = { id?, description?, duration?, important?, action?: { label, onClick }, onDismiss?, onAutoClose? }` (NO type/title/position fields; type comes from the method, title is the first arg, position is a `Toaster` prop). `toast()` and `Toaster` communicate through a module singleton; mount `Toaster` exactly once. `Toaster` children is a REQUIRED render-prop `(t: ToastRecord) => VNode`; returned nodes render inside an `<ol>`, so `Toast.Root` defaults to `li`. `Toast.Action` renders nothing unless the record has an `action` and auto-dismisses after click; `Toast.Close` needs an aria-label (defaults 'Close'). SSR-safe (no toast fires during server render).
- **Popover**: parts `Root/Trigger/Anchor/Positioner/Popup/Arrow/Title/Description/Close`. `side`/`align`/`offset` live on `Root` (defaults bottom/center/8). `Positioner` must wrap `Popup`; `Arrow` must be inside `Positioner`. Popup is `role="dialog"`, mount-on-open (`mount: 'unmount'`), dismisses on outside-press/Escape, returns focus to the trigger. No `modal`/`openDelay`/`asChild` props; the `render` prop is the polymorphism hook. Provide `Popover.Title` or `aria-label` on `Popup`.
- **Standalone `useOptimistic(base, reducer, { transition? })`** returns `[value, addOptimistic]`; `addOptimistic(payload)` returns `{ settle, revert }`. Entries marked settled are dropped whenever `base` identity changes, so pair settle with a loader `invalidate` that refetches or accept the value re-deriving from the next base. `transition: true` wraps settle/revert in `document.startViewTransition`.
- **`useAction` streaming**: `defineAction`/`route.action` accept an `async function*` (`AsyncGenerator<TChunk, TResult>`); the client's `UseActionOptions.onChunk?: (chunk: Serialize<TChunk>) => void` fires per yield; `mutate` resolves with the final `TResult`. Through `createCaller`, `call(actionRef, payload)` on a streaming action resolves `CallResult<AsyncGenerator<TChunk, TResult>>`: iterate `next()` for chunks; the `done` value is the result.
- **`useFieldErrors()`/`useFieldErrorProps(name)`** read the enclosing `<Form>`'s context, so they must be called from a component rendered INSIDE the `<Form>` subtree (not the component that renders `<Form>`). `useFieldErrorProps` returns `{}` when valid, else `{ 'aria-invalid': true, 'aria-describedby': <FieldError id> }`.
- **`NavLink`** props: `href, match?, exact? (default true), class, activeClass, inactiveClass, transition?` plus anchor attrs; `aria-current` is computed from active state but an explicit `aria-current` prop overrides it. `transition={false}` arms `skipNextNavTransition` on soft navs. `useRouteActive(patternOrHref, { exact })` prefix-matches when `exact: false`. `useRouteMatch(pattern, opts?)` returns the typed params object or `null`.
- **VT tail**: `useViewTransitionName(name | null)` and `useViewTransitionClass(cls | null)` return REF CALLBACKS to attach to an element (`<span ref={ref}>`); passing `null` removes the property. `ViewTransitionGroup({ class, render?, children })` is the component form of the class hook (defaultTag div). Naming must be unique per document: only ONE element may carry a given `view-transition-name` at a time.
- **Head hooks** (hoofd re-exports through `hono-preact`): `useTitleTemplate(template: string)` (e.g. `'%s · demo'`; later `useTitle('X')` renders `X · demo`); `useMeta({ name? | property? | httpEquiv? | charset?, content? })`; `useLink({ rel, href, as?, media?, crossorigin?, type?, hreflang?, sizes? })`.
- **`useHonoContext()`** comes from `'hono-preact/server'` (NOT the main entry) and returns the live Hono `Context` during SSR, `null`/undefined on the client. The site's vite config already aliases `hono-preact/server` to source. Importing it into shared client code relies on tree-shaking dropping `renderPage` from that barrel; Task 5 verifies the client build does not grow (see its verification step) and has a fallback.
- **`AppConfig.use`** accepts `ServerMiddleware<'page'> | ClientMiddleware | StreamObserver<unknown, never>`. `defineStreamObserver({ onStart?, onChunk?, onEnd?, onError?, onAbort? })` builds one; ctx is `ServerLoaderCtx | ServerActionCtx` (`ctx.scope` discriminates; loader ctx has `module`/`loader`, action ctx `module`/`action`). The Vite guard-strip plugin REPLACES `defineStreamObserver(...)` calls with `{ __kind: 'observer' }` in the client bundle, so observer bodies (and their imports, via tree-shaking) never ship to the client. Server middleware in app-use MUST be `defineServerMiddleware<'page'>`.
- **`api.ts`**: the plugin auto-loads `src/api.ts` when the file exists (no config change needed) and expects a DEFAULT export of a Hono instance, which is mounted so it can even shadow framework routes. `upgradeWebSocket(createEvents)` (from `hono-preact`) is the raw-WS middleware for api routes; its upgrader resolves lazily at request time, so a plain unit `app.request()` on the WS route without a running adapter is NOT testable (verify E2E instead).
- **Hono `Context` has private class fields**, so `ServerCtx` stubs cannot satisfy `ctx.c` structurally in tests. Precedent fix: extract the logic the observer/middleware runs into a pure exported helper and unit-test the helper (see `timeLoader` in `apps/site/src/pages/demo/board-insights.ts`).
- **Current demo state** (post-P1): Board.tsx deletes via `useAction(serverActions.deleteTask, { invalidate: [serverLoaders.default] })` and groups columns from `patch.value` (a `useOptimisticAction` over `tasks`), with a FLIP `useLayoutEffect` keyed on `[patch.value]`. `data.ts` has NO restore/undo API (`deleteTask` hard-deletes and cascades). The sidebar in projects-shell.tsx hand-rolls active links off `useRoute().pathParams.projectId`. `demo-layout.tsx` only calls `useViewTransitionTypes`. `app-config.ts` has `speculation` + `fonts` only. `src/api.ts` does not exist. The audit registry modules (`src/server/audit/log.server.ts`, `project-activity.server.ts`) are stubs returning empty arrays. task.tsx's single `useTitle` call is `` useTitle(`${task.title} · demo`) ``; projects.tsx uses `useTitle('Projects · demo')`; project-header.tsx has a `useTitle` too. The board filter chips and insights links build hrefs via `boardHref(slug, { priority, insights })` from `apps/site/src/demo/board-links.ts`.
- Board columns render via a local `Column` component mapped inside Board.tsx; `groupTasks` comes from `../../demo/group-tasks.js`.
- Abort-aware sleep exists as a LOCAL (non-exported) helper in `project-board.server.ts`; Task 3 hoists it to a shared module.

---

### Task 1: Toaster + delete-with-undo (Toast family, standalone `useOptimistic`, restore action)

**Files:**
- Modify: `apps/site/src/demo/data.ts` (trash stash + `restoreTask`)
- Modify: `apps/site/src/pages/demo/project-board.server.ts` (restore action)
- Modify: `apps/site/src/components/demo/Board.tsx` (optimistic delete + toasts)
- Modify: `apps/site/src/pages/demo/demo-layout.tsx` (mount `Toaster`)
- Modify: `apps/site/src/styles/root.css` (toast styling; find the demo/site section and match its conventions)
- Test: `apps/site/src/demo/__tests__/data.test.ts` (extend), `apps/site/src/pages/demo/__tests__/project-board.server.test.ts` (extend)

**Interfaces:**
- Consumes: existing `deleteTask`, `DeleteTaskSchema`, `serverActions.deleteTask`.
- Produces: `restoreTask(taskId: string): Task | null` (data.ts); `serverActions.restoreTask` (`ActionRef<{ taskId: string }, { id: string }>`); a globally mounted `Toaster` any later task may fire toasts at.

- [ ] **Step 1: Write the failing data tests**

Append to `apps/site/src/demo/__tests__/data.test.ts` (match the file's existing imports/beforeEach conventions; `resetDemoData` is already used there):

```ts
describe('deleteTask trash + restoreTask', () => {
  beforeEach(() => resetDemoData());

  it('restores a deleted task with its comments', () => {
    const before = getTask('t-1');
    expect(before).not.toBeNull();
    const commentCount = listComments('t-1').length;
    expect(commentCount).toBeGreaterThan(0);

    deleteTask('t-1');
    expect(getTask('t-1')).toBeNull();
    expect(listComments('t-1')).toHaveLength(0);

    const restored = restoreTask('t-1');
    expect(restored?.id).toBe('t-1');
    expect(getTask('t-1')?.title).toBe(before?.title);
    expect(listComments('t-1')).toHaveLength(commentCount);
  });

  it('returns null when there is nothing to restore', () => {
    expect(restoreTask('t-1')).toBeNull();
    expect(restoreTask('never-existed')).toBeNull();
  });

  it('a second restore of the same task is a no-op', () => {
    deleteTask('t-1');
    expect(restoreTask('t-1')).not.toBeNull();
    expect(restoreTask('t-1')).toBeNull();
  });
});
```

(Import `deleteTask`, `restoreTask`, `getTask`, `listComments` from `../data.js` as needed.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- run apps/site/src/demo/__tests__/data.test.ts` (recall: path args may run the full suite; read the summary and the failure list)
Expected: FAIL (`restoreTask` is not exported).

- [ ] **Step 3: Implement the trash stash**

In `apps/site/src/demo/data.ts`:

1. Extend the `Store` type with a trash map and seed it in `freshStore()`'s return:

```ts
type Store = {
  users: User[];
  projects: Project[];
  tasks: Task[];
  comments: Comment[];
  moves: {
    taskId: string;
    to: TaskStatus;
    at: number;
    userId: string | null;
  }[];
  // Deleted tasks parked for undo. Per-process, like the rest of the store:
  // on Workers a restore may land on a different isolate and legitimately
  // find nothing (the restore action denies 404 in that case).
  trash: Map<string, { task: Task; comments: Comment[] }>;
  nextId: number;
};
```

and add `trash: new Map(),` to the object `freshStore()` returns.

2. Rework `deleteTask` to stash before filtering:

```ts
export function deleteTask(taskId: string): void {
  const task = store.tasks.find((t) => t.id === taskId);
  if (!task) return;
  store.trash.set(taskId, {
    task,
    comments: store.comments.filter((c) => c.taskId === taskId),
  });
  store.tasks = store.tasks.filter((t) => t.id !== taskId);
  store.comments = store.comments.filter((c) => c.taskId !== taskId);
  store.moves = store.moves.filter((m) => m.taskId !== taskId);
}

export function restoreTask(taskId: string): Task | null {
  const entry = store.trash.get(taskId);
  if (!entry) return null;
  store.trash.delete(taskId);
  store.tasks.push(entry.task);
  store.comments.push(...entry.comments);
  return entry.task;
}
```

- [ ] **Step 4: Run data tests to verify pass**

Run: `pnpm test -- run apps/site/src/demo/__tests__/data.test.ts`
Expected: PASS (all three new tests; no regressions elsewhere in the run).

- [ ] **Step 5: Write the failing restore-action test**

Append to `apps/site/src/pages/demo/__tests__/project-board.server.test.ts` (reuse the file's existing Hono + `createCaller` harness style and its `mintSessionCookie`-equivalent if present; if the file has no cookie helper, copy the one from `task.server.test.ts`):

```ts
describe('restoreTask action', () => {
  beforeEach(() => resetDemoData());

  const runRestore = async (
    taskId: string,
    cookie: string | null
  ): Promise<CallResult<{ id: string }>> => {
    const app = new Hono();
    let result!: CallResult<{ id: string }>;
    app.post('/', async (c) => {
      result = await createCaller(c).call(serverActions.restoreTask, {
        taskId,
      });
      return c.text('ok');
    });
    await app.request('/', {
      method: 'POST',
      headers: cookie ? { Cookie: cookie } : {},
    });
    return result;
  };

  it('restores a just-deleted task for a signed-in user', async () => {
    const cookie = await mintSessionCookie({
      id: 'u-1',
      email: 'alice@example.com',
      name: 'Alice',
    });
    deleteTask('t-1');
    const r = await runRestore('t-1', cookie);
    expect(r.ok).toBe(true);
    expect(getTask('t-1')).not.toBeNull();
  });

  it('denies 404 when the trash has no entry', async () => {
    const cookie = await mintSessionCookie({
      id: 'u-1',
      email: 'alice@example.com',
      name: 'Alice',
    });
    const r = await runRestore('t-1', cookie);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) expect(r.outcome.status).toBe(404);
    }
  });

  it('denies 401 when signed out', async () => {
    deleteTask('t-1');
    const r = await runRestore('t-1', null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) expect(r.outcome.status).toBe(401);
    }
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm test -- run apps/site/src/pages/demo/__tests__/project-board.server.test.ts`
Expected: FAIL (`serverActions.restoreTask` does not exist).

- [ ] **Step 7: Add the restore action**

In `apps/site/src/pages/demo/project-board.server.ts`, import `restoreTask` from `'../../demo/data.js'` and append to `serverActions` (after `deleteTask`):

```ts
// Undo for deleteTask. The trash is per-process (like the whole demo store),
// so on Workers a restore may land on a fresh isolate and find nothing;
// denying 404 lets the client surface "undo expired" honestly. Reuses
// DeleteTaskSchema: the payload is the same single taskId.
restoreTask: defineAction(
  async (ctx, input) => {
    const user = await currentUser(ctx.c);
    if (!user) throw deny(401, 'Sign in to restore tasks.');
    const restored = restoreTask(input.taskId);
    if (!restored) {
      throw deny(404, 'Nothing to restore: the undo window expired.');
    }
    return { id: restored.id };
  },
  { input: DeleteTaskSchema }
),
```

- [ ] **Step 8: Run server tests to verify pass**

Run: `pnpm test -- run apps/site/src/pages/demo/__tests__/project-board.server.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 9: Mount the Toaster and style it**

`apps/site/src/pages/demo/demo-layout.tsx` becomes:

```tsx
import type { LayoutProps } from 'hono-preact';
import { useViewTransitionTypes } from 'hono-preact';
import { Toast, Toaster, type ToastRecord } from 'hono-preact-ui';

// One Toaster for the whole demo subtree: toast() reaches it through the
// ui package's module singleton, so mounting it once here is the wiring.
const renderDemoToast = (t: ToastRecord) => (
  <Toast.Root toast={t} class="demo-toast">
    <div class="min-w-0 flex-1">
      <Toast.Title class="text-sm font-semibold text-foreground" />
      <Toast.Description class="mt-0.5 text-xs text-muted" />
    </div>
    <Toast.Action class="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-foreground/5" />
    <Toast.Close
      aria-label="Dismiss notification"
      class="shrink-0 text-muted hover:text-foreground"
    >
      &times;
    </Toast.Close>
  </Toast.Root>
);

export default function DemoLayout({ children }: LayoutProps) {
  useViewTransitionTypes((nav) => {
    const types: string[] = [];
    if (nav.from && nav.from.startsWith(nav.to + '/')) types.push('nav-up');
    const fromProjects = nav.from?.startsWith('/demo/projects') ?? false;
    const toProjects = nav.to?.startsWith('/demo/projects') ?? false;
    if (fromProjects && toProjects) types.push('demo-within');
    return types;
  });
  return (
    <>
      {children}
      <Toaster position="bottom-right" label="Demo notifications">
        {renderDemoToast}
      </Toaster>
    </>
  );
}
```

In `apps/site/src/styles/root.css`, find the site's demo/component styling section (search for an existing demo selector to co-locate with; follow the file's commenting style) and add:

```css
.demo-toast {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  width: 20rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--background);
  box-shadow: var(--shadow-subtle, 0 4px 16px rgb(0 0 0 / 0.08));
}
```

(If `--border`/`--background`/`--shadow-subtle` are not this stylesheet's real token names, use the tokens the surrounding rules use; check `BRAND.md`'s token mapping. Do not invent new tokens.)

- [ ] **Step 10: Rework the Board delete flow**

In `apps/site/src/components/demo/Board.tsx`:

1. Extend imports: `useOptimistic` from `'hono-preact'`; `toast` from `'hono-preact-ui'`.
2. Replace the current `del` block and `doRemove` with:

```tsx
// Deletes ride a STANDALONE optimistic layer over the patch-adjusted list:
// the card disappears same-frame, settle keeps it gone once the server
// confirms, revert brings it back on failure. transition: true wraps
// settle/revert in a view transition where supported.
const [visibleTasks, removeOptimistically] = useOptimistic(
  patch.value,
  (current, taskId: string) => current.filter((t) => t.id !== taskId),
  { transition: true }
);
const del = useAction(serverActions.deleteTask, {
  invalidate: [serverLoaders.default],
});
const restore = useAction(serverActions.restoreTask, {
  invalidate: [serverLoaders.default],
});

const doRemove: RemoveFn = (taskId) => {
  const removed = patch.value.find((t) => t.id === taskId);
  const handle = removeOptimistically(taskId);
  void del.mutate({ taskId }).then((r) => {
    if (r.ok) {
      handle.settle();
      toast.success(`Deleted "${removed?.title ?? 'task'}"`, {
        description: 'The task and its comments are gone.',
        action: {
          label: 'Undo',
          onClick: () => {
            void restore.mutate({ taskId }).then((rr) => {
              if (!rr.ok) toast.error(rr.error.message);
            });
          },
        },
      });
    } else {
      handle.revert();
      toast.error(r.error.message);
    }
  });
};
```

3. Change `const columns = groupTasks(patch.value)` to `groupTasks(visibleTasks)`, and the FLIP `useLayoutEffect` dependency from `[patch.value]` to `[visibleTasks]` (read the effect first; only the dep array and any direct `patch.value` reads inside it change to `visibleTasks`).

- [ ] **Step 11: Full suite + typecheck + format**

Run: `pnpm test -- run && pnpm typecheck && pnpm format:check`
Expected: PASS. (There is no DOM test for Board; the flow is E2E-verified in Task 11.)

- [ ] **Step 12: Commit**

```bash
git add apps/site/src/demo/data.ts apps/site/src/demo/__tests__/data.test.ts apps/site/src/pages/demo/project-board.server.ts apps/site/src/pages/demo/__tests__/project-board.server.test.ts apps/site/src/components/demo/Board.tsx apps/site/src/pages/demo/demo-layout.tsx apps/site/src/styles/root.css
git commit -m "demo: delete-with-undo via toasts and a standalone optimistic layer

Deletes now park the task in a per-process trash, a restoreTask action puts
it back (404 when the undo window expired on another isolate), and the board
removes the card through standalone useOptimistic with settle/revert wrapped
in a view transition. Mounts the demo's single Toaster. Covers the Toast
family and useOptimistic items of issue #282 P2.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Insights recompute control (direct `loader.invalidate()`)

**Files:**
- Modify: `apps/site/src/components/demo/InsightsPanel.tsx`
- Test: `apps/site/src/components/demo/__tests__/InsightsPanel.test.tsx` (extend)

**Interfaces:**
- Consumes: `renderInsightsBody(state, staleError, slug, searchParams)` (current signature; this task extends it), `insightsLoader` (`serverLoaders.insights`), `useReload` from `'hono-preact'`.
- Produces: `renderInsightsBody(state, staleError, slug, searchParams, onRecompute: () => void, recomputing: boolean)`.

- [ ] **Step 1: Write the failing DOM test**

Read `apps/site/src/components/demo/__tests__/InsightsPanel.test.tsx` first and follow its harness. Append:

```tsx
it('renders a Recompute control that fires the callback', () => {
  const onRecompute = vi.fn();
  render(
    renderInsightsBody(successState, null, 'inf', {}, onRecompute, false)
  );
  const btn = screen.getByRole('button', { name: /recompute/i });
  fireEvent.click(btn);
  expect(onRecompute).toHaveBeenCalledTimes(1);
});

it('disables the Recompute control while reloading', () => {
  render(renderInsightsBody(successState, null, 'inf', {}, () => {}, true));
  const btn = screen.getByRole('button', { name: /recompute/i });
  expect(btn).toHaveProperty('disabled', true);
});
```

(`successState` is whatever success-arm fixture the existing tests build; reuse it. Existing `renderInsightsBody(...)` call sites in the test file gain the two new arguments: `() => {}, false`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- run apps/site/src/components/demo/__tests__/InsightsPanel.test.tsx`
Expected: FAIL (signature mismatch / no button).

- [ ] **Step 3: Implement**

In `apps/site/src/components/demo/InsightsPanel.tsx`:

1. Extend the pure render fn signature to `(state, staleError, slug, searchParams, onRecompute: () => void, recomputing: boolean)` and add, next to the quick/deep links in the success layout:

```tsx
<button
  class="font-medium underline hover:text-foreground disabled:opacity-60"
  onClick={onRecompute}
  disabled={recomputing}
>
  {recomputing ? 'Recomputing…' : 'Recompute'}
</button>
```

2. In the `InsightsBody` component, wire it (this is the direct-`invalidate()` coverage; the comment matters):

```tsx
const { reload, reloading } = useReload();
// Direct cache invalidation + reload: invalidate() alone only clears the
// cache entry; pairing it with useReload's reload() re-runs the active
// loader immediately instead of waiting for the next navigation.
const recompute = () => {
  insightsLoader.invalidate();
  reload();
};
```

and pass `recompute, reloading` through to `renderInsightsBody`. Import `useReload` from `'hono-preact'`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- run apps/site/src/components/demo/__tests__/InsightsPanel.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/demo/InsightsPanel.tsx apps/site/src/components/demo/__tests__/InsightsPanel.test.tsx
git commit -m "demo: insights Recompute control exercising direct loader.invalidate()

invalidate() busts the cache and useReload's reload() re-runs the active
loader in place. Covers the direct-invalidate item of issue #282 P2.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Workspace digest (streaming action + `onChunk`)

**Files:**
- Create: `apps/site/src/demo/sleep.ts` (hoisted shared abort-aware sleep)
- Create: `apps/site/src/demo/digest.ts` (pure line builder)
- Create: `apps/site/src/demo/__tests__/digest.test.ts`
- Modify: `apps/site/src/pages/demo/project-board.server.ts` (switch to shared sleep)
- Modify: `apps/site/src/pages/demo/projects-shell.server.ts` (add `serverActions.digest`)
- Modify: `apps/site/src/pages/demo/projects.tsx` (digest UI)
- Test: `apps/site/src/pages/demo/__tests__/projects-shell.server.test.ts` (extend)

**Interfaces:**
- Produces: `sleepMs(ms: number, signal: AbortSignal): Promise<void>`; `projectDigestLine(p: Project, tasks: Task[]): string`; `serverActions.digest` (streaming: chunks `string`, result `{ projects: number; tasks: number; by: string }`).

- [ ] **Step 1: Write the failing pure-helper test**

Create `apps/site/src/demo/__tests__/digest.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { projectDigestLine } from '../digest.js';
import {
  resetDemoData,
  listProjects,
  listTasksForProject,
} from '../data.js';

describe('projectDigestLine', () => {
  beforeEach(() => resetDemoData());

  it('summarizes open counts and flags the most urgent open task', () => {
    const inf = listProjects().find((p) => p.slug === 'inf')!;
    const line = projectDigestLine(inf, listTasksForProject(inf.id));
    expect(line).toContain('Infrastructure');
    expect(line).toContain('4 open of 5');
    expect(line).toContain('Worker times out under load');
  });

  it('reports an all-done project without an urgent pick', () => {
    const legacy = listProjects().find((p) => p.slug === 'legacy')!;
    const line = projectDigestLine(legacy, listTasksForProject(legacy.id));
    expect(line).toContain('0 open of 2');
    expect(line).not.toContain('next:');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- run apps/site/src/demo/__tests__/digest.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the helpers**

Create `apps/site/src/demo/sleep.ts` by MOVING the existing abort-aware `sleep` out of `project-board.server.ts` verbatim (keep its comment), renamed and exported:

```ts
// Abort-aware sleep shared by the demo's deliberately-slow server paths, so
// a loader/action timeout abort actually stops the wait.
export const sleepMs = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
```

Update `project-board.server.ts` to `import { sleepMs } from '../../demo/sleep.js';`, delete its local `sleep`, and change its call site to `sleepMs(5_000, signal)`.

Create `apps/site/src/demo/digest.ts`:

```ts
import { PRIORITIES, type Project, type Task } from './data.js';

// One digest line per project: open-vs-total counts plus the highest-priority
// open task as the suggested next pick. Pure so the streaming action stays a
// thin generator around it.
export function projectDigestLine(project: Project, tasks: Task[]): string {
  const open = tasks.filter((t) => t.status !== 'done');
  const head = `${project.name}: ${open.length} open of ${tasks.length}`;
  if (open.length === 0) return head;
  const next = [...open].sort(
    (a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)
  )[0];
  return `${head} (next: ${next.title})`;
}
```

- [ ] **Step 4: Run helper tests to verify pass**

Run: `pnpm test -- run apps/site/src/demo/__tests__/digest.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing streaming-action test**

Append to `apps/site/src/pages/demo/__tests__/projects-shell.server.test.ts` (reuse its harness; add a session-cookie helper if it lacks one, copied from `task.server.test.ts`):

```ts
describe('digest streaming action', () => {
  beforeEach(() => resetDemoData());

  it('streams one line per project then returns totals', async () => {
    const cookie = await mintSessionCookie({
      id: 'u-1',
      email: 'alice@example.com',
      name: 'Alice',
    });
    const app = new Hono();
    let chunks: string[] = [];
    let final!: { projects: number; tasks: number; by: string };
    app.post('/', async (c) => {
      const r = await createCaller(c).call(serverActions.digest, {});
      expect(r.ok).toBe(true);
      if (r.ok) {
        const gen = r.value;
        for (;;) {
          const n = await gen.next();
          if (n.done) {
            final = n.value;
            break;
          }
          chunks.push(n.value);
        }
      }
      return c.text('ok');
    });
    await app.request('/', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toContain('Infrastructure');
    expect(final.projects).toBe(4);
    expect(final.tasks).toBe(14);
    expect(final.by).toBe('Alice');
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm test -- run apps/site/src/pages/demo/__tests__/projects-shell.server.test.ts`
Expected: FAIL (`serverActions` not exported from projects-shell.server).

- [ ] **Step 7: Implement the streaming action**

In `apps/site/src/pages/demo/projects-shell.server.ts`, add imports (`listProjects`, `listTasksForProject` are already imported; add `projectDigestLine` from `'../../demo/digest.js'`, `sleepMs` from `'../../demo/sleep.js'`) and append:

```ts
export const serverActions = {
  // Streaming action: an async generator whose yields arrive on the client
  // through useAction's onChunk, with the return value as the final result.
  // Route-bound to the projects subtree, so it inherits requireSession.
  digest: route.action(async function* (ctx, _payload: Record<string, never>) {
    const user = await currentUser(ctx.c);
    const projects = listProjects();
    let tasks = 0;
    for (const p of projects) {
      const t = listTasksForProject(p.id);
      tasks += t.length;
      yield projectDigestLine(p, t);
      // Visible streaming: without a beat between lines the whole digest
      // arrives as one paint.
      await sleepMs(150, ctx.signal);
    }
    return { projects: projects.length, tasks, by: user?.name ?? 'someone' };
  }),
};
```

- [ ] **Step 8: Run server tests to verify pass**

Run: `pnpm test -- run apps/site/src/pages/demo/__tests__/projects-shell.server.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Digest UI on the projects index**

Replace `apps/site/src/pages/demo/projects.tsx` with:

```tsx
import { definePage, useAction, useTitle } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { serverActions } from './projects-shell.server.js';

const ProjectsIndex: FunctionComponent = () => {
  useTitle('Projects · demo');
  const [lines, setLines] = useState<string[]>([]);
  // onChunk fires per generator yield; mutate resolves with the return value.
  const digest = useAction(serverActions.digest, {
    onChunk: (line) => setLines((prev) => [...prev, line]),
  });

  return (
    <div class="grid h-full place-items-center p-6">
      <div class="w-full max-w-md space-y-4 text-center">
        <div>
          <h1 class="text-lg font-semibold text-foreground">
            Select a project
          </h1>
          <p class="mt-1 text-sm text-muted">
            Pick a project from the sidebar to open its board.
          </p>
        </div>
        <div class="rounded-xl border border-border bg-background p-4 text-left">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold text-foreground">
              Workspace digest
            </h2>
            <button
              class="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-60"
              disabled={digest.pending}
              onClick={() => {
                setLines([]);
                void digest.mutate({});
              }}
            >
              {digest.pending ? 'Generating…' : 'Generate'}
            </button>
          </div>
          {lines.length > 0 && (
            <ul class="mt-3 space-y-1 text-xs text-foreground">
              {lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          {digest.data && (
            <p class="mt-3 border-t border-border pt-2 text-xs text-muted">
              {digest.data.projects} projects, {digest.data.tasks} tasks, run
              by {digest.data.by}. Streamed line by line over a generator
              action.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
ProjectsIndex.displayName = 'ProjectsIndex';

export default definePage(ProjectsIndex);
```

(Preserve the existing wrapper markup where it differs; the existing centered layout classes win over the ones above if they conflict. Note: `useTitle('Projects · demo')` stays for now; Task 5 strips the suffix.)

- [ ] **Step 10: Full suite + typecheck + format, then commit**

Run: `pnpm test -- run && pnpm typecheck && pnpm format:check`
Expected: PASS.

```bash
git add apps/site/src/demo/sleep.ts apps/site/src/demo/digest.ts apps/site/src/demo/__tests__/digest.test.ts apps/site/src/pages/demo/project-board.server.ts apps/site/src/pages/demo/projects-shell.server.ts apps/site/src/pages/demo/projects.tsx apps/site/src/pages/demo/__tests__/projects-shell.server.test.ts
git commit -m "demo: streaming workspace digest action with per-chunk UI

An async-generator action yields one line per project (with an abort-aware
beat between lines) and returns totals; the projects index renders chunks
as they arrive via useAction onChunk. Hoists the shared abort-aware sleep.
Covers the streaming-action item of issue #282 P2.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: NavLink sidebar, transition-free chips, VT name/class/group

**Files:**
- Modify: `apps/site/src/pages/demo/projects-shell.tsx` (NavLink sidebar + `useRouteMatch` + active-dot VT name)
- Modify: `apps/site/src/pages/demo/project-board.tsx` (chips become `NavLink transition={false}`)
- Modify: `apps/site/src/components/demo/InsightsPanel.tsx` (mode links become `NavLink transition={false}`)
- Modify: `apps/site/src/components/demo/Board.tsx` (columns wrapped in `ViewTransitionGroup`)
- Modify: `apps/site/src/styles/root.css` (two VT rules)
- Test: `apps/site/src/components/demo/__tests__/InsightsPanel.test.tsx` (hrefs unchanged; adjust only if the anchor tag assertions break on NavLink markup)

**Interfaces:**
- Consumes: `NavLink`, `useRouteMatch`, `useViewTransitionName`, `ViewTransitionGroup` from `'hono-preact'`; existing `boardHref`.
- Produces: no new exports; sidebar behavior identical, minus the hand-rolled `aria-current`.

- [ ] **Step 1: Sidebar swap**

In `apps/site/src/pages/demo/projects-shell.tsx`:

1. Change the `hono-preact` import to include `NavLink`, `useRouteMatch`, `useViewTransitionName` (drop `useRoute` if nothing else uses it after this edit).
2. Replace the tolerant `useRoute().pathParams` read with:

```tsx
// Typed match instead of the tolerant pathParams read: null off the
// projects subtree, the typed { projectId } inside it (exact: false keeps
// the sidebar lit on nested task pages).
const match = useRouteMatch('/demo/projects/:projectId', { exact: false });
const activeSlug = match?.projectId ?? null;
```

3. Replace the sidebar `<a>` map with:

```tsx
{data.projects.map((p) => {
  const active = p.slug === activeSlug;
  return (
    <NavLink
      key={p.id}
      href={buildPath('/demo/projects/:projectId', {
        projectId: p.slug,
      })}
      exact={false}
      class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium"
      activeClass="bg-accent/10 text-accent"
      inactiveClass="text-foreground hover:bg-foreground/5"
    >
      <SidebarDot active={active} />
      {p.name}
      <span class="ml-auto text-[11px] text-muted">{p.taskCount}</span>
    </NavLink>
  );
})}
```

4. Add the dot component (top level of the file):

```tsx
// Only the ACTIVE dot carries the view-transition-name (names must be
// unique per document), so on navigation the browser morphs the dot from
// the old active item to the new one: the classic gliding-indicator VT.
const SidebarDot: FunctionComponent<{ active: boolean }> = ({ active }) => {
  const ref = useViewTransitionName(active ? 'demo-sidebar-active' : null);
  return <span ref={ref} class="h-2 w-2 rounded-[3px] bg-accent" />;
};
```

(Import `FunctionComponent` from preact if not present.)

- [ ] **Step 2: Chips and mode links skip the view transition**

In `apps/site/src/pages/demo/project-board.tsx`: import `NavLink`; the priority chips change from `<a ...>` to `NavLink`, keeping `boardHref` and the manual active styling (NavLink's own active detection is path-based and cannot see the query string, so the explicit `aria-current` and classes stay):

```tsx
<NavLink
  key={p}
  href={boardHref(project.slug, { priority: p, insights: searchParams.insights })}
  transition={false}
  aria-current={priority === p ? 'page' : undefined}
  class={[
    'rounded-full px-2 py-0.5 font-medium',
    priority === p
      ? 'bg-accent text-accent-foreground'
      : 'text-muted hover:text-foreground',
  ].join(' ')}
>
  {p === 'all' ? 'All' : PRIORITY_LABEL[p]}
</NavLink>
```

(A filter change re-renders the same view; a document view transition on it reads as a flash, which is exactly what `transition={false}` / `skipNextNavTransition` exists for. Keep the surrounding `nav` and count markup as-is.)

In `apps/site/src/components/demo/InsightsPanel.tsx`: the quick/deep links inside `renderInsightsBody` become `NavLink transition={false}` with their existing `boardHref` hrefs and classes (plain class only, no active classes). The `errorFallback`'s plain anchor stays a plain anchor (it navigates back from an error state; the transition is fine there).

- [ ] **Step 3: Column groups**

In `apps/site/src/components/demo/Board.tsx`, import `ViewTransitionGroup` from `'hono-preact'` and wrap each rendered `<Column>` at the map site:

```tsx
<ViewTransitionGroup class="board-column" key={col.status}>
  <Column ... />
</ViewTransitionGroup>
```

(Use the map's existing key variable; move the `key` from `Column` onto the wrapper.)

In `apps/site/src/styles/root.css`, in the same section as the existing view-transition rules (search `view-transition` to find it; match its comment style), add:

```css
::view-transition-group(*.board-column) {
  animation-duration: 160ms;
}
::view-transition-group(demo-sidebar-active) {
  animation-duration: 220ms;
}
```

- [ ] **Step 4: Full suite + typecheck + format**

Run: `pnpm test -- run && pnpm typecheck && pnpm format:check`
Expected: PASS. If InsightsPanel DOM tests assert on raw `<a>` markup and NavLink broke them, update the assertions to keep asserting the SAME hrefs (the contract is the composed query string, not the tag).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/demo/projects-shell.tsx apps/site/src/pages/demo/project-board.tsx apps/site/src/components/demo/InsightsPanel.tsx apps/site/src/components/demo/Board.tsx apps/site/src/styles/root.css apps/site/src/components/demo/__tests__/InsightsPanel.test.tsx
git commit -m "demo: NavLink sidebar with a gliding active dot, transition-free filter navs

The sidebar swaps hand-rolled aria-current for NavLink + useRouteMatch and
morphs the active dot via useViewTransitionName; filter chips and insights
mode links skip the document transition via transition={false}; board
columns get a ViewTransitionGroup class. Covers the NavLink and VT-tail
items of issue #282 P2.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Head APIs + `useHonoContext` (title template, og meta, canonical)

**Files:**
- Modify: `apps/site/src/pages/demo/demo-layout.tsx`
- Modify: `apps/site/src/pages/demo/task.tsx`, `apps/site/src/pages/demo/projects.tsx`, `apps/site/src/pages/demo/project-header.tsx` (strip manual `· demo` suffixes)
- Test: `apps/site/src/pages/demo/__tests__/demo-layout.test.tsx` (new)

**Interfaces:**
- Consumes: `useTitleTemplate`, `useMeta`, `useLink`, `useLocation` from `'hono-preact'`; `useHonoContext` from `'hono-preact/server'`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/pages/demo/__tests__/demo-layout.test.tsx` (follow the render harness used by `apps/site/src/components/demo/__tests__/` tests):

```tsx
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { useTitle } from 'hono-preact';
import DemoLayout from '../demo-layout.js';

function Page() {
  useTitle('Some Page');
  return <p>content</p>;
}

describe('demo layout head wiring', () => {
  it('applies the %s title template to child titles', async () => {
    render(
      <DemoLayout>
        <Page />
      </DemoLayout>
    );
    await waitFor(() =>
      expect(document.title).toBe('Some Page · hono-preact demo')
    );
  });
});
```

(If hoofd needs a tick beyond `waitFor`, keep the `waitFor` and extend its timeout rather than asserting synchronously. If `useLocation` throws outside a Router in this harness, wrap the render in the same Router/location provider the other page tests use, or move the `useLink` canonical call into a `try`-free guard: see Step 3's note.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- run apps/site/src/pages/demo/__tests__/demo-layout.test.tsx`
Expected: FAIL (title is `Some Page`, no template applied).

- [ ] **Step 3: Implement the head wiring**

In `apps/site/src/pages/demo/demo-layout.tsx`, inside `DemoLayout` before the return (keep Task 1's Toaster):

```tsx
useTitleTemplate('%s · hono-preact demo');
useMeta({ property: 'og:site_name', content: 'hono-preact demo' });
useMeta({
  name: 'description',
  content: 'Interactive feature demo for the hono-preact framework.',
});
// Request-scoped head value: useHonoContext returns the live Hono Context
// during SSR and null on the client, so the meta content is request-derived
// on the server document and falls back after hydration (head-only, so the
// mismatch is harmless).
const c = useHonoContext();
useMeta({
  name: 'demo-request-id',
  content: c?.req.header('cf-ray') ?? 'local',
});
const { path } = useLocation();
useLink({ rel: 'canonical', href: `https://framework.sbesh.com${path}` });
```

Imports: `useTitleTemplate, useMeta, useLink, useLocation` join the `'hono-preact'` import; `useHonoContext` from `'hono-preact/server'`.

Then strip the manual suffixes (the template now appends them):
- task.tsx: `` useTitle(`${task.title} · demo`) `` becomes `` useTitle(task.title) ``.
- projects.tsx: `useTitle('Projects · demo')` becomes `useTitle('Projects')`.
- project-header.tsx: read its `useTitle` call and strip its `· demo` suffix the same way (keep whatever base string it uses).

- [ ] **Step 4: Run to verify pass, then check the client bundle did not swallow the server barrel**

Run: `pnpm test -- run apps/site/src/pages/demo/__tests__/demo-layout.test.tsx && pnpm typecheck`
Expected: PASS.

Then the bundle check (the `hono-preact/server` barrel also exports `renderPage`; tree-shaking must drop it from the client):

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm --filter site build
grep -rl "renderToStringAsync\|renderPage" apps/site/dist/client/static/ | head -3
```

Expected: the site build succeeds and the grep finds NOTHING in client chunks. If it finds matches (the barrel did not tree-shake), REVERT the `useHonoContext` part only (keep template/meta/link), record the finding for the issue comment, and note it in your report; do not fight the bundler in this task.

- [ ] **Step 5: Full suite + format, commit**

Run: `pnpm test -- run && pnpm format:check`

```bash
git add apps/site/src/pages/demo/demo-layout.tsx apps/site/src/pages/demo/task.tsx apps/site/src/pages/demo/projects.tsx apps/site/src/pages/demo/project-header.tsx apps/site/src/pages/demo/__tests__/demo-layout.test.tsx
git commit -m "demo: title template, og/description meta, canonical link, request-scoped meta

useTitleTemplate('%s · hono-preact demo') replaces per-page suffixes; the
layout adds og:site_name/description meta and a canonical link, plus a
request-derived meta via useHonoContext (SSR-only value, head-safe
fallback on the client). Covers the head-API items of issue #282 P2.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Audit stream observer (`AppConfig.use` + `defineStreamObserver`) with a visible feed

**Files:**
- Create: `apps/site/src/demo/audit-log.ts`
- Create: `apps/site/src/demo/stream-audit.ts`
- Create: `apps/site/src/demo/__tests__/audit-log.test.ts`
- Modify: `apps/site/src/server/audit/log.server.ts` (real `recent` loader)
- Modify: `apps/site/src/app-config.ts` (`use: [streamAudit]`)
- Modify: `apps/site/src/pages/demo/index.tsx` (recent-activity panel)

**Interfaces:**
- Produces: `recordAudit(line: string): void`, `recentAudit(limit?: number): string[]`, `resetAudit(): void` (audit-log); `streamAudit` (a `StreamObserver`), `streamAuditLine(phase: 'start' | 'end' | 'error' | 'abort', unit: string, chunks?: number): string` (pure, tested); audit `serverLoaders.recent` now returns real entries.

- [ ] **Step 1: Write the failing tests**

Create `apps/site/src/demo/__tests__/audit-log.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { recordAudit, recentAudit, resetAudit } from '../audit-log.js';
import { streamAuditLine } from '../stream-audit.js';

describe('audit log', () => {
  beforeEach(() => resetAudit());

  it('returns newest entries first', () => {
    recordAudit('first');
    recordAudit('second');
    const lines = recentAudit();
    expect(lines[0]).toContain('second');
    expect(lines[1]).toContain('first');
  });

  it('caps the buffer at 50 entries', () => {
    for (let i = 0; i < 60; i++) recordAudit(`entry ${i}`);
    const lines = recentAudit(100);
    expect(lines).toHaveLength(50);
    expect(lines[0]).toContain('entry 59');
    expect(lines.at(-1)).toContain('entry 10');
  });

  it('formats stream lifecycle lines', () => {
    expect(streamAuditLine('start', 'shell.activity')).toBe(
      'stream start shell.activity'
    );
    expect(streamAuditLine('end', 'shell.activity', 7)).toBe(
      'stream end shell.activity (7 chunks)'
    );
    expect(streamAuditLine('abort', 'tasks.comments', 2)).toBe(
      'stream abort tasks.comments (2 chunks)'
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- run apps/site/src/demo/__tests__/audit-log.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

Create `apps/site/src/demo/audit-log.ts`:

```ts
// In-memory audit ring for the demo: per-process like the rest of the demo
// store, capped so a long-lived dev server cannot grow it unbounded. Written
// by the app-level stream observer; read by the audit registry loader.
type AuditEntry = { at: number; line: string };

const MAX_ENTRIES = 50;
const entries: AuditEntry[] = [];

export function recordAudit(line: string): void {
  entries.push({ at: Date.now(), line });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export function recentAudit(limit = 20): string[] {
  return entries
    .slice(-limit)
    .reverse()
    .map((e) => `${new Date(e.at).toISOString().slice(11, 19)} ${e.line}`);
}

export function resetAudit(): void {
  entries.length = 0;
}
```

Create `apps/site/src/demo/stream-audit.ts`:

```ts
import { defineStreamObserver, type ServerStreamCtx } from 'hono-preact';
import { recordAudit } from './audit-log.js';

// Pure formatter, exported for the unit test (a real ServerStreamCtx cannot
// be stubbed structurally: Hono's Context has private fields).
export function streamAuditLine(
  phase: 'start' | 'end' | 'error' | 'abort',
  unit: string,
  chunks?: number
): string {
  const suffix = chunks === undefined ? '' : ` (${chunks} chunks)`;
  return `stream ${phase} ${unit}${suffix}`;
}

function unitName(ctx: ServerStreamCtx): string {
  return ctx.scope === 'loader'
    ? `${ctx.module}.${ctx.loader}`
    : `${ctx.module}.${ctx.action}`;
}

// App-level stream observer (AppConfig.use): sees every streaming loader
// and action in the app. The Vite guard-strip plugin replaces this call
// with a bare descriptor in the client bundle, so none of this ships to
// the browser.
export const streamAudit = defineStreamObserver<unknown, never>({
  onStart: (ctx) => recordAudit(streamAuditLine('start', unitName(ctx))),
  onEnd: (ctx, info) =>
    recordAudit(streamAuditLine('end', unitName(ctx), info.chunks)),
  onError: (ctx, _err, info) =>
    recordAudit(streamAuditLine('error', unitName(ctx), info.chunks)),
  onAbort: (ctx, info) =>
    recordAudit(streamAuditLine('abort', unitName(ctx), info.chunks)),
});
```

Update `apps/site/src/server/audit/log.server.ts`: the `recent` loader body becomes real (imports `recentAudit` from `'../../demo/audit-log.js'`; keep the module's header comment and the `record` action as-is):

```ts
export const serverLoaders = {
  // Latest audit entries, callable from any page via its client stub.
  recent: defineLoader(
    async (): Promise<{ entries: string[] }> => ({ entries: recentAudit() })
  ),
};
```

Update `apps/site/src/app-config.ts`:

```ts
import { defineApp } from 'hono-preact';
import { streamAudit } from './demo/stream-audit.js';
```

and the export gains `use: [streamAudit],` alongside `speculation`/`fonts`. (The observer is the only app-use element; it is not a guard, so the realtime room-binding congruence checks stay satisfied: the cursors route has no params.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- run apps/site/src/demo/__tests__/audit-log.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Surface the feed on the demo index**

In `apps/site/src/pages/demo/index.tsx`: import the registry loader and add a panel. Add at top:

```tsx
import { serverLoaders as auditLoaders } from '../../server/audit/log.server.js';

// Route-less registry loader consumed from a page: the client stub reaches
// it by module key over the loaders RPC. Entries come from the app-level
// stream observer, so visiting the projects board populates this feed.
const RecentServerActivity = auditLoaders.recent.View(({ status, data }) => (
  <section class="rounded-xl border border-border bg-background p-4 text-left">
    <h2 class="text-sm font-semibold text-foreground">
      Recent server streams
    </h2>
    {status === 'loading' || !data ? (
      <p class="mt-2 text-xs text-muted">Loading…</p>
    ) : data.entries.length === 0 ? (
      <p class="mt-2 text-xs text-muted">
        Nothing yet. Open the projects board, then come back.
      </p>
    ) : (
      <ul class="mt-2 space-y-1 font-mono text-[11px] text-muted">
        {data.entries.slice(0, 8).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    )}
  </section>
));
```

and render `<RecentServerActivity />` inside `DemoIndex`'s card layout (after the existing links block; read the file and place it where the layout allows a full-width section).

- [ ] **Step 6: Full suite + typecheck + format, commit**

Run: `pnpm test -- run && pnpm typecheck && pnpm format:check`

```bash
git add apps/site/src/demo/audit-log.ts apps/site/src/demo/stream-audit.ts apps/site/src/demo/__tests__/audit-log.test.ts apps/site/src/server/audit/log.server.ts apps/site/src/app-config.ts apps/site/src/pages/demo/index.tsx
git commit -m "demo: app-level stream observer feeding a visible audit ring

AppConfig.use gains a defineStreamObserver that records every streaming
loader/action lifecycle into an in-memory ring; the audit registry's recent
loader serves it and the demo index renders the feed (registry loader
consumed from a page). Covers the AppConfig.use item of issue #282 P2.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: NewTaskDialog field-error a11y (`useFieldErrors` + `useFieldErrorProps`)

**Files:**
- Modify: `apps/site/src/components/demo/NewTaskDialog.tsx`
- Test: `apps/site/src/components/demo/__tests__/NewTaskDialog.test.tsx` (new)

**Interfaces:**
- Consumes: `useFieldErrors`, `useFieldErrorProps`, existing `Form`/`FieldError`/`NewTaskSchema`.

- [ ] **Step 1: Write the failing DOM test**

Create `apps/site/src/components/demo/__tests__/NewTaskDialog.test.tsx` (follow the harness of the sibling component tests; `NewTaskDialog` needs `projectId` and `users` props):

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import NewTaskDialog from '../NewTaskDialog.js';

describe('NewTaskDialog field errors', () => {
  it('associates the title error and shows the summary on invalid submit', async () => {
    render(<NewTaskDialog projectId="p-1" users={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /new task/i }));
    const form = document.querySelector('form')!;
    fireEvent.submit(form);
    await waitFor(() => {
      const input = screen.getByLabelText(/title/i);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const description = input.getAttribute('aria-describedby');
      expect(description).toBeTruthy();
      expect(document.getElementById(description!)?.textContent).toMatch(
        /title is required/i
      );
      expect(screen.getByRole('status').textContent).toMatch(/1 field/i);
    });
  });
});
```

(If the title input has no `<label>`, target it with `screen.getByPlaceholderText` or a `name="title"` query instead of `getByLabelText`; keep the aria assertions identical. If the dialog trigger's accessible name differs, read the component and use its real label.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- run apps/site/src/components/demo/__tests__/NewTaskDialog.test.tsx`
Expected: FAIL (no aria-invalid, no status element).

- [ ] **Step 3: Implement**

In `apps/site/src/components/demo/NewTaskDialog.tsx`: `useFieldErrors`/`useFieldErrorProps` read the `<Form>` context, so they need components rendered INSIDE the Form. Add two small components at the top level of the file:

```tsx
// Inside-the-Form components: useFieldErrors/useFieldErrorProps read the
// enclosing Form's context, so they cannot be called from NewTaskDialog
// itself (it renders the Form; it is not inside it).
const TitleField: FunctionComponent = () => {
  const aria = useFieldErrorProps('title');
  return (
    <>
      <input
        name="title"
        required
        placeholder="Task title"
        {...aria}
        class="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <FieldError name="title" class="mt-0.5 block text-[11px] text-red-500" />
    </>
  );
};

const FieldErrorSummary: FunctionComponent = () => {
  const errors = useFieldErrors();
  const count = Object.values(errors).filter((m) => m.length > 0).length;
  if (count === 0) return null;
  return (
    <p role="status" class="text-xs text-danger">
      {count} {count === 1 ? 'field needs' : 'fields need'} attention
    </p>
  );
};
```

Then, inside the `<Form>`: replace the existing raw title `<input name="title" ...>` and its adjacent `<FieldError name="title" .../>` with `<TitleField />` (PRESERVE the existing input's exact classes and any label markup around it; the snippet above is a fallback if the current classes are inline on the input). Add `<FieldErrorSummary />` just above the submit-button row. Extend the `hono-preact` import with `useFieldErrors, useFieldErrorProps` and import `FunctionComponent` from preact if missing.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- run apps/site/src/components/demo/__tests__/NewTaskDialog.test.tsx && pnpm typecheck && pnpm format:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/demo/NewTaskDialog.tsx apps/site/src/components/demo/__tests__/NewTaskDialog.test.tsx
git commit -m "demo: wire useFieldErrorProps and a useFieldErrors summary into the task dialog

The title input now carries aria-invalid/aria-describedby from
useFieldErrorProps and an in-form summary counts invalid fields via
useFieldErrors. Covers the field-error hooks item of issue #282 P2.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: `api.ts` with a JSON endpoint and a raw WebSocket route

**Files:**
- Create: `apps/site/src/api.ts`
- Create: `apps/site/src/__tests__/api.test.ts`

**Interfaces:**
- Produces: default-exported Hono app with `GET /api/demo/health` (JSON) and `GET /api/demo/echo` (raw WS upgrade).

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/__tests__/api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../api.js';
import { resetDemoData } from '../demo/data.js';

describe('demo api', () => {
  beforeEach(() => resetDemoData());

  it('serves workspace health as JSON', async () => {
    const res = await app.request('/api/demo/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.projects).toBe(4);
    expect(body.tasks).toBe(14);
  });

  it('404s outside its namespace', async () => {
    const res = await app.request('/api/demo/nope');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- run apps/site/src/__tests__/api.test.ts`
Expected: FAIL (no `src/api.ts`).

- [ ] **Step 3: Implement**

Create `apps/site/src/api.ts`:

```ts
// Hand-authored Hono routes mounted by the framework (the plugin auto-loads
// src/api.ts when present; the default export must be the Hono app).
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono-preact';
import { listAllTasks, listProjects } from './demo/data.js';

const app = new Hono();

app.get('/api/demo/health', (c) =>
  c.json({
    ok: true,
    projects: listProjects().length,
    tasks: listAllTasks().length,
  })
);

// Raw WebSocket on the framework's single connection: the upgrader resolves
// lazily at request time, so this route only functions under a running
// adapter (dev server / deploy), not in unit tests.
app.get(
  '/api/demo/echo',
  upgradeWebSocket(() => ({
    onMessage(ev, ws) {
      ws.send(`echo:${String(ev.data).toUpperCase()}`);
    },
  }))
);

export default app;
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- run apps/site/src/__tests__/api.test.ts && pnpm typecheck && pnpm format:check`
Expected: PASS. (The WS route is E2E-verified in Task 11 with a browser WebSocket; the plugin's shadow-route detection may log at dev boot; note anything it prints in your report.)

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/api.ts apps/site/src/__tests__/api.test.ts
git commit -m "demo: hand-authored api.ts with a health endpoint and a raw echo WebSocket

Exercises the vite api option (auto-mounted src/api.ts) and
upgradeWebSocket. Covers the api.ts item of issue #282 P2.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Board info Popover

**Files:**
- Create: `apps/site/src/components/demo/BoardInfoPopover.tsx`
- Modify: `apps/site/src/pages/demo/project-board.tsx` (mount in the header)
- Test: `apps/site/src/components/demo/__tests__/BoardInfoPopover.test.tsx` (new)

- [ ] **Step 1: Write the failing DOM test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { BoardInfoPopover } from '../BoardInfoPopover.js';

describe('BoardInfoPopover', () => {
  it('opens a dialog with the explainer and closes on Escape', async () => {
    render(<BoardInfoPopover />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /about this board/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/what this board exercises/i);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
```

(If the ui package's dismiss listens on a different target than `document`, check how `packages/ui/src/__tests__` fire Escape for Popover/Dialog and mirror that exact event target.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- run apps/site/src/components/demo/__tests__/BoardInfoPopover.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `apps/site/src/components/demo/BoardInfoPopover.tsx`:

```tsx
import { Popover } from 'hono-preact-ui';
import type { FunctionComponent } from 'preact';

export const BoardInfoPopover: FunctionComponent = () => (
  <Popover.Root side="bottom" align="end">
    <Popover.Trigger
      aria-label="About this board"
      class="grid h-7 w-7 place-items-center rounded-full border border-border text-xs font-bold text-muted hover:text-foreground"
    >
      ?
    </Popover.Trigger>
    <Popover.Positioner class="z-50">
      <Popover.Popup class="w-72 rounded-xl border border-border bg-background p-4 shadow-subtle">
        <Popover.Title class="text-sm font-semibold text-foreground">
          What this board exercises
        </Popover.Title>
        <Popover.Description class="mt-1 text-xs leading-relaxed text-muted">
          Server-filtered search params, optimistic drag and delete with undo,
          a deliberately slow loader behind a timeout, and a route-bound
          draft-preview socket on every task page.
        </Popover.Description>
        <Popover.Close class="mt-3 text-xs font-medium underline">
          Got it
        </Popover.Close>
      </Popover.Popup>
    </Popover.Positioner>
  </Popover.Root>
);
```

(If `shadow-subtle` is not a real utility in this codebase, use the shadow class the board's cards use; check TaskCard.tsx.) Mount it in `apps/site/src/pages/demo/project-board.tsx` inside the header row, before the `ml-auto` NewTaskDialog wrapper: `<BoardInfoPopover />` with its import.

- [ ] **Step 4: Run to verify pass, commit**

Run: `pnpm test -- run apps/site/src/components/demo/__tests__/BoardInfoPopover.test.tsx && pnpm typecheck && pnpm format:check`

```bash
git add apps/site/src/components/demo/BoardInfoPopover.tsx apps/site/src/components/demo/__tests__/BoardInfoPopover.test.tsx apps/site/src/pages/demo/project-board.tsx
git commit -m "demo: board info popover

Full Popover part set (Root/Trigger/Positioner/Popup/Title/Description/
Close) explaining what the board exercises. Covers the Popover item of
issue #282 P2.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Drift-guard coverage test

**Files:**
- Create: `apps/site/src/__tests__/framework-coverage.test.ts`

- [ ] **Step 1: Write the test (it will fail until the allowlist is complete; completing the allowlist IS the implementation)**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hp from 'hono-preact';

// Drift guard for issue #282: every RUNTIME export of the framework's main
// entry must either be imported somewhere in the demo surface or carry an
// explicit allowlist reason. Type-only exports are invisible to Object.keys
// and are out of scope by design. A stale allowlist entry (the symbol got
// covered) fails too, so the list cannot rot in either direction.

const here = dirname(fileURLToPath(import.meta.url));
const SCAN_ROOTS = [
  '../demo',
  '../pages/demo',
  '../components/demo',
  '../server',
].map((p) => join(here, p));
const EXTRA_FILES = ['../routes.ts', '../app-config.ts', '../api.ts'].map(
  (p) => join(here, p)
);

const ALLOWLIST: Record<string, string> = {
  // Seed entries; the implementer completes this empirically (see Step 2).
  // Every entry needs a one-line reason tied to WHY the demo cannot or need
  // not exercise it.
  bootClient: 'custom client entries only; the demo uses the generated entry',
  ClientScript: 'document plumbing emitted by the framework layout',
  Head: 'document plumbing used by the site root Layout.tsx, not demo code',
  Router: 'low-level preact-iso re-export; demo uses the route tree',
  Route: 'low-level preact-iso re-export',
  Routes: 'consumed by the generated entries, not app code',
  lazy: 'low-level preact-iso re-export',
  defineSocket:
    'route-independent socket variant; the demo covers serverRoute(r).socket',
  useSocket:
    'free-function form; the demo uses the ref-method serverSockets.x.useSocket',
  useRoom:
    'free-function form; the demo uses the ref-method serverRooms.x.useRoom',
  skipNextNavTransition:
    'exercised through NavLink transition={false} in the board chips',
  prefetch: 'imperative form; the demo covers usePrefetch',
  createCaller: 'exercised by the demo server tests, not shipped demo code',
  isBrowser: 'internal-leaning helper with no natural demo surface',
};

function collectFiles(root: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      out = out.concat(collectFiles(full));
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function importedNames(source: string): string[] {
  const names: string[] = [];
  // Value imports only: `import type {...}` exercises nothing at runtime.
  const re = /import\s+\{([^}]+)\}\s+from\s+'hono-preact'/g;
  for (const m of source.matchAll(re)) {
    for (const raw of m[1].split(',')) {
      const item = raw.trim();
      if (!item || item.startsWith('type ')) continue;
      names.push(item.split(/\s+as\s+/)[0].trim());
    }
  }
  return names;
}

describe('demo framework coverage (issue #282 drift guard)', () => {
  const used = new Set<string>();
  for (const root of SCAN_ROOTS) {
    for (const file of collectFiles(root)) {
      for (const n of importedNames(readFileSync(file, 'utf8'))) used.add(n);
    }
  }
  for (const file of EXTRA_FILES) {
    for (const n of importedNames(readFileSync(file, 'utf8'))) used.add(n);
  }

  it('leaves no runtime export uncovered and unexplained', () => {
    const uncovered = Object.keys(hp)
      .filter((k) => !used.has(k))
      .filter((k) => !(k in ALLOWLIST))
      .sort();
    expect(uncovered).toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    const stale = Object.keys(ALLOWLIST).filter((k) => used.has(k));
    expect(stale).toEqual([]);
  });

  it('allowlists only real exports', () => {
    const ghosts = Object.keys(ALLOWLIST).filter((k) => !(k in hp));
    expect(ghosts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, then complete the allowlist empirically**

Run: `pnpm test -- run apps/site/src/__tests__/framework-coverage.test.ts`
Expected: the first test FAILS with a list of uncovered names. For each name in that list decide: is it genuinely un-exercisable/covered-elsewhere (add an ALLOWLIST entry with a real one-line reason) or is it something a P2 task was supposed to cover (then something is wrong; check the task landed). Do NOT blanket-add names without reasons. Re-run until all three tests pass. Report the final allowlist in your report so the reviewer can challenge individual reasons.

- [ ] **Step 3: Full suite + format, commit**

Run: `pnpm test -- run && pnpm format:check`

```bash
git add apps/site/src/__tests__/framework-coverage.test.ts
git commit -m "demo: drift guard diffing framework exports against demo imports

Every runtime export of the hono-preact main entry must be imported by the
demo surface or carry an explicit allowlist reason; stale and ghost
allowlist entries fail too. Closes the drift-guard item of issue #282.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end verification, CI parity, PR

**Files:** none (verification; fix-forward in this worktree).

- [ ] **Step 1: Live verification** (dev server from `apps/site`, note the port it prints; sign in via `/demo/login`; the P1 session-cookie mint script pattern is in git history if curl needs it)

1. Board: delete a card via the task-actions menu; the card vanishes instantly, a toast appears; Undo brings it back (card + comments). A failed restore (restart the dev server between delete and undo) shows the error toast.
2. Insights strip: Recompute re-runs the loader in place (network shows a fresh loaders RPC).
3. Projects index: Generate streams digest lines one by one, then the totals line renders.
4. Sidebar: links carry framework `aria-current`; the active dot has inline `view-transition-name: demo-sidebar-active` (inspect the DOM style attribute; do NOT try to verify the animation visually over MCP, it backgrounds the tab and view transitions skip).
5. Filter chips: clicking chips does not fire a document view transition (no flash), and chips still compose `?insights=`.
6. `document.title` on a task page reads `<task title> · hono-preact demo`; `curl` the SSR HTML and confirm the `og:site_name`, `description`, `demo-request-id`, and canonical tags.
7. Demo index: after visiting the board, the Recent-server-streams panel lists `stream start/end` lines.
8. New-task dialog: submitting an empty title shows the summary line and `aria-invalid` on the title input.
9. `curl http://localhost:<port>/api/demo/health` returns the JSON; in the browser console `const ws = new WebSocket('ws://localhost:<port>/api/demo/echo'); ws.onmessage = (e) => console.log(e.data); ws.onopen = () => ws.send('hi');` logs `echo:HI`.
10. Board info popover opens, closes on Escape, focus returns to the trigger.
11. Watch the dev-server boot log for `.server` export-whitelist errors and api.ts shadow-route warnings: there must be none.

- [ ] **Step 2: CI parity, in CI order** (all eight steps, from the worktree root; every step must pass before push)

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

- [ ] **Step 3: Push, PR, issue bookkeeping**

Push the branch, open the PR against main titled `demo: cover the remaining framework surface end to end (#282 P2)` closing out the P2 checkboxes, run the repo's deep PR review as the mandated first follow-up, tick the #282 P2 + drift-guard checkboxes, and log any new framework findings on the issue.

---

## Self-review notes

- Spec coverage: streaming action + onChunk (T3), standalone useOptimistic (T1), useFieldErrors/useFieldErrorProps (T7), direct invalidate() (T2), NavLink/useRouteMatch sidebar (T4), skipNextNavTransition via NavLink transition={false} + ViewTransitionGroup + useViewTransitionName (T4; useViewTransitionClass is exercised inside ViewTransitionGroup, and directly if the reviewer prefers: the group component IS the class hook's component form), useTitleTemplate/useMeta/useLink (T5), useHonoContext (T5, with bundle check + fallback), AppConfig.use + defineStreamObserver (T6), api.ts + upgradeWebSocket (T8), Toast (T1) + Popover (T9), drift guard (T10).
- Known judgment calls, written into the tasks: chips keep manual active styling (NavLink's active detection is path-only); the ui Toaster is demo-layout-scoped (docs pages have their own Toaster in docs demos; two Toasters never co-mount because layouts are route-scoped: verify in T11 that /docs toast demos still work if both appear in one session's DOM tree at once; they cannot, different layouts).
- Type consistency: `restoreTask` name is used identically in data.ts and the action; `sleepMs` replaces the local `sleep`; `renderInsightsBody` gains exactly two parameters used by both component and tests.
