import { defineRoutes } from '@hono-preact/iso';

const docsView = () => import('./components/DocsRoute.js');

export default defineRoutes([
  { path: '/', view: () => import('./pages/home.js') },
  { path: '/test', view: () => import('./pages/test.js') },
  {
    path: '/movies',
    layout: () => import('./pages/movies-layout.js'),
    children: [
      {
        path: '',
        view: () => import('./pages/movies-list.js'),
        server: () => import('./pages/movies-list.server.js'),
      },
      {
        path: ':id',
        view: () => import('./pages/movie.js'),
        server: () => import('./pages/movie.server.js'),
      },
    ],
  },
  {
    path: '/watched',
    view: () => import('./pages/watched.js'),
    server: () => import('./pages/watched.server.js'),
  },
  {
    path: '/live-stats',
    view: () => import('./pages/live-stats.js'),
    server: () => import('./pages/live-stats.server.js'),
  },
  {
    path: '/docs',
    view: docsView,
  },
  {
    path: '/docs/*',
    view: docsView,
  },
  {
    path: '*',
    view: () => import('./pages/not-found.js'),
  },
]);
