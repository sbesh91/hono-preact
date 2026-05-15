import { defineRoutes } from 'hono-preact';

const docsView = () => import('./components/DocsRoute.js');

export default defineRoutes([
  { path: '/', view: () => import('./pages/home.js') },
  { path: '/docs', view: docsView },
  { path: '/docs/*', view: docsView },
  {
    path: '*',
    view: () => import('./pages/not-found.js'),
  },
]);
