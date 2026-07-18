import {
  definePage,
  Form,
  useFormStatus,
  useOptimisticAction,
  useParams,
  usePrefetch,
  useReload,
  useTitle,
  ViewTransitionName,
} from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { ArrowLeft } from 'lucide-preact';
import {
  serverLoaders,
  serverActions,
  serverSockets,
  type TaskDetail,
} from './task.server.js';
import { serverLoaders as boardLoaders } from './project-board.server.js';
import { StatusSelect } from '../../components/demo/pickers.js';
import {
  PRIORITY_BADGE,
  PRIORITY_LABEL,
} from '../../components/demo/priority.js';
import CommentList from '../../components/demo/CommentList.js';
import type {
  ActivityItem,
  Comment,
  TaskStatus,
  User,
} from '../../demo/data.js';

const {
  task: taskLoader,
  comments: commentsLoader,
  activity: activityLoader,
} = serverLoaders;

type WithAuthor<T extends { authorId: string }> = T & { author: User | null };
type TaskData = TaskDetail;
type CommentData = WithAuthor<Comment>;

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

// Shared panel chrome, matching the board's card/column language.
const PANEL = 'rounded-xl border border-border bg-background p-5';

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
  useTitle(task.title);

  // The route slug doubles as the project slug, so the back link can point at
  // the board without touching any loader. (project-header.tsx reads the same
  // param.)
  const { projectId: projectSlug } = useParams(
    '/demo/projects/:projectId/tasks/:taskId'
  );

  // Warm the board loader on back-link intent (hover/focus). Changing this
  // task's status invalidates the board cache, so on back-nav the board would
  // otherwise be COLD: its server RPC misses the route scheduler's ~150ms
  // morph-partner grace, the new snapshot is captured without this card, and
  // the card-hero morph degrades to a flicker. Prefetching lands the fresh
  // board (card present) in cache first, so the back-nav renders it
  // synchronously and the morph pairs cleanly. Mirrors TaskCard's forward
  // prefetch of the task loader.
  const backHref = `/demo/projects/${projectSlug}`;
  const prefetchBoard = usePrefetch(backHref, boardLoaders.default);

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

  const done = status === 'done';

  return (
    <>
      <a
        href={backHref}
        onMouseEnter={prefetchBoard}
        onFocus={prefetchBoard}
        class="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft size={15} aria-hidden />
        Back to {projectSlug.toUpperCase()}
      </a>

      {/* Card-hero: the morph counterpart of the board card (`task-card-${id}`).
          It is the SAME card shape as TaskCard (border, radius, left priority
          bar, title above a badge row with the assignee pinned right), just
          larger, so the back-nav reads as that card growing into the page
          rather than a cross-dissolve of two unlike layouts. View transitions
          scale captured bitmaps, so keeping both ends card-shaped is what makes
          the box resize cleanly (text still softens slightly mid-morph). */}
      <ViewTransitionName
        name={`task-card-${task.id}`}
        groupClass="task-card"
        render={
          <article class="relative rounded-xl border border-border bg-background p-5 pl-6 shadow-subtle" />
        }
      >
        <span
          class="absolute inset-y-0 left-0 w-1 rounded-l-xl"
          style={{ background: `var(--color-priority-${task.priority})` }}
          aria-hidden
        />
        <h2 class="text-2xl font-semibold leading-tight text-foreground">
          <span class={done ? 'line-through decoration-border' : ''}>
            {task.title}
          </span>
        </h2>
        <div class="mt-3 flex items-center gap-2">
          <span
            class={`rounded-full px-2.5 py-1 text-xs font-bold ${PRIORITY_BADGE[task.priority]}`}
          >
            {PRIORITY_LABEL[task.priority]}
          </span>
          <span
            class={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              done ? 'badge-success' : 'badge-neutral'
            }`}
          >
            {STATUS_LABEL[status]}
          </span>
          {task.assignee && (
            <span
              class="ml-auto grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground"
              title={task.assignee.name}
            >
              {task.assignee.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <p class="mt-3 text-sm text-muted">
          Opened by{' '}
          <strong class="font-medium text-foreground">
            {task.author?.name ?? 'someone'}
          </strong>{' '}
          on {new Date(task.createdAt).toLocaleDateString()}
        </p>
      </ViewTransitionName>

      <section class={`${PANEL} space-y-5`}>
        {task.body && (
          <p class="whitespace-pre-wrap leading-relaxed text-foreground">
            {task.body}
          </p>
        )}

        <div class="space-y-1.5">
          <span class="block text-sm font-medium text-foreground">Status</span>
          <div class="flex items-center gap-3">
            <div class="w-48">
              <StatusSelect
                value={status}
                onChange={(next) => mutate({ taskId: task.id, status: next })}
              />
            </div>
            {pending && <span class="text-xs text-muted">Saving…</span>}
          </div>
          {error && <p class="text-sm text-danger">{error}</p>}
        </div>
      </section>
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
    apply: (current, payload) => {
      const optimistic: CommentData = {
        id: `pending-${current.length}`,
        taskId: payload.taskId,
        authorId: '',
        body: payload.body,
        createdAt: Date.now(),
        author: null,
      };
      return [...current, optimistic];
    },
  });
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
CommentsSection.displayName = 'CommentsSection';

// The comments loader streams the cumulative list (each chunk is the full
// accumulated list so far). `reduce` takes the latest chunk as the new
// accumulator value. The loading placeholder shows only during the initial
// `connecting` phase (data is undefined); once `open`, even an empty list
// renders the empty state via CommentsSection.
const CommentsView = commentsLoader.View<CommentData[], { taskId: string }>(
  ({ data, taskId }) =>
    data ? (
      <CommentsSection comments={data} taskId={taskId} />
    ) : (
      <p class="text-sm text-muted">Loading comments…</p>
    ),
  {
    initial: [],
    reduce: (_acc, chunk) => chunk,
  }
);

// ---- Section: project activity feed ----

const ActivitySection: FunctionComponent<{ activity: ActivityItem[] }> = ({
  activity,
}) => (
  <aside class={`${PANEL} space-y-3`}>
    <h4 class="text-sm font-semibold text-foreground">Activity</h4>
    {activity.length === 0 ? (
      <p class="text-xs text-muted">No activity yet.</p>
    ) : (
      <ul class="space-y-3 text-sm text-foreground">
        {activity.map((a, i) => (
          <li key={`${a.kind}-${a.at}-${i}`} class="space-y-0.5">
            <time class="block text-xs text-muted">
              {new Date(a.at).toLocaleTimeString()}
            </time>
            <span class="leading-snug">
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
            </span>
          </li>
        ))}
      </ul>
    )}
  </aside>
);

// Same shape: keep the prior activity during a background revalidation, show
// the loading line only for the cold first load.
const ActivityView = activityLoader.View(({ data }) =>
  data ? (
    <ActivitySection activity={data} />
  ) : (
    <p class="text-xs text-muted">Loading activity…</p>
  )
);

// ---- Page: task loads first, then comments + activity in parallel ----

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

export default definePage(TaskView);
