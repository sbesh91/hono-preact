import { defineRoutes } from 'hono-preact';

// room.server.ts is not route-bound, but its `serverRooms` map must be
// discoverable by buildRoomRegistry, which reads from serverImports (the
// `server` thunks in the route tree). A single leaf node carrying `server`
// contributes the module to serverImports; the home view gives the app a page
// so the framework SSR catch-all has something to render.
export default defineRoutes([
  {
    path: '/',
    view: () => import('./pages/home.js'),
    server: () => import('./room.server.js'),
  },
]);
