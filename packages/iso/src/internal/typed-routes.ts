// Absolute-path extraction. Mirrors the runtime join in define-routes.tsx:
//   here = parent === '' ? path : (path === '' ? parent : `${parent}/${path}`)
// and the `/`-root reset (a layout/grouping at `/` joins children from '').
type Here<Parent extends string, Path extends string> = Parent extends ''
  ? Path
  : Path extends ''
    ? Parent
    : `${Parent}/${Path}`;

type NextParent<H extends string> = H extends '/' ? '' : H;

// Read each node STRUCTURALLY (its `path` literal, the presence of `view` /
// `layout` keys, and its `children`). Crucially we do NOT constrain nodes to
// `RouteDef`: that assignability check would resolve each node's
// `view`/`layout`/`server` import thunk module types, and those leaf modules
// consume the route registry (`useParams`, `defineLoader(routeId, ...)`),
// forming a type cycle. Reading keys + the `path` literal never resolves them.
type NodePaths<R, Parent extends string> = R extends {
  path: infer P extends string;
}
  ? Here<Parent, P> extends infer H
    ? H extends string
      ?
          | (R extends { view: unknown } ? H : never)
          | (R extends { layout: unknown } ? H : never)
          | (R extends { children: infer C extends readonly unknown[] }
              ? AbsolutePaths<C, NextParent<H>>
              : never)
      : never
    : never
  : never;

/**
 * The union of absolute route patterns for every view/layout node in a route
 * tree (the ids a consumer can legitimately name). Walks layout-group nesting,
 * which `RoutesManifest.flat` omits.
 */
export type AbsolutePaths<
  T extends readonly unknown[],
  Parent extends string = '',
> = T extends readonly [infer Head, ...infer Tail extends readonly unknown[]]
  ? NodePaths<Head, Parent> | AbsolutePaths<Tail, Parent>
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

/**
 * The route-pattern union for an app. Accepts either the route tree array
 * (use `typeof routeTree` from `const routeTree = [...] as const`) or a manifest
 * produced by `defineRoutes`.
 *
 * Prefer the tree form in the `declare module` registration. Referencing the
 * manifest (`typeof routes`) there forms a type cycle: the manifest is built by
 * `defineRoutes` (a value imported from `hono-preact`), and TypeScript eagerly
 * evaluates the module augmentation while resolving that value, so the
 * augmentation ends up depending on the very binding it annotates. A tree array
 * is a plain literal that does not depend on any `hono-preact` value, so it
 * breaks the cycle.
 */
export type RoutePaths<M> = M extends readonly unknown[]
  ? AbsolutePaths<M>
  : M extends { __tree?: infer T extends readonly unknown[] }
    ? AbsolutePaths<T>
    : never;
