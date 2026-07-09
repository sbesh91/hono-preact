import { definePage, useTitle } from 'hono-preact';
import type { FunctionComponent } from 'preact';

const ProjectsIndex: FunctionComponent = () => {
  useTitle('Projects · demo');
  return (
    <div class="grid h-screen place-items-center p-6 text-center">
      <div>
        <h1 class="text-xl font-semibold">Select a project</h1>
        <p class="mt-1 text-sm text-muted">
          Pick a project from the sidebar to open its board.
        </p>
      </div>
    </div>
  );
};
ProjectsIndex.displayName = 'ProjectsIndex';
export default definePage(ProjectsIndex, {});
