import { defineRoutes } from 'hono-preact';

const docsView = () => import('./components/DocsRoute.js');

export default defineRoutes([
  { path: '/', view: () => import('./pages/home.js') },
  { path: '/docs', view: docsView },
  { path: '/docs/*', view: docsView },
  {
    path: '/demo',
    children: [
      { path: '', view: () => import('./pages/demo/index.js') },
      { path: 'login', view: () => import('./pages/demo/login.js') },
      {
        path: 'projects',
        view: () => import('./pages/demo/projects.js'),
        server: () => import('./pages/demo/projects.server.js'),
      },
    ],
  },
  {
    path: '*',
    view: () => import('./pages/not-found.js'),
  },
]);
