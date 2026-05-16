import { definePage, useAction } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { useTitle } from 'hoofd/preact';
import { serverLoaders, serverActions } from './issue.server.js';
import { requireSession } from '../../demo/guard.js';
import CommentList from '../../components/demo/CommentList.js';
import CommentForm from '../../components/demo/CommentForm.js';

const { issue: issueLoader, comments: commentsLoader, activity: activityLoader } =
  serverLoaders;

const IssuePage: FunctionComponent = () => {
  const issue = issueLoader.useData();
  const comments = commentsLoader.useData();
  const activity = activityLoader.useData();

  // Optimistic status state. Defaults to server state; the action updates this
  // immediately on click, then the invalidated loader reconciles.
  const [optimisticStatus, setOptimisticStatus] = useState(issue?.status ?? 'open');
  const { mutate: toggleStatus, pending: toggling } = useAction(
    serverActions.setStatus,
    {
      invalidate: [issueLoader, activityLoader],
      onError: () => setOptimisticStatus(issue?.status ?? 'open'), // rollback
    }
  );

  useTitle(issue ? `${issue.title} · demo` : 'Issue not found · demo');

  if (!issue) return <p>Issue not found.</p>;

  const status = toggling ? optimisticStatus : issue.status;
  const nextStatus = status === 'open' ? 'closed' : 'open';

  return (
    <article class="space-y-6">
      <header class="space-y-2">
        <div class="flex items-center gap-2">
          <h2 class="text-xl font-semibold">{issue.title}</h2>
          <span
            class={`text-xs px-2 py-0.5 ${
              status === 'open' ? 'bg-green-200' : 'bg-gray-200'
            }`}
          >
            {status}
          </span>
        </div>
        <p class="text-sm text-gray-700">
          Opened by <strong>{issue.author?.name ?? 'someone'}</strong> on{' '}
          {new Date(issue.createdAt).toLocaleDateString()}
        </p>
      </header>

      {issue.body && <p class="whitespace-pre-wrap">{issue.body}</p>}

      <div>
        <button
          type="button"
          class="bg-gray-700 text-white px-3 py-1 text-sm"
          disabled={toggling}
          onClick={() => {
            setOptimisticStatus(nextStatus);
            toggleStatus({ issueId: issue.id, status: nextStatus });
          }}
        >
          {toggling
            ? `${nextStatus === 'closed' ? 'Closing' : 'Reopening'}…`
            : nextStatus === 'closed'
              ? 'Close issue'
              : 'Reopen issue'}
        </button>
      </div>

      <section class="space-y-3">
        <h3 class="font-semibold">Comments</h3>
        <CommentList comments={comments ?? []} />
        <CommentForm issueId={issue.id} />
      </section>

      <aside class="border-t pt-3 text-xs text-gray-700">
        <h4 class="font-semibold mb-1">Project activity</h4>
        <ul class="space-y-1">
          {(activity ?? []).map((a, i) => (
            <li key={`${a.kind}-${a.at}-${i}`}>
              <time class="text-gray-500">
                {new Date(a.at).toLocaleTimeString()}
              </time>{' '}
              {a.kind === 'issue-created' && (
                <>created <strong>{a.issue.title}</strong></>
              )}
              {a.kind === 'issue-closed' && (
                <>closed <strong>{a.issue.title}</strong></>
              )}
              {a.kind === 'comment-added' && (
                <>commented on <strong>{a.issue.title}</strong></>
              )}
            </li>
          ))}
        </ul>
      </aside>
    </article>
  );
};
IssuePage.displayName = 'IssuePage';

// Compose multi-loader boundaries from the inside out. Each .View() returns a
// FunctionComponent that wraps its render in a Boundary for that loader.
const ActivityView = activityLoader.View(() => <IssuePage />, {
  fallback: <p>Loading activity…</p>,
});

const CommentsView = commentsLoader.View(() => <ActivityView />, {
  fallback: <p>Loading comments…</p>,
});

const IssueView = issueLoader.View(() => <CommentsView />, {
  fallback: <p>Loading issue…</p>,
});

export default definePage(IssueView, { guards: requireSession });
