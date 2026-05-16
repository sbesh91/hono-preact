import { definePage, useAction } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { useTitle } from 'hoofd/preact';
import { serverLoaders, serverActions } from './issue.server.js';
import { requireSession } from '../../demo/guard.js';
import CommentList from '../../components/demo/CommentList.js';
import CommentForm from '../../components/demo/CommentForm.js';
import type { ActivityItem, Comment, Issue, User } from '../../demo/data.js';

const { issue: issueLoader, comments: commentsLoader, activity: activityLoader } =
  serverLoaders;

type WithAuthor<T extends { authorId: string }> = T & { author: User | null };
type IssueData = WithAuthor<Issue>;
type CommentData = WithAuthor<Comment>;

type IssuePageProps = {
  issue: IssueData;
  comments: CommentData[];
  activity: ActivityItem[];
};

const IssuePage: FunctionComponent<IssuePageProps> = ({ issue, comments, activity }) => {
  useTitle(`${issue.title} · demo`);

  // Optimistic status state. Defaults to server state; the action updates this
  // immediately on click, then the invalidated loader reconciles.
  const [optimisticStatus, setOptimisticStatus] = useState(issue.status);
  const { mutate: toggleStatus, pending: toggling } = useAction(
    serverActions.setStatus,
    {
      invalidate: [issueLoader, activityLoader],
      onError: () => setOptimisticStatus(issue.status), // rollback
    }
  );

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
        <CommentList comments={comments} />
        <CommentForm issueId={issue.id} />
      </section>

      <aside class="border-t pt-3 text-xs text-gray-700">
        <h4 class="font-semibold mb-1">Project activity</h4>
        <ul class="space-y-1">
          {activity.map((a, i) => (
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

// Per-loader consumer components defined at module scope (not nested in
// render) so Preact does not remount them on each render. Each one reads its
// own loader inside that loader's Boundary, then passes the resolved value
// down via props.
const ActivityConsumer: FunctionComponent<{
  issue: IssueData;
  comments: CommentData[];
}> = ({ issue, comments }) => {
  const activity = activityLoader.useData() ?? [];
  return <IssuePage issue={issue} comments={comments} activity={activity} />;
};

const CommentsConsumer: FunctionComponent<{ issue: IssueData }> = ({ issue }) => {
  const comments = commentsLoader.useData() ?? [];
  return (
    <activityLoader.Boundary fallback={<p>Loading activity…</p>}>
      <ActivityConsumer issue={issue} comments={comments} />
    </activityLoader.Boundary>
  );
};

const IssueView = issueLoader.View(
  ({ data: issue }: { data: IssueData | null }) => {
    if (!issue) return <p>Issue not found.</p>;
    return (
      <commentsLoader.Boundary fallback={<p>Loading comments…</p>}>
        <CommentsConsumer issue={issue} />
      </commentsLoader.Boundary>
    );
  },
  { fallback: <p>Loading issue…</p> },
);

export default definePage(IssueView, { guards: requireSession });
