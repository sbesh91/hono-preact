# Demo Kanban Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/demo` issue tracker with a beautiful per-project kanban task board in a sidebar app shell that dogfoods Dialog, Select, Combobox, Menu/ContextMenu, Tooltip, layout-level loaders, optimistic actions, streaming loaders, and view transitions.

**Architecture:** A persistent sidebar layout (fed by a layout-level loader) lists projects + the current user. Each project route renders a board: a board loader returns the project's tasks, a pure `groupTasks()` splits them into status columns sorted by priority, and a single board-level `useOptimisticAction(patchTask)` drives both drag-and-drop and Menu/ContextMenu moves/priority changes. New tasks are created in a Dialog. Task detail stays a full-page route that the card morphs into via view transitions.

**Tech Stack:** `hono-preact` (iso framework), `hono-preact-ui` (Dialog/Select/Combobox/Menu/ContextMenu/Tooltip), Preact, Tailwind v4 over brand CSS tokens, `lucide-preact` icons, Vitest + `@testing-library/preact` (happy-dom), pointer-events drag (demo-only hook).

---

## Conventions for every task

- Test command (targeted): `pnpm exec vitest run <path>` from repo root.
- Commit only when a task's steps are green. Branch is `demo/kanban-redesign` (already created off `origin/main`). Never commit on `main`.
- After EACH task that creates/edits committed files, run `pnpm format` then `git status` before committing (the recurring format:check trap: per-task work that skips `pnpm format` leaves files format-dirty).
- No em-dashes in prose, code comments, or commit messages (project rule). Use commas/colons/parentheses.
- The demo is in-memory and resets on cold start; no persistence.

## File structure (created / modified)

Data + logic (`apps/site/src/demo/`):
- Modify `data.ts` — rename `Issue`→`Task`; add `status` (4 states), `priority`, `assigneeId`; new seed data; writes `createTask`, `setTaskStatus`, `setTaskPriority`, `deleteTask`, `addComment`; activity gains `task-moved`.
- Create `group-tasks.ts` — pure `groupTasks(tasks)` → ordered columns, priority-sorted.
- Modify `__tests__/data.test.ts`, create `__tests__/group-tasks.test.ts`.
- Modify `guard.ts` — unchanged session guard (only rename references if any).

Pages (`apps/site/src/pages/demo/`):
- Create `projects-shell.tsx` + `projects-shell.server.ts` — sidebar layout + layout loader.
- Rename `project-layout.tsx` → `project-header.tsx` — project top bar + New-task trigger.
- Create `project-board.tsx` + `project-board.server.ts` — board view + tasks loader + actions.
- Rename `issue.tsx`→`task.tsx`, `issue.server.ts`→`task.server.ts`, `issue-guards.ts`→`task-guards.ts`.
- Modify `projects.tsx` — in-shell "select a project" empty state.
- Modify `projects.server.ts` — fold into the shell loader (or delete if shell loader supersedes).
- Modify `login.tsx`, `index.tsx` — light restyle to match the shell.
- Update `__tests__/` for the renamed guard/actions.

Components (`apps/site/src/components/demo/`):
- Create `Board.tsx`, `Column.tsx`, `TaskCard.tsx`.
- Create `NewTaskDialog.tsx`, `TaskActions.tsx`, `pickers.tsx`.
- Modify `CommentList.tsx` (rename issue→task references).
- Delete `IssueRow.tsx`.

Hooks (`apps/site/src/hooks/`):
- Create `use-board-drag.ts` — pointer-events drag (demo-only) + pure `dropTargetFromPoint()`.
- Create `__tests__/use-board-drag.test.ts` (pure-logic only).

Routing + styles:
- Modify `routes.ts` — shell layout+server on `projects`, board + detail children, renamed task routes.
- Modify `styles/root.css` — priority badge tokens + utilities (three theme blocks).

---

## Phase 1 — Data model, sidebar shell, static board

### Task 1: Reshape the demo data model

**Files:**
- Modify: `apps/site/src/demo/data.ts`
- Test: `apps/site/src/demo/__tests__/data.test.ts`

- [ ] **Step 1: Write the failing tests** (replace the issue-centric tests; keep session-relevant helpers)

```ts
// apps/site/src/demo/__tests__/data.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetDemoData,
  listProjects,
  getProjectBySlug,
  listTasksForProject,
  getTask,
  createTask,
  setTaskStatus,
  setTaskPriority,
  deleteTask,
  addComment,
  listComments,
  upsertUser,
  activityForProject,
  type Task,
} from '../data.js';

beforeEach(() => resetDemoData());

describe('tasks', () => {
  it('seeds projects with tasks across statuses and priorities', () => {
    const inf = getProjectBySlug('inf')!;
    const tasks = listTasksForProject(inf.id);
    expect(tasks.length).toBeGreaterThanOrEqual(4);
    const statuses = new Set(tasks.map((t) => t.status));
    expect(statuses.has('backlog')).toBe(true);
    expect(statuses.has('done')).toBe(true);
    for (const t of tasks) {
      expect(['urgent', 'high', 'medium', 'low']).toContain(t.priority);
    }
  });

  it('createTask adds a task with the given status/priority/assignee', () => {
    const inf = getProjectBySlug('inf')!;
    const author = upsertUser('alice@example.com', 'Alice');
    const t = createTask(author, {
      projectId: inf.id,
      title: 'New work',
      body: 'details',
      priority: 'high',
      status: 'backlog',
      assigneeId: 'u-2',
    });
    expect(getTask(t.id)).toMatchObject({
      title: 'New work',
      priority: 'high',
      status: 'backlog',
      assigneeId: 'u-2',
      authorId: author.id,
    });
  });

  it('setTaskStatus and setTaskPriority mutate in place', () => {
    const inf = getProjectBySlug('inf')!;
    const first = listTasksForProject(inf.id)[0];
    setTaskStatus(first.id, 'done');
    setTaskPriority(first.id, 'urgent');
    expect(getTask(first.id)).toMatchObject({ status: 'done', priority: 'urgent' });
  });

  it('deleteTask removes the task and its comments', () => {
    const inf = getProjectBySlug('inf')!;
    const first = listTasksForProject(inf.id)[0];
    const author = upsertUser('alice@example.com', 'Alice');
    addComment(author, { taskId: first.id, body: 'hi' });
    deleteTask(first.id);
    expect(getTask(first.id)).toBeNull();
    expect(listComments(first.id)).toEqual([]);
  });

  it('activity includes task-moved when a task is closed to done', () => {
    const inf = getProjectBySlug('inf')!;
    const open = listTasksForProject(inf.id).find((t) => t.status !== 'done')!;
    setTaskStatus(open.id, 'done');
    const feed = activityForProject(inf.id, 20);
    expect(feed.some((a) => a.kind === 'task-moved')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run apps/site/src/demo/__tests__/data.test.ts`
Expected: FAIL (e.g. `listTasksForProject` / `createTask` signature mismatch, missing `task-moved`).

- [ ] **Step 3: Rewrite `data.ts`** (full file)

