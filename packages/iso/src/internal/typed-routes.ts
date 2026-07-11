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
//
// The runtime matcher (`build-path.ts`, and preact-iso's `exec`) only treats a
// segment as a param when it is `:name` where `name` matches `[A-Za-z0-9_]+`,
// optionally followed by a single `?`/`*`/`+` modifier and nothing else. A
// segment like `:foo-bar` or `:a.b` does NOT match, so the runtime keeps it as
// a literal and substitutes nothing. `ParamNameChar` / `IsParamName` mirror
// that character class so the type grammar agrees: a name outside the class
// makes the segment a literal that contributes no param, rather than
// over-claiming a required `foo-bar` the runtime would silently ignore.
// prettier-ignore
type ParamNameChar =
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z'
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '_';

// True iff `S` is a non-empty string of `[A-Za-z0-9_]` (the `+` in the runtime
// regex requires at least one character).
type IsParamName<S extends string> = S extends ''
  ? false
  : S extends `${infer Char}${infer Rest}`
    ? Char extends ParamNameChar
      ? Rest extends ''
        ? true
        : IsParamName<Rest>
      : false
    : false;

// Strip a single trailing `?`/`*`/`+` modifier (the runtime regex allows one),
// recording optionality: `?` and `*` are optional, `+` and a bare name are
// required. The name itself is validated separately by `IsParamName`.
type StripModifier<Seg extends string> = Seg extends `${infer Name}?`
  ? { name: Name; optional: true }
  : Seg extends `${infer Name}*`
    ? { name: Name; optional: true }
    : Seg extends `${infer Name}+`
      ? { name: Name; optional: false }
      : { name: Seg; optional: false };

// Map a `:`-stripped segment to its param contribution. A name outside the
// `[A-Za-z0-9_]` class is a literal: it contributes the empty object (the
// identity under the `&` in `RouteParams`) rather than over-claiming a param.
type ParamFrom<Seg extends string> =
  StripModifier<Seg> extends {
    name: infer Name extends string;
    optional: infer Optional;
  }
    ? IsParamName<Name> extends true
      ? Optional extends true
        ? { [K in Name]?: string }
        : { [K in Name]: string }
      : {}
    : {};

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
 * A registered route pattern, or any other path string. Autocompletes the
 * registered patterns while still accepting content-glob and computed paths
 * (which the pure-type engine cannot enumerate). Used by the active-state
 * matching APIs, which must work for routes outside the typed union.
 */
export type RoutePattern = RegisteredPaths | (string & {});

// A path's subtree pattern. The root's subtree is '/*', not '//*', mirroring
// the runtime key construction in `subtreePatternOf` (define-routes.tsx).
type SubtreeOf<P extends string> = P extends '/' ? '/*' : `${P}/*`;

// `${P}/*` when P has at least one registered strict descendant, else never.
// `All` is the FULL registered union (captured before distribution); the
// Exclude guards the root case, where '/' itself matches `/${string}`.
type SubtreeFrom<P extends string, All extends string> = [
  Exclude<Extract<All, P extends '/' ? `/${string}` : `${P}/${string}`>, P>,
] extends [never]
  ? never
  : SubtreeOf<P>;

/**
 * The subtree-pattern union derivable from a path union: `${P}/*` for every
 * member `P` that has another member as a strict descendant. A pure function
 * of the union (directly testable); `RegisteredSubtrees` applies it to the
 * registered paths. `All` is a defaulted (not inferred) second parameter:
 * defaults resolve once, before `Paths extends string` distributes, so `All`
 * stays bound to the WHOLE union while `Paths` walks each member. An
 * `[Paths] extends [infer All extends string]` capture looks equivalent but
 * is not: nesting that capture around this function's `extends [never] ? :`
 * conditional collapses the result to `never` for the whole union (a known
 * conditional-type evaluation quirk), which a default parameter avoids.
 */
export type SubtreePatterns<
  Paths extends string,
  All extends string = Paths,
> = Paths extends string ? SubtreeFrom<Paths, All> : never;

/**
 * `${P}/*` for every registered path with a registered descendant: the
 * subtree-scope spellings `serverRoute` accepts alongside the exact
 * registered paths. Resolves to `never` until routes are registered
 * (`RegisteredPaths` then falls back to `string`, which already admits any
 * spelling). Deliberately NOT part of `RegisteredPaths`, so `buildPath` and
 * `useParams` autocompletion stay on navigable patterns.
 */
export type RegisteredSubtrees = SubtreePatterns<RegisteredPaths>;

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
