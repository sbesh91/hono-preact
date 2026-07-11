import { defineRoutes, type RoutePaths } from 'hono-preact';

// Each route's view is a deferred dynamic import (one code-split chunk per
// page). A colocated `<view>.server.ts` sibling (loaders/actions) is
// discovered and wired automatically; nothing extra to declare here.
//
// The tree is its own `as const` binding (not inlined into defineRoutes) so
// the registration below can reference `typeof routeTree`.
const routeTree = [
  { path: '/', view: () => import('./pages/home.js') },
  { path: '/about', view: () => import('./pages/about.js') },
] as const;

export default defineRoutes(routeTree);

// Registers this app's paths with the framework, so `useParams`,
// `buildPath`, and `NavLink` are typed against the real route table.
declare module 'hono-preact' {
  interface RegisteredRoutes {
    paths: RoutePaths<typeof routeTree>;
  }
}
