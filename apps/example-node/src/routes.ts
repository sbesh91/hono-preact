import { defineRoutes } from 'hono-preact';

// chat.server.ts and cursors.server.ts are not route-bound but their
// serverSockets / serverRooms maps must be discoverable by buildSocketRegistry
// and buildRoomRegistry, which read from serverImports (the `server` thunks in
// the route tree). Bare-grouping parents (no view/layout, has children) are the
// mechanism: each contributes its server module to serverImports without adding
// a page route, while the home and about leaves keep their own modules and URLs.
export default defineRoutes([
  {
    path: '/',
    server: () => import('./pages/chat.server.js'),
    children: [
      {
        path: '',
        server: () => import('./pages/cursors.server.js'),
        children: [
          {
            path: '',
            view: () => import('./pages/home.js'),
            server: () => import('./pages/home.server.js'),
          },
          { path: 'about', view: () => import('./pages/about.js') },
        ],
      },
    ],
  },
]);
