import type { FunctionComponent } from 'preact';

// The page tree the archived-project gate swaps in via the render() outcome.
// Server-rendered in place of the board; no loaders run for the page.
export const ArchivedProjectNotice: FunctionComponent = () => (
  <div class="mx-auto w-full max-w-xl px-6 py-16 text-center space-y-3">
    <h2 class="text-lg font-semibold text-foreground">
      This project is archived
    </h2>
    <p class="text-sm text-muted">
      A server middleware on the project route returned the framework&apos;s
      render() outcome, replacing the page tree before any loader ran.
    </p>
    <a href="/demo/projects" class="text-sm font-medium underline">
      Back to projects
    </a>
  </div>
);
