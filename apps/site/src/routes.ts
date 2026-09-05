import { defineRoutes, contentRoutes } from 'hono-preact';
// Registers the global `docs` view-transition type rule (enter/leave/within
// /docs). Side-effect import: the generated client entry imports this module,
// so the subscriber is installed once at startup.
import './docs-transition.js';
import { publishSession, requireSession } from './demo/guard.js';
import { archivedGate } from './demo/archived-gate.js';
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
    // Publishing is scoped to the demo subtree, one level above where it is
    // enforced. Every demo page publishes, so a navigation that starts anywhere
    // inside /demo carries a real answer into /demo/projects; and no docs page
    // publishes, so no docs document is made per-visitor (a document carrying a
    // snapshot is uncacheable by a shared cache).
    use: [publishSession],
    children: [
      { path: '', view: () => import('./pages/demo/index.js') },
      { path: 'login', view: () => import('./pages/demo/login.js') },
      { path: 'cursors', view: () => import('./pages/demo/cursors-demo.js') },
      { path: 'live-tally', view: () => import('./pages/demo/live-tally.js') },
      {
        path: 'projects',
        layout: () => import('./pages/demo/projects-shell.js'),
        use: requireSession,
        children: [
          { path: '', view: () => import('./pages/demo/projects.js') },
          {
            path: ':projectId',
            layout: () => import('./pages/demo/project-header.js'),
            use: archivedGate,
            children: [
              {
                path: '',
                view: () => import('./pages/demo/project-board.js'),
              },
              {
                path: 'tasks/:taskId',
                view: () => import('./pages/demo/task.js'),
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
    tree: typeof routeTree;
  }
}
