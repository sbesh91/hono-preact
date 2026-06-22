import { defineRoutes, contentRoutes, type RoutePaths } from 'hono-preact';
// Registers the global `docs` view-transition type rule (enter/leave/within
// /docs). Side-effect import: the generated client entry imports this module,
// so the subscriber is installed once at startup.
import './docs-transition.js';
import { requireSession } from './demo/guard.js';
import { MdxArticle } from './components/MdxArticle.js';

// The tree is its own `as const` binding (not just inlined into defineRoutes)
// so the route registration below can reference `typeof routeTree`. Registering
// against the manifest (`typeof routes`) would form a type cycle: the manifest
// is built by `defineRoutes` (a hono-preact value) and the module augmentation
// is evaluated while resolving it. The tree is a plain literal, so it is safe.
const routeTree = [
  { path: '/', view: () => import('./pages/home.js') },
  {
    path: '/docs',
    layout: () => import('./components/DocsLayout.js'),
    children: [
      ...contentRoutes(import.meta.glob('./pages/docs/**/*.mdx'), {
        wrapper: MdxArticle,
      }),
      { path: '*', view: () => import('./components/DocsNotFound.js') },
    ],
  },
  {
    path: '/demo',
    layout: () => import('./pages/demo/demo-layout.js'),
    children: [
      { path: '', view: () => import('./pages/demo/index.js') },
      {
        path: 'login',
        view: () => import('./pages/demo/login.js'),
        server: () => import('./pages/demo/login.server.js'),
      },
      {
        path: 'cursors',
        view: () => import('./pages/demo/cursors-demo.js'),
        server: () => import('./pages/demo/cursors-demo.server.js'),
      },
      {
        path: 'projects',
        layout: () => import('./pages/demo/projects-shell.js'),
        server: () => import('./pages/demo/projects-shell.server.js'),
        use: requireSession,
        children: [
          { path: '', view: () => import('./pages/demo/projects.js') },
          {
            path: ':projectId',
            layout: () => import('./pages/demo/project-header.js'),
            children: [
              {
                path: '',
                view: () => import('./pages/demo/project-board.js'),
                server: () => import('./pages/demo/project-board.server.js'),
              },
              {
                path: 'tasks/:taskId',
                view: () => import('./pages/demo/task.js'),
                server: () => import('./pages/demo/task.server.js'),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    path: '*',
    view: () => import('./pages/not-found.js'),
  },
] as const;

export default defineRoutes(routeTree);

declare module 'hono-preact' {
  interface RegisteredRoutes {
    paths: RoutePaths<typeof routeTree>;
  }
}
