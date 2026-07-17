# Demo Coverage P1 (#282) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three P1 gaps in issue #282 so the site demo smoke-tests duplex sockets (including the #274 route binder), the framework error path, and the uncovered loader options.

**Architecture:** All changes live in the docs-site demo app (`apps/site/src`). Server features land in the existing colocated `*.server.ts` modules via the `serverRoute` binder; error surfaces ride the loaders' `View`/`Boundary`/`errorFallback` plumbing; the `render()` gate is a route-node `use` middleware. No framework (`packages/`) changes.

**Tech Stack:** hono-preact (workspace), valibot, vitest, Preact + Tailwind v4 (site conventions).

## Global Constraints

- Worktree: all paths below are relative to `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/demo-coverage-p1-282/`. Always use that absolute prefix in Read/Edit/Write (a main-checkout path would silently edit the wrong tree). Serena tools must NOT be used (they resolve against the main checkout).
- No em-dashes in prose, code comments, or commit messages (user style rule). Use commas, colons, parentheses, or two sentences.
- No inline `as` casts. Reshape types instead (repo CLAUDE.md "Type casts" section). The demo currently has zero casts; keep it that way.
- TDD: write the failing test, see it fail, implement, see it pass.
- Run tests from the worktree root: `pnpm --filter site test -- run <file>` runs one site test file; `pnpm test` runs everything.
- `pnpm typecheck` must pass after any change to shared types or `*.server.ts` signatures (test files alone do not cover them).
- Match surrounding comment density and tone; comments explain constraints, not narrate edits.
- Commit after each task (commits in this isolated worktree branch are part of the approved plan flow).

## Facts established during planning (do not re-derive)

- `serverRoute(r)` returns a `RouteBinder` with `.loader(fn, opts)`, `.action(fn, opts)`, `.socket(handler)`, `.room(channel, handler)` (`packages/iso/src/server-route.ts:80`).
- `route.socket<Incoming, Outgoing, Data>(handler)`: the handler's `data?: (c, params) => Data` factory receives the route params validated at upgrade; the client hook is `ref.useSocket({ params, ... })` and the `params` option is REQUIRED for a param-bearing binding. `lastMessage: true` opts into reactive last-message state.
- `serverRoute(r).room(channel, handler)` keeps the same client call (`ref.useRoom({ key, presence })`); binding only stamps `__routeId` for boot validation and page-use inheritance. Route `/demo/cursors` has no `:params`, so the room/channel param-congruence check is trivially satisfied.
- Loader opts (`DefineLoaderOptions`, `packages/iso/src/define-loader.ts:262`): `live`, `cache` (a `LoaderCache<T>` from `createCache<T>()`), `timeoutMs: number | false`, `use` (per-loader middleware), `params` (the CACHE-KEY search-param dependency list, `'*'` or `string[]`), `searchSchema` (400 on fail), `paramsSchema` (404 on fail, non-live loaders only).
- Cache location key = `path?` + only the search params named in `params`, sorted (`packages/iso/src/internal/cache-key.ts`). A search-driven loader MUST list its search key in `params` or every filter value shares one cache slot.
- Client error decode (`packages/iso/src/internal/loader-fetch.ts:111`): timeout outcome becomes a `TimeoutError` instance; a deny with validation issues becomes `LoaderValidationError`; any other deny becomes `new Error(message)`.
- A COLD loader error (failed before any value) routes to the `errorFallback` of `View`/`Boundary` with `(err, reset)`; a STALE error (after data) surfaces in-view via the `error` state arm and `ref.useError()` (`packages/iso/src/internal/loader.tsx`).
- `definePage(Component, { errorFallback })` installs a page-level error boundary (`packages/iso/src/define-page.tsx`).
- `render(Component)` lives on `hono-preact/page` and is a PAGE-scope-only outcome. A route-node `use` server middleware runs for page renders AND loader/action RPCs; it must branch on `ctx.scope` and never return `render` from loader/action scope. `ServerPageCtx`/`ServerLoaderCtx` carry `location: RouteHook` (typed `pathParams`); `ServerActionCtx` has no location.
- Middleware fns may RETURN an outcome (`Promise<void | Outcome>`) instead of throwing (`packages/iso/src/define-middleware.ts`).
- **`createCaller` APPLIES `paramsSchema`/`searchSchema`** (`packages/iso/src/server-caller.ts:170`). Existing tests that call `serverLoaders.task` with only `{ pathParams: { taskId } }` will fail once a `paramsSchema` requiring `projectId` lands; Task 3 updates them.
- Existing server-test harness pattern: mint a signed session cookie via a first Hono round-trip, replay it as a `Cookie` header, and run `createCaller(c).call(...)` inside `app.request('/')` (see `apps/site/src/pages/demo/__tests__/task.server.test.ts`).
- Demo data: project slugs `inf`/`api`/`web` (`^[a-z][a-z0-9-]*$` shaped), task ids `t-<n>`, users Alice (`u-1`) and Bob (`u-2`). `resetDemoData()` reseeds.

---

### Task 1: Bind the cursors room to its route (`serverRoute(r).room`)

**Files:**
- Modify: `apps/site/src/pages/demo/cursors-demo.server.ts`

**Interfaces:**
- Consumes: `serverRoute` from `hono-preact`; existing `cursorsChannel`.
- Produces: `serverRooms.cursors` unchanged for the client (`cursors-demo.tsx` keeps calling `serverRooms.cursors.useRoom({ key, presence })`).

This is the #274 binder path with zero coverage today. No unit test exists for this module and the binding's observable behavior is boot-time validation, so verification is typecheck plus the dev-boot check in Task 8 (a bad pattern here throws at boot, fail-closed).

- [ ] **Step 1: Rebind the room through the route binder**

Replace the full contents of `apps/site/src/pages/demo/cursors-demo.server.ts` with:

```ts
import { defineChannel, serverRoute } from 'hono-preact';

type CursorMsg = { x: number; y: number };

// Channel name embeds the room key param so each named room gets its own
// Durable Object instance. On the docs site this fans out cursors across
// Worker isolates via the HONO_PREACT_REALTIME DO binding.
const cursorsChannel = defineChannel('cursors/:room')<CursorMsg>();

// Bind the room to its route. The binding stamps the route pattern on the
// room def, so boot validates it fail-closed against the module mount and
// the upgrade guard resolves this route's page-use chain (empty here: the
// cursors page is public) rather than deriving it from the module mount.
// The route has no :params, so the room/channel param-congruence check is
// trivially satisfied (the channel may be finer-grained than the route).
const route = serverRoute('/demo/cursors');

export const serverRooms = {
  cursors: route.room(cursorsChannel, {
    // Seed every joining member's presence with a default cursor position.
    presence: () => ({ x: 0, y: 0 }),
    // Relay cursor positions to all other members. Presence frames are handled
    // by the framework; only application messages arrive here.
    onMessage(conn, msg) {
      conn.broadcast(msg);
    },
  }),
};
```

- [ ] **Step 2: Typecheck and run the site suite**

Run: `pnpm typecheck && pnpm --filter site test -- run`
Expected: PASS (no behavior change for existing tests; the client call in `cursors-demo.tsx` is untouched).

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/pages/demo/cursors-demo.server.ts
git commit -m "demo: bind the cursors room to /demo/cursors via serverRoute(r).room

