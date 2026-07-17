import { definePage, useTitle } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders as auditLoaders } from '../../server/audit/log.server.js';

// Route-less registry loader consumed from a page: the client stub reaches
// it by module key over the loaders RPC. Entries come from the app-level
// stream observer, so visiting the projects board populates this feed.
const RecentServerActivity = auditLoaders.recent.View(({ status, data }) => (
  <section class="rounded-xl border border-border bg-background p-4 text-left">
    <h2 class="text-sm font-semibold text-foreground">Recent server streams</h2>
    {status === 'loading' || !data ? (
      <p class="mt-2 text-xs text-muted">Loading…</p>
    ) : data.entries.length === 0 ? (
      <p class="mt-2 text-xs text-muted">
        Nothing yet. Open the projects board, then come back.
      </p>
    ) : (
      <ul class="mt-2 space-y-1 font-mono text-[11px] text-muted">
        {/* The list is a wholesale-replaced snapshot on every load, so index
            keys are stable enough and immune to duplicate lines colliding. */}
        {data.entries.slice(0, 8).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    )}
  </section>
));

const DemoIndex: FunctionComponent = () => {
  useTitle('Demo');
  return (
    <div class="grid min-h-screen place-items-center gap-4 bg-background px-4 py-8">
      <div class="w-full max-w-sm rounded-2xl border border-border bg-surface-subtle p-8 shadow-sm">
        <div class="mb-6">
          <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-orange to-magenta-500">
            <span class="text-lg font-bold text-white">T</span>
          </div>
          <h1 class="text-xl font-bold text-foreground">Tasks demo</h1>
          <p class="mt-1 text-sm text-muted">
            Everything here is built with <code>hono-preact</code>, exercising
            every feature the framework ships: loaders, actions, streaming,
            guards, view transitions, and UI primitives.
          </p>
        </div>
        <p class="mb-4 text-sm text-muted">
          The data is in-memory and resets when the Worker restarts. Anything
          you create here is temporary.
        </p>
        <a
          href="/demo/projects"
          class="block w-full rounded-lg bg-accent px-4 py-2 text-center text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
        >
          Go to projects
        </a>
        <a
          href="/demo/cursors"
          class="mt-2 block w-full rounded-lg border border-border bg-surface px-4 py-2 text-center text-sm font-semibold text-foreground hover:bg-surface-subtle"
        >
          Live cursors (Durable Object)
        </a>
        <a
          href="/demo/live-tally"
          class="mt-2 block w-full rounded-lg border border-border bg-surface px-4 py-2 text-center text-sm font-semibold text-foreground hover:bg-surface-subtle"
        >
          Live tally (cross-isolate publish)
        </a>
        <footer class="mt-6 border-t border-border pt-4 text-xs text-muted">
          Behind the scenes:{' '}
          <a href="/docs/loaders" class="underline hover:text-foreground">
            loaders
          </a>
          ,{' '}
          <a href="/docs/actions" class="underline hover:text-foreground">
            actions
          </a>
          ,{' '}
          <a href="/docs/streaming" class="underline hover:text-foreground">
            streaming
          </a>
          ,{' '}
          <a href="/docs/middleware" class="underline hover:text-foreground">
            guards
          </a>
          .
        </footer>
      </div>
      <div class="w-full max-w-2xl">
        <RecentServerActivity />
      </div>
    </div>
  );
};
DemoIndex.displayName = 'DemoIndex';

export default definePage(DemoIndex, {});
