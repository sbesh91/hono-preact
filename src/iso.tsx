import type { FunctionComponent } from 'preact';
import { flushSync } from 'preact/compat';
import { lazy, Route, Router } from 'preact-iso';
import NotFound from './pages/not-found.js';

const Home = lazy(() => import('./pages/home.js'));
const Test = lazy(() => import('./pages/test.js'));
const Movies = lazy(() => import('./pages/movies.js'));

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
      <NotFound />
    </Router>
  );
};
