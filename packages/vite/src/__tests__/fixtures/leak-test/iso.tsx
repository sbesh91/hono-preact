import { lazy, Route, Router } from '@hono-preact/iso';
import { loader, cache } from './pages/foo.server.js';

const Foo = lazy(() => import('./pages/foo.js'));

export const Base = () => (
  <Router>
    <Route path="/foo" component={Foo} loader={loader} cache={cache} />
  </Router>
);