Covers the #274 room binder in the running demo (issue #282 P1).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Draft-preview duplex socket on the task page

**Files:**
- Create: `apps/site/src/demo/draft-preview.ts`
- Create: `apps/site/src/demo/__tests__/draft-preview.test.ts`
- Modify: `apps/site/src/demo/data.ts` (add `listUsers`)
- Modify: `apps/site/src/pages/demo/task.server.ts` (add `serverSockets`)
- Modify: `apps/site/src/pages/demo/task.tsx` (wire the socket into the comment form)
- Test: `apps/site/src/pages/demo/__tests__/task.server.test.ts` (new describe block)

**Interfaces:**
- Consumes: `route` binder already in `task.server.ts` (`serverRoute('/demo/projects/:projectId/tasks/:taskId')`); `listUsers(): User[]` (new, from `data.ts`).
- Produces: `previewOf(draft: string): DraftPreview` where `DraftPreview = { chars: number; words: number; mentions: string[] }` (from `demo/draft-preview.ts`); `serverSockets.draftPreview` (a `SocketRef` whose client call is `serverSockets.draftPreview.useSocket({ params: { projectId, taskId }, lastMessage: true })`, Incoming `{ draft: string }`, Outgoing `DraftPreview`).

- [ ] **Step 1: Write the failing test for the pure preview helper**

Create `apps/site/src/demo/__tests__/draft-preview.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { previewOf } from '../draft-preview.js';
import { resetDemoData, upsertUser } from '../data.js';

describe('previewOf', () => {
  beforeEach(() => resetDemoData());

  it('counts characters and words', () => {
    const p = previewOf('two words');
    expect(p.chars).toBe(9);
    expect(p.words).toBe(2);
    expect(p.mentions).toEqual([]);
  });

  it('treats whitespace-only drafts as zero words', () => {
    expect(previewOf('   ').words).toBe(0);
    expect(previewOf('').chars).toBe(0);
  });

  it('resolves @mentions against demo users, case-insensitively', () => {
    const p = previewOf('ping @alice and @ALICE about this');
    expect(p.mentions).toEqual(['Alice']);
  });

  it('ignores mentions that match no demo user', () => {
    expect(previewOf('@nobody hello').mentions).toEqual([]);
  });

  it('sees users created after seed time', () => {
    upsertUser('carol@example.com', 'Carol');
    expect(previewOf('cc @carol').mentions).toEqual(['Carol']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter site test -- run src/demo/__tests__/draft-preview.test.ts`
Expected: FAIL (`previewOf` and `listUsers` do not exist yet).

- [ ] **Step 3: Implement `listUsers` and `previewOf`**

In `apps/site/src/demo/data.ts`, next to the other read helpers (after the `getUser` line):

```ts
export const listUsers = (): User[] => store.users.slice();
```

Create `apps/site/src/demo/draft-preview.ts`:

```ts
// Server-side live preview of a comment draft, computed per message on the
// task page's draft-preview socket. Pure so it is unit-testable without a
// socket; the socket handler in task.server.ts just calls it and sends the
// result back on the same connection.
import { listUsers } from './data.js';

export type DraftPreview = {
  chars: number;
  words: number;
  /** Canonical names of demo users the draft @mentions, deduped. */
  mentions: string[];
};

const MENTION = /@([\p{L}][\p{L}\d-]*)/gu;

export function previewOf(draft: string): DraftPreview {
  const trimmed = draft.trim();
  const byName = new Map(
    listUsers().map((u) => [u.name.toLowerCase(), u.name] as const)
  );
  const mentions: string[] = [];
  for (const m of draft.matchAll(MENTION)) {
    const canonical = byName.get(m[1].toLowerCase());
    if (canonical && !mentions.includes(canonical)) mentions.push(canonical);
  }
  return {
    chars: draft.length,
    words: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
    mentions,
  };
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `pnpm --filter site test -- run src/demo/__tests__/draft-preview.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing socket-handler test**

Append to `apps/site/src/pages/demo/__tests__/task.server.test.ts` (add `serverSockets` to the existing import from `../task.server.js`, and `vi` to the vitest import):

```ts
// The draft-preview socket is a route-bound duplex socket: the handler only
// touches its own connection, so it is testable by driving the def's
// lifecycle methods directly with a stub ServerSocket.
describe('draftPreview socket', () => {
  beforeEach(() => resetDemoData());

  type Sent = { chars: number; words: number; mentions: string[] };
  const makeSocket = () => {
    const sent: Sent[] = [];
    return {
      sent,
      socket: {
        send: (msg: Sent) => {
          sent.push(msg);
        },
        close: () => {},
        data: undefined,
        raw: null,
      },
    };
  };

  it('sends a zero preview on open', async () => {
    const { socket, sent } = makeSocket();
    await serverSockets.draftPreview.open?.(socket);
    expect(sent).toEqual([{ chars: 0, words: 0, mentions: [] }]);
  });

  it('answers each draft message with its preview', async () => {
    const { socket, sent } = makeSocket();
    await serverSockets.draftPreview.message?.(socket, {
      draft: 'ask @bob to review',
    });
    expect(sent).toEqual([{ chars: 18, words: 4, mentions: ['Bob'] }]);
  });
});
```

