import type { LayoutProps } from 'hono-preact';
import {
  useRoute,
  useRouteChange,
  useViewTransitionTypes,
  ViewTransitionName,
} from 'hono-preact';
import { useTitle } from 'hoofd/preact';

export default function ProjectLayout({ children }: LayoutProps) {
  const route = useRoute();
  const slug = (route.pathParams as { projectId?: string }).projectId ?? '';

  useTitle(`${slug.toUpperCase()} · demo`);
  useRouteChange(() => {
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  });

  // In-app up-navigation (e.g. the "← all projects" link) is a pushState, so
  // the history shim classifies it as a forward `nav-push`. Emit `nav-up` when
  // the destination is an ancestor of the current path so the CSS plays the
  // reverse (left-to-right) slide instead. The hook is mounted here because
  // this layout owns those up-links and is mounted whenever they're available.
  useViewTransitionTypes((nav) =>
    nav.from && nav.from.startsWith(nav.to + '/') ? ['nav-up'] : []
  );

  return (
    <section class="mx-auto max-w-4xl p-6 space-y-4">
      <header class="flex items-center gap-3">
        <a href="/demo/projects" class="text-sm text-blue-700 underline">
          ← all projects
        </a>
        <ViewTransitionName
          name={`project-${slug}`}
          render={<h1 class="text-xl font-semibold uppercase" />}
        >
          {slug}
        </ViewTransitionName>
      </header>
      <div>{children}</div>
    </section>
  );
}
