import type { ComponentType, FunctionComponent } from 'preact';
import { flushSync } from 'preact/compat';
import { lazy, Route, Router } from 'preact-iso';
import NotFound from './pages/not-found.js';

const Home = lazy(() => import('./pages/home.js'));
const Test = lazy(() => import('./pages/test.js'));
const Movies = lazy(() => import('./pages/movies.js'));

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
      <Route path="/" component={Home} />
      <Route path="/test" component={Test} />
      <Route path="/movies" component={Movies} />
      <Route path="/movies/*" component={Movies} />
      {mdxRoutes.map(({ route, Component }) => (
        <Route path={route} component={Component} />
      ))}
      <NotFound />
    </Router>
  );
};
