import { subscribeViewTransitionTypes } from 'hono-preact';
import { useEffect, useState } from 'preact/hooks';
import { ChevronUp, ChevronDown } from 'lucide-preact';
import type { ActivityEvent } from '../../demo/activity-stream.js';
import type { TaskStatus } from '../../demo/data.js';

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
    return `${e.actor} moved "${e.taskTitle}" → ${STATUS_LABEL[e.to]}`;
  return `${e.actor} commented on "${e.taskTitle}"`;
}

// Persistent live-activity bar. Mounted via <Persist> (see demo-layout), so it
// renders inside PersistHost OUTSIDE the router: no router hooks. It owns its
// own EventSource; the connection and accumulated feed survive intra-app
// navigation because the component instance persists.
export function ActivityBar() {
  const [path, setPath] = useState(
    typeof window === 'undefined' ? '' : window.location.pathname
  );
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [connected, setConnected] = useState(false);

  // Learn the current path from outside the router: window on mount, then every
  // navigation via the global (non-hook) view-transition subscription. Returns
  // undefined so it adds no transition types; used purely for nav.to.
  useEffect(() => {
    setPath(window.location.pathname);
    return subscribeViewTransitionTypes((nav) => {
      setPath(nav.to);
      return undefined;
    });
  }, []);

  const isApp = path.startsWith('/demo/projects');

  // Open the stream only inside the app area. Keyed on `isApp` so it stays open
  // across intra-app navigation (dep unchanged -> no re-run) and closes on exit.
  useEffect(() => {
    if (!isApp || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/demo/activity');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        // Trust boundary: our own endpoint. JSON parse cast is acceptable.
        const e = JSON.parse(ev.data) as ActivityEvent;
        setEvents((prev) => [e, ...prev].slice(0, MAX));
      } catch {
        // ignore a malformed frame
      }
    };
    return () => {
      es.close();
      setConnected(false);
    };
  }, [isApp]);

  if (typeof window === 'undefined' || !isApp) return null;

  const latest = events[0];
  return (
    <div class="demo-activity-bar fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-subtle/95 backdrop-blur">
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
ActivityBar.displayName = 'ActivityBar';
