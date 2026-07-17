import type { LayoutProps } from 'hono-preact';
import {
  buildPath,
  useAction,
  useNavigate,
  NavLink,
  useRouteMatch,
  useViewTransitionName,
} from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { ActivityBar } from '../../components/demo/ActivityBar.js';
import { useEffect } from 'preact/hooks';
import { serverLoaders } from './projects-shell.server.js';
import { serverActions as loginActions } from './login.server.js';
import { DEMO_AUTHED_KEY } from '../../demo/guard.js';
import type { ShellData } from './projects-shell.server.js';

// Only the ACTIVE dot carries the view-transition-name (names must be
// unique per document), so on navigation the browser morphs the dot from
// the old active item to the new one: the classic gliding-indicator VT.
const SidebarDot: FunctionComponent<{ active: boolean }> = ({ active }) => {
  const ref = useViewTransitionName(active ? 'demo-sidebar-active' : null);
  return <span ref={ref} class="h-2 w-2 rounded-[3px] bg-accent" />;
};

const shellLoader = serverLoaders.default;

function Sidebar({
  data,
  children,
}: {
  data: ShellData;
  children: LayoutProps['children'];
}) {
  const navigate = useNavigate();
  // Typed match instead of the tolerant pathParams read: null off the
  // projects subtree, the typed { projectId } inside it (exact: false keeps
  // the sidebar lit on nested task pages).
  const match = useRouteMatch('/demo/projects/:projectId', { exact: false });
  const activeSlug = match?.projectId ?? null;

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
      <aside class="demo-sidebar sticky top-0 flex h-screen flex-col self-start border-r border-border bg-surface-subtle p-3">
        <a
          href="/demo/projects"
          class="mb-4 flex items-center gap-2 px-1.5 py-1"
        >
          <span class="h-6 w-6 rounded-md bg-gradient-to-tr from-brand-orange to-magenta-500" />
          <span class="font-bold tracking-tight">Tasks</span>
        </a>
        <p class="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
          Projects
        </p>
        <nav class="flex flex-col gap-0.5">
          {data.projects.map((p) => {
            const active = p.slug === activeSlug;
            return (
              <NavLink
                key={p.id}
                href={buildPath('/demo/projects/:projectId', {
                  projectId: p.slug,
                })}
                exact={false}
                class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium"
                activeClass="bg-accent/10 text-accent"
                inactiveClass="text-foreground hover:bg-foreground/5"
              >
                <SidebarDot active={active} />
                {p.name}
                <span class="ml-auto text-[11px] text-muted">
                  {p.taskCount}
                </span>
              </NavLink>
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
  ({ data, children }) =>
    data ? (
      <Sidebar data={data} children={children} />
    ) : (
      <div class="p-6 text-muted">Loading...</div>
    )
);

export default function ProjectsShell({ children }: LayoutProps) {
  return (
    <>
      <ShellView children={children} />
      <ActivityBar />
    </>
  );
}
