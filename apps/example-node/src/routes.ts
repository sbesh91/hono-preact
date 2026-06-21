import { defineRoutes } from 'hono-preact';

// chat.server.ts is not route-bound but its serverSockets map must be
// discoverable by buildSocketRegistry, which reads from serverImports (the
// `server` thunks in the route tree). A bare-grouping parent (no view/layout,
// has children) is the mechanism: it contributes chat.server to serverImports
// without adding a page route, while the existing home and about leaves keep
// their own server modules and URL patterns.
export default defineRoutes([
  {
    path: '/',
    server: () => import('./pages/chat.server.js'),
    children: [
      {
        path: '',
        view: () => import('./pages/home.js'),
        server: () => import('./pages/home.server.js'),
      },
      { path: 'about', view: () => import('./pages/about.js') },
    ],
  },
]);
