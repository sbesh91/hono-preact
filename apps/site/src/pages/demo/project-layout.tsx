import type { LayoutProps } from 'hono-preact';
import { useRoute, useRouteChange } from 'hono-preact';
import { useTitle } from 'hoofd/preact';

export default function ProjectLayout({ children }: LayoutProps) {
  const route = useRoute();
  const slug = (route.pathParams as { projectId?: string }).projectId ?? '';

  useTitle(`${slug.toUpperCase()} · demo`);
  useRouteChange(() => {
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  });

  return (
    <section class="mx-auto max-w-4xl p-6 space-y-4">
      <header class="flex items-center gap-3">
        <a href="/demo/projects" class="text-sm text-blue-700 underline">
          ← all projects
        </a>
        <h1 class="text-xl font-semibold uppercase">{slug}</h1>
      </header>
      <div>{children}</div>
    </section>
  );
}
