import type { FunctionComponent } from 'preact';
import { flushSync } from 'preact/compat';
import { lazy, Route, Router } from '@hono-preact/iso';
import { Route as IsoRoute } from 'preact-iso';
import NotFound from './pages/not-found.js';

const Home = lazy(() => import('./pages/home.js'));
const Test = lazy(() => import('./pages/test.js'));
const Movies = lazy(() => import('./pages/movies.js'));
const Watched = lazy(() => import('./pages/watched.js'));
const DocsRoute = lazy(() => import('./components/DocsRoute.js'));

function onRouteChange() {
  document.startViewTransition(() => flushSync(() => {}));
}

export const Base: FunctionComponent = () => {
  return (
    <Router onRouteChange={onRouteChange}>
      <Route path="/" component={Home} />
      <Route path="/test" component={Test} />
      <Route path="/movies" component={Movies} />
      <Route path="/movies/*" component={Movies} />
      <Route path="/watched" component={Watched} />
      {/* IsoRoute (preact-iso's Route) so both /docs and /docs/* hand the
          same DocsRoute lazy reference to preact-iso. With our @hono-preact/iso
          Route, wrapWithPage would mint a new PageRouteHandler per Route, and
          preact-iso's component-identity check would treat /docs <-> /docs/foo
          as a route change and remount DocsRoute (and the sidebar with it).
          DocsRoute has no definePage bindings, so PageBoundary wrapping isn't
          needed here. */}
      <IsoRoute path="/docs" component={DocsRoute} />
      <IsoRoute path="/docs/*" component={DocsRoute} />
      <NotFound />
    </Router>
  );
};
