// Insights strip under the board header. Deliberately exercises the loader
// error surface end to end: the Boundary provides state to useData()
// children, a cold failure (including the deep-mode TimeoutError) routes to
// errorFallback with a reset, and a stale error after data surfaces through
// useError() without unmounting the stats.
import {
  TimeoutError,
  useRoute,
  useReload,
  NavLink,
  type LoaderState,
} from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { serverLoaders } from '../../pages/demo/project-board.server.js';
import type { ProjectInsights } from '../../pages/demo/board-insights.js';
import { boardHref } from '../../demo/board-links.js';
import { STATUSES, type TaskStatus } from '../../demo/data.js';

const insightsLoader = serverLoaders.insights;

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};

// Pure render body, extracted so it can be exercised with canned loader
// state in a DOM test without mounting the real loader (mirrors
// ActivityBar's renderActivityBar). No behavior change from the inline
// version this replaces.
export function renderInsightsBody(
  state: LoaderState<ProjectInsights>,
  staleError: Error | null,
  slug: string,
  searchParams: Record<string, string>
) {
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
        <NavLink
          href={boardHref(slug, {
            insights: 'deep',
            priority: searchParams.priority,
          })}
          transition={false}
          // These are mode toggles, not location links: suppress NavLink's
          // own path-active fallback (aria-current="false", since undefined
          // would not suppress it) rather than let it mark either arm current.
          aria-current="false"
          class="font-medium underline hover:text-foreground"
        >
          Run deep analysis (times out on purpose)
        </NavLink>
      ) : (
        <NavLink
          href={boardHref(slug, { priority: searchParams.priority })}
          transition={false}
          aria-current="false"
          class="font-medium underline hover:text-foreground"
        >
          Back to quick insights
        </NavLink>
      )}
      {staleError && (
        <span class="text-danger">(refresh failed: {staleError.message})</span>
      )}
    </div>
  );
}

// Recompute the insights loader only on a SAME-PROJECT task mutation. The board
// loader's `taskSignature` fingerprints every task's id+status and is
// filter-independent, so a ?priority= change leaves it unchanged (no recompute,
// which in deep mode would needlessly re-hit the 1s timeout). It DOES change
// wholesale on a project switch, but the route-bound insights loader already
// re-runs for the new project then, so a switch must not trigger a second
// reload. Exported so the contract is unit-tested without mounting the loader.
export function shouldRecomputeInsights(
  prev: { slug: string; taskSignature: string },
  next: { slug: string; taskSignature: string }
): boolean {
  return next.slug === prev.slug && next.taskSignature !== prev.taskSignature;
}

const InsightsBody: FunctionComponent<{
  slug: string;
  taskSignature: string;
}> = ({ slug, taskSignature }) => {
  const state = insightsLoader.useData();
  const staleError = insightsLoader.useError();
  const { searchParams } = useRoute();
  const { reload } = useReload();

  // Auto-recompute: when a board mutation changes the task set, ProjectBoardPage
  // hands down a new taskSignature; invalidate + reload keeps the numbers in
  // sync without a manual button (invalidate() alone only clears the cache;
  // reload() re-runs this active loader now instead of waiting for the next
  // navigation). shouldRecomputeInsights excludes ?priority= changes and project
  // switches; seeding the ref to the mount value excludes the initial render.
  const last = useRef({ slug, taskSignature });
  useEffect(() => {
    const recompute = shouldRecomputeInsights(last.current, {
      slug,
      taskSignature,
    });
    last.current = { slug, taskSignature };
    if (recompute) {
      insightsLoader.invalidate();
      reload();
    }
  }, [slug, taskSignature, reload]);

  return renderInsightsBody(state, staleError, slug, searchParams);
};

export const InsightsPanel: FunctionComponent<{
  slug: string;
  taskSignature: string;
}> = ({ slug, taskSignature }) => (
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
          {/* Hooks are illegal in the errorFallback closure (it renders
              outside the loader's component tree), so useRoute() isn't
              available here: this deliberately drops the current
              ?priority= filter rather than reaching for it. */}
          <a href={`/demo/projects/${slug}`} class="font-medium underline">
            Back to quick insights
          </a>
        </p>
      )}
    >
      <InsightsBody slug={slug} taskSignature={taskSignature} />
    </insightsLoader.Boundary>
  </div>
);
