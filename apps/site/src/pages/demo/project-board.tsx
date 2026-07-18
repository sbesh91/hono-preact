// apps/site/src/pages/demo/project-board.tsx
import { definePage, useParams, useRoute, NavLink } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useRef } from 'preact/hooks';
import { serverLoaders } from './project-board.server.js';
import Board from '../../components/demo/Board.js';
import NewTaskDialog from '../../components/demo/NewTaskDialog.js';
import { BoardInfoPopover } from '../../components/demo/BoardInfoPopover.js';
import { InsightsPanel } from '../../components/demo/InsightsPanel.js';
import { PRIORITY_LABEL } from '../../components/demo/priority.js';
import { PRIORITIES } from '../../demo/data.js';
import { boardHref } from '../../demo/board-links.js';

const boardLoader = serverLoaders.default;

const ProjectBoardPage: FunctionComponent = () => {
  // Hoisted once (not per chip): hooks are illegal in a loop/map callback,
  // and every chip needs the current ?insights= value to preserve it.
  const { searchParams } = useRoute();
  const { projectId: currentSlug } = useParams('/demo/projects/:projectId');
  const { status, data } = boardLoader.useData();

  // Keep the last good board on screen during a SAME-PROJECT reload instead of
  // flashing the full-page skeleton. A ?priority= change is a COLD keyed reload
  // (the loader has no stale value across cache keys, so `data` is briefly
  // undefined) even though we already have a board to show. A mutation reload is
  // `revalidating` and keeps `data`, so it never reaches here.
  //
  // Scope the retained value to the CURRENT project: a project switch keeps this
  // component mounted (same route, new :projectId) and is also a cold keyed
  // reload, so without the slug check the ref would render the previous
  // project's whole board under the new URL until its RPC settles. On a project
  // switch the skeleton is correct; keep-previous applies only within a project.
  const lastData = useRef<typeof data>(undefined);
  if (data) lastData.current = data;
  const prev = lastData.current;
  const shown = data ?? (prev?.project.slug === currentSlug ? prev : undefined);
  if (!shown) return <BoardSkeleton />;
  const pending = status === 'loading';

  const { project, tasks, users, priority, totalCount } = shown;
  // Drive the active chip from the URL, not the loader data: on a filter click
  // the URL updates immediately while `shown` still holds the previous filter's
  // data for a frame, so keying the highlight off `shown.priority` would lag the
  // click. The count line still reads `shown` (it describes the visible tasks).
  const activePriority = searchParams.priority ?? 'all';
  return (
    <div class="flex h-screen flex-col" aria-busy={pending || undefined}>
      <div class="flex items-center gap-3 border-b border-border px-4 py-3.5">
        <h1 class="text-[17px] font-bold">{project.name}</h1>
        <span class="text-[12px] text-muted">
          {priority === 'all'
            ? `${tasks.length} tasks`
            : `${tasks.length} of ${totalCount} tasks`}
        </span>
        <nav
          class="flex items-center gap-1 text-[12px]"
          aria-label="Filter by priority"
        >
          {(['all', ...PRIORITIES] as const).map((p) => (
            <NavLink
              key={p}
              href={boardHref(project.slug, {
                priority: p,
                insights: searchParams.insights,
              })}
              transition={false}
              // NavLink's own active detection is path-only, so it would
              // mark the query-less All chip current too; pin aria-current
              // explicitly here ('false' suppresses NavLink's fallback,
              // since undefined would not).
              aria-current={activePriority === p ? 'page' : 'false'}
              class={[
                'rounded-full px-2 py-0.5 font-medium',
                activePriority === p
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted hover:text-foreground',
              ].join(' ')}
            >
              {p === 'all' ? 'All' : PRIORITY_LABEL[p]}
            </NavLink>
          ))}
        </nav>
        <BoardInfoPopover />
        <div class="ml-auto">
          <NewTaskDialog projectId={project.id} users={users} />
        </div>
      </div>
      <InsightsPanel slug={project.slug} taskSignature={shown.taskSignature} />
      <Board tasks={tasks} projectSlug={project.slug} users={users} />
    </div>
  );
};
ProjectBoardPage.displayName = 'ProjectBoardPage';

const ProjectBoardView = boardLoader.View(
  // ProjectBoardPage owns the loading render: it keeps the previous board up
  // during a filter reload and shows the skeleton only on the cold first load.
  // Rendering it unconditionally (rather than swapping to a bare skeleton here)
  // is what preserves the component instance whose ref holds that previous board.
  () => <ProjectBoardPage />,
  {
    errorFallback: (err, reset) => (
      <div class="mx-auto w-full max-w-xl px-6 py-16 text-center space-y-3">
        <h2 class="text-lg font-semibold text-foreground">
          Couldn&apos;t load this board
        </h2>
        <p class="text-sm text-muted">{err.message}</p>
        <div class="flex justify-center gap-3 text-sm">
          <button class="font-medium underline" onClick={reset}>
            Try again
          </button>
          <a href="/demo/projects" class="font-medium underline">
            Back to projects
          </a>
        </div>
      </div>
    ),
  }
);

function BoardSkeleton() {
  return (
    <div class="grid grid-cols-4 gap-3 p-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} class="h-40 animate-pulse rounded-xl bg-surface-subtle" />
      ))}
    </div>
  );
}

export default definePage(ProjectBoardView, {
  errorFallback: (error, reset) => (
    <div class="mx-auto w-full max-w-xl px-6 py-16 text-center space-y-3">
      <h2 class="text-lg font-semibold text-foreground">
        Something broke rendering this page
      </h2>
      <p class="text-sm text-muted">{error.message}</p>
      <button class="text-sm font-medium underline" onClick={reset}>
        Reset the page
      </button>
    </div>
  ),
});
