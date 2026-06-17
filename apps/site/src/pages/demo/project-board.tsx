// apps/site/src/pages/demo/project-board.tsx
import { definePage } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders } from './project-board.server.js';
import Board from '../../components/demo/Board.js';

const boardLoader = serverLoaders.default;

const ProjectBoardPage: FunctionComponent = () => {
  const data = boardLoader.useData();
  if (!data) return <p class="p-6">Unknown project.</p>;
  const { project, tasks, users } = data;
  return (
    <>
      <div class="flex items-center gap-3 border-b border-border px-4 py-3.5">
        <h1 class="text-[17px] font-bold">{project.name}</h1>
        <span class="text-[12px] text-muted">{tasks.length} tasks</span>
        {/* New-task trigger added in Task 9 */}
      </div>
      <Board tasks={tasks} projectSlug={project.slug} users={users} />
    </>
  );
};
ProjectBoardPage.displayName = 'ProjectBoardPage';

const ProjectBoardView = boardLoader.View(() => <ProjectBoardPage />, {
  fallback: <BoardSkeleton />,
});

function BoardSkeleton() {
  return (
    <div class="grid grid-cols-4 gap-3 p-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} class="h-40 animate-pulse rounded-xl bg-surface-subtle" />
      ))}
    </div>
  );
}

export default definePage(ProjectBoardView);
