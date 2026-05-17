import { lazy, Route, Router } from '@hono-preact/iso';
import { serverLoaders } from './pages/foo.server.js';
// Transitive chain: pulls the same `.server.ts` module through an indirect
// non-`.server` re-export. If the plugin only handled direct imports, this
// chain would slip the server module's body into the client bundle.
import { wrappedLoaders } from './pages/wrapper.js';

const Foo = lazy(() => import('./pages/foo.js'));

export const Base = () => (
  <Router>
    <Route path="/foo" component={Foo} loader={serverLoaders.default} />
    <Route path="/foo-wrapped" component={Foo} loader={wrappedLoaders.default} />
  </Router>
);
