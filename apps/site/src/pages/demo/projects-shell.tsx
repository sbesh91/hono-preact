import type { LayoutProps } from 'hono-preact';
import { buildPath, useAction, useNavigate, useRoute } from 'hono-preact';
import { ActivityBar } from '../../components/demo/ActivityBar.js';
import { useEffect } from 'preact/hooks';
import { serverLoaders } from './projects-shell.server.js';
import { serverActions as loginActions } from './login.server.js';
import { DEMO_AUTHED_KEY } from '../../demo/guard.js';
import type { ShellData } from './projects-shell.server.js';

const shellLoader = serverLoaders.default;

function Sidebar({
  data,
  children,
}: {
  data: ShellData;
  children: LayoutProps['children'];
}) {
  const navigate = useNavigate();
  // Read the current route's pathParams directly so we can tolerate the case
  // where the sidebar renders on /demo/projects (no :projectId segment) and
  // the case where it renders on /demo/projects/:projectId. useParams always
  // asserts the key is present, so we drop to useRoute().pathParams for the
  // safe read.
  const { pathParams } = useRoute();
  const activeSlug: string | undefined = pathParams.projectId;

  // Self-heal the client guard flag on any authed render.
  useEffect(() => {
    if (!data.user) return;
    try {
      window.localStorage.setItem(DEMO_AUTHED_KEY, '1');
    } catch {
      // ignore (private browsing, storage full, etc.)
    }
  }, [data.user]);

  const logout = useAction(loginActions.logout, {
    onSuccess: () => {
      try {
        window.localStorage.removeItem(DEMO_AUTHED_KEY);
      } catch {
        // ignore
      }
      navigate('/demo/login', { replace: true });
    },
  });

  return (
    <div class="grid min-h-screen grid-cols-[208px_1fr] bg-background text-foreground">
      <aside class="demo-sidebar flex flex-col border-r border-border bg-surface-subtle p-3">
        <a
          href="/demo/projects"
          class="mb-4 flex items-center gap-2 px-1.5 py-1"
        >
          <span class="h-6 w-6 rounded-md bg-gradient-to-br from-magenta-500 to-brand-orange" />
          <span class="font-bold tracking-tight">Tasks</span>
        </a>
        <p class="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
          Projects
        </p>
        <nav class="flex flex-col gap-0.5">
          {data.projects.map((p) => {
            const active = p.slug === activeSlug;
            return (
              <a
                key={p.id}
                href={buildPath('/demo/projects/:projectId', {
                  projectId: p.slug,
                })}
                class={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium ${
                  active
                    ? 'bg-accent/10 text-accent'
                    : 'text-foreground hover:bg-foreground/5'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <span class="h-2 w-2 rounded-[3px] bg-accent" />
                {p.name}
                <span class="ml-auto text-[11px] text-muted">
                  {p.taskCount}
                </span>
              </a>
            );
          })}
        </nav>
        <div class="flex-1" />
        {data.user && (
          <div class="mt-2 flex items-center gap-2 border-t border-border p-2">
            <span class="grid h-6 w-6 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">
              {data.user.name.charAt(0).toUpperCase()}
            </span>
            <span class="text-[12.5px] font-semibold">{data.user.name}</span>
            <button
              type="button"
              class="ml-auto text-[11px] text-muted underline"
              onClick={() => logout.mutate({})}
              disabled={logout.pending}
            >
              {logout.pending ? '...' : 'log out'}
            </button>
          </div>
        )}
      </aside>
      <main class="min-w-0">{children}</main>
    </div>
  );
}

const ShellView = shellLoader.View<{ children: LayoutProps['children'] }>(
  ({ data, children }) => <Sidebar data={data} children={children} />,
  { fallback: <div class="p-6 text-muted">Loading...</div> }
);

export default function ProjectsShell({ children }: LayoutProps) {
  return (
    <>
      <ShellView children={children} />
      <ActivityBar />
    </>
  );
}
