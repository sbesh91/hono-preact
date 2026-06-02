import { definePage } from 'hono-preact';
import type { FunctionComponent } from 'preact';

const DemoIndex: FunctionComponent = () => (
  <section class="mx-auto max-w-2xl p-6 space-y-4">
    <header>
      <h1 class="text-2xl font-semibold">Demo: a mini issue tracker</h1>
      <p class="text-sm text-muted mt-1">
        Everything below is built with <code>hono-preact</code>. This is the
        same framework, the same primitives, exercising every feature the
        framework ships.
      </p>
    </header>
    <p>
      The data is in-memory and resets when the Worker restarts. Anything you
      create here is temporary.
    </p>
    <p>
      <a
        href="/demo/projects"
        class="text-accent underline hover:text-accent-hover"
      >
        Go to projects →
      </a>
    </p>
    <footer class="text-xs text-muted pt-6">
      Behind the scenes: see{' '}
      <a href="/docs/loaders" class="underline">
        loaders
      </a>
      ,{' '}
      <a href="/docs/actions" class="underline">
        actions
      </a>
      ,{' '}
      <a href="/docs/streaming" class="underline">
        streaming
      </a>
      ,{' '}
      <a href="/docs/guards" class="underline">
        guards
      </a>
      .
    </footer>
  </section>
);
DemoIndex.displayName = 'DemoIndex';

export default definePage(DemoIndex, {});
