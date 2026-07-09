import { Route, useLocation } from 'preact-iso';
import { useTitle } from 'hono-preact';

export function PageNotFound() {
  const location = useLocation();
  useTitle('Page not found · hono-preact');
  return (
    <main class="grid min-h-screen place-items-center bg-background px-6 py-16 text-center">
      <div class="max-w-md space-y-4">
        <p
          class="text-7xl font-semibold leading-none text-orangenta"
          aria-hidden="true"
        >
          404
        </p>
        <h1 class="text-2xl font-semibold text-foreground">
          There's nothing at this address.
        </h1>
        <p class="text-sm leading-relaxed text-muted">
          <code class="rounded bg-surface-subtle px-1.5 py-0.5">
            {location.url}
          </code>{' '}
          may have moved, or the URL has a typo.
        </p>
        <div class="flex justify-center gap-3 pt-2">
          <a
            href="/docs"
            class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-hover"
          >
            Browse the docs
          </a>
          <a
            href="/"
            class="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-subtle"
          >
            Go home
          </a>
        </div>
      </div>
    </main>
  );
}

export default function NotFound() {
  return <Route default component={PageNotFound} />;
}
