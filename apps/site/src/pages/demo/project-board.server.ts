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
  type Task,
  type Project,
  type User,
  type TaskPriority,
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
};
