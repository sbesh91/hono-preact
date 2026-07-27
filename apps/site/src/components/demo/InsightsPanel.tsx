// Insights strip under the board header. Deliberately exercises the loader
// error surface end to end: the Boundary provides state to useData()
// children, a cold failure (including the deep-mode TimeoutError) routes to
// errorFallback with a reset, and a stale error after data surfaces through
// useError() without unmounting the stats.
import {
  TimeoutError,
  useRoute,
  useReload,
  useComputed,
  NavLink,
  type LoaderState,
  type ReadonlySignal,
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

/** The loader's reactive state, as every leaf below receives it. */
type InsightsSignal = ReadonlySignal<LoaderState<ProjectInsights>>;

/**
 * One stat's projection off the loader state. Module-level so each `select` is
 * a stable reference: `useComputed` is `useMemo(..., [])`, so a cell's computed
 * closes over the `select` it was handed on its FIRST render. A fresh arrow per
 * render would pin every cell to whichever selector mounted first.
 */
type StatSpec = {
  key: string;
  /** Plain text before the emphasised number. */
  label: string;
  select: (d: ProjectInsights) => number;
  /** Unit rendered INSIDE the emphasis, e.g. the `d` in `5d`. */
  unit?: string;
  /** Plain text after the emphasis, e.g. the ` tasks` in `7 tasks`. */
  after?: string;
};

const STAT_SPECS: readonly StatSpec[] = [
  { key: 'total', label: '', select: (d) => d.total, after: ' tasks' },
  ...STATUSES.map((s) => ({
    key: s,
    label: `${STATUS_LABEL[s]}: `,
    select: (d: ProjectInsights) => d.byStatus[s],
  })),
  {
    key: 'oldest',
    label: 'oldest open: ',
    select: (d) => d.oldestOpenDays,
    unit: 'd',
  },
];

/**
 * One stat, bound to ONE number off the loader signal.
 *
 * This is the whole point of the signals data layer, made concrete: `computed`
 * propagates only when its value changes by `===`, and a number compares by
 * value, so a reload that leaves this stat's number alone does not re-render
 * this cell. Moving one task from `backlog` to `done` re-renders exactly two of
 * these seven cells. `InsightsPanel.test.tsx` asserts that by render count.
 *
 * `state`'s identity is stable for the loader host's lifetime (the provider
 * owns that invariant), so closing over it here is safe for the same reason
 * closing over `spec` is.
 */
const StatCell: FunctionComponent<{
  state: InsightsSignal;
  spec: StatSpec;
  onRender?: (key: string) => void;
}> = ({ state, spec, onRender }) => {
  onRender?.(spec.key);
  const value = useComputed(() => {
    const s = state.value;
    return s.status === 'loading' ? null : spec.select(s.data);
  });
  if (value.value === null) return null;
  return (
    <span>
      {spec.label}
      <strong class="font-semibold text-foreground">
        {value.value}
        {spec.unit}
      </strong>
      {spec.after}
    </span>
  );
};

/**
 * The quick/deep toggle, bound to the mode alone. A recompute that returns the
 * same mode (the common case) leaves this link untouched, so its NavLink is not
 * rebuilt on every reload.
 */
const ModeLink: FunctionComponent<{
  state: InsightsSignal;
  slug: string;
  searchParams: Record<string, string>;
  onRender?: () => void;
}> = ({ state, slug, searchParams, onRender }) => {
  onRender?.();
  const mode = useComputed(() => {
    const s = state.value;
    return s.status === 'loading' ? null : s.data.mode;
  });
  if (mode.value === null) return null;
  return mode.value === 'quick' ? (
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
  );
};

/** Test seam: lets the granularity test count renders per leaf. */
export type InsightsProbe = {
  cell?: (key: string) => void;
  modeLink?: () => void;
  strip?: () => void;
};

/**
 * The strip. Takes the loader's SIGNAL, not a snapshot, and deliberately reads
 * almost nothing from it: the only thing it subscribes to is a derived boolean,
 * which flips exactly once (cold load to first data). A reload's
 * success -> revalidating -> success churn leaves that boolean alone, so this
 * component does not re-render and the leaves below update independently.
 *
 * Reading `state.value.status` directly here instead would re-render the whole
 * strip on every reload and make the per-leaf projections pointless. That is
 * the mistake the signals migration exists to let you avoid, so the demo had
 * better not make it.
 *
 * Exported so a DOM test can drive it with a plain signal, no loader mounted.
 */
export function renderInsightsBody(
  state: InsightsSignal,
  staleError: Error | null,
  slug: string,
  searchParams: Record<string, string>,
  probe?: InsightsProbe
) {
  return (
    <InsightsStrip
      state={state}
      staleError={staleError}
      slug={slug}
      searchParams={searchParams}
      probe={probe}
    />
  );
}

const InsightsStrip: FunctionComponent<{
  state: InsightsSignal;
  staleError: Error | null;
  slug: string;
  searchParams: Record<string, string>;
  probe?: InsightsProbe;
}> = ({ state, staleError, slug, searchParams, probe }) => {
  probe?.strip?.();
  const cold = useComputed(() => state.value.status === 'loading');
  if (cold.value) {
    return <p class="text-xs text-muted">Computing insights…</p>;
  }
  // A cold failure never reaches here: it routes to the Boundary's
  // errorFallback instead. So the 'error' status is always a stale error over
  // the last good stats, and the data is present on every remaining status.
  // Keep the stats mounted and report the failure inline via useError().
  return (
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {STAT_SPECS.map((spec) => (
        <StatCell
          key={spec.key}
          state={state}
          spec={spec}
          onRender={probe?.cell}
        />
      ))}
      <ModeLink
        state={state}
        slug={slug}
        searchParams={searchParams}
        onRender={probe?.modeLink}
      />
      {staleError && (
        <span class="text-danger">(refresh failed: {staleError.message})</span>
      )}
    </div>
  );
};

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
  // The SIGNAL, not `.value`: this component must not subscribe to the loader,
  // or every reload re-renders the whole strip and the per-leaf projections
  // below buy nothing.
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
