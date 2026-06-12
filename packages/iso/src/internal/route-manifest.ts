import { createContext } from 'preact';
import type { FlatRoute } from '../define-routes.js';

/**
 * The flat route list (patterns) of the active app, provided by `Routes`.
 * `usePrefetch` reads it to resolve an href to its route params. Internal.
 */
export const RouteManifestContext = createContext<ReadonlyArray<FlatRoute>>([]);
