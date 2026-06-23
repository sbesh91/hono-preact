import { definePage, useAction } from 'hono-preact';
import { serverLoaders, serverActions } from './live-tally.server.js';

const countLoader = serverLoaders.count;

// Accumulating live view: the latest count pushed over the channel. Open two
// tabs and click Bump in one; both update live, fanned out cross-isolate
// through the Durable Object on Cloudflare.
const LiveTally = countLoader.View<number>(
  ({ data, status }) => {
    const bump = useAction(serverActions.bump);
    return (
      <div class="grid min-h-screen place-items-center bg-background px-4">
        <div class="w-full max-w-md rounded-2xl border border-border bg-surface-subtle p-8 shadow-sm space-y-4 text-center">
          <h1 class="text-xl font-bold text-foreground">Live tally</h1>
          <p class="text-sm text-muted">
            Open this page in a second tab and click Bump. Both update live,
            fanned out cross-isolate through the Durable Object.
          </p>
          <p class="text-5xl font-bold text-foreground tabular-nums">{data}</p>
          <div class="flex items-center justify-center gap-2 text-sm text-muted">
            <span
              class={[
                'inline-block w-2 h-2 rounded-full',
                status === 'open' ? 'bg-green-500' : 'bg-amber-400',
              ].join(' ')}
            />
            <span>{status === 'open' ? 'Connected' : 'Connecting...'}</span>
          </div>
          <button
            type="button"
            class="rounded-md bg-accent text-accent-foreground px-4 py-2 font-medium hover:bg-accent-hover disabled:opacity-60"
            disabled={bump.pending}
            onClick={() => bump.mutate({})}
          >
            Bump
          </button>
          <footer class="border-t border-border pt-4 text-xs text-muted">
            Powered by{' '}
            <a href="/docs/live-data" class="underline hover:text-foreground">
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
    reduce: (_acc, chunk) => chunk.count,
    fallback: (
      <div class="grid min-h-screen place-items-center bg-background px-4">
        <div class="w-full max-w-md rounded-2xl border border-border bg-surface-subtle p-8 shadow-sm space-y-4 text-center">
          <h1 class="text-xl font-bold text-foreground">Live tally</h1>
          <p class="text-sm text-muted">Connecting...</p>
        </div>
      </div>
    ),
  }
);
LiveTally.displayName = 'LiveTally';

export default definePage(LiveTally, {});
