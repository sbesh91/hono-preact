import type { RouteDef } from '../define-routes.js';

// Absolute-path extraction. Mirrors the runtime join in define-routes.tsx:
//   here = parent === '' ? path : (path === '' ? parent : `${parent}/${path}`)
// and the `/`-root reset (a layout/grouping at `/` joins children from '').
type Here<Parent extends string, Path extends string> = Parent extends ''
  ? Path
  : Path extends ''
    ? Parent
    : `${Parent}/${Path}`;

type NextParent<H extends string> = H extends '/' ? '' : H;

type NodePaths<R extends RouteDef, Parent extends string> = Here<
  Parent,
  R['path']
> extends infer H
  ? H extends string
    ?
        | (R extends { view: unknown } ? H : never)
        | (R extends { layout: unknown } ? H : never)
        | (R extends { children: infer C }
            ? C extends readonly RouteDef[]
              ? AbsolutePaths<C, NextParent<H>>
              : never
            : never)
    : never
  : never;

/**
 * The union of absolute route patterns for every view/layout node in a route
 * tree (the ids a consumer can legitimately name). Walks layout-group nesting,
 * which `RoutesManifest.flat` omits.
 */
export type AbsolutePaths<
  T extends readonly RouteDef[],
  Parent extends string = '',
> = T extends readonly [infer Head, ...infer Tail]
  ? Head extends RouteDef
    ? Tail extends readonly RouteDef[]
      ? NodePaths<Head, Parent> | AbsolutePaths<Tail, Parent>
      : never
    : never
  : never;

// Param extraction. Handles required `:id`, optional `:id?`, and the preact-iso
// modifier suffixes `*` / `+`. A pattern with no `:param` yields `{}`.
type ParamKey<Seg extends string> = Seg extends `${infer Name}?`
  ? { optional: true; name: Name }
  : Seg extends `${infer Name}*`
    ? { optional: true; name: Name }
    : Seg extends `${infer Name}+`
      ? { optional: false; name: Name }
      : { optional: false; name: Seg };

type ParamFrom<Seg extends string> =
  ParamKey<Seg> extends { optional: infer O; name: infer N extends string }
    ? O extends true
      ? { [K in N]?: string }
      : { [K in N]: string }
    : never;

/** Extract the path-params object type from an absolute route pattern. */
export type RouteParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? ParamFrom<Param> & RouteParams<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? ParamFrom<Param>
      : {};

/**
 * Augment this interface to register your app's routes for typed params:
 *
 * ```ts
 * declare module 'hono-preact' {
 *   interface RegisteredRoutes {
 *     paths: RoutePaths<typeof routes>;
 *   }
 * }
 * ```
 *
 * Until registered, `RegisteredPaths` falls back to `string` (the param hooks
 * still work; they just accept any string and project its param shape).
 */
export interface RegisteredRoutes {
  // augmented by users
}

export type RegisteredPaths = RegisteredRoutes extends {
  paths: infer P extends string;
}
  ? P
  : string;

/** The route-pattern union of a manifest produced by `defineRoutes`. */
export type RoutePaths<M> = M extends {
  __tree?: infer T extends readonly RouteDef[];
}
  ? AbsolutePaths<T>
  : never;
