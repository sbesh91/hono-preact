import type { LayoutProps } from 'hono-preact';
import {
  useParams,
  useViewTransitionLifecycle,
  ViewTransitionName,
} from 'hono-preact';
import { useTitle } from 'hoofd/preact';

export default function ProjectLayout({ children }: LayoutProps) {
  const { projectId: slug } = useParams('/demo/projects/:projectId');

  useTitle(`${slug.toUpperCase()} · demo`);
  useViewTransitionLifecycle({
    onAfterSwap: () => {
      if (typeof window !== 'undefined') window.scrollTo(0, 0);
    },
  });

  return (
    <section class="mx-auto max-w-4xl p-6 space-y-4">
      <header class="flex items-center gap-3">
        <a
          href="/demo/projects"
          class="text-sm text-accent underline hover:text-accent-hover"
        >
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
