import { prefetch } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useCallback } from 'preact/hooks';
import type { Issue } from '../../demo/data.js';
import { serverLoaders } from '../../pages/demo/issue.server.js';

type Props = { issue: Issue; projectSlug: string };

const ISSUE_ROUTE = '/demo/projects/:projectId/issues/:issueId';

const IssueRow: FunctionComponent<Props> = ({ issue, projectSlug }) => {
  const href = `/demo/projects/${projectSlug}/issues/${issue.id}`;

  // Prefetch the issue page's primary loader on hover/focus. The comments
  // loader streams and the activity loader is small; both stay on-demand.
  const onPrefetch = useCallback(() => {
    void prefetch(serverLoaders.issue, { url: href, route: ISSUE_ROUTE });
  }, [href]);

  return (
    <li class="border p-3 flex items-baseline justify-between">
      <a
        href={href}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        class="font-medium underline"
      >
        {issue.title}
      </a>
      <span
        class={`text-xs px-2 py-0.5 ${
          issue.status === 'open' ? 'bg-green-200' : 'bg-gray-200'
        }`}
      >
        {issue.status}
      </span>
    </li>
  );
};
IssueRow.displayName = 'IssueRow';

export default IssueRow;
