import { definePage, useAction } from 'hono-preact';
import { serverLoaders, serverActions } from './live-tally.server.js';

const pingsLoader = serverLoaders.pings;

// Live updates demo: a tally of how many live updates THIS tab received (the
// initial connect, plus one per Ping from any tab). Click Ping and every open
// tab ticks up together, fanned out cross-isolate through the Durable Object on
// Cloudflare. There is no shared counter: publish() syncs the EVENT, not state,
// so each tab keeps its own honest count (the reduce just counts arrivals).
const LiveTally = pingsLoader.View<number>(
  (s) => {
    const ping = useAction(serverActions.ping);
    // Only `open`/`closed` carry the accumulated tally; `connecting` and a cold
    // `error` carry no data, so fall back to the initial tally (0) until a chunk
    // arrives, rather than dereferencing `s.data`.
    const count = s.status === 'open' || s.status === 'closed' ? s.data : 0;
    return (
      <div class="grid min-h-screen place-items-center bg-background px-4">
        <div class="w-full max-w-md rounded-2xl border border-border bg-surface-subtle p-8 shadow-sm space-y-4 text-center">
          <h1 class="text-xl font-bold text-foreground">Live tally</h1>
          <p class="text-sm text-muted">
            Open this page in a second tab and click Ping. Every open tab gets a
            live update, fanned out cross-isolate through the Durable Object.
          </p>
          <p class="text-5xl font-bold text-foreground tabular-nums">{count}</p>
          <p class="text-xs text-muted">live updates received in this tab</p>
          <div class="flex items-center justify-center gap-2 text-sm text-muted">
            <span
              class={[
                'inline-block w-2 h-2 rounded-full',
                s.status === 'open'
                  ? 'bg-green-500'
                  : s.status === 'error'
                    ? 'bg-red-500'
                    : 'bg-amber-400',
              ].join(' ')}
            />
            <span>
              {s.status === 'open'
                ? 'Connected'
                : s.status === 'error'
                  ? 'Disconnected'
                  : 'Connecting...'}
            </span>
          </div>
          <button
            type="button"
            class="rounded-md bg-accent text-accent-foreground px-4 py-2 font-medium hover:bg-accent-hover disabled:opacity-60"
            disabled={ping.pending}
            onClick={() => ping.mutate({})}
          >
            Ping all tabs
          </button>
          <footer class="border-t border-border pt-4 text-xs text-muted">
            Powered by{' '}
            <a
              href="/docs/live-loaders"
              class="underline hover:text-foreground"
            >
              live loaders + publish
            </a>
            .{' '}
            <a href="/demo" class="underline hover:text-foreground">
              Back to demo
            </a>
          </footer>
        </div>
      </div>
    );
  },
  {
    initial: 0,
    // The wake itself is the update; count arrivals (initial connect + each
    // Ping). Each tab counts independently, which is the honest picture: publish
    // fans the event out cross-isolate, it does not share a value.
    reduce: (received) => received + 1,
  }
);
LiveTally.displayName = 'LiveTally';

export default definePage(LiveTally, {});
