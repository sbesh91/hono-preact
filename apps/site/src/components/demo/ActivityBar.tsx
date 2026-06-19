import { useState } from 'preact/hooks';
import { ChevronUp, ChevronDown } from 'lucide-preact';
import type { StreamStatus } from 'hono-preact';
import type { ActivityEvent } from '../../demo/activity-stream.js';
import type { TaskStatus } from '../../demo/data.js';
import { serverLoaders } from '../../pages/demo/projects-shell.server.js';

const activityLoader = serverLoaders.activity;
const MAX = 50;
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
// adopts it.
function ConnectingBar() {
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
export const ActivityBar = activityLoader.View<ActivityEvent[]>(
  ({ data, status }) => <Feed events={data} status={status} />,
  {
    initial: [],
    reduce: (acc, e) => (acc[0]?.id === e.id ? acc : [e, ...acc].slice(0, MAX)),
    fallback: <ConnectingBar />,
  }
);
ActivityBar.displayName = 'ActivityBar';
