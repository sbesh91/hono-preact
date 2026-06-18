# Persistent live-activity bar for /demo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bottom-docked bar to the `/demo` task board that streams a live hybrid activity feed (simulated teammates + echoed real actions) over SSE and survives intra-demo navigation because it is mounted via the framework's `Persist` component (rendered outside the router).

**Architecture:** A Hono SSE endpoint in `apps/site/src/api.ts` (auto-mounted ahead of framework handlers) emits JSON activity frames: an event-driven loop races a 4-8s jittered timer (simulated teammate events) against an in-memory bus that the demo's server actions publish real events to. A client `ActivityBar` component, mounted via `<Persist>` in the demo layout, opens its own `EventSource`, accumulates events, and renders a collapsible bar. View-transition isolation mirrors the existing sidebar.

**Tech Stack:** Hono `streamSSE` (`hono/streaming`, hono 4.12.14), native `EventSource`, Preact + `hono-preact` (`Persist`, `subscribeViewTransitionTypes`), Tailwind v4 tokens, Vitest + `@testing-library/preact` + happy-dom.

## Global Constraints

- **No em-dashes** in prose, code comments, or commit messages. Use comma, semicolon, colon, parentheses, or two sentences. (Arrows `→` in UI copy are fine.)
- **No inline type casts.** Reshape types instead (this plan uses a discriminated union for `ActivityEvent`). The one acceptable cast is `JSON.parse(...) as ActivityEvent` at the SSE-parse trust boundary.
- **apps/site only.** No changes to `packages/*` or any framework/published surface. No release implications.
- **Browser support:** depend only on Baseline Widely Available platform features. `EventSource` qualifies. View Transitions stay progressive enhancement (handled by the existing isolation CSS pattern).
- **Pre-push = the six CI steps in order** (framework build → `pnpm format:check` → `pnpm typecheck` → `pnpm test:coverage` → `pnpm test:integration` → `pnpm --filter site build`). `format:check` is the most-missed; **run `pnpm format` before every commit** and review `git status` for format-dirty files (recurring subagent trap).
- ESM imports use the `.js` extension on relative paths (e.g. `import { x } from './data.js'`), matching the codebase.
- Tests that render components need the file-header pragma `// @vitest-environment happy-dom`; pure-logic tests use the default node env. Reset the demo store with `resetDemoData()` and the activity bus with `__resetActivityForTesting()` in `beforeEach`.

---

## File Structure

New:
- `apps/site/src/demo/activity-stream.ts` — `ActivityEvent` type, in-memory bus, event builders, seed backfill.
- `apps/site/src/demo/activity-sim.ts` — simulated teammate event generator.
- `apps/site/src/api.ts` — Hono app with the `GET /api/demo/activity` SSE endpoint.
- `apps/site/src/components/demo/ActivityBar.tsx` — the persistent bar component.
- `apps/site/src/demo/__tests__/activity-stream.test.ts`
- `apps/site/src/demo/__tests__/activity-sim.test.ts`
- `apps/site/src/__tests__/api.test.ts`
- `apps/site/src/components/demo/__tests__/ActivityBar.test.tsx`

Modified:
- `apps/site/src/demo/data.ts` — add `listAllTasks`.
- `apps/site/src/pages/demo/project-board.server.ts` — publish on `createTask` / `patchTask` (move).
- `apps/site/src/pages/demo/task.server.ts` — publish on `addComment` / `setStatus`.
- `apps/site/src/pages/demo/demo-layout.tsx` — mount `<Persist><ActivityBar/></Persist>`.
- `apps/site/src/pages/demo/projects-shell.tsx` — bottom padding on `<main>` so the bar never covers content.
- `apps/site/src/styles/root.css` — VT isolation + pulse/slide-up keyframes.

---

## Task 1: Event model, bus, builders, backfill

**Files:**
- Modify: `apps/site/src/demo/data.ts` (add `listAllTasks` near the other reads, ~line 272)
- Create: `apps/site/src/demo/activity-stream.ts`
- Test: `apps/site/src/demo/__tests__/activity-stream.test.ts`

**Interfaces:**
- Consumes: from `./data.js` — `listAllTasks(): Task[]` (added here), `getProject(id): Project | null`, `getUser(id): User | null`, `listComments(taskId): Comment[]`, types `Task`, `TaskStatus`.
- Produces:
  - `type ActivityEvent` (discriminated union on `kind`).
  - `publishActivity(e: ActivityEvent): void`
  - `subscribeActivity(cb: (e: ActivityEvent) => void): () => void`
  - `taskCreatedEvent(task: Task, actor: string, simulated?: boolean): ActivityEvent`
  - `taskMovedEvent(task: Task, to: TaskStatus, actor: string, simulated?: boolean): ActivityEvent`
  - `commentAddedEvent(task: Task, actor: string, simulated?: boolean): ActivityEvent`
  - `recentActivityEvents(limit?: number): ActivityEvent[]`
  - `__resetActivityForTesting(): void`

