import { usePrefetch, ViewTransitionName } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import type { Issue } from '../../demo/data.js';
import { serverLoaders } from '../../pages/demo/issue.server.js';

type Props = { issue: Issue; projectSlug: string };

const IssueRow: FunctionComponent<Props> = ({ issue, projectSlug }) => {
  const href = `/demo/projects/${projectSlug}/issues/${issue.id}`;

  // Prefetch the issue page's primary loader on hover/focus. The comments
  // loader streams and the activity loader is small; both stay on-demand.
  const prefetchIssue = usePrefetch(href, serverLoaders.issue);

  return (
    <li class="border p-3 flex items-baseline justify-between">
      <ViewTransitionName
        name={`issue-title-${issue.id}`}
        groupClass="issue-card"
        render={
          <a
            href={href}
            onMouseEnter={prefetchIssue}
            onFocus={prefetchIssue}
            class="font-medium underline"
          />
        }
      >
        {issue.title}
      </ViewTransitionName>
      <ViewTransitionName
        name={`issue-status-${issue.id}`}
        groupClass="issue-card"
        render={
          <span
            class={`text-xs px-2 py-0.5 ${
              issue.status === 'open' ? 'badge-success' : 'badge-neutral'
            }`}
          />
        }
      >
        {issue.status}
      </ViewTransitionName>
    </li>
  );
};
IssueRow.displayName = 'IssueRow';

export default IssueRow;
