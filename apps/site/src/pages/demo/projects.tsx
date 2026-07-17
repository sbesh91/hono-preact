import { definePage, useAction, useTitle } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { serverActions } from './projects-shell.server.js';

const ProjectsIndex: FunctionComponent = () => {
  useTitle('Projects · demo');
  const [lines, setLines] = useState<string[]>([]);
  // onChunk fires per generator yield; mutate resolves with the return value.
  const digest = useAction(serverActions.digest, {
    onChunk: (line) => setLines((prev) => [...prev, line]),
  });

  return (
    <div class="grid h-screen place-items-center p-6 text-center">
      <div class="w-full max-w-md space-y-4">
        <div>
          <h1 class="text-xl font-semibold">Select a project</h1>
          <p class="mt-1 text-sm text-muted">
            Pick a project from the sidebar to open its board.
          </p>
        </div>
        <div class="rounded-xl border border-border bg-background p-4 text-left">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold text-foreground">
              Workspace digest
            </h2>
            <button
              class="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-60"
              disabled={digest.pending}
              onClick={() => {
                setLines([]);
                void digest.mutate({});
              }}
            >
              {digest.pending ? 'Generating…' : 'Generate'}
            </button>
          </div>
          {lines.length > 0 && (
            <ul class="mt-3 space-y-1 text-xs text-foreground">
              {lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          {digest.data && (
            <p class="mt-3 border-t border-border pt-2 text-xs text-muted">
              {digest.data.projects} projects, {digest.data.tasks} tasks, run by{' '}
              {digest.data.by}. Streamed line by line over a generator action.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
ProjectsIndex.displayName = 'ProjectsIndex';

export default definePage(ProjectsIndex, {});