- [ ] **Step 1: Add `listAllTasks` to `data.ts`**

In `apps/site/src/demo/data.ts`, in the `// ---- Reads ----` section (just after `listTasksForProject`, ~line 276), add:

```ts
export const listAllTasks = (): Task[] => store.tasks.slice();
```

- [ ] **Step 2: Write the failing test**

Create `apps/site/src/demo/__tests__/activity-stream.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoData, getTask } from '../data.js';
import {
  publishActivity,
  subscribeActivity,
  taskMovedEvent,
  commentAddedEvent,
  taskCreatedEvent,
  recentActivityEvents,
  __resetActivityForTesting,
  type ActivityEvent,
} from '../activity-stream.js';

beforeEach(() => {
  resetDemoData();
  __resetActivityForTesting();
});

describe('activity bus', () => {
  it('delivers published events to subscribers', () => {
    const seen: ActivityEvent[] = [];
    const unsub = subscribeActivity((e) => seen.push(e));
    const task = getTask('t-1')!;
    publishActivity(taskMovedEvent(task, 'done', 'Alice'));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: 'task-moved',
      taskId: 't-1',
      to: 'done',
      actor: 'Alice',
      projectSlug: 'inf',
      simulated: false,
    });
    unsub();
    publishActivity(commentAddedEvent(task, 'Bob'));
    expect(seen).toHaveLength(1); // unsubscribed: no further delivery
  });

  it('assigns unique ids and marks simulated events', () => {
    const task = getTask('t-1')!;
    const a = taskCreatedEvent(task, 'Alice');
    const b = commentAddedEvent(task, 'Bob', true);
    expect(a.id).not.toBe(b.id);
    expect(a.simulated).toBe(false);
    expect(b.simulated).toBe(true);
  });
});

describe('recentActivityEvents', () => {
  it('returns up to `limit` well-formed events newest-first from the seed store', () => {
    const events = recentActivityEvents(5);
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].at).toBeGreaterThanOrEqual(events[i].at);
    }
    for (const e of events) {
      expect(typeof e.taskTitle).toBe('string');
      expect(['inf', 'api', 'web']).toContain(e.projectSlug);
      expect(e.simulated).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `pnpm exec vitest run apps/site/src/demo/__tests__/activity-stream.test.ts`
Expected: FAIL (cannot resolve `../activity-stream.js`).

- [ ] **Step 4: Implement `activity-stream.ts`**

Create `apps/site/src/demo/activity-stream.ts`:

```ts
// apps/site/src/demo/activity-stream.ts
// In-memory activity bus + event model for the persistent demo activity bar.
// The bus is per-isolate: server actions publish real events; the SSE endpoint
// subscribes. Builders construct events; the data store stays a pure module and
// does not import this file.
import {
  listAllTasks,
  listComments,
  getProject,
  getUser,
  type Task,
  type TaskStatus,
} from './data.js';

type EventBase = {
  id: string;
  at: number; // epoch ms
  actor: string; // display name
  taskId: string;
  taskTitle: string;
  projectSlug: string;
  simulated: boolean; // true = fabricated teammate event (display-only)
};

export type ActivityEvent =
  | (EventBase & { kind: 'task-created' })
  | (EventBase & { kind: 'task-moved'; to: TaskStatus })
  | (EventBase & { kind: 'comment-added' });

let counter = 0;
const nextId = (): string => `evt-${++counter}`;
const slugOf = (task: Task): string => getProject(task.projectId)?.slug ?? '';

export function taskCreatedEvent(
  task: Task,
  actor: string,
  simulated = false
): ActivityEvent {
  return {
    id: nextId(),
    kind: 'task-created',
    at: Date.now(),
    actor,
    taskId: task.id,
    taskTitle: task.title,
    projectSlug: slugOf(task),
    simulated,
  };
}

export function taskMovedEvent(
  task: Task,
  to: TaskStatus,
  actor: string,
  simulated = false
): ActivityEvent {
  return {
    id: nextId(),
    kind: 'task-moved',
    at: Date.now(),
    actor,
    taskId: task.id,
    taskTitle: task.title,
    projectSlug: slugOf(task),
    to,
    simulated,
  };
}

