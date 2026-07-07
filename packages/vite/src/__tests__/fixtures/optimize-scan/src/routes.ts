import { defineRoutes } from 'hono-preact';

export default defineRoutes([
  {
    path: '/',
    layout: () => import('./pages/late-layout.js'),
    children: [{ path: '', view: () => import('./pages/late-view.js') }],
  },
]);
