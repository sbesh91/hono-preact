import {
  definePage,
  Form,
  useFormStatus,
  useOptimisticAction,
  useActionResult,
  ViewTransitionName,
} from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useTitle } from 'hoofd/preact';
import { serverLoaders, serverActions } from './issue.server.js';
import { serverLoaders as projectIssuesLoaders } from './project-issues.server.js';
import { requireSession } from '../../demo/guard.js';
import CommentList from '../../components/demo/CommentList.js';
import type { ActivityItem, Comment, Issue, User } from '../../demo/data.js';

const {
  issue: issueLoader,
  comments: commentsLoader,
  activity: activityLoader,
} = serverLoaders;

type WithAuthor<T extends { authorId: string }> = T & { author: User | null };
type IssueData = WithAuthor<Issue>;
type CommentData = WithAuthor<Comment>;

// ---- Section: issue header + body + status toggle ----
// Lives inside issueLoader's View context. Owns the status-toggle action.
// Sibling loaders in the invalidate list (activityLoader, project-issues
// list loader) have their caches cleared but don't refetch from here; their
// pages refetch on next mount, so the back-nav to the project issues list
// sees the new status on the IssueRow badge. issueLoader IS the active
// loader so its auto-reload runs and the header re-renders with the new
// status.

const IssueHeaderAndActions: FunctionComponent<{
  issue: IssueData;
  reloadIssue: () => void;
}> = ({ issue, reloadIssue }) => {
  useTitle(`${issue.title} · demo`);

  // useOptimisticAction keeps the applied patch in place until the loader's
  // base value (issue.status) actually reflects it. On error the framework
  // reverts the patch automatically so the badge snaps back to issue.status;
  // surface the error message inline so the user knows why (most likely:
  // the action-guard 403 for non-authors closing someone else's issue).
  const [error, setError] = useState<string | null>(null);
  const {
    mutate: toggleStatus,
    pending: toggling,
    value: status,
  } = useOptimisticAction(serverActions.setStatus, {
    base: issue.status,
    apply: (_current, payload) => payload.status,
    invalidate: [activityLoader, projectIssuesLoaders.default],
    onSuccess: () => {
      setError(null);
      reloadIssue();
    },
    onError: (err) => setError(err.message),
  });

  const nextStatus = status === 'open' ? 'closed' : 'open';

  return (
    <>
      <header class="space-y-2">
        <div class="flex items-center gap-2">
          <ViewTransitionName
            name={`issue-title-${issue.id}`}
            groupClass="issue-card"
            render={<h2 class="text-xl font-semibold" />}
          >
            {issue.title}
          </ViewTransitionName>
          <ViewTransitionName
            name={`issue-status-${issue.id}`}
            groupClass="issue-card"
            render={
              <span
                class={`text-xs px-2 py-0.5 ${
                  status === 'open' ? 'badge-success' : 'badge-neutral'
                }`}
              />
            }
          >
            {status}
          </ViewTransitionName>
        </div>
        <p class="text-sm text-muted">
          Opened by <strong>{issue.author?.name ?? 'someone'}</strong> on{' '}
          {new Date(issue.createdAt).toLocaleDateString()}
        </p>
      </header>

      {issue.body && <p class="whitespace-pre-wrap">{issue.body}</p>}

      <div class="space-y-1">
        <button
          type="button"
          class="bg-gray-700 text-white px-3 py-1 text-sm"
          disabled={toggling}
          onClick={() =>
            toggleStatus({ issueId: issue.id, status: nextStatus })
          }
        >
          {toggling
            ? `${nextStatus === 'closed' ? 'Closing' : 'Reopening'}…`
            : nextStatus === 'closed'
              ? 'Close issue'
              : 'Reopen issue'}
        </button>
        {error && <p class="text-sm text-danger">{error}</p>}
      </div>
    </>
  );
};
IssueHeaderAndActions.displayName = 'IssueHeaderAndActions';

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
  issueId: string;
}> = ({ comments, issueId }) => {
  const [formKey, setFormKey] = useState(0);
  const result = useActionResult(serverActions.addComment);

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
        issueId: payload.issueId,
        authorId: '',
        body: payload.body,
        createdAt: Date.now(),
        author: null,
      } as CommentData,
    ],
  });
  const { pending } = useFormStatus(serverActions.addComment);

  useEffect(() => {
    if (result?.kind === 'success') {
      setFormKey((k) => k + 1);
      commentsLoader.invalidate();
    }
  }, [result]);

  return (
    <section class="space-y-3">
      <h3 class="font-semibold">Comments</h3>
      <CommentList comments={addComment.value} />
      <Form key={formKey} action={addComment} class="space-y-2">
        <input type="hidden" name="issueId" value={issueId} />
        <textarea
          name="body"
          rows={3}
          required
          placeholder="Add a comment"
          class="block w-full border px-2 py-1"
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

const CommentsView = commentsLoader.View<{ issueId: string }>(
  ({ data: comments, issueId }) => (
    <CommentsSection comments={comments ?? []} issueId={issueId} />
  ),
  { fallback: <p class="text-sm text-muted">Loading comments…</p> }
);

// ---- Section: project activity feed ----

const ActivitySection: FunctionComponent<{ activity: ActivityItem[] }> = ({
  activity,
}) => (
  <aside class="border-t border-border pt-3 text-xs text-muted">
    <h4 class="font-semibold mb-1">Project activity</h4>
    <ul class="space-y-1">
      {activity.map((a, i) => (
        <li key={`${a.kind}-${a.at}-${i}`}>
          <time class="text-muted">{new Date(a.at).toLocaleTimeString()}</time>{' '}
          {a.kind === 'issue-created' && (
            <>
              created <strong>{a.issue.title}</strong>
            </>
          )}
          {a.kind === 'issue-closed' && (
            <>
              closed <strong>{a.issue.title}</strong>
            </>
          )}
          {a.kind === 'comment-added' && (
            <>
              commented on <strong>{a.issue.title}</strong>
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

// ---- Page: issue loads first, then comments + activity in parallel ----

const IssueView = issueLoader.View(
  ({ data: issue, reload: reloadIssue }) => {
    if (!issue) return <p>Issue not found.</p>;
    return (
      <article class="space-y-6">
        <IssueHeaderAndActions issue={issue} reloadIssue={reloadIssue} />
        <CommentsView issueId={issue.id} />
        <ActivityView />
      </article>
    );
  },
  { fallback: <p>Loading issue…</p> }
);

export default definePage(IssueView, { use: requireSession });