```ts
// apps/site/src/demo/data.ts
// In-memory demo store. Per-process, resets on cold start.
// No persistence; the demo is a feature showcase, not a saved tool.

export type User = { id: string; email: string; name: string };
export type Project = { id: string; slug: string; name: string };
export type TaskStatus = 'backlog' | 'in_progress' | 'in_review' | 'done';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type Task = {
  id: string;
  projectId: string;
  authorId: string;
  assigneeId: string | null;
  title: string;
  body: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: number;
};
export type Comment = {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: number;
};

type Store = {
  users: User[];
  projects: Project[];
  tasks: Task[];
  comments: Comment[];
  // status changes recorded for the activity feed (kept small, demo-only)
  moves: { taskId: string; to: TaskStatus; at: number; userId: string | null }[];
  nextId: number;
};

let store: Store = freshStore();

function freshStore(): Store {
  const users: User[] = [
    { id: 'u-1', email: 'alice@example.com', name: 'Alice' },
    { id: 'u-2', email: 'bob@example.com', name: 'Bob' },
  ];
  const projects: Project[] = [
    { id: 'p-1', slug: 'inf', name: 'Infrastructure' },
    { id: 'p-2', slug: 'api', name: 'API' },
    { id: 'p-3', slug: 'web', name: 'Web' },
  ];
  const T = Date.UTC(2026, 4, 1); // deterministic
  const HR = 3600_000;
  const mk = (
    id: string,
    projectId: string,
    authorId: string,
    assigneeId: string | null,
    title: string,
    body: string,
    status: TaskStatus,
    priority: TaskPriority,
    hours: number
  ): Task => ({
    id, projectId, authorId, assigneeId, title, body, status, priority,
    createdAt: T + hours * HR,
  });

  const tasks: Task[] = [
    // Infrastructure (p-1)
    mk('t-1', 'p-1', 'u-1', 'u-1', 'Worker times out under load', 'Repro: hammer /api/users with 200 RPS.', 'in_progress', 'urgent', 0),
    mk('t-2', 'p-1', 'u-2', 'u-1', 'Stream request bodies', 'Skip the full parse on hot paths.', 'in_progress', 'high', 1),
    mk('t-3', 'p-1', 'u-2', 'u-2', 'Cache key collides for guests', 'Anonymous sessions reuse a single key.', 'in_review', 'medium', 2),
    mk('t-4', 'p-1', 'u-1', null, 'Audit cold-start budget', 'Measure isolate spin-up cost.', 'backlog', 'low', 3),
    mk('t-5', 'p-1', 'u-1', 'u-1', 'Pin pnpm to 10.18.3', 'Dodge the peer-dep override bug.', 'done', 'medium', 4),
    // API (p-2)
    mk('t-6', 'p-2', 'u-1', 'u-2', 'Pagination cursor decodes wrong', 'Base64 padding mismatch.', 'done', 'high', 5),
    mk('t-7', 'p-2', 'u-2', 'u-2', 'Add rate-limit headers', 'Echo remaining budget.', 'backlog', 'high', 6),
    mk('t-8', 'p-2', 'u-1', null, 'Document error envelope', 'Spec the __outcome shape.', 'backlog', 'low', 7),
    mk('t-9', 'p-2', 'u-2', 'u-1', 'Retry queue on 5xx', 'Bounded backoff with jitter.', 'in_progress', 'urgent', 8),
    // Web (p-3)
    mk('t-10', 'p-3', 'u-1', 'u-1', 'Dark mode toggle flashes', 'SSR + client hydration mismatch.', 'in_progress', 'medium', 9),
    mk('t-11', 'p-3', 'u-2', 'u-2', 'Skeleton states for board', 'Match column shapes.', 'backlog', 'medium', 10),
    mk('t-12', 'p-3', 'u-1', 'u-1', 'Polish focus rings', 'AA contrast on all controls.', 'in_review', 'low', 11),
  ];

  // Keep two long threads on t-1 / t-3 so the streaming comments loader
  // has visibly staggered material.
  const MIN = 60_000;
  const thread = (
    taskId: string,
    base: number,
    lines: [string, string][] // [authorId, body]
  ): Comment[] =>
    lines.map(([authorId, body], i) => ({
      id: `c-${taskId}-${i + 1}`,
      taskId,
      authorId,
      body,
      createdAt: base + (i + 1) * 8 * MIN,
    }));

  const comments: Comment[] = [
    ...thread('t-1', T, [
      ['u-2', 'Looking at it.'],
      ['u-1', 'Got a repro? I can reach 180 RPS locally before it spikes.'],
      ['u-2', 'P99 spikes correlate with the body parse on /api/users.'],
      ['u-1', 'Profiler agrees. JSON.parse dominates past 150 RPS.'],
      ['u-2', 'Could we stream the body and skip the full parse?'],
      ['u-1', 'Worth a shot. Draft up: down to 84ms P99 at 200 RPS.'],
      ['u-2', 'Reviewing. Two questions on the back-pressure path.'],
      ['u-1', 'Answered inline. Good catch on the abort handling.'],
      ['u-2', 'LGTM. Merging.'],
      ['u-1', 'Holding 200 RPS for 30 min, P99 at 140ms. Calling it.'],
    ]),
    ...thread('t-3', T + 60 * MIN, [
      ['u-2', 'Looking at it.'],
      ['u-1', 'Got a profile?'],
      ['u-2', 'session-id falls back to a static literal for guests.'],
      ['u-1', 'So everyone shares one cache slot. Cute.'],
      ['u-2', 'Easiest fix: hash the IP into the key for guests.'],
      ['u-1', 'Hash-IP for now behind a flag, default off.'],
      ['u-2', 'Flag wired up. A/B over the next 24h.'],
      ['u-1', 'Numbers look good. Promoting default to on.'],
    ]),
  ];

  return { users, projects, tasks, comments, moves: [], nextId: 100 };
}

export function resetDemoData(): void {
  store = freshStore();
}

// ---- Reads ----
export const listProjects = (): Project[] => store.projects.slice();
export const getProjectBySlug = (slug: string): Project | null =>
  store.projects.find((p) => p.slug === slug) ?? null;
export const getProject = (id: string): Project | null =>
  store.projects.find((p) => p.id === id) ?? null;

export const listTasksForProject = (projectId: string): Task[] =>
  store.tasks
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => a.createdAt - b.createdAt);

export const getTask = (id: string): Task | null =>
  store.tasks.find((t) => t.id === id) ?? null;

export const listComments = (taskId: string): Comment[] =>
  store.comments
    .filter((c) => c.taskId === taskId)
    .sort((a, b) => a.createdAt - b.createdAt);

export const getUser = (id: string): User | null =>
  store.users.find((u) => u.id === id) ?? null;
export const findUserByEmail = (email: string): User | null =>
  store.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
export const upsertUser = (email: string, name: string): User => {
  const existing = findUserByEmail(email);
  if (existing) return existing;
  const created: User = { id: `u-${++store.nextId}`, email, name };
  store.users.push(created);
  return created;
};

// ---- Writes ----
export function createTask(
  author: User,
  input: {
    projectId: string;
    title: string;
    body: string;
    priority: TaskPriority;
    status: TaskStatus;
    assigneeId: string | null;
  }
): Task {
  const task: Task = {
    id: `t-${++store.nextId}`,
    projectId: input.projectId,
    authorId: author.id,
    assigneeId: input.assigneeId,
    title: input.title,
    body: input.body,
    status: input.status,
    priority: input.priority,
    createdAt: Date.now(),
  };
  store.tasks.push(task);
  return task;
}

export function setTaskStatus(
  taskId: string,
  status: TaskStatus,
  userId: string | null = null
): void {
  const task = store.tasks.find((t) => t.id === taskId);
  if (!task || task.status === status) return;
  task.status = status;
  store.moves.push({ taskId, to: status, at: Date.now(), userId });
}

export function setTaskPriority(taskId: string, priority: TaskPriority): void {
  const task = store.tasks.find((t) => t.id === taskId);
  if (task) task.priority = priority;
}

export function deleteTask(taskId: string): void {
  store.tasks = store.tasks.filter((t) => t.id !== taskId);
  store.comments = store.comments.filter((c) => c.taskId !== taskId);
  store.moves = store.moves.filter((m) => m.taskId !== taskId);
}

export function addComment(
  author: User,
  input: { taskId: string; body: string }
): Comment {
  const comment: Comment = {
    id: `c-${++store.nextId}`,
    taskId: input.taskId,
    authorId: author.id,
    body: input.body,
    createdAt: Date.now(),
  };
  store.comments.push(comment);
  return comment;
}

// ---- Activity (derived) ----
export type ActivityItem =
  | { kind: 'task-created'; at: number; task: Task; user: User | null }
  | { kind: 'task-moved'; at: number; task: Task; to: TaskStatus; user: User | null }
  | { kind: 'comment-added'; at: number; comment: Comment; task: Task; user: User | null };

export function activityForProject(projectId: string, limit = 20): ActivityItem[] {
  const items: ActivityItem[] = [];
  const tasks = store.tasks.filter((t) => t.projectId === projectId);
  const taskById = new Map(store.tasks.map((t) => [t.id, t] as const));
  for (const task of tasks) {
    items.push({ kind: 'task-created', at: task.createdAt, task, user: getUser(task.authorId) });
  }
  for (const m of store.moves) {
    const task = taskById.get(m.taskId);
    if (!task || task.projectId !== projectId) continue;
    items.push({ kind: 'task-moved', at: m.at, task, to: m.to, user: getUser(m.userId ?? '') });
  }
  for (const comment of store.comments) {
    const task = taskById.get(comment.taskId);
    if (!task || task.projectId !== projectId) continue;
    items.push({ kind: 'comment-added', at: comment.createdAt, comment, task, user: getUser(comment.authorId) });
  }
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run apps/site/src/demo/__tests__/data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/site/src/demo/data.ts apps/site/src/demo/__tests__/data.test.ts
git commit -m "feat(demo): reshape data model to kanban tasks (status, priority, assignee)"
```

### Task 2: Pure `groupTasks()` grouping + priority sort

**Files:**
- Create: `apps/site/src/demo/group-tasks.ts`
- Test: `apps/site/src/demo/__tests__/group-tasks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/site/src/demo/__tests__/group-tasks.test.ts
import { describe, it, expect } from 'vitest';
import { groupTasks, STATUS_COLUMNS } from '../group-tasks.js';
import type { Task } from '../data.js';

const t = (id: string, status: Task['status'], priority: Task['priority']): Task => ({
  id, projectId: 'p-1', authorId: 'u-1', assigneeId: null,
  title: id, body: '', status, priority, createdAt: 0,
});

describe('groupTasks', () => {
  it('returns the four status columns in fixed order', () => {
    const cols = groupTasks([]);
    expect(cols.map((c) => c.status)).toEqual(STATUS_COLUMNS.map((c) => c.status));
  });

  it('places tasks in their status column', () => {
    const cols = groupTasks([t('a', 'backlog', 'low'), t('b', 'done', 'low')]);
    const byStatus = Object.fromEntries(cols.map((c) => [c.status, c.tasks.map((x) => x.id)]));
    expect(byStatus['backlog']).toEqual(['a']);
    expect(byStatus['done']).toEqual(['b']);
  });

  it('sorts within a column by priority (urgent first)', () => {
    const cols = groupTasks([
      t('low', 'backlog', 'low'),
      t('urgent', 'backlog', 'urgent'),
      t('med', 'backlog', 'medium'),
      t('high', 'backlog', 'high'),
    ]);
    const backlog = cols.find((c) => c.status === 'backlog')!;
    expect(backlog.tasks.map((x) => x.id)).toEqual(['urgent', 'high', 'med', 'low']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run apps/site/src/demo/__tests__/group-tasks.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/site/src/demo/group-tasks.ts
import type { Task, TaskStatus, TaskPriority } from './data.js';

export const STATUS_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review', label: 'In Review' },
  { status: 'done', label: 'Done' },
];

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0, high: 1, medium: 2, low: 3,
};

export type Column = { status: TaskStatus; label: string; tasks: Task[] };

export function groupTasks(tasks: Task[]): Column[] {
  return STATUS_COLUMNS.map(({ status, label }) => ({
    status,
    label,
    tasks: tasks
      .filter((t) => t.status === status)
      .sort(
        (a, b) =>
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          a.createdAt - b.createdAt
      ),
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run apps/site/src/demo/__tests__/group-tasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/site/src/demo/group-tasks.ts apps/site/src/demo/__tests__/group-tasks.test.ts
git commit -m "feat(demo): add pure groupTasks column/priority sort"
```

### Task 3: Rename guard to `assertCanMoveToDone`

