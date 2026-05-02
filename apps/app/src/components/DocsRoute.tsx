import type { ComponentType } from 'preact';
import { lazy } from '@hono-preact/iso';
import { Route as IsoRoute, Router } from 'preact-iso';
import { DocsLayout } from './DocsLayout.js';

// Each MDX file is lazy-loaded (code-split). Inner-router paths are derived
// from filenames at module-evaluation time; the glob keys are statically
// analysable by Rollup. The lazy resolves to an article-wrapped component
// because MDX compiles to a Fragment root (multiple sibling nodes), which
// Preact cannot reconcile correctly during hydration when the component is
// inside a Suspense boundary; appending instead of replacing causes the
// content to appear twice.
const mdxModules = import.meta.glob('../pages/docs/*.mdx');
const mdxRoutes = Object.entries(mdxModules).map(([file, load]) => {
  // Path relative to /docs: '' for index.mdx, 'quick-start' for
  // quick-start.mdx, etc. The inner Router below matches against the rest
  // path that preact-iso passes via RouteContext after the outer route
  // strips '/docs/'.
  const relative = file
    .replace('../pages/docs/', '')
    .replace('.mdx', '')
    .replace(/^index$/, '');
  const Component = lazy(async () => {
    const mod = await (load as () => Promise<{ default: ComponentType }>)();
    const MDX = mod.default;
    const SingleRoot: ComponentType = (props) => (
      <article class="mdx-content">
        <MDX {...props} />
      </article>
    );
    return { default: SingleRoot };
  });
  return { relative, Component };
});

function DocsNotFound() {
  return (
    <article class="mdx-content">
      <p>Docs page not found.</p>
    </article>
  );
}

// Component for both /docs and /docs/* outer routes. Pointing both outer
// routes at the same component reference makes preact-iso treat the nav as
// a non-route-change (incoming.props.component identity matches), so
// DocsLayout reconciles in place across docs->docs navigation. The inner
// Router matches the rest of the URL against the per-MDX lazies, keeping
// preact-iso's lazy + Suspense hydration coordination intact at the inner
// route level.
export default function DocsRoute() {
  return (
    <DocsLayout>
      <Router>
        {mdxRoutes.map(({ relative, Component }) =>
          relative === '' ? (
            <IsoRoute path="" component={Component} />
          ) : (
            <IsoRoute path={relative} component={Component} />
          )
        )}
        <IsoRoute default component={DocsNotFound} />
      </Router>
    </DocsLayout>
  );
}
