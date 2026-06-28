import { defineAction, serverRoute } from 'hono-preact';
import {
  activityForProject,
  addComment,
  getTask,
  getUser,
  listComments,
  setTaskStatus,
  type Comment,
  type Task,
  type TaskStatus,
  type User,
  type ActivityItem,
} from '../../demo/data.js';
import { currentUser } from '../../demo/session.js';
import { assertCanMoveToDone } from './task-guards.js';
import {
  publishActivity,
  commentAddedEvent,
  taskMovedEvent,
} from '../../demo/activity-stream.js';

// Bind this server module to its route once; `route.loader(fn)` then types
// `ctx.location.pathParams` (taskId/projectId) from the route's pattern.
const route = serverRoute('/demo/projects/:projectId/tasks/:taskId');

type WithAuthor<T extends { authorId: string }> = T & { author: User | null };
const withAuthor = <T extends { authorId: string }>(x: T): WithAuthor<T> => ({
  ...x,
  author: getUser(x.authorId),
});

// The detail hero mirrors the board card, which shows the assignee avatar, so
// resolve the assignee alongside the author for the task loader.
export type TaskDetail = WithAuthor<Task> & { assignee: User | null };

export const serverLoaders = {
  task: route.loader(async ({ location }): Promise<TaskDetail | null> => {
    const id = location.pathParams.taskId;
    if (!id) return null;
    const task = getTask(id);
    if (!task) return null;
    return {
      ...withAuthor(task),
      assignee: task.assigneeId ? getUser(task.assigneeId) : null,
    };
  }),

  comments: route.loader(async function* ({
    location,
    signal,
  }): AsyncGenerator<WithAuthor<Comment>[]> {
    const id = location.pathParams.taskId;
    if (!id) {
      yield [];
      return;
    }
    const all = listComments(id).map(withAuthor);
    // Demo throttle: trickle comments one at a time. Removes any feeling of
    // "wait for the whole loader" and is the visible proof of streaming.
    const cumulative: WithAuthor<Comment>[] = [];
    for (const c of all) {
      if (signal.aborted) return;
      cumulative.push(c);
      yield cumulative;
      await new Promise((r) => setTimeout(r, 300));
    }
    // Final yield to flush state when there are zero comments.
    if (cumulative.length === 0) yield [];
  }),

  activity: route.loader(async ({ location }): Promise<ActivityItem[]> => {
    const taskId = location.pathParams.taskId;
    const task = taskId ? getTask(taskId) : null;
    if (!task) return [];
    return activityForProject(task.projectId, 10);
  }),
};

export const serverActions = {
  addComment: defineAction<{ taskId: string; body: string }, { id: string }>(
    async (ctx, input) => {
      const user = await currentUser(ctx.c);
      if (!user) throw new Error('not signed in');
      const c = addComment(user, {
        taskId: input.taskId,
        body: input.body.trim(),
      });
      const task = getTask(input.taskId);
      if (task) publishActivity(commentAddedEvent(task, user.name));
      return { id: c.id };
    }
  ),

  setStatus: defineAction<{ taskId: string; status: TaskStatus }, { ok: true }>(
    async (ctx, input) => {
      const user = await currentUser(ctx.c);
      if (input.status === 'done') {
        await assertCanMoveToDone(input.taskId, user?.id);
      }
      setTaskStatus(input.taskId, input.status, user?.id ?? null);
      const task = getTask(input.taskId);
      if (task) {
        publishActivity(
          taskMovedEvent(task, input.status, user?.name ?? 'someone')
        );
      }
      return { ok: true };
    }
  ),
};