Note: `serverSockets.draftPreview` is typed as the client `SocketRef` on import, but at runtime (server/test) the def carries the handler methods. If TypeScript rejects `.open?.`/`.message?.` on the ref type, type the stub against the HANDLER by exporting it separately (see Step 7's `draftPreviewHandler` export) and drive `draftPreviewHandler.open`/`.message` instead. Do NOT cast.

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter site test -- run src/pages/demo/__tests__/task.server.test.ts`
Expected: FAIL (`serverSockets` is not exported).

- [ ] **Step 7: Add the socket to `task.server.ts`**

In `apps/site/src/pages/demo/task.server.ts`, import the helper (top of file, with the other demo imports):

```ts
import { previewOf, type DraftPreview } from '../../demo/draft-preview.js';
```

Append after `serverActions`:

```ts
type DraftMsg = { draft: string };

// The handler is its own named binding so the unit test can drive
// open/message directly with a stub socket (the SocketRef type the client
// sees hides the handler methods).
export const draftPreviewHandler = {
  // Per-connection setup: seed the preview line immediately so the client
  // renders stats before the first keystroke.
  open(socket: { send(msg: DraftPreview): void }) {
    socket.send(previewOf(''));
  },
  // Pure request/response per message: hibernation-safe on Cloudflare (no
  // in-memory state between events).
  message(socket: { send(msg: DraftPreview): void }, msg: DraftMsg) {
    socket.send(previewOf(msg.draft));
  },
};

export const serverSockets = {
  // Route-bound duplex socket (issue #282 P1): binding selects this route's
  // page-use chain (the requireSession gate inherited from /demo/projects)
  // for the upgrade guard, and requires the client to supply the route
  // params, validated at the upgrade (a missing slot denies 4403).
  draftPreview: route.socket<DraftMsg, DraftPreview>(draftPreviewHandler),
};
```

If `route.socket`'s handler contextual typing rejects the standalone-object spelling, inline the two methods in the `route.socket({ ... })` call and keep `previewOf` as the tested unit instead; adjust the Step 5 test to drive `previewOf` plus one inline smoke of `message`. Prefer the standalone handler if it typechecks cleanly.

- [ ] **Step 8: Run the socket test to verify it passes**

Run: `pnpm --filter site test -- run src/pages/demo/__tests__/task.server.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 9: Wire the socket into the comment form UI**

In `apps/site/src/pages/demo/task.tsx`:

1. Add `serverSockets` to the import from `./task.server.js`, and add `useParams` (already imported) usage inside `CommentsSection`.
2. Replace the `CommentsSection` component's form section so the textarea reports drafts and a status line renders the live preview. The component becomes:

```tsx
const CommentsSection: FunctionComponent<{
  comments: CommentData[];
  taskId: string;
}> = ({ comments, taskId }) => {
  // (existing addComment useOptimisticAction block stays exactly as-is)

  const { pending } = useFormStatus(serverActions.addComment);

  // Live draft preview over the route-bound duplex socket. The params are
  // required by the binding and validated at the upgrade; the upgrade also
  // runs the requireSession gate this route inherits, so signed-out users
  // simply never connect (status stays 'connecting').
  const { projectId, taskId: taskIdParam } = useParams(
    '/demo/projects/:projectId/tasks/:taskId'
  );
  const preview = serverSockets.draftPreview.useSocket({
    params: { projectId, taskId: taskIdParam },
    lastMessage: true,
  });

  return (
    <section class={`${PANEL} space-y-4`}>
      <h3 class="text-base font-semibold text-foreground">
        Comments
        <span class="ml-2 text-sm font-normal text-muted">
          {addComment.value.length}
        </span>
      </h3>
      <CommentList comments={addComment.value} />
      <Form
        action={addComment}
        reset
        invalidate={[commentsLoader]}
        class="space-y-2.5 border-t border-border pt-4"
      >
        <input type="hidden" name="taskId" value={taskId} />
        <textarea
          name="body"
          rows={3}
          required
          placeholder="Add a comment"
          onInput={(e) => {
            if (preview.status === 'open') {
              preview.send({ draft: e.currentTarget.value });
            }
          }}
          class="block w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <div class="flex items-center justify-between gap-3">
          <p class="flex items-center gap-1.5 text-xs text-muted">
            <span
              class={[
                'inline-block h-1.5 w-1.5 rounded-full',
                preview.status === 'open' ? 'bg-green-500' : 'bg-amber-400',
              ].join(' ')}
              aria-hidden
            />
            {preview.status === 'open' && preview.lastMessage ? (
              <>
                {preview.lastMessage.chars} chars &middot;{' '}
                {preview.lastMessage.words} words
                {preview.lastMessage.mentions.length > 0 && (
                  <>
                    {' '}
                    &middot; mentions{' '}
                    <strong class="font-medium text-foreground">
                      {preview.lastMessage.mentions.join(', ')}
                    </strong>
                  </>
                )}
              </>
            ) : (
              'Live preview connecting…'
            )}
          </p>
          <button
            type="submit"
            class="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-60"
            disabled={pending}
          >
            {pending ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </Form>
    </section>
  );
};
```

(The textarea stays uncontrolled so `Form`'s `reset` keeps clearing it.)

- [ ] **Step 10: Verify site tests and typecheck**

Run: `pnpm --filter site test -- run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/site/src/demo/draft-preview.ts apps/site/src/demo/__tests__/draft-preview.test.ts apps/site/src/demo/data.ts apps/site/src/pages/demo/task.server.ts apps/site/src/pages/demo/task.tsx apps/site/src/pages/demo/__tests__/task.server.test.ts
git commit -m "demo: live comment-draft preview over a route-bound duplex socket

serverRoute(r).socket + useSocket({ params, lastMessage }) had zero runtime
coverage (issue #282 P1). The socket inherits the requireSession gate from
/demo/projects and validates the route params at the upgrade.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Framework 404 path (`paramsSchema` + loader `deny(404)` + `errorFallback`)

**Files:**
- Modify: `apps/site/src/pages/demo/task-schema.ts` (add route-param schemas)
- Modify: `apps/site/src/pages/demo/task.server.ts` (task/activity loaders)
- Modify: `apps/site/src/pages/demo/project-board.server.ts` (default loader)
- Modify: `apps/site/src/pages/demo/task.tsx` (drop inline not-found, add `errorFallback`)
- Modify: `apps/site/src/pages/demo/project-board.tsx` (same, plus `definePage` `errorFallback`)
- Test: `apps/site/src/pages/demo/__tests__/task.server.test.ts` (update + extend)
- Create: `apps/site/src/pages/demo/__tests__/project-board.server.test.ts`

**Interfaces:**
- Consumes: `deny` from `hono-preact`; valibot.
- Produces: `TaskRouteParamsSchema`, `ProjectRouteParamsSchema` (from `task-schema.ts`); `serverLoaders.task` now returns `Promise<TaskDetail>` (no `null`); `BoardData` loses `| null`.

- [ ] **Step 1: Write the failing tests**

In `apps/site/src/pages/demo/__tests__/task.server.test.ts`, the task-loader describe changes: `loadTask` must send BOTH params and return the full `CallResult` so deny outcomes are assertable. Replace the `loadTask` helper and the unknown-id test with:

```ts
const callTask = async (pathParams: {
  projectId: string;
  taskId: string;
}): Promise<CallResult<TaskDetail>> => {
  const app = new Hono();
  let result!: CallResult<TaskDetail>;
  app.get('/', async (c) => {
    result = await createCaller(c).call(serverLoaders.task, {
      location: { pathParams },
    });
    return c.text('ok');
  });
  await app.request('/');
  return result;
};

const loadTask = async (taskId: string): Promise<TaskDetail> => {
  const result = await callTask({ projectId: 'inf', taskId });
  if (!result.ok) throw new Error('expected the task loader to succeed');
  return result.value;
};
```

Adjust the two assignee tests to use the non-null return (drop the `?.` chains where trivial). Then replace the `returns null for an unknown task id` test with:

```ts
it('denies 404 for a well-formed unknown task id', async () => {
  const r = await callTask({ projectId: 'inf', taskId: 't-999999' });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(isDeny(r.outcome)).toBe(true);
    if (isDeny(r.outcome)) expect(r.outcome.status).toBe(404);
  }
});

it('rejects a malformed task id via paramsSchema (framework 404)', async () => {
  const r = await callTask({ projectId: 'inf', taskId: 'DROP TABLE' });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(isDeny(r.outcome)).toBe(true);
    if (isDeny(r.outcome)) expect(r.outcome.status).toBe(404);
  }
});
```

Create `apps/site/src/pages/demo/__tests__/project-board.server.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createCaller, isDeny, type CallResult } from 'hono-preact';
import { serverLoaders, type BoardData } from '../project-board.server.js';
import { resetDemoData } from '../../../demo/data.js';

const callBoard = async (
  projectId: string
): Promise<CallResult<BoardData>> => {
  const app = new Hono();
  let result!: CallResult<BoardData>;
  app.get('/', async (c) => {
    result = await createCaller(c).call(serverLoaders.default, {
      location: { pathParams: { projectId } },
    });
    return c.text('ok');
  });
  await app.request('/');
  return result;
};

