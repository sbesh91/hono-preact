// apps/site/src/demo/data.ts
// In-memory demo store. Per-process, resets on cold start.
// No persistence; the demo is a feature showcase, not a saved tool.

export type User = { id: string; email: string; name: string };
export type Project = { id: string; slug: string; name: string };

/** Canonical ordered set of task statuses. Derive `TaskStatus` from this. */
export const STATUSES = [
  'backlog',
  'in_progress',
  'in_review',
  'done',
] as const;
/** Canonical ordered set of task priorities. Derive `TaskPriority` from this. */
export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

export type TaskStatus = (typeof STATUSES)[number];
export type TaskPriority = (typeof PRIORITIES)[number];
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
  moves: {
    taskId: string;
    to: TaskStatus;
    at: number;
    userId: string | null;
  }[];
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
    id,
    projectId,
    authorId,
    assigneeId,
    title,
    body,
    status,
    priority,
    createdAt: T + hours * HR,
  });

  const tasks: Task[] = [
    // Infrastructure (p-1)
    mk(
      't-1',
      'p-1',
      'u-1',
      'u-1',
      'Worker times out under load',
      'Repro: hammer /api/users with 200 RPS.',
      'in_progress',
      'urgent',
      0
    ),
    mk(
      't-2',
      'p-1',
      'u-2',
      'u-1',
      'Stream request bodies',
      'Skip the full parse on hot paths.',
      'in_progress',
      'high',
      1
    ),
    mk(
      't-3',
      'p-1',
      'u-2',
      'u-2',
      'Cache key collides for guests',
      'Anonymous sessions reuse a single key.',
      'in_review',
      'medium',
      2
    ),
    mk(
      't-4',
      'p-1',
      'u-1',
      null,
      'Audit cold-start budget',
      'Measure isolate spin-up cost.',
      'backlog',
      'low',
      3
    ),
    mk(
      't-5',
      'p-1',
      'u-1',
      'u-1',
      'Pin pnpm to 10.18.3',
      'Dodge the peer-dep override bug.',
      'done',
      'medium',
      4
    ),
    // API (p-2)
    mk(
      't-6',
      'p-2',
      'u-1',
      'u-2',
      'Pagination cursor decodes wrong',
      'Base64 padding mismatch.',
      'done',
      'high',
      5
    ),
    mk(
      't-7',
      'p-2',
      'u-2',
      'u-2',
      'Add rate-limit headers',
      'Echo remaining budget.',
      'backlog',
      'high',
      6
    ),
    mk(
      't-8',
      'p-2',
      'u-1',
      null,
      'Document error envelope',
      'Spec the __outcome shape.',
      'backlog',
      'low',
      7
    ),
    mk(
      't-9',
      'p-2',
      'u-2',
      'u-1',
      'Retry queue on 5xx',
      'Bounded backoff with jitter.',
      'in_progress',
      'urgent',
      8
    ),
    // Web (p-3)
    mk(
      't-10',
      'p-3',
      'u-1',
      'u-1',
      'Dark mode toggle flashes',
      'SSR + client hydration mismatch.',
      'in_progress',
      'medium',
      9
    ),
    mk(
      't-11',
      'p-3',
      'u-2',
      'u-2',
      'Skeleton states for board',
      'Match column shapes.',
      'backlog',
      'medium',
      10
    ),
    mk(
      't-12',
      'p-3',
      'u-1',
      'u-1',
      'Polish focus rings',
      'AA contrast on all controls.',
      'in_review',
      'low',
      11
    ),
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

export const listAllTasks = (): Task[] => store.tasks.slice();

export const getTask = (id: string): Task | null =>
  store.tasks.find((t) => t.id === id) ?? null;

export const listComments = (taskId: string): Comment[] =>
  store.comments
    .filter((c) => c.taskId === taskId)
    .sort((a, b) => a.createdAt - b.createdAt);

export const getUser = (id: string): User | null =>
  store.users.find((u) => u.id === id) ?? null;
export const findUserByEmail = (email: string): User | null =>
  store.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ??
  null;
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
  | {
      kind: 'task-moved';
      at: number;
      task: Task;
      to: TaskStatus;
      user: User | null;
    }
  | {
      kind: 'comment-added';
      at: number;
      comment: Comment;
      task: Task;
      user: User | null;
    };

export function activityForProject(
  projectId: string,
  limit = 20
): ActivityItem[] {
  const items: ActivityItem[] = [];
  const tasks = store.tasks.filter((t) => t.projectId === projectId);
  const taskById = new Map(store.tasks.map((t) => [t.id, t] as const));
  for (const task of tasks) {
    items.push({
      kind: 'task-created',
      at: task.createdAt,
      task,
      user: getUser(task.authorId),
    });
  }
  for (const m of store.moves) {
    const task = taskById.get(m.taskId);
    if (!task || task.projectId !== projectId) continue;
    items.push({
      kind: 'task-moved',
      at: m.at,
      task,
      to: m.to,
      user: getUser(m.userId ?? ''),
    });
  }
  for (const comment of store.comments) {
    const task = taskById.get(comment.taskId);
    if (!task || task.projectId !== projectId) continue;
    items.push({
      kind: 'comment-added',
      at: comment.createdAt,
      comment,
      task,
      user: getUser(comment.authorId),
    });
  }
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}
