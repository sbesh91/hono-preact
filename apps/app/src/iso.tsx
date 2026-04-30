import type { ComponentType, FunctionComponent } from 'preact';
import { flushSync } from 'preact/compat';
import { lazy, Route, Router } from '@hono-preact/iso';
import { Route as IsoRoute } from 'preact-iso';
import NotFound from './pages/not-found.js';
import { loader as moviesLoader, cache as moviesCache } from './pages/movies.server.js';

const Home = lazy(() => import('./pages/home.js'));
const Test = lazy(() => import('./pages/test.js'));
const Movies = lazy(() => import('./pages/movies.js'));
const Watched = lazy(() => import('./pages/watched.js'));

// Each MDX file is lazy-loaded (code-split), consistent with the page pattern
// above. Route paths are derived from filenames at module-evaluation time —
// the glob keys are statically analysable by Rollup so no dynamic import of
// module contents is needed to know the path.
const mdxModules = import.meta.glob('./pages/docs/*.mdx');
const mdxRoutes = Object.entries(mdxModules).map(([filePath, load]) => {
  const route = ('/docs' + filePath.replace('./pages/docs', '').replace('.mdx', ''))
    .replace(/\/index$/, '') || '/docs';
  // Wrap the MDX component in a single root element so the lazy Suspense
  // boundary contains one node. MDX compiles to a Fragment root (multiple
  // sibling nodes), which Preact cannot reconcile correctly during hydration
  // when the component is inside a Suspense boundary — it appends instead of
  // replacing, causing the content to appear twice.
  const Component = lazy(async () => {
    const [mod, { DocsLayout }] = await Promise.all([
      (load as () => Promise<{ default: ComponentType }>)(),
      import('./components/DocsLayout.js'),
    ]);
    const MDX = mod.default;
    const Wrapped: ComponentType = (props) => <DocsLayout><MDX {...props} /></DocsLayout>;
    return { default: Wrapped };
  });
  return { route, Component };
});

function onRouteChange() {
  if (!document.startViewTransition) return;
  document.startViewTransition(() => flushSync(() => {}));
}

export const Base: FunctionComponent = () => {
  return (
    <Router onRouteChange={onRouteChange}>
      {/* Migrated to route-level Page wrapping */}
      <Route path="/" component={Home} />
      {/* Migrated to route-level Page wrapping */}
      <Route path="/test" component={Test} />
      {/* Migrated to route-level Page wrapping */}
      <Route path="/movies" component={Movies} loader={moviesLoader} cache={moviesCache} />
      <Route path="/movies/*" component={Movies} loader={moviesLoader} cache={moviesCache} />
      <IsoRoute path="/watched" component={Watched} />
      {mdxRoutes.map(({ route, Component }) => (
        <IsoRoute path={route} component={Component} />
      ))}
      <NotFound />
    </Router>
  );
};
