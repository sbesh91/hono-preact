import { prefetch } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useCallback } from 'preact/hooks';
import type { Issue } from '../../demo/data.js';

type Props = { issue: Issue; projectSlug: string };

const IssueRow: FunctionComponent<Props> = ({ issue, projectSlug }) => {
  const href = `/demo/projects/${projectSlug}/issues/${issue.id}`;
  const onMouseEnter = useCallback(() => {
    prefetch(href);
  }, [href]);

  return (
    <li class="border p-3 flex items-baseline justify-between">
      <a
        href={href}
        onMouseEnter={onMouseEnter}
        onFocus={onMouseEnter}
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
