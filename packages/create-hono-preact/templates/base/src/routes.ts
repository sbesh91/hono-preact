import { defineRoutes } from 'hono-preact';

export default defineRoutes([
  {
    path: '/',
    view: () => import('./pages/home.js'),
    server: () => import('./pages/home.server.js'),
  },
  { path: '/about', view: () => import('./pages/about.js') },
]);
