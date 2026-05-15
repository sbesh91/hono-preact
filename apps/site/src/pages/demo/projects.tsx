import { definePage, Head, useAction } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders } from './projects.server.js';
import { serverActions as loginActions } from './login.server.js';
import { requireSession } from '../../demo/guard.js';

const projectsLoader = serverLoaders.default;

const LogoutInline: FunctionComponent<{ user: { name: string } | null }> = ({
  user,
}) => {
  const { mutate, pending } = useAction(loginActions.logout, {
    onSuccess: () => {
      window.location.assign('/demo/login');
    },
  });
  return (
    <span class="text-sm text-gray-700">
      {user?.name} ·{' '}
      <button
        type="button"
        class="underline"
        onClick={() => mutate({})}
        disabled={pending}
      >
        {pending ? 'logging out…' : 'log out'}
      </button>
    </span>
  );
};

const ProjectsPage: FunctionComponent = () => {
  const { user, projects } = projectsLoader.useData();

  return (
    <section class="mx-auto max-w-3xl p-6 space-y-4">
      <Head>
        <title>Projects · demo</title>
      </Head>
      <header class="flex items-baseline justify-between">
        <h1 class="text-2xl font-semibold">Your projects</h1>
        <LogoutInline user={user} />
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
