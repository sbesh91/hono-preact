import {
  definePage,
  Form,
  useFormStatus,
  useOptimisticAction,
  ViewTransitionName,
} from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { useTitle } from 'hoofd/preact';
import { serverLoaders, serverActions } from './task.server.js';
import { serverLoaders as boardLoaders } from './project-board.server.js';
import CommentList from '../../components/demo/CommentList.js';
import type {
  ActivityItem,
  Comment,
  Task,
  TaskStatus,
  User,
} from '../../demo/data.js';

const {
  task: taskLoader,
  comments: commentsLoader,
  activity: activityLoader,
} = serverLoaders;

type WithAuthor<T extends { authorId: string }> = T & { author: User | null };
type TaskData = WithAuthor<Task>;
type CommentData = WithAuthor<Comment>;

// The four task statuses in board order, with their display labels.
const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
];

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

// ---- Section: task header + body + status control ----
// Lives inside taskLoader's View context. Owns the status-change action.
// Sibling loaders in the invalidate list (activityLoader, project-board
// loader) have their caches cleared but don't refetch from here; their
// pages refetch on next mount, so the back-nav to the project board sees
// the new status on the card. taskLoader IS the active loader so its
// auto-reload runs and the header re-renders with the new status.

const TaskHeaderAndActions: FunctionComponent<{
  task: TaskData;
  reloadTask: () => void;
}> = ({ task, reloadTask }) => {
  useTitle(`${task.title} · demo`);

  // useOptimisticAction keeps the applied patch in place until the loader's
  // base value (task.status) actually reflects it. On error the framework
  // reverts the patch automatically so the badge snaps back to task.status;
  // surface the error message inline so the user knows why (most likely:
  // the action-guard 403 for a non-author/non-assignee moving a task to Done).
  const [error, setError] = useState<string | null>(null);
  const {
    mutate,
    pending,
    value: status,
  } = useOptimisticAction(serverActions.setStatus, {
    base: task.status,
    apply: (_current, payload) => payload.status,
    invalidate: [activityLoader, boardLoaders.default],
    onSuccess: () => {
      setError(null);
      reloadTask();
    },
    onError: (err) => setError(err.message),
  });

  return (
    <>
      <header class="space-y-2">
        <div class="flex items-center gap-2">
          <ViewTransitionName
            name={`task-title-${task.id}`}
            groupClass="task-card"
            render={<h2 class="text-xl font-semibold text-foreground" />}
          >
            {task.title}
          </ViewTransitionName>
          <ViewTransitionName
            name={`task-status-${task.id}`}
            groupClass="task-card"
            render={
              <span
                class={`text-xs px-2 py-0.5 ${
                  status === 'done' ? 'badge-success' : 'badge-neutral'
                }`}
              />
            }
          >
            {STATUS_LABEL[status]}
          </ViewTransitionName>
        </div>
        <p class="text-sm text-muted">
          Opened by <strong>{task.author?.name ?? 'someone'}</strong> on{' '}
          {new Date(task.createdAt).toLocaleDateString()}
        </p>
      </header>

      {task.body && (
        <p class="whitespace-pre-wrap text-foreground">{task.body}</p>
      )}

      <div class="space-y-1">
        <label class="flex items-center gap-2 text-sm text-foreground">
          <span class="font-medium">Status</span>
          <select
            class="border border-border px-2 py-1 text-sm bg-transparent"
            value={status}
            disabled={pending}
            onChange={(e) =>
              mutate({
                taskId: task.id,
                status: e.currentTarget.value as TaskStatus,
              })
            }
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {pending && <span class="text-xs text-muted">Saving…</span>}
        </label>
        {error && <p class="text-sm text-danger">{error}</p>}
      </div>
    </>
  );
};
TaskHeaderAndActions.displayName = 'TaskHeaderAndActions';

// ---- Section: comments list + new-comment form ----
// Sibling of the activity view, so each comment chunk re-renders THIS
// section only; the header/body above and the activity aside below stay
// stable.

