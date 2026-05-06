import type { FunctionComponent } from 'preact';
import { flushSync } from 'preact/compat';
import { lazy, Route, Router } from '@hono-preact/iso';
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
      <Route path="/docs" component={DocsRoute} />
      <Route path="/docs/*" component={DocsRoute} />
      <NotFound />
    </Router>
  );
};
