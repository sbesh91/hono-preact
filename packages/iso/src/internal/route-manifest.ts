import { createContext } from 'preact';
import type { ServerRoute } from '../define-routes.js';

/**
 * The server-bearing routes of the active app (each with its absolute leaf
 * `path`), provided by `Routes`. `usePrefetch` matches an href against these
 * patterns to resolve params. Uses serverRoutes, not the flat route list,
 * because a layout group's nested leaf patterns appear only in serverRoutes.
 * Internal.
 */
export const RouteManifestContext = createContext<ReadonlyArray<ServerRoute>>(
  []
);