**Files:**
- Rename: `apps/site/src/pages/demo/issue-guards.ts` → `apps/site/src/pages/demo/task-guards.ts`
- Test: `apps/site/src/pages/demo/__tests__/` (mirror the existing issue-guards test name → `task-guards.test.ts`)

- [ ] **Step 1: Read the existing guard + test** to preserve behavior.

Run: `git show HEAD:apps/site/src/pages/demo/issue-guards.ts` and read `apps/site/src/pages/demo/__tests__/` for the existing guard test. The guard throws a `deny`-style error when a non-author tries the protected transition.

- [ ] **Step 2: Write the failing test** (`task-guards.test.ts`)

```ts
// apps/site/src/pages/demo/__tests__/task-guards.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoData, getTask, listTasksForProject, getProjectBySlug } from '../../../demo/data.js';
import { assertCanMoveToDone } from '../task-guards.js';

beforeEach(() => resetDemoData());

describe('assertCanMoveToDone', () => {
  it('allows the author', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id).find((t) => t.status !== 'done')!;
    await expect(assertCanMoveToDone(task.id, task.authorId)).resolves.toBeUndefined();
  });

  it('rejects a non-author non-assignee', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id).find(
      (t) => t.assigneeId === null && t.status !== 'done'
    )!;
    await expect(assertCanMoveToDone(task.id, 'u-999')).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm exec vitest run apps/site/src/pages/demo/__tests__/task-guards.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement** `task-guards.ts` (mirror the old guard's deny mechanism; read the old file for the exact error helper it used, e.g. an action `deny()` or `Error`)

```ts
// apps/site/src/pages/demo/task-guards.ts
import { getTask } from '../../demo/data.js';

// Only the author or the assignee may move a task to Done.
// Throw the same way the old issue-guard did (read git history for the helper;
// if it threw a plain Error, keep that; if it used an action deny helper, reuse it).
export async function assertCanMoveToDone(
  taskId: string,
  userId: string | undefined
): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw new Error('task not found');
  if (!userId || (userId !== task.authorId && userId !== task.assigneeId)) {
    throw new Error('Only the author or assignee can move a task to Done.');
  }
}
```

- [ ] **Step 5: Run to verify it passes**, then delete the old file.

Run: `pnpm exec vitest run apps/site/src/pages/demo/__tests__/task-guards.test.ts`
Expected: PASS.
Then: `git rm apps/site/src/pages/demo/issue-guards.ts` and remove the old guard test if it still references issues.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add -A apps/site/src/pages/demo/task-guards.ts apps/site/src/pages/demo/__tests__/
git commit -m "feat(demo): rename guard to assertCanMoveToDone"
```

### Task 4: Priority badge CSS tokens + utilities

**Files:**
- Modify: `apps/site/src/styles/root.css`

No unit test (CSS). `format:check` does not cover `.css`; review manually and verify the site builds.

- [ ] **Step 1: Add four `@utility` rules** next to the existing `badge-success` / `badge-neutral` block.

```css
@utility badge-urgent {
  background-color: var(--badge-urgent-surface);
  color: var(--badge-urgent-foreground);
}
@utility badge-high {
  background-color: var(--badge-high-surface);
  color: var(--badge-high-foreground);
}
@utility badge-medium {
  background-color: var(--badge-medium-surface);
  color: var(--badge-medium-foreground);
}
@utility badge-low {
  background-color: var(--badge-low-surface);
  color: var(--badge-low-foreground);
}
```

- [ ] **Step 2: Add the token pairs to ALL THREE theme blocks.** Light tokens go in `:root`; dark tokens go in BOTH `@media (prefers-color-scheme: dark) { :root:not([data-theme]) }` and `:root[data-theme='dark']` (mirroring `badge-success`). Each pair must hit WCAG AA (>= 4.5:1).

Light (`:root`):
```css
  --badge-urgent-surface: #fde8e8;  /* red-100 */
  --badge-urgent-foreground: #b91c1c; /* red-700: 5.9:1 */
  --badge-high-surface: #ffedd5;   /* orange-100 */
  --badge-high-foreground: #c2410c; /* orange-700: 4.7:1 */
  --badge-medium-surface: #fef3c7; /* amber-100 */
  --badge-medium-foreground: #b45309; /* amber-700: 4.6:1 */
  --badge-low-surface: #d1fae5;    /* emerald-100 */
  --badge-low-foreground: #047857; /* emerald-700: 4.7:1 */
```

Dark (both dark blocks, identical values):
```css
  --badge-urgent-surface: #450a0a;  /* red-950 */
  --badge-urgent-foreground: #fecaca; /* red-200 */
  --badge-high-surface: #431407;   /* orange-950 */
  --badge-high-foreground: #fed7aa; /* orange-200 */
  --badge-medium-surface: #451a03; /* amber-950 */
  --badge-medium-foreground: #fde68a; /* amber-200 */
  --badge-low-surface: #022c22;    /* emerald-950 */
  --badge-low-foreground: #a7f3d0; /* emerald-200 */
```

- [ ] **Step 3: Add a `--priority-dot-*` solid color for stripes/dots** (used by cards) to the same three blocks. Light: urgent `#dc2626`, high `#ea580c`, medium `#d97706`, low `#0d9488`. Dark: bump each one stop brighter (urgent `#f87171`, high `#fb923c`, medium `#fbbf24`, low `#2dd4bf`). Map them under `@theme inline` as `--color-priority-urgent` etc. so Tailwind utilities can reference them.

- [ ] **Step 4: Verify the site still builds.**

Run: `pnpm --filter site build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/styles/root.css
git commit -m "feat(demo): add priority badge tokens + utilities (light + dark, AA)"
```

### Task 5: Sidebar shell layout + layout-level loader

**Files:**
- Create: `apps/site/src/pages/demo/projects-shell.server.ts`
- Create: `apps/site/src/pages/demo/projects-shell.tsx`

- [ ] **Step 1: Write the shell loader** (returns user + projects with counts)

```ts
// apps/site/src/pages/demo/projects-shell.server.ts
import { defineLoader, type LoaderCtx } from 'hono-preact';
import { listProjects, listTasksForProject, type Project, type User } from '../../demo/data.js';
import { currentUser } from '../../demo/session.js';

export type ShellData = {
  user: User | null;
  projects: (Project & { taskCount: number })[];
};

const shellLoader = async (ctx: LoaderCtx): Promise<ShellData> => {
  const user = await currentUser(ctx.c);
  const projects = listProjects().map((p) => ({
    ...p,
    taskCount: listTasksForProject(p.id).length,
  }));
  return { user, projects };
};

export const serverLoaders = {
  default: defineLoader(shellLoader),
};
```

- [ ] **Step 2: Write the shell layout component** (consumes the loader via `.View()`, renders sidebar + `children`)

```tsx
// apps/site/src/pages/demo/projects-shell.tsx
import type { LayoutProps } from 'hono-preact';
import { buildPath, useAction, useNavigate, useParams } from 'hono-preact';
import { useEffect } from 'preact/hooks';
import { serverLoaders } from './projects-shell.server.js';
import { serverActions as loginActions } from './login.server.js';
import { DEMO_AUTHED_KEY } from '../../demo/guard.js';
import type { ShellData } from './projects-shell.server.js';

const shellLoader = serverLoaders.default;

function Sidebar({ data, children }: { data: ShellData; children: LayoutProps['children'] }) {
  const navigate = useNavigate();
  // active project slug (undefined on the /demo/projects index)
  const params = useParams('/demo/projects/:projectId', { optional: true });
  const activeSlug = params?.projectId;

  // self-heal client-guard flag from any authed render
  useEffect(() => {
    if (!data.user) return;
    try { window.localStorage.setItem(DEMO_AUTHED_KEY, '1'); } catch { /* ignore */ }
  }, [data.user]);

  const logout = useAction(loginActions.logout, {
    onSuccess: () => {
      try { window.localStorage.removeItem(DEMO_AUTHED_KEY); } catch { /* ignore */ }
      navigate('/demo/login', { replace: true });
    },
  });

  return (
    <div class="grid min-h-screen grid-cols-[208px_1fr] bg-background text-foreground">
      <aside class="flex flex-col border-r border-border bg-surface-subtle p-3">
        <a href="/demo/projects" class="mb-4 flex items-center gap-2 px-1.5 py-1">
          <span class="h-6 w-6 rounded-md bg-gradient-to-br from-magenta-500 to-brand-orange" />
          <span class="font-bold tracking-tight">Tasks</span>
        </a>
        <p class="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Projects</p>
        <nav class="flex flex-col gap-0.5">
          {data.projects.map((p) => {
            const active = p.slug === activeSlug;
            return (
              <a
                key={p.id}
                href={buildPath('/demo/projects/:projectId', { projectId: p.slug })}
                class={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium ${
                  active ? 'bg-accent/10 text-accent' : 'text-foreground hover:bg-foreground/5'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <span class="h-2 w-2 rounded-[3px] bg-accent" />
                {p.name}
                <span class="ml-auto text-[11px] text-muted">{p.taskCount}</span>
              </a>
            );
          })}
        </nav>
        <div class="flex-1" />
        {data.user && (
          <div class="mt-2 flex items-center gap-2 border-t border-border p-2">
            <span class="grid h-6 w-6 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">
              {data.user.name.charAt(0).toUpperCase()}
            </span>
            <span class="text-[12.5px] font-semibold">{data.user.name}</span>
            <button
              type="button"
              class="ml-auto text-[11px] text-muted underline"
              onClick={() => logout.mutate({})}
              disabled={logout.pending}
            >
              {logout.pending ? '...' : 'log out'}
            </button>
          </div>
        )}
      </aside>
      <main class="min-w-0">{children}</main>
    </div>
  );
}

const ShellView = shellLoader.View<{ children: LayoutProps['children'] }>(
  ({ data, children }) => <Sidebar data={data} children={children} />,
  { fallback: <div class="p-6 text-muted">Loading…</div> }
);

export default function ProjectsShell({ children }: LayoutProps) {
  return <ShellView children={children} />;
}
```

