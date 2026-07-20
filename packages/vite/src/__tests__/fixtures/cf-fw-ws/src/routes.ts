import { defineRoutes } from 'hono-preact';

export default defineRoutes([
  {
    path: '/',
    view: () => import('./pages/home.js'),
  },
]);
