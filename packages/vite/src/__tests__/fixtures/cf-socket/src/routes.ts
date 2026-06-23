import { defineRoutes } from 'hono-preact';

// socket.server.ts is not route-bound, but its `serverSockets` map must be
// discoverable by buildSocketRegistry, which reads from serverImports (the
// `server` thunks in the route tree). A single leaf carrying `server`
// contributes the module; the home view gives SSR something to render.
export default defineRoutes([
  {
    path: '/',
    view: () => import('./pages/home.js'),
    server: () => import('./socket.server.js'),
  },
]);
