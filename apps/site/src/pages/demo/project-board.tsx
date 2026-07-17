// apps/site/src/pages/demo/project-board.tsx
import { definePage } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders } from './project-board.server.js';
import Board from '../../components/demo/Board.js';
import NewTaskDialog from '../../components/demo/NewTaskDialog.js';

const boardLoader = serverLoaders.default;

const ProjectBoardPage: FunctionComponent = () => {
  const { status, data } = boardLoader.useData();
  if (status === 'loading') return <BoardSkeleton />;
  if (!data) return <BoardSkeleton />;
  const { project, tasks, users } = data;
  return (
    <div class="flex h-screen flex-col">
      <div class="flex items-center gap-3 border-b border-border px-4 py-3.5">
        <h1 class="text-[17px] font-bold">{project.name}</h1>
        <span class="text-[12px] text-muted">{tasks.length} tasks</span>
        <div class="ml-auto">
          <NewTaskDialog projectId={project.id} users={users} />
        </div>
      </div>
      <Board tasks={tasks} projectSlug={project.slug} users={users} />
    </div>
  );
};
ProjectBoardPage.displayName = 'ProjectBoardPage';

const ProjectBoardView = boardLoader.View(
  ({ status }) =>
    status === 'loading' ? <BoardSkeleton /> : <ProjectBoardPage />,
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