// Optimistic appends: when the user posts a comment, useOptimisticAction
// keeps the new entry in the rendered list. The optimistic entry stays
// applied until the loader's base value (next mount / nav) contains the
// server-confirmed comment.

const CommentsSection: FunctionComponent<{
  comments: CommentData[];
  taskId: string;
}> = ({ comments, taskId }) => {
  // Drive the optimistic list AND the form submit from the SAME action object.
  // Passing it to <Form> is what makes <Form> call addOptimistic on submit, so
  // the new comment paints immediately; a bare `serverActions.addComment` stub
  // never triggers the optimistic append (that was the bug: the comment only
  // appeared after a full reload). The optimistic entry stays applied until the
  // loader's base value contains the server-confirmed comment on the next mount
  // or nav; invalidate() below busts the cache so that refetch is fresh.
  const addComment = useOptimisticAction(serverActions.addComment, {
    base: comments,
    apply: (current, payload) => [
      ...current,
      {
        id: `pending-${current.length}`,
        taskId: payload.taskId,
        authorId: '',
        body: payload.body,
        createdAt: Date.now(),
        author: null,
      } as CommentData,
    ],
  });
  const { pending } = useFormStatus(serverActions.addComment);

  return (
    <section class="space-y-3">
      <h3 class="font-semibold text-foreground">Comments</h3>
      <CommentList comments={addComment.value} />
      <Form
        action={addComment}
        reset
        invalidate={[commentsLoader]}
        class="space-y-2"
      >
        <input type="hidden" name="taskId" value={taskId} />
        <textarea
          name="body"
          rows={3}
          required
          placeholder="Add a comment"
          class="block w-full border border-border px-2 py-1"
        />
        <button
          type="submit"
          class="bg-accent text-accent-foreground px-3 py-1 text-sm hover:bg-accent-hover"
        >
          {pending ? 'Posting…' : 'Comment'}
        </button>
      </Form>
    </section>
  );
};
CommentsSection.displayName = 'CommentsSection';

const CommentsView = commentsLoader.View<{ taskId: string }>(
  ({ data: comments, taskId }) => (
    <CommentsSection comments={comments ?? []} taskId={taskId} />
  ),
  { fallback: <p class="text-sm text-muted">Loading comments…</p> }
);

// ---- Section: project activity feed ----

const ActivitySection: FunctionComponent<{ activity: ActivityItem[] }> = ({
  activity,
}) => (
  <aside class="border-t border-border pt-3 text-xs text-muted">
    <h4 class="font-semibold mb-1 text-foreground">Project activity</h4>
    <ul class="space-y-1">
      {activity.map((a, i) => (
        <li key={`${a.kind}-${a.at}-${i}`}>
          <time class="text-muted">{new Date(a.at).toLocaleTimeString()}</time>{' '}
          {a.kind === 'task-created' && (
            <>
              created <strong>{a.task.title}</strong>
            </>
          )}
          {a.kind === 'task-moved' && (
            <>
              moved <strong>{a.task.title}</strong> to{' '}
              <strong>{STATUS_LABEL[a.to]}</strong>
            </>
          )}
          {a.kind === 'comment-added' && (
            <>
              commented on <strong>{a.task.title}</strong>
            </>
          )}
        </li>
      ))}
    </ul>
  </aside>
);

const ActivityView = activityLoader.View(
  ({ data: activity }) => <ActivitySection activity={activity ?? []} />,
  { fallback: <p class="text-xs text-muted">Loading activity…</p> }
);

// ---- Page: task loads first, then comments + activity in parallel ----

const TaskView = taskLoader.View(
  ({ data: task, reload: reloadTask }) => {
    if (!task) return <p>Task not found.</p>;
    return (
      <article class="space-y-6">
        <TaskHeaderAndActions task={task} reloadTask={reloadTask} />
        <CommentsView taskId={task.id} />
        <ActivityView />
      </article>
    );
  },
  { fallback: <p>Loading task…</p> }
);

export default definePage(TaskView);