- [ ] **Step 3: Verify `useParams` supports an optional read.** Check `packages/iso` for the `useParams` signature; if it does NOT accept `{ optional: true }`, derive the active slug from `useLocation()`/the router path instead (read `apps/site/src/pages/demo/project-layout.tsx` for how params are read today and adjust). Update the code to the real API.

- [ ] **Step 4: Verify the `.View()` generic accepts extra props.** Confirm against the layout-loader docs (`packages/iso/src/pages/docs/loaders.mdx` layout section) that `loader.View<ExtraProps>(({ data, ...extra }) => ...)` passes through props supplied at the call site (`<ShellView children={children} />`). If the View render prop does NOT forward arbitrary props, instead read `shellLoader.useData()` inside a child component rendered within the layout. Adjust to the real API.

- [ ] **Step 5: Typecheck.**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`
Expected: passes (routes not wired yet; this is a standalone module compile check via typecheck).

- [ ] **Step 6: Commit**

```bash
pnpm format
git add apps/site/src/pages/demo/projects-shell.tsx apps/site/src/pages/demo/projects-shell.server.ts
git commit -m "feat(demo): sidebar shell layout fed by a layout-level loader"
```

### Task 6: Board view, board loader, project header, board components (static, no DnD)

**Files:**
- Create: `apps/site/src/pages/demo/project-board.server.ts`
- Create: `apps/site/src/pages/demo/project-board.tsx`
- Rename/rewrite: `apps/site/src/pages/demo/project-layout.tsx` → `project-header.tsx`
- Create: `apps/site/src/components/demo/Board.tsx`, `Column.tsx`, `TaskCard.tsx`

- [ ] **Step 1: Board loader + actions** (`project-board.server.ts`)

```ts
// apps/site/src/pages/demo/project-board.server.ts
import { defineAction, serverRoute } from 'hono-preact';
import {
  getProjectBySlug, listTasksForProject, getUser, createTask, setTaskStatus,
  setTaskPriority, deleteTask, type Task, type Project, type User,
  type TaskStatus, type TaskPriority,
} from '../../demo/data.js';
import { currentUser } from '../../demo/session.js';
import { assertCanMoveToDone } from './task-guards.js';

const route = serverRoute('/demo/projects/:projectId');

export type BoardData = {
  project: Project;
  users: User[];
  tasks: Task[];
} | null;

export const serverLoaders = {
  default: route.loader(async ({ location }): Promise<BoardData> => {
    const slug = location.pathParams.projectId;
    if (!slug) return null;
    const project = getProjectBySlug(slug);
    if (!project) return null;
    return {
      project,
      users: [getUser('u-1'), getUser('u-2')].filter(Boolean) as User[],
      tasks: listTasksForProject(project.id),
    };
  }),
};

export const serverActions = {
  createTask: defineAction<
    { projectId: string; title: string; body: string; priority: TaskPriority; status: TaskStatus; assigneeId: string | null },
    { id: string }
  >(async (ctx, input) => {
    const user = await currentUser(ctx.c);
    if (!user) throw new Error('not signed in');
    const created = createTask(user, {
      projectId: input.projectId,
      title: input.title.trim(),
      body: input.body.trim(),
      priority: input.priority,
      status: input.status,
      assigneeId: input.assigneeId,
    });
    return { id: created.id };
  }),

  // One action drives both moves and priority changes so a single
  // useOptimisticAction can cover drag + menu interactions.
  patchTask: defineAction<
    { taskId: string; status?: TaskStatus; priority?: TaskPriority },
    { ok: true }
  >(async (ctx, input) => {
    const user = await currentUser(ctx.c);
    if (input.status === 'done') {
      await assertCanMoveToDone(input.taskId, user?.id);
    }
    if (input.status) setTaskStatus(input.taskId, input.status, user?.id ?? null);
    if (input.priority) setTaskPriority(input.taskId, input.priority);
    return { ok: true };
  }),

  deleteTask: defineAction<{ taskId: string }, { ok: true }>(async (_ctx, input) => {
    deleteTask(input.taskId);
    return { ok: true };
  }),
};
```

- [ ] **Step 2: Project header layout** (`project-header.tsx`, replaces `project-layout.tsx`)

```tsx
// apps/site/src/pages/demo/project-header.tsx
import type { LayoutProps } from 'hono-preact';
import { useParams, useViewTransitionLifecycle } from 'hono-preact';
import { useTitle } from 'hoofd/preact';

export default function ProjectHeader({ children }: LayoutProps) {
  const { projectId: slug } = useParams('/demo/projects/:projectId');
  useTitle(`${slug.toUpperCase()} · demo`);
  useViewTransitionLifecycle({
    onAfterSwap: () => { if (typeof window !== 'undefined') window.scrollTo(0, 0); },
  });
  return <div class="flex h-screen flex-col">{children}</div>;
}
```

(The project title + New-task trigger live in the board view itself, Task 9, since the board owns the create action. The header layout only persists the scroll/VT behavior across board <-> detail.)

- [ ] **Step 3: `TaskCard.tsx`** (presentational; drag + menu wired in later phases)

```tsx
// apps/site/src/components/demo/TaskCard.tsx
import { usePrefetch, ViewTransitionName } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import type { Task, User } from '../../demo/data.js';
import { serverLoaders as taskLoaders } from '../../pages/demo/task.server.js';

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low',
};

type Props = { task: Task; projectSlug: string; assignee: User | null };

const TaskCard: FunctionComponent<Props> = ({ task, projectSlug, assignee }) => {
  const href = `/demo/projects/${projectSlug}/tasks/${task.id}`;
  const prefetch = usePrefetch(href, taskLoaders.task);
  const done = task.status === 'done';

  return (
    <ViewTransitionName
      name={`task-card-${task.id}`}
      groupClass="task-card"
      render={
        <a
          href={href}
          onMouseEnter={prefetch}
          onFocus={prefetch}
          class="relative block rounded-lg border border-border bg-background p-2.5 pl-3 shadow-[0_1px_1px_rgba(37,40,42,.04)] hover:border-accent/40"
        />
      }
    >
      <span
        class="absolute inset-y-0 left-0 w-[3px] rounded-l-lg"
        style={{ background: `var(--color-priority-${task.priority})` }}
        aria-hidden
      />
      <ViewTransitionName name={`task-title-${task.id}`} groupClass="task-card" render={<p class="mb-2 pr-4 text-[12.5px] font-medium" />}>
        <span class={done ? 'line-through decoration-border' : ''}>{task.title}</span>
      </ViewTransitionName>
      <div class="flex items-center gap-1.5">
        <span class={`rounded-full px-1.5 py-px text-[10px] font-bold badge-${task.priority}`}>
          {PRIORITY_LABEL[task.priority]}
        </span>
        {assignee && (
          <span class="ml-auto grid h-[19px] w-[19px] place-items-center rounded-full bg-accent text-[9.5px] font-bold text-accent-foreground">
            {assignee.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
    </ViewTransitionName>
  );
};
TaskCard.displayName = 'TaskCard';
export default TaskCard;
```

- [ ] **Step 4: `Column.tsx`**

```tsx
// apps/site/src/components/demo/Column.tsx
import type { FunctionComponent } from 'preact';
import type { Column as ColumnModel } from '../../demo/group-tasks.js';
import type { User } from '../../demo/data.js';
import TaskCard from './TaskCard.js';

const DOT: Record<string, string> = {
  backlog: '#94a3b8', in_progress: 'var(--accent)', in_review: '#7c3aed', done: '#16a34a',
};

type Props = { column: ColumnModel; projectSlug: string; userById: Map<string, User> };

const Column: FunctionComponent<Props> = ({ column, projectSlug, userById }) => (
  <div class="rounded-xl bg-surface-subtle p-2.5">
    <div class="mb-2.5 flex items-center gap-2 text-[12.5px] font-semibold">
      <span class="h-2 w-2 rounded-full" style={{ background: DOT[column.status] }} aria-hidden />
      {column.label}
      <span class="ml-auto rounded-full border border-border bg-background px-1.5 text-[11px] font-semibold text-muted">
        {column.tasks.length}
      </span>
    </div>
    <div class="flex flex-col gap-2">
      {column.tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          projectSlug={projectSlug}
          assignee={task.assigneeId ? userById.get(task.assigneeId) ?? null : null}
        />
      ))}
    </div>
  </div>
);
Column.displayName = 'Column';
export default Column;
```

- [ ] **Step 5: `Board.tsx`**

```tsx
// apps/site/src/components/demo/Board.tsx
import type { FunctionComponent } from 'preact';
import { groupTasks } from '../../demo/group-tasks.js';
import type { Task, User } from '../../demo/data.js';
import Column from './Column.js';

type Props = { tasks: Task[]; projectSlug: string; users: User[] };

const Board: FunctionComponent<Props> = ({ tasks, projectSlug, users }) => {
  const columns = groupTasks(tasks);
  const userById = new Map(users.map((u) => [u.id, u] as const));
  return (
    <div class="grid grid-cols-4 gap-3 overflow-x-auto p-4">
      {columns.map((column) => (
        <Column key={column.status} column={column} projectSlug={projectSlug} userById={userById} />
      ))}
    </div>
  );
};
Board.displayName = 'Board';
export default Board;
```

- [ ] **Step 6: `project-board.tsx`** (board page; New-task button is a placeholder until Task 9)

```tsx
// apps/site/src/pages/demo/project-board.tsx
import { definePage } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders } from './project-board.server.js';
import Board from '../../components/demo/Board.js';

const boardLoader = serverLoaders.default;