export function commentAddedEvent(
  task: Task,
  actor: string,
  simulated = false
): ActivityEvent {
  return {
    id: nextId(),
    kind: 'comment-added',
    at: Date.now(),
    actor,
    taskId: task.id,
    taskTitle: task.title,
    projectSlug: slugOf(task),
    simulated,
  };
}

const listeners = new Set<(e: ActivityEvent) => void>();

export function publishActivity(e: ActivityEvent): void {
  // Copy before iterating so an unsubscribe during dispatch is safe.
  for (const l of [...listeners]) l(e);
}

export function subscribeActivity(cb: (e: ActivityEvent) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Derive a few most-recent events from the seeded store (across all projects)
// so a freshly-connected bar is immediately populated. Uses the historical
// timestamps (not Date.now), so the backfill reads as real history.
export function recentActivityEvents(limit = 5): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const task of listAllTasks()) {
    const projectSlug = slugOf(task);
    events.push({
      id: nextId(),
      kind: 'task-created',
      at: task.createdAt,
      actor: getUser(task.authorId)?.name ?? 'someone',
      taskId: task.id,
      taskTitle: task.title,
      projectSlug,
      simulated: false,
    });
    for (const c of listComments(task.id)) {
      events.push({
        id: nextId(),
        kind: 'comment-added',
        at: c.createdAt,
        actor: getUser(c.authorId)?.name ?? 'someone',
        taskId: task.id,
        taskTitle: task.title,
        projectSlug,
        simulated: false,
      });
    }
  }
  return events.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Test-only reset. Do not call from production code. */