describe('project board loader', () => {
  beforeEach(() => resetDemoData());

  it('loads a known project with its tasks and users', async () => {
    const r = await callBoard('inf');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.project.slug).toBe('inf');
      expect(r.value.tasks.length).toBeGreaterThan(0);
    }
  });

  it('denies 404 for a well-formed unknown slug', async () => {
    const r = await callBoard('nope');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) expect(r.outcome.status).toBe(404);
    }
  });

  it('rejects a malformed slug via paramsSchema (framework 404)', async () => {
    const r = await callBoard('NOT A SLUG');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) expect(r.outcome.status).toBe(404);
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter site test -- run src/pages/demo/__tests__/task.server.test.ts src/pages/demo/__tests__/project-board.server.test.ts`
Expected: FAIL (loaders still return `null`, no schemas, `BoardData` nullable).

- [ ] **Step 3: Add the param schemas**

Append to `apps/site/src/pages/demo/task-schema.ts`:

```ts
// Route-param shapes. paramsSchema failures respond 404 through the
// framework (LoaderValidationError on the client), so a malformed URL never
// reaches the loader body; a WELL-FORMED unknown id still runs the loader,
// which denies 404 itself.
const projectSlug = v.pipe(
  v.string(),
  v.regex(/^[a-z][a-z0-9-]*$/, 'Not a project slug')
);
const taskIdShape = v.pipe(v.string(), v.regex(/^t-\d+$/, 'Not a task id'));

export const ProjectRouteParamsSchema = v.object({ projectId: projectSlug });
export const TaskRouteParamsSchema = v.object({
  projectId: projectSlug,
  taskId: taskIdShape,
});
```

- [ ] **Step 4: Convert the loaders**

`apps/site/src/pages/demo/task.server.ts`: add `deny` to the `hono-preact` import and `TaskRouteParamsSchema` to the schema import. The `task` loader becomes (note: no `null` in the return type, and the second argument is new):

```ts
task: route.loader(
  async ({ location }): Promise<TaskDetail> => {
    const task = getTask(location.pathParams.taskId);
    if (!task) throw deny(404, 'Task not found.');
    return {
      ...withAuthor(task),
      assignee: task.assigneeId ? getUser(task.assigneeId) : null,
    };
  },
  { paramsSchema: TaskRouteParamsSchema }
),
```

The `activity` loader keeps returning `[]` for a missing task (the aside must not 404 the page) but gains the same schema:

```ts
activity: route.loader(
  async ({ location }): Promise<ActivityItem[]> => {
    const task = getTask(location.pathParams.taskId);
    if (!task) return [];
    return activityForProject(task.projectId, 10);
  },
  { paramsSchema: TaskRouteParamsSchema }
),
```

Leave the streaming `comments` loader without a schema (paramsSchema is documented for non-live loaders; the task loader already gates the page).

`apps/site/src/pages/demo/project-board.server.ts`: add `ProjectRouteParamsSchema` to the schema import; `BoardData` drops `| null`:

```ts
export type BoardData = {
  project: Project;
  users: User[];
  tasks: Task[];
};
```

and the loader becomes:

```ts
default: route.loader(
  async ({ location }): Promise<BoardData> => {
    const slug = location.pathParams.projectId;
    const project = getProjectBySlug(slug);
    if (!project) throw deny(404, `No project named '${slug}'.`);
    return {
      project,
      users: [getUser('u-1'), getUser('u-2')].filter(
        (u): u is User => u !== null
      ),
      tasks: listTasksForProject(project.id),
    };
  },
  { paramsSchema: ProjectRouteParamsSchema }
),
```

- [ ] **Step 5: Run the server tests to verify they pass**

Run: `pnpm --filter site test -- run src/pages/demo/__tests__/task.server.test.ts src/pages/demo/__tests__/project-board.server.test.ts`
Expected: PASS.

- [ ] **Step 6: Surface the errors in the views**

`apps/site/src/pages/demo/task.tsx`: `TaskView` drops the `if (!data)` arm (data is non-null once loaded) and gains an `errorFallback`:

```tsx
const TaskView = taskLoader.View(
  ({ status, data }) => {
    const { reload: reloadTask } = useReload();
    if (status === 'loading' || !data) return <p class="p-6">Loading task…</p>;
    const task = data;
    return (
      <div class="mx-auto w-full max-w-5xl px-6 py-6">
        <div class="grid gap-6 lg:grid-cols-[1fr_280px]">
          <main class="space-y-6">
            <TaskHeaderAndActions task={task} reloadTask={reloadTask} />
            <CommentsView taskId={task.id} />
          </main>
          <ActivityView />
        </div>
      </div>
    );
  },
  {
    // A cold loader failure (the deny(404) for an unknown task, or the
    // paramsSchema 404 for a malformed URL) routes here instead of the
    // success arms; reset re-enters the loader.
    errorFallback: (err, reset) => (
      <div class="mx-auto w-full max-w-xl px-6 py-16 text-center space-y-3">
        <h2 class="text-lg font-semibold text-foreground">
          Couldn&apos;t load this task
        </h2>
        <p class="text-sm text-muted">{err.message}</p>
        <div class="flex justify-center gap-3 text-sm">
          <button class="font-medium underline" onClick={reset}>
            Try again
          </button>
          <a href="/demo/projects" class="font-medium underline">
            Back to projects
          </a>
        </div>
      </div>
    ),
  }
);
```

`apps/site/src/pages/demo/project-board.tsx`: `ProjectBoardPage` drops the `if (!data)` branch (keep the `status === 'loading'` skeleton, then `if (!data) return <BoardSkeleton />;` as the residual loading-arm narrowing); `ProjectBoardView` gains the matching `errorFallback`:

```tsx
const ProjectBoardView = boardLoader.View(
  ({ status }) => (status === 'loading' ? <BoardSkeleton /> : <ProjectBoardPage />),
  {
    errorFallback: (err, reset) => (
      <div class="mx-auto w-full max-w-xl px-6 py-16 text-center space-y-3">
        <h2 class="text-lg font-semibold text-foreground">
          Couldn&apos;t load this board
        </h2>
        <p class="text-sm text-muted">{err.message}</p>
        <div class="flex justify-center gap-3 text-sm">
          <button class="font-medium underline" onClick={reset}>
            Try again
          </button>
          <a href="/demo/projects" class="font-medium underline">
            Back to projects
          </a>
        </div>
      </div>
    ),
  }
);
```

and the export gains the page-level boundary (a render-time throw anywhere in the page tree, distinct from loader errors):

```tsx
export default definePage(ProjectBoardView, {
  errorFallback: (error, reset) => (
    <div class="mx-auto w-full max-w-xl px-6 py-16 text-center space-y-3">
      <h2 class="text-lg font-semibold text-foreground">
        Something broke rendering this page
      </h2>
      <p class="text-sm text-muted">{error.message}</p>
      <button class="text-sm font-medium underline" onClick={reset}>
        Reset the page
      </button>
    </div>
  ),
});
```

- [ ] **Step 7: Full site suite + typecheck**

Run: `pnpm --filter site test -- run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/site/src/pages/demo/task-schema.ts apps/site/src/pages/demo/task.server.ts apps/site/src/pages/demo/project-board.server.ts apps/site/src/pages/demo/task.tsx apps/site/src/pages/demo/project-board.tsx apps/site/src/pages/demo/__tests__/task.server.test.ts apps/site/src/pages/demo/__tests__/project-board.server.test.ts
git commit -m "demo: 404 through the framework error path instead of inline null branches

paramsSchema rejects malformed ids (framework 404 / LoaderValidationError);
well-formed unknown ids deny(404) from the loader; both surface through
View errorFallback, and the board page adds a definePage errorFallback.
Covers issue #282 P1 error-path items.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Board priority filter (`searchSchema` + cache `params`)

**Files:**
- Modify: `apps/site/src/pages/demo/task-schema.ts` (add `BoardSearchSchema`)
- Modify: `apps/site/src/pages/demo/project-board.server.ts` (filter + schema + cache key)
- Modify: `apps/site/src/pages/demo/project-board.tsx` (filter links)
- Test: `apps/site/src/pages/demo/__tests__/project-board.server.test.ts`

**Interfaces:**
- Consumes: `PRIORITIES` from `demo/data.ts`; Task 3's `ProjectRouteParamsSchema`.
- Produces: `BoardData` gains `priority: 'all' | TaskPriority` and `totalCount: number`; `BoardSearchSchema` exported from `task-schema.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/site/src/pages/demo/__tests__/project-board.server.test.ts` (extend `callBoard` with an optional `searchParams` argument threaded into `location`):

```ts
const callBoardWith = async (
  projectId: string,
  searchParams: Record<string, string>
): Promise<CallResult<BoardData>> => {
  const app = new Hono();
  let result!: CallResult<BoardData>;
  app.get('/', async (c) => {
    result = await createCaller(c).call(serverLoaders.default, {
      location: { pathParams: { projectId }, searchParams },
    });
    return c.text('ok');
  });
  await app.request('/');
  return result;
};

describe('project board priority filter', () => {
  beforeEach(() => resetDemoData());

  it('defaults to all tasks with priority "all"', async () => {
    const r = await callBoard('inf');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.priority).toBe('all');
      expect(r.value.tasks.length).toBe(r.value.totalCount);
    }
  });

  it('filters tasks server-side by ?priority=', async () => {
    const r = await callBoardWith('inf', { priority: 'urgent' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.priority).toBe('urgent');
      expect(r.value.tasks.length).toBeGreaterThan(0);
      expect(r.value.tasks.every((t) => t.priority === 'urgent')).toBe(true);
      expect(r.value.totalCount).toBeGreaterThan(r.value.tasks.length);
    }
  });

  it('rejects an unknown priority via searchSchema (framework 400)', async () => {
    const r = await callBoardWith('inf', { priority: 'bogus' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) expect(r.outcome.status).toBe(400);
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter site test -- run src/pages/demo/__tests__/project-board.server.test.ts`
Expected: FAIL (no `priority`/`totalCount` fields, no schema).

- [ ] **Step 3: Add the search schema**

Append to `apps/site/src/pages/demo/task-schema.ts`:

```ts
// Board filter: searchSchema validates and defaults ?priority=. An unknown
// value responds 400 through the framework (LoaderValidationError on the
// client); unrelated query keys pass through untouched.
export const BoardSearchSchema = v.object({
  priority: v.optional(v.picklist(['all', ...PRIORITIES]), 'all'),
});
```

- [ ] **Step 4: Filter in the loader**

In `apps/site/src/pages/demo/project-board.server.ts`, import `BoardSearchSchema`, extend `BoardData`:

```ts
export type BoardData = {
  project: Project;
  users: User[];
  tasks: Task[];
  /** The validated, defaulted ?priority= filter this data was computed for. */
  priority: 'all' | TaskPriority;
  /** Unfiltered task count, so the UI can show "n of m". */
  totalCount: number;
};
```

(add `TaskPriority` to the `demo/data.js` type import), and the loader becomes:

```ts
default: route.loader(
  async ({ location }): Promise<BoardData> => {
    const slug = location.pathParams.projectId;
    const project = getProjectBySlug(slug);
    if (!project) throw deny(404, `No project named '${slug}'.`);
    const all = listTasksForProject(project.id);
    const priority = location.searchParams.priority;
    return {
      project,
      users: [getUser('u-1'), getUser('u-2')].filter(
        (u): u is User => u !== null
      ),
      tasks:
        priority === 'all' ? all : all.filter((t) => t.priority === priority),
      priority,
      totalCount: all.length,
    };
  },
  {
    paramsSchema: ProjectRouteParamsSchema,
    searchSchema: BoardSearchSchema,
    // The cache key must include the filter, or every ?priority= value
    // shares one cache slot and navigation between filters serves stale data.
    params: ['priority'],
  }
),
```

- [ ] **Step 5: Run the loader tests to verify they pass**

Run: `pnpm --filter site test -- run src/pages/demo/__tests__/project-board.server.test.ts`
Expected: PASS.

- [ ] **Step 6: Filter links in the board header**

In `apps/site/src/pages/demo/project-board.tsx`, import `PRIORITY_LABEL` from `../../components/demo/priority.js` and `PRIORITIES` from `../../demo/data.js`. Inside `ProjectBoardPage`, destructure the new fields (`const { project, tasks, users, priority, totalCount } = data;`), change the count span to show filtered-of-total when filtering, and add the filter row into the header (after the `<h1>`/count, before the `ml-auto` dialog wrapper):

```tsx
<span class="text-[12px] text-muted">
  {priority === 'all' ? `${tasks.length} tasks` : `${tasks.length} of ${totalCount} tasks`}
</span>
<nav class="flex items-center gap-1 text-[12px]" aria-label="Filter by priority">
  {(['all', ...PRIORITIES] as const).map((p) => (
    <a
      key={p}
      href={
        p === 'all'
          ? `/demo/projects/${project.slug}`
          : `/demo/projects/${project.slug}?priority=${p}`
      }
      aria-current={priority === p ? 'page' : undefined}
      class={[
        'rounded-full px-2 py-0.5 font-medium',
        priority === p
          ? 'bg-accent text-accent-foreground'
          : 'text-muted hover:text-foreground',
      ].join(' ')}
    >
      {p === 'all' ? 'All' : PRIORITY_LABEL[p]}
    </a>
  ))}
</nav>
```

- [ ] **Step 7: Full site suite + typecheck**

Run: `pnpm --filter site test -- run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/site/src/pages/demo/task-schema.ts apps/site/src/pages/demo/project-board.server.ts apps/site/src/pages/demo/project-board.tsx apps/site/src/pages/demo/__tests__/project-board.server.test.ts
git commit -m "demo: server-side board priority filter via searchSchema

Validated+defaulted ?priority= drives the loader (400 through the framework
on a bad value); cache params list keys the cache per filter. Covers the
searchSchema item of issue #282 P1.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Insights panel (`timeoutMs` + `TimeoutError` + explicit `cache` + per-loader `use` + `Boundary`/`useData`/`useError`)

**Files:**
- Modify: `apps/site/src/pages/demo/project-board.server.ts` (insights loader + timing middleware)
- Create: `apps/site/src/components/demo/InsightsPanel.tsx`
- Modify: `apps/site/src/pages/demo/project-board.tsx` (mount the panel)
- Test: `apps/site/src/pages/demo/__tests__/project-board.server.test.ts`

**Interfaces:**
- Consumes: `createCache`, `defineServerMiddleware`, `TimeoutError` from `hono-preact`; `ProjectRouteParamsSchema`.
- Produces: `serverLoaders.insights` (`LoaderRef<ProjectInsights>`); `insightsCache` (exported `LoaderCache<ProjectInsights>`); `insightsTiming` (exported loader-scope middleware, for the unit test); `ProjectInsights` type.

- [ ] **Step 1: Write the failing tests**

Append to `apps/site/src/pages/demo/__tests__/project-board.server.test.ts` (import `insightsCache`, `insightsTiming`, `type ProjectInsights` from the server module, and `vi` from vitest):

```ts
describe('project insights loader', () => {
  beforeEach(() => resetDemoData());

  const callInsights = async (
    searchParams: Record<string, string>
  ): Promise<CallResult<ProjectInsights>> => {
    const app = new Hono();
    let result!: CallResult<ProjectInsights>;
    app.get('/', async (c) => {
      result = await createCaller(c).call(serverLoaders.insights, {
        location: { pathParams: { projectId: 'inf' }, searchParams },
      });
      return c.text('ok');
    });
    await app.request('/');
    return result;
  };

  it('computes quick insights by default', async () => {
    const r = await callInsights({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mode).toBe('quick');
      expect(r.value.total).toBeGreaterThan(0);
      const statusSum = Object.values(r.value.byStatus).reduce(
        (a, b) => a + b,
        0
      );
      expect(statusSum).toBe(r.value.total);
    }
  });

  it('caps the loader at a deliberate 1s timeout', () => {
    // timeoutMs is public metadata on the ref; the deep-mode sleep (5s) is
    // designed to exceed it so the live demo surfaces a TimeoutError.
    expect(serverLoaders.insights.timeoutMs).toBe(1000);
  });

  it('uses the exported explicit cache instance', () => {
    expect(serverLoaders.insights.cache).toBe(insightsCache);
  });

  it('emits a Server-Timing header from the per-loader middleware', async () => {
    const header = vi.fn();
    const ctxStub = {
      c: { header },
      signal: new AbortController().signal,
      scope: 'loader',
      location: { pathParams: {}, searchParams: {} },
      module: 'demo',
      loader: 'insights',
    };
    await insightsTiming.fn(ctxStub, async () => undefined);
    expect(header).toHaveBeenCalledTimes(1);
    const [name, value] = header.mock.calls[0];
    expect(name).toBe('Server-Timing');
    expect(String(value)).toMatch(/insights;dur=\d/);
  });
});
```

Note on the `ctxStub`: `insightsTiming.fn` expects a `ServerCtx<'loader'>`; build the stub to satisfy that type structurally (the fields above are the full `ServerLoaderCtx` minus the real Hono context; if the `c` field's `Context` type rejects the stub, give the helper middleware a narrower dependency instead: see Step 3's note. Do NOT cast).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter site test -- run src/pages/demo/__tests__/project-board.server.test.ts`
Expected: FAIL (no `insights` loader, no exports).

- [ ] **Step 3: Implement the insights loader**

In `apps/site/src/pages/demo/project-board.server.ts`, extend the `hono-preact` import with `createCache`, `defineServerMiddleware`, and add `STATUSES`, `type TaskStatus` to the data import. Append:

```ts
// ---- Project insights (issue #282 P1: loader options showcase) ----

export type ProjectInsights = {
  total: number;
  byStatus: Record<TaskStatus, number>;
  /** Age in whole days of the oldest task not yet done. 0 when none. */
  oldestOpenDays: number;
  mode: 'quick' | 'deep';
};

// Explicit cache instance (the `cache` loader option): exported so tests and
// future controls can address the cache directly instead of only through
// ref.invalidate().
export const insightsCache = createCache<ProjectInsights>();

// Per-loader middleware (the `use` loader option): times the loader body and
// reports it as a Server-Timing entry on the RPC response, visible in the
// browser's network panel.
export const insightsTiming = defineServerMiddleware<'loader'>(
  async (ctx, next) => {
    const started = performance.now();
    await next();
    const dur = Math.round(performance.now() - started);
    ctx.c.header('Server-Timing', `insights;dur=${dur}`);
  }
);

const InsightsSearchSchema = v.object({
  insights: v.optional(v.picklist(['quick', 'deep']), 'quick'),
});

// Abort-aware sleep so the timeout abort actually stops the deep path.
const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true }
    );
  });
```

(also add `import * as v from 'valibot';` and `deny` is already imported). Then add to `serverLoaders`:

```ts
insights: route.loader(
  async ({ location, signal }): Promise<ProjectInsights> => {
    const slug = location.pathParams.projectId;
    const project = getProjectBySlug(slug);
    if (!project) throw deny(404, `No project named '${slug}'.`);
    const mode = location.searchParams.insights;
    if (mode === 'deep') {
      // Deliberately exceeds the loader's 1s timeoutMs below. This is the
      // demo's visible TimeoutError path: the handler aborts the loader and
      // the client error boundary receives a TimeoutError instance.
      await sleep(5_000, signal);
    }
    const tasks = listTasksForProject(project.id);
    const byStatus = Object.fromEntries(
      STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length])
    ) as Record<TaskStatus, number>;
    const oldestOpen = tasks
      .filter((t) => t.status !== 'done')
      .reduce<number | null>(
        (min, t) => (min === null ? t.createdAt : Math.min(min, t.createdAt)),
        null
      );
    return {
      total: tasks.length,
      byStatus,
      oldestOpenDays:
        oldestOpen === null
          ? 0
          : Math.floor((Date.now() - oldestOpen) / 86_400_000),
      mode,
    };
  },
  {
    timeoutMs: 1_000,
    cache: insightsCache,
    use: [insightsTiming],
    paramsSchema: ProjectRouteParamsSchema,
    searchSchema: InsightsSearchSchema,
    params: ['insights'],
  }
),
```

Cast note: the `Object.fromEntries(...) as Record<TaskStatus, number>` above violates the no-cast rule. Build the record castless instead:

```ts
const byStatus: Record<TaskStatus, number> = {
  backlog: 0,
  in_progress: 0,
  in_review: 0,
  done: 0,
};
for (const t of tasks) byStatus[t.status] += 1;
```

Use the castless version.

If the `ServerCtx<'loader'>` stub in the test cannot satisfy Hono's `Context` type structurally for `ctx.c`, restructure: extract the measurable body as `export const timeLoader = async (setHeader: (name: string, value: string) => void, next: () => Promise<unknown>) => {...}` and have `insightsTiming` delegate (`(ctx, next) => timeLoader((n, v) => ctx.c.header(n, v), next)`); the test then drives `timeLoader` directly. Prefer the direct stub if it typechecks.

- [ ] **Step 4: Run the loader tests to verify they pass**

Run: `pnpm --filter site test -- run src/pages/demo/__tests__/project-board.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the panel UI**

Create `apps/site/src/components/demo/InsightsPanel.tsx`:

```tsx
// Insights strip under the board header. Deliberately exercises the loader
// error surface end to end: the Boundary provides state to useData()
// children, a cold failure (including the deep-mode TimeoutError) routes to
// errorFallback with a reset, and a stale error after data surfaces through
// useError() without unmounting the stats.
import { TimeoutError } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders } from '../../pages/demo/project-board.server.js';
import type { TaskStatus } from '../../demo/data.js';

