// Insights strip under the board header. Deliberately exercises the loader
// error surface end to end: the Boundary provides state to useData()
// children, a cold failure (including the deep-mode TimeoutError) routes to
// errorFallback with a reset, and a stale error after data surfaces through
// useError() without unmounting the stats.
import { TimeoutError } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders } from '../../pages/demo/project-board.server.js';
import { STATUSES, type TaskStatus } from '../../demo/data.js';

const insightsLoader = serverLoaders.insights;

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};

const InsightsBody: FunctionComponent<{ slug: string }> = ({ slug }) => {
  const state = insightsLoader.useData();
  const staleError = insightsLoader.useError();
  if (state.status === 'loading') {
    return <p class="text-xs text-muted">Computing insights…</p>;
  }
  // A cold failure never reaches here: it routes to the Boundary's
  // errorFallback instead. So the 'error' status on this arm is always a
  // stale error over the last good stats, and `state.data` is present on
  // every remaining status. Keep the stats mounted and report the failure
  // inline via useError() below, rather than unmounting them.
  const d = state.data;
  return (
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span>
        <strong class="font-semibold text-foreground">{d.total}</strong> tasks
      </span>
      {STATUSES.map((s) => (
        <span key={s}>
          {STATUS_LABEL[s]}:{' '}
          <strong class="font-semibold text-foreground">{d.byStatus[s]}</strong>
        </span>
      ))}
      <span>
        oldest open:{' '}
        <strong class="font-semibold text-foreground">
          {d.oldestOpenDays}d
        </strong>
      </span>
      {d.mode === 'quick' ? (
        <a
          href={`/demo/projects/${slug}?insights=deep`}
          class="font-medium underline hover:text-foreground"
        >
          Run deep analysis (times out on purpose)
        </a>
      ) : (
        <a
          href={`/demo/projects/${slug}`}
          class="font-medium underline hover:text-foreground"
        >
          Back to quick insights
        </a>
      )}
      {staleError && (
        <span class="text-danger">(refresh failed: {staleError.message})</span>
      )}
    </div>
  );
};

export const InsightsPanel: FunctionComponent<{ slug: string }> = ({
  slug,
}) => (
  <div class="border-b border-border bg-surface-subtle px-4 py-2">
    <insightsLoader.Boundary
      errorFallback={(err, reset) => (
        <p class="text-xs text-muted">
          {err instanceof TimeoutError
            ? 'Deep analysis exceeded the loader’s 1s timeoutMs (that is the demo). '
            : `Insights failed: ${err.message} `}
          <button class="font-medium underline" onClick={reset}>
            Try again
          </button>{' '}
          <a href={`/demo/projects/${slug}`} class="font-medium underline">
            Back to quick insights
          </a>
        </p>
      )}
    >
      <InsightsBody slug={slug} />
    </insightsLoader.Boundary>
  </div>
);
