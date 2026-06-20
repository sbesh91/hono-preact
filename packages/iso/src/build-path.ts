import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';
import { interpolatePattern } from './internal/interpolate-pattern.js';

// Param-less routes take no second argument; routes with params require the
// matching params object. `keyof {} extends never` is true, so param-less
// patterns resolve to the empty tuple.
type BuildArgs<P extends string> = keyof RouteParams<P> extends never
  ? []
  : [params: RouteParams<P>];

/**
 * Build a concrete path from a registered route pattern and its params.
 *
 *   buildPath('/demo/projects/:projectId', { projectId: p.slug }) // '/demo/projects/abc'
 *   buildPath('/docs/components')                                 // '/docs/components'
 *
 * For wildcard params (`:rest*`, `:rest+`), pass the value as a plain string;
 * embedded `/` characters are percent-encoded (`%2F`). If you need literal
 * slash-separated segments, build that part of the path yourself.
 */
// Public, type-safe overload. The implementation signature below is the
// standard typed-overload idiom: it is intentionally looser and never visible
// to callers, so the body reads dynamic keys off a plain Record without a cast.
export function buildPath<P extends RegisteredPaths>(
  pattern: P,
  ...args: BuildArgs<P>
): string;
export function buildPath(
  pattern: string,
  params?: Record<string, string | undefined>
): string {
  return interpolatePattern(pattern, params ?? {});
}
