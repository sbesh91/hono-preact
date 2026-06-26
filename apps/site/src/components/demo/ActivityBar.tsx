import { useState } from 'preact/hooks';
import { ChevronUp, ChevronDown } from 'lucide-preact';
import type { StreamState, StreamStatus } from 'hono-preact';
import type { ActivityEvent } from '../../demo/activity-stream.js';
import type { TaskStatus } from '../../demo/data.js';
import { serverLoaders } from '../../pages/demo/projects-shell.server.js';

const activityLoader = serverLoaders.activity;

/** Most recent events kept in the feed. */
export const ACTIVITY_MAX = 50;

// The feed reducer: newest-first, de-duped against the current head (the stream
// backfills then tails, so a re-yielded head is a dup, not a new event), capped
// at ACTIVITY_MAX. Exported so it can be unit-tested directly.
export function accumulateActivity(
  acc: ActivityEvent[],
  e: ActivityEvent
): ActivityEvent[] {
  return acc[0]?.id === e.id ? acc : [e, ...acc].slice(0, ACTIVITY_MAX);
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

function describeEvent(e: ActivityEvent): string {
  if (e.kind === 'task-created') return `${e.actor} created "${e.taskTitle}"`;
  if (e.kind === 'task-moved')
    return `${e.actor} moved "${e.taskTitle}" to ${STATUS_LABEL[e.to]}`;
  return `${e.actor} commented on "${e.taskTitle}"`;
}

const SHELL =
  'demo-activity-bar fixed bottom-6 right-6 z-40 w-[22rem] max-w-[90vw] overflow-hidden rounded-xl border border-border bg-surface-subtle/95 shadow-lg backdrop-blur';

// Suspense fallback (connecting state). The same markup the server renders for
// the live loader and the client shows until the first chunk, so hydration
// adopts it. Exported for the fallback render test.
export function ConnectingBar() {
  return (
    <div class={SHELL}>
      <div class="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px]">
        <span class="h-2 w-2 shrink-0 rounded-full bg-muted" aria-hidden />
        <span class="min-w-0 flex-1 truncate text-muted">
          Listening for activity…
        </span>
      </div>
    </div>
  );
}

// Cold-error affordance: the live stream's connect rejected before any chunk, so
// there is no accumulated feed to show. Mirrors ConnectingBar's shell (a red dot
// instead of muted) so the bar stays in place rather than dereferencing the
// absent `events`. Exported for the error render test.
export function ErrorBar() {
  return (
    <div class={SHELL}>
      <div class="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px]">
        <span class="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
        <span class="min-w-0 flex-1 truncate text-muted">
          Activity stream disconnected.
        </span>
      </div>
    </div>
  );
}

function Feed({
  events,
  status,
}: {
  events: ActivityEvent[];
  status: StreamStatus;
}) {
  const [expanded, setExpanded] = useState(false);
  const connected = status === 'open';
  const latest = events[0];
  return (
    <div class={SHELL}>
      {expanded && (
        <div
          role="log"
          aria-label="Recent activity"
          class="demo-activity-feed max-h-64 overflow-y-auto border-b border-border px-4 py-2"
        >
          {events.length === 0 ? (
            <p class="py-4 text-center text-xs text-muted">No activity yet.</p>
          ) : (
            <ul class="space-y-1.5">
              {events.map((e) => (
                <li key={e.id} class="flex items-baseline gap-2 text-[13px]">
                  <span class="text-foreground">{describeEvent(e)}</span>
                  <span class="ml-auto shrink-0 text-[11px] uppercase tracking-wide text-muted">
                    {e.projectSlug}
                  </span>
                  <time class="shrink-0 text-[11px] text-muted">
                    {new Date(e.at).toLocaleTimeString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button
        type="button"
        aria-label="Toggle activity feed"
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        class="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px]"
      >
        <span
          class={`h-2 w-2 shrink-0 rounded-full ${
            connected ? 'demo-activity-pulse bg-accent' : 'bg-muted'
          }`}
          aria-hidden
        />
        <span class="min-w-0 flex-1 truncate text-foreground">
          {latest ? describeEvent(latest) : 'Listening for activity…'}
        </span>
        <span class="shrink-0 rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] font-semibold text-muted">
          {events.length}
        </span>
        {expanded ? (
          <ChevronDown size={15} aria-hidden />
        ) : (
          <ChevronUp size={15} aria-hidden />
        )}
      </button>
    </div>
  );
}

// Live-activity bar consumed via the framework's `.View` convention: an
// accumulating stream folded into a capped feed. `.View` renders through
// LoaderHost (Suspense + useId), so the bar hydrates cleanly inside the lazy
// projects-shell layout (no orphan, no isBrowser guard). On SSR the loader
// never runs and the fallback renders; the client connects and folds chunks.
// The `.View` render fn, pulled out as a named export so the SSR regression
// guard (ActivityBar.ssr.test.tsx) can drive the REAL render fn + Feed through
// a real (keyed) live loader, exactly as ActivityBar does.
//
// `connecting` carries no data (SSR and pre-first-chunk) and a COLD `error`
// (the connect rejected before any chunk) carries no data either, so both MUST
// short-circuit before Feed: Feed dereferences `events[0]`/`events.map`, so
// handing it `undefined` 500s the SSR. A POST-chunk `error` still carries the
// last-good `data`, so it falls through to Feed (the muted status dot reflects
// the disconnect). Feed therefore only ever sees a real accumulated
// `ActivityEvent[]` (open/closed/error-with-data arms).
export function renderActivityBar(s: StreamState<ActivityEvent[]>) {
  if (s.status === 'open' || s.status === 'closed')
    return <Feed events={s.data} status={s.status} />;
  // A POST-chunk error keeps the last-good feed visible (the muted status dot
  // reflects the disconnect); a COLD error carries no `data`, so show the error
  // bar instead of handing Feed an `undefined` events array.
  if (s.status === 'error')
    return s.data !== undefined ? (
      <Feed events={s.data} status={s.status} />
    ) : (
      <ErrorBar />
    );
  return <ConnectingBar />;
}

export const ActivityBar = activityLoader.View<ActivityEvent[]>(
  renderActivityBar,
  {
    initial: [],
    reduce: accumulateActivity,
  }
);
ActivityBar.displayName = 'ActivityBar';
