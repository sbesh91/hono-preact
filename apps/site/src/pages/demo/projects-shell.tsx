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
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { serverLoaders } from './projects-shell.server.js';
import { serverActions as loginActions } from './login.server.js';
import { DEMO_AUTHED_KEY } from '../../demo/guard.js';
import type { ShellData } from './projects-shell.server.js';

// Per-project bullet: static (every row has one).
const SidebarDot: FunctionComponent = () => (
  <span class="h-2 w-2 rounded-[3px] bg-accent" />
);

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

  // Sliding active indicator, driven by the view transition. ONE persistent
  // element carries the (unique) view-transition-name and is positioned over the
  // active row by measuring the live DOM. On a project nav the layout effect
  // moves it to the new row inside the same render the VT captures, so the
  // browser morphs it from the old row to the new one — gliding alongside the
  // board's own transition.
  //
  // Persistence is the whole trick: the earlier per-row pill (rendered only on
  // the active row) remounted every nav, and that freshly-mounted element got
  // its VT group cancelled ~30ms in by the post-nav flush. A single element that
  // never unmounts survives that flush, so its group is not cancelled. No CSS
  // transition here: the VT owns the motion.
  const indicatorNameRef = useViewTransitionName('demo-sidebar-active');
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const ind = nav?.querySelector<HTMLElement>('[data-active-indicator]');
    if (!nav || !ind) return;
    const row = activeSlug
      ? nav.querySelector<HTMLElement>(`[data-slug="${activeSlug}"]`)
      : null;
    if (!row) {
      // Off the projects subtree (e.g. the index page): hide it.
      ind.style.opacity = '0';
      return;
    }
    ind.style.transform = `translateY(${row.offsetTop}px)`;
    ind.style.height = `${row.offsetHeight}px`;
    ind.style.opacity = '1';
  }, [activeSlug, data.projects.length]);

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
        <nav ref={navRef} class="relative isolate flex flex-col gap-0.5">
          {/* The sliding highlight: a single persistent element the view
              transition morphs between rows (positioned by the effect above).
              -z-10 (under the isolate context) keeps it behind the row text. A
              plain tinted pill — its rounded shape reads cleanly as it glides,
              with no left stripe fighting the corners. */}
          <span
            ref={indicatorNameRef}
            data-active-indicator
            aria-hidden
            class="pointer-events-none absolute left-0 top-0 -z-10 w-full rounded-lg bg-accent/10 opacity-0"
          />
          {data.projects.map((p) => (
            <NavLink
              key={p.id}
              href={buildPath('/demo/projects/:projectId', {
                projectId: p.slug,
              })}
              exact={false}
              data-slug={p.slug}
              class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium"
              activeClass="text-accent"
              inactiveClass="text-foreground hover:bg-foreground/5"
            >
              <SidebarDot />
              {p.name}
              <span class="ml-auto text-[11px] text-muted">{p.taskCount}</span>
            </NavLink>
          ))}
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