const insightsLoader = serverLoaders.insights;

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};

const InsightsBody: FunctionComponent<{ slug: string }> = ({ slug }) => {
  const state = insightsLoader.useData();
  const staleError = insightsLoader.useError();
  if (state.status === 'loading') {
    return <p class="text-xs text-muted">Computing insights…</p>;
  }
  if (state.status === 'error') {
    // Stale-error arm: a revalidation failed after data was shown; the
    // Boundary keeps children mounted, so report inline.
    return (
      <p class="text-xs text-danger">
        Insights refresh failed: {state.error.message}
      </p>
    );
  }
  const d = state.data;
  return (
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span>
        <strong class="font-semibold text-foreground">{d.total}</strong> tasks
      </span>
      {Object.entries(d.byStatus).map(([s, n]) => (
        <span key={s}>
          {STATUS_LABEL[s as TaskStatus] ?? s}:{' '}
          <strong class="font-semibold text-foreground">{n}</strong>
        </span>
      ))}
      <span>
        oldest open:{' '}
        <strong class="font-semibold text-foreground">
          {d.oldestOpenDays}d
        </strong>
      </span>
      {d.mode === 'quick' ? (
        <a
          href={`/demo/projects/${slug}?insights=deep`}
          class="font-medium underline hover:text-foreground"
        >
          Run deep analysis (times out on purpose)
        </a>
      ) : (
        <a
          href={`/demo/projects/${slug}`}
          class="font-medium underline hover:text-foreground"
        >
          Back to quick insights
        </a>
      )}
      {staleError && (
        <span class="text-danger">({staleError.message})</span>
      )}
    </div>
  );
};