export function __resetActivityForTesting(): void {
  listeners.clear();
  counter = 0;
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `pnpm exec vitest run apps/site/src/demo/__tests__/activity-stream.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 6: Format and commit**

```bash
pnpm format
git add apps/site/src/demo/activity-stream.ts apps/site/src/demo/data.ts apps/site/src/demo/__tests__/activity-stream.test.ts
git commit -m "feat(demo): activity event model and in-memory bus"
```

---

## Task 2: Simulated teammate generator

**Files:**
- Create: `apps/site/src/demo/activity-sim.ts`
- Test: `apps/site/src/demo/__tests__/activity-sim.test.ts`

**Interfaces:**
- Consumes: `listAllTasks`, `getProject`, type `TaskStatus` from `./data.js`; `taskMovedEvent`, `commentAddedEvent`, type `ActivityEvent` from `./activity-stream.js`.
- Produces: `simulateActivity(): ActivityEvent | null` — a `simulated: true` event referencing a real existing task; `null` only if the store has no tasks. Never mutates the store.

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/demo/__tests__/activity-sim.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoData, listAllTasks, getProject, getTask } from '../data.js';
import { __resetActivityForTesting } from '../activity-stream.js';
import { simulateActivity } from '../activity-sim.js';

beforeEach(() => {
  resetDemoData();
  __resetActivityForTesting();
});

describe('simulateActivity', () => {
  it('produces a valid display-only event referencing a real task, 200 runs', () => {
    const ids = new Set(listAllTasks().map((t) => t.id));
    const statusBefore = new Map(listAllTasks().map((t) => [t.id, t.status]));

    for (let i = 0; i < 200; i++) {
      const e = simulateActivity();
      expect(e).not.toBeNull();
      if (!e) continue;
      expect(['task-moved', 'comment-added']).toContain(e.kind);
      expect(ids.has(e.taskId)).toBe(true);
      const task = getTask(e.taskId)!;
      expect(e.projectSlug).toBe(getProject(task.projectId)!.slug);
      expect(e.simulated).toBe(true);
      if (e.kind === 'task-moved') {
        expect(e.to).not.toBe(task.status); // moved somewhere new
      }
    }

    // Display-only: the store is untouched.
    for (const t of listAllTasks()) {
      expect(t.status).toBe(statusBefore.get(t.id));
    }
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm exec vitest run apps/site/src/demo/__tests__/activity-sim.test.ts`
Expected: FAIL (cannot resolve `../activity-sim.js`).

- [ ] **Step 3: Implement `activity-sim.ts`**

Create `apps/site/src/demo/activity-sim.ts`:

```ts
// apps/site/src/demo/activity-sim.ts
// Fabricated teammate activity for the demo bar's streaming heartbeat. Events
// reference real existing tasks but are display-only: they do NOT mutate the
// store. Limited to moves/comments so every event has a real taskId (a
// fabricated create would need a fake id).
import { listAllTasks, type TaskStatus } from './data.js';
import {
  taskMovedEvent,
  commentAddedEvent,
  type ActivityEvent,
} from './activity-stream.js';

const SIM_ACTORS = ['Alice', 'Bob'];
const STATUSES: TaskStatus[] = [
  'backlog',
  'in_progress',
  'in_review',
  'done',
];

const pick = <T>(xs: readonly T[]): T =>
  xs[Math.floor(Math.random() * xs.length)];

export function simulateActivity(): ActivityEvent | null {
  const tasks = listAllTasks();
  if (tasks.length === 0) return null;
  const task = pick(tasks);
  const actor = pick(SIM_ACTORS);
  if (Math.random() < 0.6) {
    const to = pick(STATUSES.filter((s) => s !== task.status));
    return taskMovedEvent(task, to, actor, true);
  }
  return commentAddedEvent(task, actor, true);
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm exec vitest run apps/site/src/demo/__tests__/activity-sim.test.ts`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add apps/site/src/demo/activity-sim.ts apps/site/src/demo/__tests__/activity-sim.test.ts
git commit -m "feat(demo): simulated teammate activity generator"
```

---

## Task 3: SSE endpoint (`api.ts`)

**Files:**
- Create: `apps/site/src/api.ts`
- Test: `apps/site/src/__tests__/api.test.ts`

**Interfaces:**
- Consumes: `subscribeActivity`, `recentActivityEvents`, type `ActivityEvent` from `./demo/activity-stream.js`; `simulateActivity` from `./demo/activity-sim.js`; `Hono` from `hono`; `streamSSE` from `hono/streaming`.
- Produces: default-exported `Hono` app. The framework auto-mounts `src/api.ts` (default `api` option) ahead of its handlers. `GET /api/demo/activity` returns a `text/event-stream` whose frames are JSON-encoded `ActivityEvent`s.

Note on `streamSSE` API (verified, hono 4.12.14): `stream.writeSSE({ data })`, `stream.sleep(ms)`, `stream.onAbort(fn)`, boolean `stream.aborted`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/__tests__/api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoData } from '../demo/data.js';
import { __resetActivityForTesting } from '../demo/activity-stream.js';
import app from '../api.js';

beforeEach(() => {
  resetDemoData();
  __resetActivityForTesting();
});

describe('GET /api/demo/activity', () => {
  it('streams JSON activity frames as text/event-stream (reads backfill, then aborts)', async () => {
    const ctrl = new AbortController();
    const res = await app.request('/api/demo/activity', {
      signal: ctrl.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let firstData: string | null = null;

    // The backfill frames are written before the first timer sleep, so they
    // arrive in the first read(s). Bound the loop so the test can't hang.
    for (let i = 0; i < 5 && firstData === null; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const m = buf.match(/^data: (.*)$/m);
      if (m) firstData = m[1];
    }
    ctrl.abort();
    await reader.cancel().catch(() => undefined);

    expect(firstData).not.toBeNull();
    const parsed = JSON.parse(firstData!);
    expect(parsed).toHaveProperty('kind');
    expect(parsed).toHaveProperty('taskId');
    expect(['inf', 'api', 'web']).toContain(parsed.projectSlug);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm exec vitest run apps/site/src/__tests__/api.test.ts`
Expected: FAIL (cannot resolve `../api.js`).

- [ ] **Step 3: Implement `api.ts`**

Create `apps/site/src/api.ts`:

```ts
// apps/site/src/api.ts
// User Hono app, auto-mounted by the framework ahead of its own handlers.
// Hosts the SSE endpoint that drives the persistent demo activity bar.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  subscribeActivity,
  recentActivityEvents,
  type ActivityEvent,
} from './demo/activity-stream.js';
import { simulateActivity } from './demo/activity-sim.js';

const app = new Hono();

// Hybrid stream: real actions (echoed from the in-memory bus when same-isolate)
// race a 4-8s jittered timer that emits a simulated teammate event. The page is
// never blocked: this is opened by the client post-hydration.
app.get('/api/demo/activity', (c) =>
  streamSSE(c, async (stream) => {
    const queue: ActivityEvent[] = [];
    let wake!: () => void;
    let wakeP = new Promise<void>((r) => (wake = r));
    const unsub = subscribeActivity((e) => {
      queue.push(e);
      wake();
    });
    stream.onAbort(() => {
      unsub();
      wake(); // break the race promptly on disconnect
    });

    // Immediate backfill so the bar is populated on connect.
    for (const e of recentActivityEvents(5)) {
      await stream.writeSSE({ data: JSON.stringify(e) });
    }

    try {
      while (!stream.aborted) {
        while (queue.length) {
          await stream.writeSSE({ data: JSON.stringify(queue.shift()!) });
        }
        const tick = 4000 + Math.floor(Math.random() * 4000);
        await Promise.race([wakeP, stream.sleep(tick)]);
        wakeP = new Promise<void>((r) => (wake = r));
        if (stream.aborted) break;
        if (queue.length === 0) {
          // Timer path (no real event this round): emit a simulated one.
          const e = simulateActivity();
          if (e) await stream.writeSSE({ data: JSON.stringify(e) });
        }
        // queue non-empty -> loop top drains real events first.
      }
    } finally {
      unsub();
    }
  })
);

export default app;
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm exec vitest run apps/site/src/__tests__/api.test.ts`
Expected: PASS. If the read loop ever hangs, the bounded `for` (max 5 reads) plus `ctrl.abort()` guarantees termination; a failure here means backfill is not being written before the first sleep.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add apps/site/src/api.ts apps/site/src/__tests__/api.test.ts
git commit -m "feat(demo): SSE endpoint streaming hybrid activity feed"
```

---

## Task 4: The persistent `ActivityBar` component

**Files:**
- Create: `apps/site/src/components/demo/ActivityBar.tsx`
- Test: `apps/site/src/components/demo/__tests__/ActivityBar.test.tsx`

**Interfaces:**
- Consumes: `subscribeViewTransitionTypes` from `hono-preact`; `useEffect`, `useState` from `preact/hooks`; type `ActivityEvent` from `../../demo/activity-stream.js`; type `TaskStatus` from `../../demo/data.js`.
- Produces: named export `ActivityBar` (a Preact function component taking no props). Renders `null` on the server and when the current path is not under `/demo/projects`. Opens `EventSource('/api/demo/activity')` while under `/demo/projects`. Root element carries the `demo-activity-bar` class (for VT isolation, wired in Task 5).

Notes:
- The component lives in `PersistHost`'s tree (outside the router), so it must NOT use `useRoute`/`useParams`/`useNavigate`. Path comes from `window.location.pathname` + `subscribeViewTransitionTypes`.
- All hooks are called unconditionally before any early `return null` (Rules of Hooks).
- `EventSource` is guarded (`typeof EventSource === 'undefined'` -> skip) because happy-dom and SSR have none.

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/components/demo/__tests__/ActivityBar.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { act } from 'preact/test-utils';
import { ActivityBar } from '../ActivityBar.js';
import type { ActivityEvent } from '../../../demo/activity-stream.js';

// Minimal EventSource stub: captures the latest instance so the test can drive
// onopen/onmessage. happy-dom has no EventSource.
class MockEventSource {
  static last: MockEventSource | null = null;
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.last = this;
  }
  close() {
    this.closed = true;
  }
}

const moved = (id: string, title: string): ActivityEvent => ({
  id,
  kind: 'task-moved',
  at: 1,
  actor: 'Bob',
  taskId: 't-1',
  taskTitle: title,
  projectSlug: 'inf',
  to: 'in_review',
  simulated: true,
});

beforeEach(() => {
  vi.stubGlobal('EventSource', MockEventSource);
  MockEventSource.last = null;
  window.history.pushState({}, '', '/demo/projects/inf');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ActivityBar', () => {
  it('accumulates streamed events and shows the latest line + count', async () => {
    render(<ActivityBar />);
    const es = MockEventSource.last!;
    expect(es.url).toBe('/api/demo/activity');

    await act(async () => {
      es.onopen?.();
      es.onmessage?.({ data: JSON.stringify(moved('e1', 'Cache key')) });
      es.onmessage?.({ data: JSON.stringify(moved('e2', 'Stream bodies')) });
    });

    // Latest event (e2) is shown; count reflects both.
    expect(screen.getByText(/Stream bodies/)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('expands to reveal the full feed', async () => {
    render(<ActivityBar />);
    const es = MockEventSource.last!;
    await act(async () => {
      es.onmessage?.({ data: JSON.stringify(moved('e1', 'Cache key')) });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /activity/i }));
    });
    // Feed region appears when expanded.
    expect(screen.getByRole('log')).toBeTruthy();
  });

  it('renders nothing outside /demo/projects', () => {
    window.history.pushState({}, '', '/docs/intro');
    const { container } = render(<ActivityBar />);
    expect(container.innerHTML).toBe('');
    expect(MockEventSource.last).toBeNull(); // no stream opened off-app
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm exec vitest run apps/site/src/components/demo/__tests__/ActivityBar.test.tsx`
Expected: FAIL (cannot resolve `../ActivityBar.js`).

- [ ] **Step 3: Implement `ActivityBar.tsx`**

Create `apps/site/src/components/demo/ActivityBar.tsx`:

```tsx
import { subscribeViewTransitionTypes } from 'hono-preact';
import { useEffect, useState } from 'preact/hooks';
import { ChevronUp, ChevronDown } from 'lucide-preact';
import type { ActivityEvent } from '../../demo/activity-stream.js';
import type { TaskStatus } from '../../demo/data.js';

const MAX = 50;
const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

function describeEvent(e: ActivityEvent): string {
  if (e.kind === 'task-created') return `${e.actor} created "${e.taskTitle}"`;
  if (e.kind === 'task-moved')
    return `${e.actor} moved "${e.taskTitle}" → ${STATUS_LABEL[e.to]}`;
  return `${e.actor} commented on "${e.taskTitle}"`;
}

// Persistent live-activity bar. Mounted via <Persist> (see demo-layout), so it
// renders inside PersistHost OUTSIDE the router: no router hooks. It owns its
// own EventSource; the connection and accumulated feed survive intra-app
// navigation because the component instance persists.
export function ActivityBar() {
  const [path, setPath] = useState(
    typeof window === 'undefined' ? '' : window.location.pathname
  );
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [connected, setConnected] = useState(false);

  // Learn the current path from outside the router: window on mount, then every
  // navigation via the global (non-hook) view-transition subscription. Returns
  // undefined so it adds no transition types; used purely for nav.to.
  useEffect(() => {
    setPath(window.location.pathname);
    return subscribeViewTransitionTypes((nav) => {
      setPath(nav.to);
      return undefined;
    });
  }, []);

  const isApp = path.startsWith('/demo/projects');

  // Open the stream only inside the app area. Keyed on `isApp` so it stays open
  // across intra-app navigation (dep unchanged -> no re-run) and closes on exit.
  useEffect(() => {
    if (!isApp || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/demo/activity');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        // Trust boundary: our own endpoint. JSON parse cast is acceptable.
        const e = JSON.parse(ev.data) as ActivityEvent;
        setEvents((prev) => [e, ...prev].slice(0, MAX));
      } catch {
        // ignore a malformed frame
      }
    };
    return () => {
      es.close();
      setConnected(false);
    };
  }, [isApp]);

  if (typeof window === 'undefined' || !isApp) return null;

  const latest = events[0];
  return (
    <div class="demo-activity-bar fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-subtle/95 backdrop-blur">
      {expanded && (
        <div
          role="log"
          aria-label="Recent activity"
          class="demo-activity-feed max-h-64 overflow-y-auto border-b border-border px-4 py-2"
        >
          {events.length === 0 ? (
            <p class="py-4 text-center text-xs text-muted">No activity yet.</p>
          ) : (
            <ul class="space-y-1.5">
              {events.map((e) => (
                <li key={e.id} class="flex items-baseline gap-2 text-[13px]">
                  <span class="text-foreground">{describeEvent(e)}</span>
                  <span class="ml-auto shrink-0 text-[11px] uppercase tracking-wide text-muted">
                    {e.projectSlug}
                  </span>
                  <time class="shrink-0 text-[11px] text-muted">
                    {new Date(e.at).toLocaleTimeString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button
        type="button"
        aria-label="Toggle activity feed"
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        class="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px]"
      >
        <span
          class={`h-2 w-2 shrink-0 rounded-full ${
            connected ? 'demo-activity-pulse bg-accent' : 'bg-muted'
          }`}
          aria-hidden
        />
        <span class="min-w-0 flex-1 truncate text-foreground">
          {latest ? describeEvent(latest) : 'Listening for activity…'}
        </span>
        <span class="shrink-0 rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] font-semibold text-muted">
          {events.length}
        </span>
        {expanded ? (
          <ChevronDown size={15} aria-hidden />
        ) : (
          <ChevronUp size={15} aria-hidden />
        )}
      </button>
    </div>
  );
}
ActivityBar.displayName = 'ActivityBar';
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm exec vitest run apps/site/src/components/demo/__tests__/ActivityBar.test.tsx`
Expected: PASS (all three tests green).

Note: the "expand" test queries `getByRole('button', { name: /activity/i })` which matches the `aria-label="Toggle activity feed"`. The latest-line test matches the rendered task title text.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add apps/site/src/components/demo/ActivityBar.tsx apps/site/src/components/demo/__tests__/ActivityBar.test.tsx
git commit -m "feat(demo): persistent ActivityBar component"
```

---

## Task 5: Wire-up — mount, publish on actions, CSS isolation

This task has no new unit tests (the builders are tested in Task 1; the publish wiring and CSS are integration/visual, verified by typecheck + site build + the manual run in the final verification). Its deliverable is the feature working end-to-end.

**Files:**
- Modify: `apps/site/src/pages/demo/demo-layout.tsx`
- Modify: `apps/site/src/pages/demo/project-board.server.ts`
- Modify: `apps/site/src/pages/demo/task.server.ts`
- Modify: `apps/site/src/pages/demo/projects-shell.tsx`
- Modify: `apps/site/src/styles/root.css`

**Interfaces:**
- Consumes: `Persist` from `hono-preact`; `ActivityBar` from `../../components/demo/ActivityBar.js`; `publishActivity`, `taskCreatedEvent`, `taskMovedEvent`, `commentAddedEvent` from `../../demo/activity-stream.js`; `getTask` from `../../demo/data.js`.

- [ ] **Step 1: Mount the bar in the demo layout**

Edit `apps/site/src/pages/demo/demo-layout.tsx`. Add imports at the top:

```ts
import { Persist } from 'hono-preact';
import { ActivityBar } from '../../components/demo/ActivityBar.js';
```

Change the `return` (currently `return <>{children}</>;`) to:

```tsx
  return (
    <>
      {children}
      {/* Persistent live-activity bar. No `viewTransitionName` on Persist: the
          bar is position:fixed, so its VT name lives on the bar element itself
          (the .demo-activity-bar class) to lift it out of the root snapshot. */}
      <Persist id="demo-activity-bar">
        <ActivityBar />
      </Persist>
    </>
  );
```

- [ ] **Step 2: Publish real events from the board actions**

Edit `apps/site/src/pages/demo/project-board.server.ts`.

Add `getTask` to the existing import from `../../demo/data.js` (it currently imports `getProjectBySlug, listTasksForProject, getUser, createTask, setTaskStatus, setTaskPriority, deleteTask`), and add a new import:

```ts
import {
  publishActivity,
  taskCreatedEvent,
  taskMovedEvent,
} from '../../demo/activity-stream.js';
```

In the `createTask` action, after `const created = createTask(...)` and before `return { id: created.id };`:

```ts
    publishActivity(taskCreatedEvent(created, user.name));
```

In the `patchTask` action, after the `if (input.status) setTaskStatus(...)` line and before `return { ok: true };`:

```ts
    if (input.status) {
      const task = getTask(input.taskId);
      if (task) {
        publishActivity(
          taskMovedEvent(task, input.status, user?.name ?? 'someone')
        );
      }
    }
```

(`user` is already resolved via `currentUser(ctx.c)` at the top of `patchTask`.)

- [ ] **Step 3: Publish real events from the task actions**

Edit `apps/site/src/pages/demo/task.server.ts`.

Add a new import (it already imports `getTask` from `../../demo/data.js`):

```ts
import {
  publishActivity,
  commentAddedEvent,
  taskMovedEvent,
} from '../../demo/activity-stream.js';
```

In the `addComment` action, after `const c = addComment(...)` and before `return { id: c.id };`:

```ts
      const task = getTask(input.taskId);
      if (task) publishActivity(commentAddedEvent(task, user.name));
```

In the `setStatus` action, after `setTaskStatus(input.taskId, input.status, ...)` and before `return { ok: true };`:

```ts
      const task = getTask(input.taskId);
      if (task) {
        publishActivity(
          taskMovedEvent(task, input.status, user?.name ?? 'someone')
        );
      }
```

- [ ] **Step 4: Reserve space so the bar never covers content**

Edit `apps/site/src/pages/demo/projects-shell.tsx`. The `Sidebar` component ends with `<main class="min-w-0">{children}</main>`. Add bottom padding so the collapsed bar (fixed at the viewport bottom) does not cover the last board row:

```tsx
      <main class="min-w-0 pb-14">{children}</main>
```

- [ ] **Step 5: Add view-transition isolation + keyframes**

Edit `apps/site/src/styles/root.css`. After the `.demo-sidebar` isolation block (ends ~line 612, before the `@keyframes slide-in-right` block), add:

```css
/* The demo activity bar is persistent, position:fixed UI. Give it its own
   transition name so it is lifted out of the root snapshot (otherwise the root
   slide/fade drags it on every navigation). The name lives on the fixed bar
   element itself, not the Persist wrapper, which would collapse to zero height
   and fail to capture an out-of-flow child. */
.demo-activity-bar {
  view-transition-name: demo-activity-bar;
}
/* Within the app (bar present in both snapshots) freeze it: only page content
   transitions. Scoped to demo-within only; on enter/leave the bar is in one
   snapshot and keeps the default fade. */
html:active-view-transition-type(demo-within)::view-transition-group(demo-activity-bar),
html:active-view-transition-type(demo-within)::view-transition-old(demo-activity-bar),
html:active-view-transition-type(demo-within)::view-transition-new(demo-activity-bar) {
  animation: none;
}

/* Live-connection pulse on the status dot (not a route transition). */
@keyframes demo-activity-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
.demo-activity-pulse {
  animation: demo-activity-pulse 1.6s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .demo-activity-pulse {
    animation: none;
  }
}
```

- [ ] **Step 6: Typecheck and build the site**

Run:
```bash
pnpm typecheck
pnpm --filter site build
```
Expected: both succeed. Typecheck confirms the `hono-preact` `Persist` import, the discriminated-union narrowing, and the server-action edits. The site build confirms `api.ts` is picked up without tripping the catch-all-shadowing check.

- [ ] **Step 7: Run the full app test suite (cross-file safety)**

Run: `pnpm exec vitest run apps/site/src`
Expected: PASS, including the unchanged demo tests (`data.test.ts`, etc.) and the three new test files.

- [ ] **Step 8: Format and commit**

```bash
pnpm format
git add apps/site/src/pages/demo/demo-layout.tsx apps/site/src/pages/demo/project-board.server.ts apps/site/src/pages/demo/task.server.ts apps/site/src/pages/demo/projects-shell.tsx apps/site/src/styles/root.css
git commit -m "feat(demo): mount persistent activity bar and publish real actions"
```

---

## Final verification (before declaring done)

Run the six CI steps in order from the worktree root (per project CLAUDE.md):

- [ ] **1. Framework build:** `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
- [ ] **2. Format:** `pnpm format:check` (if it fails, `pnpm format` then re-commit)
- [ ] **3. Typecheck:** `pnpm typecheck`
- [ ] **4. Unit + coverage:** `pnpm test:coverage`
- [ ] **5. Integration:** `pnpm test:integration`
- [ ] **6. Site build:** `pnpm --filter site build`
- [ ] **7. `git status`** — confirm nothing format-dirty was left uncommitted (recurring subagent trap).

Then a manual run (use the `run` or `verify` skill) to confirm the behaviors that unit tests can't:

- [ ] The page renders immediately; the bar fills in asynchronously (no blocking on first paint).
- [ ] The connection + accumulated feed survive board ↔ task ↔ project-list navigation (no reconnect/reset).
- [ ] During `demo-within` transitions the bar stays rock-steady (no slide/fade with the page content). Per project memory, MCP browsers cannot visually verify view transitions; confirm by reading the computed `view-transition-name` on the bar and by eye in a real browser.
- [ ] The bar disappears on `/docs` and reappears (reconnects, feed retained) on return to `/demo/projects`.
- [ ] Moving a task / adding a comment yourself echoes into the bar (same-isolate, local dev).

---

## Self-Review

**Spec coverage:**
- Hybrid data source (sim + real echo) -> Task 2 (sim), Task 1 builders + Task 5 publish (real), Task 3 race loop. ✓
- Bottom-docked + expand UI -> Task 4. ✓
- Global cross-project feed -> backfill + events carry `projectSlug`; bar does not filter by project. ✓
- EventSource transport -> Task 4. ✓
- `api.ts` SSE via `streamSSE`, auto-mounted -> Task 3 + Task 5 build check. ✓
- Persist mount in demo layout, no `viewTransitionName` prop -> Task 5 Step 1. ✓
- VT isolation (own name on fixed element + demo-within freeze) -> Task 5 Step 5. ✓
- Client-only / non-blocking / no hydration mismatch -> Task 4 (`null` on server, EventSource in effect). ✓
- `data.ts` gains only `listAllTasks`; publishing in action layer -> Task 1 Step 1 + Task 5 Steps 2-3. ✓
- Simulated events display-only -> Task 2 (asserted store-unchanged in test). ✓
- Tests: bus/backfill, sim invariants, component -> Tasks 1/2/4; plus an endpoint test (Task 3). ✓

**Refinement vs spec:** the spec said gate on `/demo`; the plan gates on `/demo/projects` (the authed app area), so the bar does not show on the `/demo` splash or `/demo/login`. This matches the spec's intent (the bar belongs to the task-board app) and aligns with the `demo-within` VT type, which only fires within `/demo/projects`. Bottom padding added via `projects-shell.tsx` (a sixth edited file beyond the spec's five) to reserve space under the fixed bar.

**Placeholder scan:** none. Every code step has complete code.

**Type consistency:** `ActivityEvent` discriminated union is defined once (Task 1) and consumed unchanged (Tasks 2/3/4). Builder names (`taskCreatedEvent`/`taskMovedEvent`/`commentAddedEvent`), `publishActivity`/`subscribeActivity`/`recentActivityEvents`/`__resetActivityForTesting`, and `listAllTasks` are used identically across tasks. `streamSSE` methods match the verified hono 4.12.14 surface.
