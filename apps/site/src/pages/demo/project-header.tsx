// apps/site/src/pages/demo/project-header.tsx
import type { LayoutProps } from 'hono-preact';
import { useParams, useTitle, useViewTransitionLifecycle } from 'hono-preact';

export default function ProjectHeader({ children }: LayoutProps) {
  const { projectId: slug } = useParams('/demo/projects/:projectId');
  useTitle(slug.toUpperCase());
  useViewTransitionLifecycle({
    onAfterSwap: () => {
      if (typeof window !== 'undefined') window.scrollTo(0, 0);
    },
  });
  return <>{children}</>;
}