export const InsightsPanel: FunctionComponent<{ slug: string }> = ({
  slug,
}) => (
  <div class="border-b border-border bg-surface-subtle px-4 py-2">
    <insightsLoader.Boundary
      errorFallback={(err, reset) => (
        <p class="text-xs text-muted">
          {err instanceof TimeoutError
            ? 'Deep analysis exceeded the loader’s 1s timeoutMs (that is the demo). '
            : `Insights failed: ${err.message} `}
          <button class="font-medium underline" onClick={reset}>
            Try again
          </button>{' '}
          <a href={`/demo/projects/${slug}`} class="font-medium underline">
            Back to quick insights
          </a>
        </p>
      )}
    >
      <InsightsBody slug={slug} />
    </insightsLoader.Boundary>
  </div>
);
```

Cast note: `STATUS_LABEL[s as TaskStatus]` is a cast; avoid it by iterating `STATUSES` (import from `demo/data.js`) instead of `Object.entries`:

```tsx
{STATUSES.map((s) => (
  <span key={s}>
    {STATUS_LABEL[s]}:{' '}
    <strong class="font-semibold text-foreground">{d.byStatus[s]}</strong>
  </span>
))}
```

Use the `STATUSES.map` version.

Mount it in `apps/site/src/pages/demo/project-board.tsx` (import `{ InsightsPanel }` and render between the header div and `<Board …/>`):

```tsx
<InsightsPanel slug={project.slug} />
```

- [ ] **Step 6: Full site suite + typecheck**

Run: `pnpm --filter site test -- run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/pages/demo/project-board.server.ts apps/site/src/components/demo/InsightsPanel.tsx apps/site/src/pages/demo/project-board.tsx apps/site/src/pages/demo/__tests__/project-board.server.test.ts
git commit -m "demo: board insights panel exercising timeoutMs, explicit cache, and per-loader use

