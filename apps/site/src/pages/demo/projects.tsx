import { definePage, useAction, useNavigate, ViewTransitionName } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import { useTitle } from 'hoofd/preact';
import { serverLoaders } from './projects.server.js';
import { serverActions as loginActions } from './login.server.js';
import { requireSession, DEMO_AUTHED_KEY } from '../../demo/guard.js';

const projectsLoader = serverLoaders.default;

const LogoutInline: FunctionComponent<{ user: { name: string } | null }> = ({
  user,
}) => {
  const navigate = useNavigate();
  const { mutate, pending } = useAction(loginActions.logout, {
    onSuccess: () => {
      try {
        window.localStorage.removeItem(DEMO_AUTHED_KEY);
      } catch {
        // ignore: a soft nav still leaves the in-memory flag cleared
      }
      navigate('/demo/login', { replace: true });
    },
  });
  return (
    <span class="text-sm text-muted">
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
  useTitle('Projects · demo');

  // Bootstrap the client-guard flag from any successful authed render. This
  // self-heals the case where a user has a valid cookie but no localStorage
  // flag (e.g. cleared storage, new browser, etc.).
  useEffect(() => {
    if (!user) return;
    try {
      window.localStorage.setItem(DEMO_AUTHED_KEY, '1');
    } catch {
      // ignore
    }
  }, [user]);

  return (
    <section class="mx-auto max-w-3xl p-6 space-y-4">
      <header class="flex items-baseline justify-between">
        <h1 class="text-2xl font-semibold">Your projects</h1>
        <LogoutInline user={user} />
      </header>
      <ul class="space-y-2">
        {projects.map((p) => (
          <li key={p.id} class="border p-3 flex items-baseline justify-between">
            <ViewTransitionName
              name={`project-${p.slug}`}
              render={
                <a
                  href={`/demo/projects/${p.slug}`}
                  class="font-medium underline"
                />
              }
            >
              {p.name}
            </ViewTransitionName>
            <span class="text-sm text-muted">
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

export default definePage(ProjectsView, { use: requireSession });
