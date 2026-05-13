import { lazy, Route, Router } from '@hono-preact/iso';
import { serverLoaders } from './pages/foo.server.js';

const Foo = lazy(() => import('./pages/foo.js'));

export const Base = () => (
  <Router>
    <Route path="/foo" component={Foo} loader={serverLoaders.default} />
  </Router>
);