Quick mode computes status counts; deep mode sleeps past the 1s timeoutMs so
the client Boundary errorFallback receives a real TimeoutError. Adds the
first Boundary/useData/useError consumption and a Server-Timing per-loader
middleware. Covers the loader-options items of issue #282 P1.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Archived-project gate (`render()` page outcome)

**Files:**
- Modify: `apps/site/src/demo/data.ts` (Project.archived + legacy seed)
- Create: `apps/site/src/demo/archived-gate.ts`
- Create: `apps/site/src/components/demo/ArchivedProjectNotice.tsx`
- Modify: `apps/site/src/routes.ts` (`use` on the `:projectId` node)
- Create: `apps/site/src/demo/__tests__/archived-gate.test.ts`
- Possibly modify: `apps/site/src/demo/__tests__/data.test.ts` and `apps/site/src/pages/demo/__tests__/projects-shell.server.test.ts` (seed-count assertions; check and update)

**Interfaces:**
- Consumes: `defineServerMiddleware` from `hono-preact`; `deny`, `render`, `isRender`, `isDeny` from `hono-preact/page`.
- Produces: `Project` gains `archived: boolean`; new seeded project `p-4` slug `legacy` (archived); `archivedGate: [ServerMiddleware]` consumed by `routes.ts`.

- [ ] **Step 1: Write the failing tests**

Create `apps/site/src/demo/__tests__/archived-gate.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isDeny, isRender } from 'hono-preact/page';
import { archivedGateServer } from '../archived-gate.js';
import { resetDemoData, getProjectBySlug } from '../data.js';

// The gate branches on scope: page scope swaps the tree via render() (a
// page-scope-only outcome), loader scope denies 410, action scope passes
// through (actions carry no location).
describe('archivedGateServer', () => {
  beforeEach(() => resetDemoData());

  const pageCtx = (projectId: string) => ({
    scope: 'page' as const,
    location: { pathParams: { projectId } },
  });

  it('seeds the legacy project as archived', () => {
    expect(getProjectBySlug('legacy')?.archived).toBe(true);
    expect(getProjectBySlug('inf')?.archived).toBe(false);
  });

  it('returns a render outcome for an archived project page', async () => {
    const next = vi.fn(async () => undefined);
    const outcome = await archivedGateServer.fn(pageCtx('legacy'), next);
    expect(outcome && isRender(outcome)).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('denies 410 for an archived project loader RPC', async () => {
    const next = vi.fn(async () => undefined);
    const outcome = await archivedGateServer.fn(
      { scope: 'loader', location: { pathParams: { projectId: 'legacy' } } },
      next
    );
    expect(outcome && isDeny(outcome)).toBe(true);
    if (outcome && isDeny(outcome)) expect(outcome.status).toBe(410);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes a live project through', async () => {
    const next = vi.fn(async () => undefined);
    const outcome = await archivedGateServer.fn(pageCtx('inf'), next);
    expect(outcome).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
```

