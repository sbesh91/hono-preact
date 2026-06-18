import { defineAction, serverRoute } from 'hono-preact';
import {
  getProjectBySlug,
  listTasksForProject,
  getUser,
  createTask,
  setTaskStatus,
  setTaskPriority,
  deleteTask,
  type Task,
  type Project,
  type User,
  type TaskStatus,
  type TaskPriority,
} from '../../demo/data.js';
import { currentUser } from '../../demo/session.js';
import { assertCanMoveToDone } from './task-guards.js';

// Bind this server module to its route once; `route.loader(fn)` then types
// `ctx.location.pathParams` (projectId) from the route's pattern.
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
      users: [getUser('u-1'), getUser('u-2')].filter(
        (u): u is User => u !== null
      ),
      tasks: listTasksForProject(project.id),
    };
  }),
};

export const serverActions = {
  createTask: defineAction<
    {
      projectId: string;
      title: string;
      body: string;
      priority: TaskPriority;
      status: TaskStatus;
      assigneeId: string | null;
    },
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
      // the form sends '' for unassigned; coerce to null
      assigneeId: input.assigneeId || null,
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
    if (input.status)
      setTaskStatus(input.taskId, input.status, user?.id ?? null);
    if (input.priority) setTaskPriority(input.taskId, input.priority);
    return { ok: true };
  }),

  deleteTask: defineAction<{ taskId: string }, { ok: true }>(
    async (_ctx, input) => {
      deleteTask(input.taskId);
      return { ok: true };
    }
  ),
};
