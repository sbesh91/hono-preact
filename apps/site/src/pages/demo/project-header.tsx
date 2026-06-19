// apps/site/src/pages/demo/project-header.tsx
import type { LayoutProps } from 'hono-preact';
import { useParams, useViewTransitionLifecycle } from 'hono-preact';
import { useTitle } from 'hoofd/preact';

export default function ProjectHeader({ children }: LayoutProps) {
  const { projectId: slug } = useParams('/demo/projects/:projectId');
  useTitle(`${slug.toUpperCase()} · demo`);
  useViewTransitionLifecycle({
    onAfterSwap: () => {
      if (typeof window !== 'undefined') window.scrollTo(0, 0);
    },
  });
  return <>{children}</>;
}