const ProjectBoardPage: FunctionComponent = () => {
  const data = boardLoader.useData();
  if (!data) return <p class="p-6">Unknown project.</p>;
  const { project, tasks, users } = data;
  return (
    <>
      <div class="flex items-center gap-3 border-b border-border px-4 py-3.5">
        <h1 class="text-[17px] font-bold">{project.name}</h1>
        <span class="text-[12px] text-muted">{tasks.length} tasks</span>
        {/* New-task trigger added in Task 9 */}
      </div>
      <Board tasks={tasks} projectSlug={project.slug} users={users} />
    </>
  );
};
ProjectBoardPage.displayName = 'ProjectBoardPage';

const ProjectBoardView = boardLoader.View(() => <ProjectBoardPage />, {
  fallback: <BoardSkeleton />,
});

function BoardSkeleton() {
  return (
    <div class="grid grid-cols-4 gap-3 p-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} class="h-40 animate-pulse rounded-xl bg-surface-subtle" />
      ))}
    </div>
  );
}

export default definePage(ProjectBoardView);
```

- [ ] **Step 7: Typecheck** (will still fail on `task.server.js` import until Task 14 renames it; create a temporary re-export OR do Task 14's rename first if the engineer prefers). To keep this task self-contained, FIRST do the mechanical rename of `issue.server.ts`→`task.server.ts` and `issue.tsx`→`task.tsx` exports referenced here (full content lands in Task 14); a thin rename now unblocks typecheck.

Run: `pnpm typecheck`
Expected: passes once `task.server.ts` exists with `serverLoaders.task`.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add apps/site/src/pages/demo/project-board.server.ts apps/site/src/pages/demo/project-board.tsx apps/site/src/pages/demo/project-header.tsx apps/site/src/components/demo/Board.tsx apps/site/src/components/demo/Column.tsx apps/site/src/components/demo/TaskCard.tsx
git commit -m "feat(demo): static board view (loader, columns, cards) + project header"
```

### Task 7: Wire routes + empty state + delete IssueRow

**Files:**
- Modify: `apps/site/src/routes.ts`
- Modify: `apps/site/src/pages/demo/projects.tsx`
- Delete: `apps/site/src/components/demo/IssueRow.tsx`

- [ ] **Step 1: Update `routes.ts`** demo subtree to:

```ts
  {
    path: '/demo',
    layout: () => import('./pages/demo/demo-layout.js'),
    children: [
      { path: '', view: () => import('./pages/demo/index.js') },
      {
        path: 'login',
        view: () => import('./pages/demo/login.js'),
        server: () => import('./pages/demo/login.server.js'),
      },
      {
        path: 'projects',
        layout: () => import('./pages/demo/projects-shell.js'),
        server: () => import('./pages/demo/projects-shell.server.js'),
        use: requireSession,
        children: [
          { path: '', view: () => import('./pages/demo/projects.js') },
          {
            path: ':projectId',
            layout: () => import('./pages/demo/project-header.js'),
            children: [
              {
                path: '',
                view: () => import('./pages/demo/project-board.js'),
                server: () => import('./pages/demo/project-board.server.js'),
              },
              {
                path: 'tasks/:taskId',
                view: () => import('./pages/demo/task.js'),
                server: () => import('./pages/demo/task.server.js'),
              },
            ],
          },
        ],
      },
    ],
  },
```

- [ ] **Step 2: Rewrite `projects.tsx`** as the in-shell empty state (no own loader; the shell already loaded projects)

```tsx
// apps/site/src/pages/demo/projects.tsx
import { definePage } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useTitle } from 'hoofd/preact';

const ProjectsIndex: FunctionComponent = () => {
  useTitle('Projects · demo');
  return (
    <div class="grid h-screen place-items-center p-6 text-center">
      <div>
        <h1 class="text-xl font-semibold">Select a project</h1>
        <p class="mt-1 text-sm text-muted">Pick a project from the sidebar to open its board.</p>
      </div>
    </div>
  );
};
ProjectsIndex.displayName = 'ProjectsIndex';
export default definePage(ProjectsIndex, {});
```

- [ ] **Step 3: Delete `IssueRow.tsx` and `projects.server.ts`** (the shell loader supersedes the old projects loader).

```bash
git rm apps/site/src/components/demo/IssueRow.tsx apps/site/src/pages/demo/projects.server.ts
```

Confirm nothing else imports them: `rg "IssueRow|projects.server" apps/site/src`.

- [ ] **Step 4: Verify `useParams('/demo/projects/:projectId')` still type-resolves** for the new tree, and that the registered route paths in the `declare module` block still come from `routeTree` (no change needed unless the path strings changed; `tasks/:taskId` replaces `issues/:issueId`).

- [ ] **Step 5: Typecheck + run the app.**

Run: `pnpm typecheck` then `pnpm --filter site dev` and click: login → sidebar shows projects → click a project → board renders columns with cards. (Task detail link will 404 until Task 14; that is expected here.)
Expected: board renders; sidebar active state highlights the chosen project.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add -A apps/site/src/routes.ts apps/site/src/pages/demo/projects.tsx
git commit -m "feat(demo): wire shell + board routes; projects index becomes empty state"
```

---

## Phase 2 — New-task Dialog + pickers

### Task 8: Picker components (Select x2, Combobox x1)

**Files:**
- Create: `apps/site/src/components/demo/pickers.tsx`

- [ ] **Step 1: Implement the three controlled pickers** using the real `hono-preact-ui` APIs.

```tsx
// apps/site/src/components/demo/pickers.tsx
import { Select, Combobox, matchSubstring } from 'hono-preact-ui';
import type { TaskStatus, TaskPriority, User } from '../../demo/data.js';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
];
const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const triggerCls =
  'flex w-full items-center rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px]';
const popupCls =
  'z-50 min-w-[10rem] rounded-lg border border-border bg-background p-1 shadow-lg';
const optionCls =
  'cursor-pointer rounded-md px-2 py-1.5 text-[12.5px] data-[highlighted]:bg-accent/10';

export function StatusSelect({ value, onChange }: { value: TaskStatus; onChange: (v: TaskStatus) => void }) {
  return (
    <Select.Root value={value} onValueChange={(v) => onChange((Array.isArray(v) ? v[0] : v) as TaskStatus)}>
      <Select.Trigger class={triggerCls}>
        <Select.Value />
        <span class="ml-auto text-muted" aria-hidden>▾</span>
      </Select.Trigger>
      <Select.Positioner>
        <Select.Popup class={popupCls} aria-label="Status">
          {STATUS_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value} class={optionCls}>{o.label}</Select.Option>
          ))}
        </Select.Popup>
      </Select.Positioner>
    </Select.Root>
  );
}

export function PrioritySelect({ value, onChange }: { value: TaskPriority; onChange: (v: TaskPriority) => void }) {
  return (
    <Select.Root value={value} onValueChange={(v) => onChange((Array.isArray(v) ? v[0] : v) as TaskPriority)}>
      <Select.Trigger class={triggerCls}>
        <span class="mr-1.5 h-2 w-2 rounded-full" style={{ background: `var(--color-priority-${value})` }} aria-hidden />
        <Select.Value />
        <span class="ml-auto text-muted" aria-hidden>▾</span>
      </Select.Trigger>
      <Select.Positioner>
        <Select.Popup class={popupCls} aria-label="Priority">
          {PRIORITY_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value} class={optionCls}>{o.label}</Select.Option>
          ))}
        </Select.Popup>
      </Select.Positioner>
    </Select.Root>
  );
}

