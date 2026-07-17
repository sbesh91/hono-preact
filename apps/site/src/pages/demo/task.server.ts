import { serverRoute, publish } from 'hono-preact';
import {
  activityForProject,
  addComment,
  getTask,
  getUser,
  listComments,
  setTaskStatus,
  type Comment,
  type Task,
  type User,
  type ActivityItem,
} from '../../demo/data.js';
import { currentUser } from '../../demo/session.js';
import { assertCanMoveToDone } from './task-guards.js';
import { AddCommentSchema, SetStatusSchema } from './task-schema.js';
import {
  activityChannel,
  commentAddedEvent,
  taskMovedEvent,
} from '../../demo/activity-stream.js';
import { previewOf, type DraftPreview } from '../../demo/draft-preview.js';

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
  // Route-bound like the loaders above: `route.action` resolves this action's
  // page-use chain (the requireSession gate inherited from /demo/projects) by
  // the exact route pattern rather than fuzzy-matching the POST URL. Passing a
  // schema as `input` infers the payload type (and validates it), so no manual
  // `route.action<Payload, Result>` generics are needed.
  addComment: route.action(
    async (ctx, input) => {
      const user = await currentUser(ctx.c);
      if (!user) throw new Error('not signed in');
      const c = addComment(user, { taskId: input.taskId, body: input.body });
      const task = getTask(input.taskId);
      if (task)
        publish(activityChannel.key(), commentAddedEvent(task, user.name));
      return { id: c.id };
    },
    { input: AddCommentSchema }
  ),

  setStatus: route.action(
    async (ctx, input) => {
      const user = await currentUser(ctx.c);
      if (input.status === 'done') {
        await assertCanMoveToDone(input.taskId, user?.id);
      }
      setTaskStatus(input.taskId, input.status, user?.id ?? null);
      const task = getTask(input.taskId);
      if (task) {
        publish(
          activityChannel.key(),
          taskMovedEvent(task, input.status, user?.name ?? 'someone')
        );
      }
      return { ok: true };
    },
    { input: SetStatusSchema }
  ),
};

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
