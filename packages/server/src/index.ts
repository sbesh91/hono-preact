export { HonoContext, useHonoContext } from './context.js';
export { renderPage } from './render.js';
// `RoutePreloadMap` is exported as a type only: it appears in renderPage's
// public options signature. `routePreloadTags` stays internal (render.tsx
// imports it directly; the generated core-app only forwards the map).
export type { RoutePreloadMap } from './route-preload-tags.js';
export {
  loadersHandler,
  type LoadersHandlerOptions,
} from './loaders-handler.js';
export { type ActionEntry } from './page-action-resolvers.js';
export {
  pageActionHandler,
  type PageActionHandlerOptions,
} from './page-action-handler.js';
