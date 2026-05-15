import { definePage, Head } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders } from './projects.server.js';
import { requireSession } from '../../demo/guard.js';

const projectsLoader = serverLoaders.default;

const ProjectsPage: FunctionComponent = () => {
  const { user, projects } = projectsLoader.useData();

  return (
    <section class="mx-auto max-w-3xl p-6 space-y-4">
      <Head>
        <title>Projects · demo</title>
      </Head>
      <header class="flex items-baseline justify-between">
        <h1 class="text-2xl font-semibold">Your projects</h1>
        <span class="text-sm text-gray-700">
          {user?.name} · <a href="#" data-logout class="underline">log out</a>
        </span>
      </header>
      <ul class="space-y-2">
        {projects.map((p) => (
          <li key={p.id} class="border p-3 flex items-baseline justify-between">
            <a href={`/demo/projects/${p.slug}`} class="font-medium underline">
              {p.name}
            </a>
            <span class="text-sm text-gray-700">
              {p.openCount} open / {p.totalCount} total
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};
ProjectsPage.displayName = 'ProjectsPage';

const ProjectsView = projectsLoader.View(() => <ProjectsPage />, {
  fallback: <p class="p-6">Loading projects…</p>,
});

export default definePage(ProjectsView, { guards: [requireSession] });
