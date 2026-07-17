import * as v from 'valibot';
import { defineAction, deny, publish, serverRoute } from 'hono-preact';
import {
  getProjectBySlug,
  listTasksForProject,
  getUser,
  getTask,
  createTask,
  setTaskStatus,
  setTaskPriority,
  deleteTask,
  restoreTask,
  type Task,
  type Project,
  type User,
  type TaskPriority,
  type TaskStatus,
} from '../../demo/data.js';
import {
  activityChannel,
  taskCreatedEvent,
  taskMovedEvent,
} from '../../demo/activity-stream.js';
import { currentUser } from '../../demo/session.js';
import { assertCanMoveToDone } from './task-guards.js';
import {
  NewTaskSchema,
  PatchTaskSchema,
  DeleteTaskSchema,
  ProjectRouteParamsSchema,
  BoardSearchSchema,
} from './task-schema.js';
import {
  insightsCache,
  insightsTiming,
  type ProjectInsights,
} from './board-insights.js';

// Bind this server module to its route once; `route.loader(fn)` then types
// `ctx.location.pathParams` (projectId) from the route's pattern.
const route = serverRoute('/demo/projects/:projectId');

export type BoardData = {
  project: Project;
  users: User[];
  tasks: Task[];
  /** The validated, defaulted ?priority= filter this data was computed for. */
  priority: 'all' | TaskPriority;
  /** Unfiltered task count, so the UI can show "n of m". */
  totalCount: number;
};

const InsightsSearchSchema = v.object({
  insights: v.optional(v.picklist(['quick', 'deep']), 'quick'),
});

// Abort-aware sleep so the timeout abort actually stops the deep path.
const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
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

export const serverLoaders = {
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
      const byStatus: Record<TaskStatus, number> = {
        backlog: 0,
        in_progress: 0,
        in_review: 0,
        done: 0,
      };
      for (const t of tasks) byStatus[t.status] += 1;
      const oldestOpen = tasks
        .filter((t) => t.status !== 'done')
        .reduce<
          number | null
        >((min, t) => (min === null ? t.createdAt : Math.min(min, t.createdAt)), null);
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
};

export const serverActions = {
  createTask: defineAction(
    async (ctx, input) => {
      const user = await currentUser(ctx.c);
      if (!user) throw deny(401, 'Sign in to create tasks.');
      // Schema coerces and trims; values are already clean.
      const created = createTask(user, input);
      publish(activityChannel.key(), taskCreatedEvent(created, user.name));
      return { id: created.id };
    },
    { input: NewTaskSchema }
  ),

  // One action drives both moves and priority changes so a single
  // useOptimisticAction can cover drag + menu interactions. The schema
  // types the payload; no generics needed.
  patchTask: defineAction(
    async (ctx, input): Promise<{ ok: true }> => {
      const user = await currentUser(ctx.c);
      if (input.status === 'done') {
        await assertCanMoveToDone(input.taskId, user?.id);
      }
      if (input.status)
        setTaskStatus(input.taskId, input.status, user?.id ?? null);
      if (input.priority) setTaskPriority(input.taskId, input.priority);
      if (input.status) {
        const task = getTask(input.taskId);
        if (task) {
          publish(
            activityChannel.key(),
            taskMovedEvent(task, input.status, user?.name ?? 'someone')
          );
        }
      }
      return { ok: true };
    },
    { input: PatchTaskSchema }
  ),

  deleteTask: defineAction(
    async (ctx, input): Promise<{ ok: true }> => {
      const user = await currentUser(ctx.c);
      if (!user) throw deny(401, 'Sign in to delete tasks.');
      deleteTask(input.taskId);
      return { ok: true };
    },
    { input: DeleteTaskSchema }
  ),

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
};