// Assignee picker dogfoods Combobox with consumer-side filtering.
export function AssigneeCombobox({
  users, value, onChange,
}: {
  users: User[];
  value: string | null; // user id or null (unassigned)
  onChange: (id: string | null) => void;
}) {
  const options = [{ id: '', name: 'Unassigned' }, ...users.map((u) => ({ id: u.id, name: u.name }))];
  const selected = options.find((o) => o.id === (value ?? '')) ?? options[0];
  // inputValue is the typed query; consumer filters.
  return (
    <Combobox.Root
      value={value ?? ''}
      onValueChange={(v) => onChange(((Array.isArray(v) ? v[0] : v) as string) || null)}
      defaultInputValue={selected.name}
      itemToString={(id) => options.find((o) => o.id === id)?.name ?? ''}
    >
      <Combobox.Input class={triggerCls} aria-label="Assignee" placeholder="Search assignee…" />
      <Combobox.Status />
      <Combobox.Positioner>
        <Combobox.Popup class={popupCls} aria-label="Assignee">
          <Filtered options={options} optionCls={optionCls} />
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

// Combobox does not filter; read inputValue and render only matches.
function Filtered({ options, optionCls }: { options: { id: string; name: string }[]; optionCls: string }) {
  // Combobox exposes the typed query via context; if the library provides a
  // hook (e.g. useComboboxInputValue), use it. Otherwise lift inputValue into
  // AssigneeCombobox state via onInputChange and pass it down as a prop.
  return (
    <>
      {options.map((o) => (
        <Combobox.Option key={o.id} value={o.id} class={optionCls}>{o.name}</Combobox.Option>
      ))}
      <Combobox.Empty class="px-2 py-1.5 text-[12.5px] text-muted">No match</Combobox.Empty>
    </>
  );
}
```

- [ ] **Step 2: Resolve the Combobox filtering wiring.** Check `apps/site/src/components/docs/ComboboxCreatableDemo.tsx` for the exact pattern: it lifts `inputValue` into local state via `onInputChange` and filters the options array with `matchSubstring(option, query)` before mapping `<Combobox.Option>`. Refactor `AssigneeCombobox` to hold `const [query, setQuery] = useState(selected.name)`, pass `inputValue={query} onInputChange={setQuery}`, and render `options.filter((o) => matchSubstring(o.name, query)).map(...)`. Remove the `Filtered` placeholder. Use `matchSubstring` (already imported).

- [ ] **Step 3: Typecheck.**

Run: `pnpm typecheck`
Expected: passes. (Popup behavior is verified manually in Task 9; happy-dom cannot drive the Popover API.)

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/site/src/components/demo/pickers.tsx
git commit -m "feat(demo): Status/Priority Select + Assignee Combobox pickers"
```

### Task 9: New-task Dialog wired to createTask

**Files:**
- Create: `apps/site/src/components/demo/NewTaskDialog.tsx`
- Modify: `apps/site/src/pages/demo/project-board.tsx` (add trigger + render dialog)

- [ ] **Step 1: Implement `NewTaskDialog.tsx`** (controlled open; Dialog + Form + pickers; closes + invalidates board on success)

```tsx
// apps/site/src/components/demo/NewTaskDialog.tsx
import { Dialog } from 'hono-preact-ui';
import { Form, useFormStatus } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { serverActions, serverLoaders } from '../../pages/demo/project-board.server.js';
import { PrioritySelect, StatusSelect, AssigneeCombobox } from './pickers.js';
import type { TaskStatus, TaskPriority, User } from '../../demo/data.js';

type Props = { projectId: string; users: User[] };

const NewTaskDialog: FunctionComponent<Props> = ({ projectId, users }) => {
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('backlog');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const { pending } = useFormStatus(serverActions.createTask);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger class="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-foreground hover:bg-accent-hover">
        + New task
      </Dialog.Trigger>
      <Dialog.Popup class="m-auto w-[380px] rounded-2xl border border-border bg-background p-5 shadow-2xl backdrop:bg-foreground/40">
        <Dialog.Title class="text-base font-bold">New task</Dialog.Title>
        <Dialog.Description class="mb-3.5 text-[12px] text-muted">
          Adds to this project.
        </Dialog.Description>
        <Form
          action={serverActions.createTask}
          invalidate={[serverLoaders.default]}
          onSuccess={() => setOpen(false)}
          class="space-y-2.5"
        >
          <input type="hidden" name="projectId" value={projectId} />
          {/* pickers are controlled; mirror their values into hidden inputs so
              the Form payload carries them */}
          <input type="hidden" name="priority" value={priority} />
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="assigneeId" value={assigneeId ?? ''} />

          <label class="block">
            <span class="mb-1 block text-[11px] font-semibold">Title</span>
            <input name="title" required placeholder="Short summary"
              class="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px]" />
          </label>
          <label class="block">
            <span class="mb-1 block text-[11px] font-semibold">Description</span>
            <textarea name="body" rows={3} placeholder="What's happening, and why it matters…"
              class="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px]" />
          </label>
          <div class="grid grid-cols-2 gap-2.5">
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold">Priority</span>
              <PrioritySelect value={priority} onChange={setPriority} />
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold">Status</span>
              <StatusSelect value={status} onChange={setStatus} />
            </label>
          </div>
          <label class="block">
            <span class="mb-1 block text-[11px] font-semibold">Assignee</span>
            <AssigneeCombobox users={users} value={assigneeId} onChange={setAssigneeId} />
          </label>
          <div class="mt-4 flex justify-end gap-2">
            <Dialog.Close class="rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-semibold">
              Cancel
            </Dialog.Close>
            <button type="submit"
              class="rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-accent-foreground hover:bg-accent-hover">
              {pending ? 'Creating…' : 'Create task'}
            </button>
          </div>
        </Form>
      </Dialog.Popup>
    </Dialog.Root>
  );
};
NewTaskDialog.displayName = 'NewTaskDialog';
export default NewTaskDialog;
```

- [ ] **Step 2: Confirm action payload coercion.** `createTask` expects `assigneeId: string | null`. The hidden input sends `''` for unassigned. In the action, coerce: `assigneeId: input.assigneeId || null` (update `project-board.server.ts` createTask accordingly so `''` becomes `null`).

- [ ] **Step 3: Render the dialog in the board header.** In `project-board.tsx`, import `NewTaskDialog` and place it in the header bar with `class="ml-auto"`:

```tsx
import NewTaskDialog from '../../components/demo/NewTaskDialog.js';
// ...in the header div, after the task count:
<div class="ml-auto"><NewTaskDialog projectId={project.id} users={users} /></div>
```

- [ ] **Step 4: Typecheck + manual verify.**

Run: `pnpm typecheck`, then `pnpm --filter site dev`: open a board, click **+ New task**, fill the form (pick priority/status/assignee), Create. The dialog closes and the new card appears in the chosen column.
Expected: works; the card lands in the right column sorted by priority.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/site/src/components/demo/NewTaskDialog.tsx apps/site/src/pages/demo/project-board.tsx apps/site/src/pages/demo/project-board.server.ts
git commit -m "feat(demo): create tasks in a Dialog with Select/Combobox pickers"
```

---

## Phase 3 — Card actions menu + optimistic moves

### Task 10: Board-level optimistic patch + TaskActions menu

**Files:**
- Create: `apps/site/src/components/demo/TaskActions.tsx`
- Modify: `apps/site/src/components/demo/Board.tsx`, `Column.tsx`, `TaskCard.tsx` (thread a `move`/`patch` + `remove` callback down)

- [ ] **Step 1: Add board-level optimistic state.** In `Board.tsx`, wrap tasks in one optimistic action covering status + priority, and a delete action.

```tsx
// apps/site/src/components/demo/Board.tsx  (replace body)
import type { FunctionComponent } from 'preact';
import { useAction, useOptimisticAction } from 'hono-preact';
import { groupTasks } from '../../demo/group-tasks.js';
import type { Task, TaskStatus, TaskPriority, User } from '../../demo/data.js';
import { serverActions, serverLoaders } from '../../pages/demo/project-board.server.js';
import Column from './Column.js';

type Props = { tasks: Task[]; projectSlug: string; users: User[] };

export type PatchFn = (taskId: string, patch: { status?: TaskStatus; priority?: TaskPriority }) => void;
export type RemoveFn = (taskId: string) => void;

const Board: FunctionComponent<Props> = ({ tasks, projectSlug, users }) => {
  const patch = useOptimisticAction(serverActions.patchTask, {
    base: tasks,
    apply: (current, payload) =>
      current.map((t) =>
        t.id === payload.taskId
          ? { ...t, ...(payload.status ? { status: payload.status } : {}), ...(payload.priority ? { priority: payload.priority } : {}) }
          : t
      ),
    invalidate: [serverLoaders.default],
  });
  const del = useAction(serverActions.deleteTask, { invalidate: [serverLoaders.default] });

  const doPatch: PatchFn = (taskId, p) => patch.mutate({ taskId, ...p });
  const doRemove: RemoveFn = (taskId) => del.mutate({ taskId });

  const columns = groupTasks(patch.value);
  const userById = new Map(users.map((u) => [u.id, u] as const));

  return (
    <div class="grid grid-cols-4 gap-3 overflow-x-auto p-4">
      {columns.map((column) => (
        <Column
          key={column.status}
          column={column}
          projectSlug={projectSlug}
          userById={userById}
          onPatch={doPatch}
          onRemove={doRemove}
        />
      ))}
    </div>
  );
};
Board.displayName = 'Board';
export default Board;
```

Thread `onPatch`/`onRemove` through `Column` props into each `TaskCard`.

- [ ] **Step 2: Implement `TaskActions.tsx`** (shared menu body used by both the `•••` Menu and the right-click ContextMenu)

```tsx
// apps/site/src/components/demo/TaskActions.tsx
import { Menu, ContextMenu } from 'hono-preact-ui';
import type { ComponentChildren } from 'preact';
import type { Task, TaskStatus, TaskPriority } from '../../demo/data.js';
import type { PatchFn, RemoveFn } from './Board.js';

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
];
const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const itemCls = 'cursor-pointer rounded-md px-2 py-1.5 text-[12.5px] data-[highlighted]:bg-accent/10';

// Shared body. `parts` is the Menu OR ContextMenu namespace; both expose the
// same surface parts (RadioGroup/RadioItem/Separator/Item) over the shared
// menu core. CONFIRM ContextMenu re-exports RadioGroup/RadioItem; if it only
// re-exports Item/Separator, render the radio groups with Menu.* parts inside
// the ContextMenu surface (they read the same context).
function MenuBody({
  parts: P, task, onPatch, onRemove,
}: {
  parts: typeof Menu | typeof ContextMenu;
  task: Task; onPatch: PatchFn; onRemove: RemoveFn;
}) {
  return (
    <>
      <P.Group>
        <P.GroupLabel class="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">Move to</P.GroupLabel>
        <P.RadioGroup value={task.status} onValueChange={(v) => onPatch(task.id, { status: v as TaskStatus })}>
          {STATUSES.map((s) => (
            <P.RadioItem key={s.value} value={s.value} class={itemCls}>{s.label}</P.RadioItem>
          ))}
        </P.RadioGroup>
      </P.Group>
      <P.Separator class="my-1 h-px bg-border" />
      <P.Group>
        <P.GroupLabel class="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">Priority</P.GroupLabel>
        <P.RadioGroup value={task.priority} onValueChange={(v) => onPatch(task.id, { priority: v as TaskPriority })}>
          {PRIORITIES.map((p) => (
            <P.RadioItem key={p.value} value={p.value} class={itemCls}>{p.label}</P.RadioItem>
          ))}
        </P.RadioGroup>
      </P.Group>
      <P.Separator class="my-1 h-px bg-border" />
      <P.Item class={`${itemCls} text-danger`} onSelect={() => onRemove(task.id)}>Delete</P.Item>
    </>
  );
}

const popupCls = 'z-50 min-w-[11rem] rounded-lg border border-border bg-background p-1 shadow-lg';

export function TaskMenu({ task, onPatch, onRemove, children }: {
  task: Task; onPatch: PatchFn; onRemove: RemoveFn; children: ComponentChildren; // the trigger content
}) {
  return (
    <Menu.Root>
      <Menu.Trigger class="grid h-5 w-5 place-items-center rounded text-muted hover:bg-foreground/10" aria-label="Task actions">
        {children}
      </Menu.Trigger>
      <Menu.Positioner>
        <Menu.Popup class={popupCls} aria-label="Task actions">
          <MenuBody parts={Menu} task={task} onPatch={onPatch} onRemove={onRemove} />
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Root>
  );
}

export function TaskContextMenu({ task, onPatch, onRemove, children }: {
  task: Task; onPatch: PatchFn; onRemove: RemoveFn; children: ComponentChildren; // the card
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ContextMenu.Positioner>
        <ContextMenu.Popup class={popupCls} aria-label="Task actions">
          <MenuBody parts={ContextMenu} task={task} onPatch={onPatch} onRemove={onRemove} />
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Root>
  );
}
```

- [ ] **Step 3: Verify `ContextMenu` exposes the parts used** (`Group`, `GroupLabel`, `RadioGroup`, `RadioItem`, `Separator`, `Item`, `Positioner`, `Popup`). Check `packages/ui/src/context-menu/index.ts`. If any are missing from the `ContextMenu` namespace, either import them from `Menu` and use `Menu.RadioGroup` etc. inside the ContextMenu surface (shared core context makes this work), or add the re-export. Pick the option that compiles and keep `MenuBody` namespace-agnostic.

- [ ] **Step 4: Typecheck.**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/site/src/components/demo/TaskActions.tsx apps/site/src/components/demo/Board.tsx apps/site/src/components/demo/Column.tsx
git commit -m "feat(demo): board optimistic patch + shared Menu/ContextMenu actions"
```

### Task 11: Wire TaskCard to the menu + context menu

**Files:**
- Modify: `apps/site/src/components/demo/TaskCard.tsx`

- [ ] **Step 1: Add the `•••` Menu trigger and wrap the card in a ContextMenu.** TaskCard receives `onPatch`/`onRemove`. The card's `<a>` stays the navigation surface; the `•••` button sits top-right (stop propagation so clicking it does not navigate). Wrap the whole card in `TaskContextMenu`.

```tsx
// key changes in TaskCard.tsx render:
import { MoreHorizontal } from 'lucide-preact';
import { TaskMenu, TaskContextMenu } from './TaskActions.js';
import type { PatchFn, RemoveFn } from './Board.js';

type Props = { task: Task; projectSlug: string; assignee: User | null; onPatch: PatchFn; onRemove: RemoveFn };

// ...inside component, wrap the existing <ViewTransitionName .../> anchor block:
return (
  <TaskContextMenu task={task} onPatch={onPatch} onRemove={onRemove}>
    <div class="relative">
      {/* existing anchor card markup here */}
      <div
        class="absolute right-1.5 top-1.5"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <TaskMenu task={task} onPatch={onPatch} onRemove={onRemove}>
          <MoreHorizontal size={14} />
        </TaskMenu>
      </div>
    </div>
  </TaskContextMenu>
);
```

Confirm `lucide-preact` icon import path (`import { MoreHorizontal } from 'lucide-preact'`).

- [ ] **Step 2: Typecheck + manual verify.**

Run: `pnpm typecheck`, then `pnpm --filter site dev`: on a board, click `•••` → Move to → "Done" (as the author) moves the card to Done instantly; try moving someone else's unassigned task to Done as a different user (sign in as a non-author) → the optimistic move reverts. Right-click a card → same menu. Change priority → card re-sorts within its column.
Expected: optimistic move + revert-on-deny + priority re-sort all work; right-click opens the menu at the pointer.

- [ ] **Step 3: Commit**

```bash
pnpm format
git add apps/site/src/components/demo/TaskCard.tsx
git commit -m "feat(demo): per-card ••• Menu + right-click ContextMenu moves"
```

---

## Phase 4 — Drag and drop

### Task 12: `use-board-drag` hook with pure drop-target logic

**Files:**
- Create: `apps/site/src/hooks/use-board-drag.ts`
- Test: `apps/site/src/hooks/__tests__/use-board-drag.test.ts`

- [ ] **Step 1: Write the failing test for the pure helper**

```ts
// apps/site/src/hooks/__tests__/use-board-drag.test.ts
import { describe, it, expect } from 'vitest';
import { dropTargetFromPoint } from '../use-board-drag.js';
import type { TaskStatus } from '../../demo/data.js';

// Column rects keyed by status; dropTargetFromPoint returns the status whose
// rect horizontally contains x (y ignored: columns are full-height).
const rects: { status: TaskStatus; rect: { left: number; right: number } }[] = [
  { status: 'backlog', rect: { left: 0, right: 100 } },
  { status: 'in_progress', rect: { left: 100, right: 200 } },
  { status: 'in_review', rect: { left: 200, right: 300 } },
  { status: 'done', rect: { left: 300, right: 400 } },
];

describe('dropTargetFromPoint', () => {
  it('returns the column containing x', () => {
    expect(dropTargetFromPoint(rects, 150)).toBe('in_progress');
    expect(dropTargetFromPoint(rects, 350)).toBe('done');
  });
  it('clamps to the nearest edge column when out of range', () => {
    expect(dropTargetFromPoint(rects, -20)).toBe('backlog');
    expect(dropTargetFromPoint(rects, 999)).toBe('done');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run apps/site/src/hooks/__tests__/use-board-drag.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook + helper**

```ts
// apps/site/src/hooks/use-board-drag.ts
import { useRef, useState, useCallback } from 'preact/hooks';
import type { TaskStatus } from '../demo/data.js';

export type ColumnRect = { status: TaskStatus; rect: { left: number; right: number } };

// Pure: pick the column whose horizontal band contains x; clamp to edges.
export function dropTargetFromPoint(cols: ColumnRect[], x: number): TaskStatus {
  for (const c of cols) {
    if (x >= c.rect.left && x < c.rect.right) return c.status;
  }
  return x < cols[0].rect.left ? cols[0].status : cols[cols.length - 1].status;
}

// Demo-only pointer-events drag. NOT a framework primitive. Tracks the
// dragged task id + the hovered column; commits via onDrop on pointerup.
export function useBoardDrag(
  getColumnRects: () => ColumnRect[],
  onDrop: (taskId: string, to: TaskStatus) => void
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);
  const startedRef = useRef(false);

  const onPointerDown = useCallback((taskId: string, e: PointerEvent) => {
    if (e.button !== 0) return; // left only; right-click stays for ContextMenu
    const startX = e.clientX, startY = e.clientY;
    const el = e.currentTarget as HTMLElement;
    startedRef.current = false;

    const move = (ev: PointerEvent) => {
      if (!startedRef.current) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        startedRef.current = true;
        setDraggingId(taskId);
        try { el.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      }
      setOverStatus(dropTargetFromPoint(getColumnRects(), ev.clientX));
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (startedRef.current) {
        const to = dropTargetFromPoint(getColumnRects(), ev.clientX);
        onDrop(taskId, to);
      }
      setDraggingId(null);
      setOverStatus(null);
      startedRef.current = false;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }, [getColumnRects, onDrop]);

  return { draggingId, overStatus, onPointerDown };
}
```

- [ ] **Step 4: Run to verify the pure test passes**

Run: `pnpm exec vitest run apps/site/src/hooks/__tests__/use-board-drag.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/site/src/hooks/use-board-drag.ts apps/site/src/hooks/__tests__/use-board-drag.test.ts
git commit -m "feat(demo): pointer-events board drag hook + pure drop-target logic"
```

### Task 13: Wire drag into the board

**Files:**
- Modify: `apps/site/src/components/demo/Board.tsx`, `Column.tsx`, `TaskCard.tsx`

- [ ] **Step 1: Measure column rects + use the hook in `Board.tsx`.** Keep a ref array of column elements; `getColumnRects()` reads `getBoundingClientRect()` lazily (read inside the callback, not at render, to avoid stale rects). Pass `onPointerDown` + `draggingId` + `overStatus` down; on drop call the SAME `doPatch(taskId, { status })`.

```tsx
// additions in Board.tsx
import { useRef } from 'preact/hooks';
import { useBoardDrag, type ColumnRect } from '../../hooks/use-board-drag.js';
import { STATUS_COLUMNS } from '../../demo/group-tasks.js';

// inside component:
const colEls = useRef<Map<string, HTMLElement>>(new Map());
const getColumnRects = (): ColumnRect[] =>
  STATUS_COLUMNS.map((c) => {
    const el = colEls.current.get(c.status);
    const r = el?.getBoundingClientRect();
    return { status: c.status, rect: { left: r?.left ?? 0, right: r?.right ?? 0 } };
  });
const drag = useBoardDrag(getColumnRects, (taskId, to) => doPatch(taskId, { status: to }));

// pass to Column: registerEl={(el) => el && colEls.current.set(column.status, el)}
//   onPointerDownCard={drag.onPointerDown} draggingId={drag.draggingId}
//   isOver={drag.overStatus === column.status}
```

- [ ] **Step 2: Column highlights when hovered; card dims while dragging.** In `Column.tsx`, set the root ref via `registerEl`, add `data-over` styling (`ring-2 ring-accent/40` when `isOver`). In `TaskCard.tsx`, add `onPointerDown={(e) => onPointerDownCard(task.id, e)}` to the card wrapper, apply `opacity-50` when `draggingId === task.id`, and set `touch-action: none` (Tailwind `touch-none`) on the drag handle so touch drags do not scroll.

- [ ] **Step 3: Guard the click-vs-drag conflict.** The card is an `<a>`; after a drag, suppress the click navigation. In TaskCard, if a drag started, call `e.preventDefault()` on the next click. Simplest: track a `draggedRef` and add `onClick={(e) => { if (justDragged) e.preventDefault(); }}`. Verify a plain click still navigates to detail.

- [ ] **Step 4: Manual verify.**

Run: `pnpm --filter site dev`: drag a card across columns with the mouse; it follows, the target column highlights, and on drop the card moves (optimistic) and the activity feed later shows the move. A drag to Done on a task you cannot complete reverts. A plain click still opens the task. Touch-drag works on a touch device / emulation.
Expected: smooth drag, correct drop, revert-on-deny, click still navigates.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/site/src/components/demo/Board.tsx apps/site/src/components/demo/Column.tsx apps/site/src/components/demo/TaskCard.tsx
git commit -m "feat(demo): drag-and-drop card moves wired to the optimistic patch"
```

---

## Phase 5 — Task detail refresh, tooltips, polish, tests

### Task 14: Task detail page (rename issue.* → task.*)

**Files:**
- Rename/rewrite: `apps/site/src/pages/demo/issue.tsx` → `task.tsx`
- Rename/rewrite: `apps/site/src/pages/demo/issue.server.ts` → `task.server.ts`
- Modify: `apps/site/src/components/demo/CommentList.tsx`

- [ ] **Step 1: Read the current `issue.tsx` / `issue.server.ts`** via `git show HEAD:apps/site/src/pages/demo/issue.server.ts` (and the working copy of `issue.tsx`). Preserve EVERY behavior: issue-first load, streaming comments loader (async generator with throttle), activity loader, optimistic comment append (`useOptimisticAction`), `<Form reset invalidate>`, the status toggle via optimistic action, inline error on guard deny.

- [ ] **Step 2: Create `task.server.ts`** mirroring `issue.server.ts` with the new names: `serverLoaders = { task, comments, activity }` bound via `serverRoute('/demo/projects/:projectId/tasks/:taskId')`; `serverActions = { addComment, setStatus }` where `setStatus` calls `assertCanMoveToDone` when moving to `done` (replacing the old `assertCanClose`/`'closed'` check). `comments` stays an async-generator streaming loader over `listComments(taskId)` with the 300ms throttle. Use `taskId` path param. (Reuse the exact streaming structure from `issue.server.ts`.)

- [ ] **Step 3: Create `task.tsx`** mirroring `issue.tsx`:
  - Header uses `ViewTransitionName name={`task-title-${task.id}`} groupClass="task-card"` so the board card morphs into the detail header (matches `TaskCard`'s names).
  - Status control: the old open/closed toggle becomes a small status `Select` (reuse `StatusSelect` from `pickers.tsx`) OR keep a button cycling status; pick the Select for consistency and dogfood. Wrap in `useOptimisticAction(setStatus, { base: task.status, apply: (_c, p) => p.status, invalidate: [activityLoader, boardLoader.default], onError })`. Import the board loader as `serverLoaders as boardLoaders from './project-board.server.js'` for invalidation.
  - Comments section: keep the streaming `commentsLoader.View` + optimistic append + `<Form>` exactly as today, renamed.
  - Activity aside: render `task-created` / `task-moved` / `comment-added` kinds.

- [ ] **Step 4: Update `CommentList.tsx`** to the renamed types (it takes `comments`; change any `issueId`→`taskId` references and `Issue`→`Task` imports if present).

- [ ] **Step 5: Delete the old files.**

```bash
git rm apps/site/src/pages/demo/issue.tsx apps/site/src/pages/demo/issue.server.ts
rg "issue\.server|issue\.js|issues/:issueId|IssueRow" apps/site/src   # expect no hits
```

- [ ] **Step 6: Typecheck + manual verify.**

Run: `pnpm typecheck`, then `pnpm --filter site dev`: click a card → detail page; the card title morphs into the header; comments stream in staggered; post a comment (optimistic append); change status (optimistic, reverts on deny); back-nav reverse-morphs.
Expected: all detail behaviors preserved under the new names; morph plays.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add -A apps/site/src/pages/demo/task.tsx apps/site/src/pages/demo/task.server.ts apps/site/src/components/demo/CommentList.tsx
git commit -m "feat(demo): task detail page (rename from issue) with card-morph + streaming"
```

### Task 15: Tooltips on card affordances + final polish

**Files:**
- Modify: `apps/site/src/components/demo/TaskCard.tsx`
- Modify: `apps/site/src/pages/demo/index.tsx`, `login.tsx` (light restyle)

- [ ] **Step 1: Add Tooltips** to the assignee avatar (full name), the priority badge (priority label), and the `•••` trigger ("Actions"). Use `Tooltip.Root openDelay={300}` with `Tooltip.Trigger` / `Tooltip.Positioner` / `Tooltip.Popup`. Note tooltips suppress on touch (acceptable; the menu remains the touch path).

```tsx
import { Tooltip } from 'hono-preact-ui';
// avatar example:
<Tooltip.Root openDelay={300}>
  <Tooltip.Trigger render={<span class="ml-auto grid h-[19px] w-[19px] place-items-center rounded-full bg-accent text-[9.5px] font-bold text-accent-foreground" />}>
    {assignee.name.charAt(0).toUpperCase()}
  </Tooltip.Trigger>
  <Tooltip.Positioner>
    <Tooltip.Popup class="rounded-md bg-foreground px-2 py-1 text-[11px] text-background shadow">
      {assignee.name}
    </Tooltip.Popup>
  </Tooltip.Positioner>
</Tooltip.Root>
```

- [ ] **Step 2: Restyle `index.tsx` and `login.tsx`** to match the shell (rounded inputs, accent button, brand tokens) so the entry flow looks consistent. Keep the existing auth logic untouched (the `markAuthed` localStorage flag, the `useActionResult` error display).

- [ ] **Step 3: Manual verify.**

Run: `pnpm --filter site dev`: hover the avatar/priority/`•••` → tooltips appear; login + index match the board styling.
Expected: cohesive look; tooltips work on hover/focus.

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/site/src/components/demo/TaskCard.tsx apps/site/src/pages/demo/index.tsx apps/site/src/pages/demo/login.tsx
git commit -m "feat(demo): tooltips on card affordances + restyle login/index"
```

### Task 16: Render smoke tests + full CI gate

**Files:**
- Create: `apps/site/src/components/demo/__tests__/Board.test.tsx`

- [ ] **Step 1: Write a render smoke test** (pure render; no popup/drag interaction, which happy-dom cannot drive)

```tsx
// apps/site/src/components/demo/__tests__/Board.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import Board from '../Board.js';
import type { Task, User } from '../../../demo/data.js';

afterEach(cleanup);

const users: User[] = [{ id: 'u-1', email: 'a@e.com', name: 'Alice' }];
const tasks: Task[] = [
  { id: 't-1', projectId: 'p-1', authorId: 'u-1', assigneeId: 'u-1', title: 'Alpha', body: '', status: 'backlog', priority: 'urgent', createdAt: 0 },
  { id: 't-2', projectId: 'p-1', authorId: 'u-1', assigneeId: null, title: 'Beta', body: '', status: 'done', priority: 'low', createdAt: 1 },
];

describe('Board', () => {
  it('renders the four columns and places tasks by status', () => {
    const { getByText } = render(<Board tasks={tasks} projectSlug="inf" users={users} />);
    expect(getByText('Backlog')).toBeTruthy();
    expect(getByText('Done')).toBeTruthy();
    expect(getByText('Alpha')).toBeTruthy();
    expect(getByText('Beta')).toBeTruthy();
  });
});
```

Note: if `Board` calls `useOptimisticAction`/`useAction` that require a router/provider context not present in a bare render, wrap the render in whatever provider the existing docs demos use, or extract the column layout into a presentational `BoardColumns` that the test targets (keep the hook usage in `Board`). Read an existing `apps/site` component test that renders a hook-using component to see the provider setup; follow it.

- [ ] **Step 2: Run the demo test suite.**

Run: `pnpm exec vitest run apps/site/src/demo apps/site/src/components/demo apps/site/src/pages/demo apps/site/src/hooks`
Expected: PASS.

- [ ] **Step 3: Run the FULL pre-push CI gate in order** (per CLAUDE.md):

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all six pass. If `format:check` fails, run `pnpm format`, commit, re-run. Watch for cross-package test fallout (the data/model rename can ripple into any test importing the demo).

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/site/src/components/demo/__tests__/Board.test.tsx
git commit -m "test(demo): board render smoke + green CI gate"
```

---

## Self-review (completed during planning)

**Spec coverage:** every spec section maps to a task. Board org + columns → Task 2/5/6. Sidebar shell + layout loader → Task 5. Drag + Menu/ContextMenu, one optimistic path → Task 10/11/12/13 (unified `patchTask` action). Full-page detail + morph → Task 14. New-task Dialog + Select/Combobox → Task 8/9. Issue→Task rename → Task 1/3/7/14. Tooltips → Task 15. CSS tokens (3 theme blocks, AA) → Task 4. Guard on move-to-done → Task 3/6. Delete (added to spec) → data Task 1 + action Task 6 + UI Task 10. Testing + CI → Task 16. Non-goals (no reorder-within-column, no global board, no toast, drag is demo-only) respected.

**Refinement vs spec:** the spec listed separate `setTaskStatus`/`setTaskPriority` actions; the plan unifies them into one `patchTask` action so a single `useOptimisticAction` cleanly covers drag + menu moves AND priority. Delete uses plain `useAction` + invalidate (refetch) rather than optimistic, to keep one optimistic base. Both are consistent with the spec's intent ("priority changes the same way [optimistically]" via the shared patch).

**Open verifications flagged inline (resolve at implementation, do not guess):** `useParams` optional read (Task 5.3), `loader.View` extra-prop passthrough (Task 5.4), Combobox filtering wiring via `onInputChange` + `matchSubstring` (Task 8.2), `ContextMenu` exposing radio/group parts (Task 10.3), lucide import path (Task 11.1), provider context for hook-using render tests (Task 16.1). Each names the file to read and the fallback if the assumed API differs.

**Type consistency:** `Task`, `TaskStatus`, `TaskPriority`, `groupTasks`/`Column`/`STATUS_COLUMNS`, `PatchFn`/`RemoveFn`, `patchTask`/`deleteTask`/`createTask`, `BoardData`/`ShellData` names are used consistently across tasks.