Note: `archivedGateServer.fn` takes a `ServerCtx`; the stubs above omit `c`/`signal` and the loader ctx's `module`/`loader` fields. If the type rejects them, extend the stubs with the missing structural fields (`signal: new AbortController().signal`, `module: 'demo'`, `loader: 'default'`) and give the gate a narrower ctx dependency for `c` as in Task 5's note. Do NOT cast.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter site test -- run src/demo/__tests__/archived-gate.test.ts`
Expected: FAIL (no `archived-gate.ts`, no `archived` field).

- [ ] **Step 3: Seed the archived project**

In `apps/site/src/demo/data.ts`:

1. `export type Project = { id: string; slug: string; name: string; archived: boolean };`
2. Seed list becomes:

```ts
const projects: Project[] = [
  { id: 'p-1', slug: 'inf', name: 'Infrastructure', archived: false },
  { id: 'p-2', slug: 'api', name: 'API', archived: false },
  { id: 'p-3', slug: 'web', name: 'Web', archived: false },
  // Archived on purpose: the /demo/projects/legacy route demonstrates the
  // render() page outcome (a server middleware swaps the page tree).
  { id: 'p-4', slug: 'legacy', name: 'Legacy Console', archived: true },
];
```

3. Give it two finished tasks so the sidebar count is honest (append to the `tasks` seed):

```ts
// Legacy Console (p-4, archived)
mk('t-13', 'p-4', 'u-1', 'u-2', 'Sunset the v1 console', 'Redirects are live.', 'done', 'low', 12),
mk('t-14', 'p-4', 'u-2', null, 'Export historical reports', 'One-off dump for finance.', 'done', 'medium', 13),
```

Then check the seed-count assumptions: run `pnpm --filter site test -- run` and fix any test that asserts 3 projects or 12 tasks (`src/demo/__tests__/data.test.ts` and `src/pages/demo/__tests__/projects-shell.server.test.ts` are the candidates). Update expectations to the new seed (4 projects, 14 tasks), keeping the tests' intent.

- [ ] **Step 4: Implement the gate and the notice**

Create `apps/site/src/components/demo/ArchivedProjectNotice.tsx`:

```tsx
import type { FunctionComponent } from 'preact';

// The page tree the archived-project gate swaps in via the render() outcome.
// Server-rendered in place of the board; no loaders run for the page.
export const ArchivedProjectNotice: FunctionComponent = () => (
  <div class="mx-auto w-full max-w-xl px-6 py-16 text-center space-y-3">
    <h2 class="text-lg font-semibold text-foreground">
      This project is archived
    </h2>
    <p class="text-sm text-muted">
      A server middleware on the project route returned the framework&apos;s
      render() outcome, replacing the page tree before any loader ran.
    </p>
    <a href="/demo/projects" class="text-sm font-medium underline">
      Back to projects
    </a>
  </div>
);
```

Create `apps/site/src/demo/archived-gate.ts`:

```ts
import { defineServerMiddleware } from 'hono-preact';
import { deny, render } from 'hono-preact/page';
import { getProjectBySlug } from './data.js';
import { ArchivedProjectNotice } from '../components/demo/ArchivedProjectNotice.js';

// Declared as `use` on the /demo/projects/:projectId route node, so it runs
// for the page render AND every loader RPC under that node. render() is a
// page-scope-only outcome (it swaps the page tree), so the loader scope
// denies 410 instead: a client-side nav to an archived project surfaces the
// message through the board View's errorFallback, while a full reload gets
// the swapped notice page. Actions pass through (no location on that scope;
// the archived board is unreachable through the UI anyway).
export const archivedGateServer = defineServerMiddleware(async (ctx, next) => {
  if (ctx.scope !== 'action') {
    const slug = ctx.location.pathParams.projectId;
    const project = slug ? getProjectBySlug(slug) : null;
    if (project?.archived) {
      if (ctx.scope === 'page') return render(ArchivedProjectNotice);
      return deny(410, 'This project is archived and read-only.');
    }
  }
  await next();
});

export const archivedGate = [archivedGateServer];
```

Wire it in `apps/site/src/routes.ts`: add `import { archivedGate } from './demo/archived-gate.js';` and on the `:projectId` node:

```ts
{
  path: ':projectId',
  layout: () => import('./pages/demo/project-header.js'),
  use: archivedGate,
  children: [
    ...
```

- [ ] **Step 5: Run the gate tests to verify they pass**

Run: `pnpm --filter site test -- run src/demo/__tests__/archived-gate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Full site suite + typecheck**

Run: `pnpm --filter site test -- run && pnpm typecheck`
Expected: PASS (including any seed-count updates from Step 3).

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/demo/data.ts apps/site/src/demo/archived-gate.ts apps/site/src/components/demo/ArchivedProjectNotice.tsx apps/site/src/routes.ts apps/site/src/demo/__tests__/archived-gate.test.ts
git commit -m "demo: archived-project gate exercising the render() page outcome

A route-node middleware swaps the page tree via render() on full loads and
denies 410 on loader RPCs (client navs surface it through the board's
errorFallback). Seeds an archived Legacy Console project. Covers the
render() item of issue #282 P1.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(If Step 3 touched `data.test.ts` or `projects-shell.server.test.ts`, add them to the commit.)

---

### Task 7: End-to-end verification and CI parity

**Files:** none (verification only; fix-forward anything found, in this worktree).

- [ ] **Step 1: Drive the changes in the real app**

Use the `verify` skill flow: build and run the dev server from the worktree (`pnpm --filter site dev`), then confirm with curl/browser:

1. `/demo/projects/legacy` full load renders the archived notice (render() outcome).
2. `/demo/projects/NOT%20A%20SLUG` and `/demo/projects/inf/tasks/bogus` render the errorFallback with a 404 message (paramsSchema), `/demo/projects/nope` the deny(404) message.
3. `/demo/projects/inf?priority=urgent` shows only urgent cards, the chip highlights, and `?priority=bogus` shows the board errorFallback (400).
4. `/demo/projects/inf?insights=deep` shows the TimeoutError fallback after ~1s; "Try again" re-enters; quick insights render stats. Check the RPC response for the `Server-Timing: insights;dur=` header.
5. On a task page, sign in, type into the comment box: the preview line updates live (chars/words), `@alice` resolves to "mentions Alice". The socket must connect (status dot green).
6. `/demo/cursors` still fans out cursors across two tabs (room binding did not regress; watch the terminal for any boot-time binding error on server start).

- [ ] **Step 2: CI parity, in CI order**

From the worktree root, run the full eight-step sequence (repo CLAUDE.md "Pre-push verification"):

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check   # if it fails: pnpm format, include in a fixup commit
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all PASS. Do not push anything that has not passed all eight.

- [ ] **Step 3: Update issue #282 checkboxes**

Tick the P1 items this branch closes (via `gh issue edit 282` body checkbox edits or a comment referencing the branch), listing anything deliberately deferred (the streaming comments loader keeps no paramsSchema; actions pass through the archived gate).

---

## Self-review notes

- Spec coverage: P1 item 1 (socket via `serverRoute(r).socket` = Task 2; room binder migration = Task 1), item 2 (paramsSchema/searchSchema/Boundary+useError/errorFallback/render() = Tasks 3, 4, 5, 6), item 3 (cache/timeoutMs/per-loader use = Task 5). P2 items are intentionally out of scope for this branch.
- The two "if the type rejects the stub" notes (Tasks 5 and 6) are deliberate: the exact structural compatibility of `ServerCtx` stubs with Hono's `Context` cannot be confirmed without compiling; both notes give a castless fallback shape instead of a placeholder.
- Type consistency: `DraftPreview` is defined once in `demo/draft-preview.ts` and imported by `task.server.ts`; `ProjectInsights`/`insightsCache`/`insightsTiming` live in `project-board.server.ts`; `BoardData.priority` uses the same `'all' | TaskPriority` union the schema produces.
