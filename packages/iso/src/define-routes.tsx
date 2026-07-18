import { h } from 'preact';
import { useMemo } from 'preact/hooks';
import type {
  AnyComponent,
  ComponentChildren,
  ComponentType,
  VNode,
} from 'preact';
import { lazy, Route, Router, useLocation } from 'preact-iso';
import type { RouteHook } from 'preact-iso';
import { RouteLocationsProvider } from './internal/route-locations.js';
import { RouteManifestContext } from './internal/route-manifest.js';
import { makeRouterLoadTracker } from './internal/route-change.js';
import { PageMiddlewareHost } from './internal/page-middleware-host.js';
import type { PageUse } from './internal/use-types.js';
import { reservedParamNamesIn } from './internal/param-slots.js';

function wrapWithRouteLocations(
  serverMod: unknown,
  location: RouteHook,
  node: VNode<any>
): VNode<any> {
  const moduleKey = (serverMod as { __moduleKey?: string } | undefined)
    ?.__moduleKey;
  return moduleKey
    ? h(RouteLocationsProvider, { moduleKey, location }, node)
    : node;
}

export type LayoutProps = { children: ComponentChildren };

export type ViewProps = RouteHook;

type LazyImport<T> = () => Promise<{ default: T }>;
export type LazyServerImport = () => Promise<unknown>;

export type RouteDef = {
  path: string;
  view?: LazyImport<ComponentType<ViewProps>>;
  layout?: LazyImport<ComponentType<LayoutProps>>;
  /**
   * Advanced. Lazy `.server.*` module loader for this route. Usually omitted:
   * the build auto-discovers the colocated sibling of the `view`/`layout` file
   * (`login.tsx` -> `login.server.ts`). Set this only to point at a non-sibling
   * module, or to `false` to opt this route out of auto-discovery (e.g. a
   * scratch `*.server.ts` sibling you don't want wired). A falsy value is
   * treated the same as no server module.
   */
  server?: LazyServerImport | false;
  children?: readonly RouteDef[];
  /**
   * Page-layer middleware/observers for this node and every descendant.
   * Composed outer-to-inner with `appConfig.use` and unit-level `use`.
   * Runs on the page render (SSR + client nav) and on the loader/action
   * RPC paths. The single declared source of a page guard.
   */
  use?: PageUse;
};

export type FlatRoute = {
  path: string;
  component: ComponentType<ViewProps>;
  // Stable per-component key. Two FlatRoute entries that share the same
  // `component` (e.g. a layout group registered at both `/movies` and
  // `/movies/*`) share this key, so preact's diff of preact-iso's matched
  // child does not unmount the shared subtree when the URL crosses between
  // them. See the `Routes` component below for why this matters.
  key: string;
};

export type ServerRoute = {
  /** Absolute route path the server module belongs to. */
  path: string;
  /** Lazy `.server.*` module loader. */
  server: LazyServerImport;
  /**
   * Lazy server-module loaders for every server-bearing ancestor in the
   * route tree, outermost first, NOT including this route's own server.
   * Used by the page-action resolver (`makePageActionResolvers`) to compose
   * page-layer middleware along the actual tree of layouts rather than
   * relying on URL-prefix matching
   * (which conflates siblings that share a path prefix, e.g.
   * `/demo/projects` and `/demo/projects/:projectId/...`).
   */
  ancestors: ReadonlyArray<LazyServerImport>;
};

export type RoutesManifest<
  T extends readonly RouteDef[] = readonly RouteDef[],
> = {
  tree: ReadonlyArray<RouteDef>;
  flat: ReadonlyArray<FlatRoute>;
  serverImports: ReadonlyArray<LazyServerImport>;
  /**
   * Path-keyed view of every server module in the tree. Lets server-side
   * consumers (e.g. the page-layer `use` resolver) load a per-page module
   * by the route path that matched, without re-walking the tree. The order
   * mirrors `serverImports`; the two arrays exist side-by-side because most
   * existing call sites only need the lazy thunks.
   */
  serverRoutes: ReadonlyArray<ServerRoute>;
  /**
   * Composed page-layer `use` per bindable route pattern. Two kinds of key:
   *
   * - An exact pattern per node with a `view` or `server` module: the page
   *   scope. Ancestor `use` folds in outer-first; a layout and its
   *   empty-path index child share one string and the deepest node's chain
   *   wins, so the exact key carries the index child's own `use` too.
   * - A `<path>/*` subtree pattern per children-bearing node (layout groups
   *   and guard-only grouping nodes): the subtree scope, the node's own
   *   composed chain without any child's additions, i.e. the chain every
   *   descendant inherits. A literal `path: '*'` child produces the same
   *   string as its parent's subtree key; the child's (superset) chain wins
   *   the dedup, keeping that collision over-guarding.
   *
   * Route-bound units (`serverRoute(pattern)`) resolve their RPC `use`
   * chain from these keys by exact lookup, never by request URL.
   */
  routeUse: ReadonlyArray<{ path: string; use: PageUse }>;
  /**
   * Phantom: carries the literal route-tree type so `RoutePaths<typeof routes>`
   * can extract the route-pattern union for typed params. Never assigned at
   * runtime; the `?` keeps the `defineRoutes` return object unchanged.
   */
  readonly __tree?: T;
};

// preact-iso's `Route<P>` and `Router` carry strict generics that reject our
// heterogeneous route components (leaves take `ViewProps`, layout-group
// wrappers take `()`). We erase the generic at every `h(Route, ...)` /
// `h(Router, ...)` call site through this single helper so the rationale lives
// in one place.
const asRouteComponent = (c: ComponentType<any>): AnyComponent<any> =>
  c as AnyComponent<any>;

// preact-iso's `lazy()` returns a wrapper whose component-type generic is
// loose. We know the underlying default export conforms to `ViewProps` (or to
// our layout-group wrapper which renders an inner Router); assert that here so
// `FlatRoute.component` stays strongly typed.
const asViewComponent = (c: ComponentType<any>): ComponentType<ViewProps> =>
  c as ComponentType<ViewProps>;

// Join a parent route path with a child segment, mirroring the tree walk:
// a root parent ('') yields the child as-is; an empty child segment (a
// layout-group wildcard leaf or index child) contributes nothing; a '/'
// parent joins its children as top-level absolute paths (the root reset:
// a child 'x' or '/x' keys as '/x', never '//x'); otherwise the child is
// appended under a single '/'. This is the one join every tree walker
// threads (walkRouteTree, collectServerRoutes, collectRouteUse), and it
// mirrors the type-level `Here` in internal/typed-routes.ts, so runtime
// pattern keys equal the type-derived spellings for every tree shape,
// including a root '/' layout or grouping node. `validate` keeps its own
// join rule (display-path with a leading slash).
function joinRoutePath(parentPath: string, childPath: string): string {
  if (parentPath === '') return childPath;
  if (childPath === '') return parentPath;
  if (parentPath === '/') {
    return childPath.startsWith('/') ? childPath : '/' + childPath;
  }
  return parentPath + '/' + childPath;
}

// Compose inherited page-layer `use` (ancestors outer-first) with a node's own
// `use`. Returns `base` unchanged when the node declares none, so the common
// no-own-use path allocates nothing. Shared by the tree walkers that thread the
// composed `use` down the tree (previously duplicated verbatim in three).
function composeUse(base: PageUse, own: PageUse | undefined): PageUse {
  return own ? [...base, ...own] : base;
}

type RouteRuleCtx = {
  hasView: boolean;
  hasLayout: boolean;
  hasChildren: boolean;
  isNested: boolean;
};

// Each rule is a predicate over a node's shape plus a message factory. The
// table form lets `validate` collect every violation in one pass (better DX
// than throw-on-first) and keeps the rule set independently testable. Messages
// are byte-identical to the previous inline throws so single-violation configs
// surface the same text.
const ROUTE_RULES: ReadonlyArray<{
  when: (r: RouteDef, ctx: RouteRuleCtx) => boolean;
  message: (here: string) => string;
}> = [
  {
    when: (_r, c) => c.hasView && c.hasLayout,
    message: (here) =>
      `Route ${here}: cannot declare both \`view\` and \`layout\`.`,
  },
  {
    when: (_r, c) => c.hasView && c.hasChildren,
    message: (here) =>
      `Route ${here}: \`view\` route cannot have \`children\`.`,
  },
  {
    when: (_r, c) => c.hasLayout && !c.hasChildren,
    message: (here) => `Route ${here}: \`layout\` requires \`children\`.`,
  },
  {
    when: (_r, c) => !c.hasView && !c.hasLayout && !c.hasChildren,
    message: (here) =>
      `Route ${here}: must declare \`view\`, \`layout\`+\`children\`, or \`children\`.`,
  },
  {
    when: (r, c) => c.isNested && r.path.startsWith('/'),
    message: (here) => `Route ${here}: child path must not start with \`/\`.`,
  },
];

function collectRouteViolations(
  routes: ReadonlyArray<RouteDef>,
  parentPath: string,
  errors: string[]
): void {
  for (const r of routes) {
    const here = parentPath + (r.path.startsWith('/') ? r.path : '/' + r.path);
    const ctx: RouteRuleCtx = {
      hasView: !!r.view,
      hasLayout: !!r.layout,
      hasChildren: !!(r.children && r.children.length > 0),
      isNested: parentPath !== '',
    };
    // Rules are checked in order; at most one fires per node (matching the
    // original if-throw semantics where the first failing check short-circuits).
    // Collecting across nodes lets a multi-route config surface all problems.
    for (const rule of ROUTE_RULES) {
      if (rule.when(r, ctx)) {
        errors.push(rule.message(here));
        break;
      }
    }
    // Reserved-param-name check (the convergent prototype-chain fix, see
    // isReservedParamName's own doc): orthogonal to the shape rules above
    // (a node can violate both a shape rule and this one), so it is not
    // folded into ROUTE_RULES's break-after-first-match table. A route can
    // never DECLARE a param named after an Object.prototype member; a guard
    // reading `ctx.location.pathParams` for a request that OMITS such a
    // param would otherwise misread the inherited member as present.
    for (const name of reservedParamNamesIn(r.path)) {
      errors.push(
        `Route ${here}: the param ':${name}' is reserved -- it is an ` +
          `Object.prototype member, so on a plain params object a guard ` +
          `reading an ABSENT param of this name would read the inherited ` +
          `member instead of undefined and wrongly treat it as present. ` +
          `Rename the param to something that is not '${name}'.`
      );
    }
    if (ctx.hasChildren) {
      collectRouteViolations(r.children!, here === '/' ? '' : here, errors);
    }
  }
}

function validate(routes: ReadonlyArray<RouteDef>): void {
  const errors: string[] = [];
  collectRouteViolations(routes, '', errors);
  if (errors.length === 0) return;
  if (errors.length === 1) throw new Error(errors[0]);
  throw new Error(
    `defineRoutes: ${errors.length} route configuration errors:\n` +
      errors.map((e) => `  - ${e}`).join('\n')
  );
}

function collectServerImports(
  routes: ReadonlyArray<RouteDef>
): LazyServerImport[] {
  const out: LazyServerImport[] = [];
  const walk = (rs: ReadonlyArray<RouteDef>) => {
    for (const r of rs) {
      if (r.server) out.push(r.server);
      if (r.children) walk(r.children);
    }
  };
  walk(routes);
  return out;
}

function collectServerRoutes(
  routes: ReadonlyArray<RouteDef>,
  parentPath = ''
): ServerRoute[] {
  const out: ServerRoute[] = [];
  // `serverStack` tracks the lazy server-thunks for every server-bearing
  // route on the path from the tree root down to (but not including) the
  // node being emitted. Pushing on the way in / popping on the way out
  // means each emitted ServerRoute captures its TRUE tree-walk ancestry,
  // not whichever other patterns happen to share a URL prefix.
  const walk = (
    rs: ReadonlyArray<RouteDef>,
    pp: string,
    serverStack: LazyServerImport[]
  ) => {
    for (const r of rs) {
      const here = joinRoutePath(pp, r.path);
      if (r.server) {
        // Capture the stack BEFORE pushing self -- ancestors exclude self.
        out.push({
          path: here,
          server: r.server,
          ancestors: serverStack.slice(),
        });
      }
      if (r.children) {
        if (r.server) {
          serverStack.push(r.server);
          walk(r.children, here, serverStack);
          serverStack.pop();
        } else {
          walk(r.children, here, serverStack);
        }
      }
    }
  };
  walk(routes, parentPath, []);
  return out;
}

/**
 * The subtree pattern for a route node's path: the key under which the node's
 * own composed chain (the chain every descendant inherits) is registered in
 * `routeUse`. Mirrors the matcher grammar's trailing `*` (route-pattern.ts in
 * the server package) and the type-level `SubtreePatterns` derivation. The
 * emitter here and the boot validator (`route-binding-guard.ts`) must agree
 * on this construction, so it lives in one place.
 *
 * Framework-private: exported for `@hono-preact/server` via the
 * `@hono-preact/iso/internal/runtime` door, not a user API.
 */
export function subtreePatternOf(path: string): string {
  return path === '/' ? '/*' : path + '/*';
}

function collectRouteUse(
  routes: ReadonlyArray<RouteDef>
): Array<{ path: string; use: PageUse }> {
  // Emit one entry per matchable route pattern: a leaf `view`, or any node
  // carrying its own `server` module. A route-bound unit resolves its
  // page-layer `use` chain by `byPattern(routeId)`, so it needs an entry for
  // every route it can bind to, not just server-bearing ones (that lets a
  // `serverRoute('/x')` unit in the src/server registry gate to a route whose
  // logic is not colocated). Ancestor `use` from layout/grouping nodes is
  // already folded into each node's `composed` chain.
  const ordered: Array<{ path: string; use: PageUse }> = [];
  const walk = (
    rs: ReadonlyArray<RouteDef>,
    parentPath: string,
    inherited: PageUse
  ) => {
    for (const r of rs) {
      const here = joinRoutePath(parentPath, r.path);
      const composed: PageUse = composeUse(inherited, r.use);
      if (r.view || r.server) {
        ordered.push({ path: here, use: composed });
      }
      if (r.children) {
        // Subtree key: the node's own composed chain (ancestors outer-first,
        // then own `use`), WITHOUT any child's additions. Emitted for every
        // children-bearing node (layout groups AND guard-only grouping nodes),
        // so `serverRoute('<path>/*')` gets its own map key distinct from the
        // node's empty-path index child. Pushed BEFORE the children so a
        // literal `path: '*'` child producing the same string wins the
        // deepest-wins dedup below.
        ordered.push({ path: subtreePatternOf(here), use: composed });
        walk(r.children, here, composed);
      }
    }
  };
  walk(routes, '', []);
  // Dedup by pattern, deepest-wins: a `server` layout node and its empty-path
  // index child share a pattern; parents are pushed before children, so the
  // later (index child) entry carries the page's own `use` and wins.
  const byPattern = new Map<string, PageUse>();
  for (const entry of ordered) byPattern.set(entry.path, entry.use);
  return [...byPattern].map(([path, use]) => ({ path, use }));
}

// Wrap a leaf view in a page-middleware host carrying the node's composed
// page-layer `use`. Identity is recomputed per registration; leaves are
// registered once each, so the shared-component memo (getOrCreateLazyView)
// is unaffected. No-op when there is nothing to run.
function withLeafGuard(
  component: ComponentType<ViewProps>,
  use: PageUse
): ComponentType<ViewProps> {
  if (use.length === 0) return component;
  const Guarded: ComponentType<ViewProps> = (location) =>
    h(PageMiddlewareHost, {
      use,
      location,
      children: h(component, location),
    });
  Guarded.displayName = `Guarded(${component.displayName ?? component.name ?? 'View'})`;
  return Guarded;
}

/**
 * Memoize `lazy(view)` per view-thunk identity. When the same `view` thunk is
 * referenced by multiple route registrations (e.g. `/docs` and `/docs/*`),
 * they should share one component reference so preact-iso's Router does not
 * treat the navigation as a route change and remount the layout.
 *
 * When `server` is provided, the loaded view is wrapped in a
 * RouteLocationsProvider so that loaders in the server module can read the
 * route's location from context.
 */
function getOrCreateLazyView(
  view: NonNullable<RouteDef['view']>,
  server: RouteDef['server'] | undefined,
  cache: Map<unknown, ComponentType<ViewProps>>
): ComponentType<ViewProps> {
  let component = cache.get(view);
  if (!component) {
    if (!server) {
      component = asViewComponent(lazy(view));
    } else {
      component = asViewComponent(
        lazy(async () => {
          const [{ default: View }, serverMod] = await Promise.all([
            view(),
            server(),
          ]);
          // `location` from the inner Router has a relative path (e.g. `/123`
          // when the route is nested inside a layout at `/movies/*`). Use
          // `useLocation()` to get the full window path and searchParams so the
          // stored location reflects the actual URL the loader runs against.
          const Wrapped: ComponentType<ViewProps> = (location) => {
            const { path, searchParams } = useLocation();
            const fullLocation: ViewProps = { ...location, path, searchParams };
            return wrapWithRouteLocations(
              serverMod,
              fullLocation,
              h(View as ComponentType<ViewProps>, location)
            );
          };
          return { default: Wrapped };
        })
      );
    }
    cache.set(view, component);
  }
  return component;
}

/**
 * Build the component for a layout group: <Layout><Router>{childRoutes}</Router></Layout>.
 * Returned via preact-iso's lazy so the layout module loads only when matched.
 * Children are themselves wrapped in preact-iso's lazy via their own `view`/`layout`,
 * so each child remains a separate code-split chunk.
 *
 * When the layout declares a `server` module, a RouteLocationsProvider is
 * installed around the layout with the layout's own matched location
 * (i.e. the path up to and including the layout's own segments, not the
 * inner wildcard/child segments).
 */
function makeLayoutGroupComponent(
  layoutImport: NonNullable<RouteDef['layout']>,
  server: RouteDef['server'] | undefined,
  layoutPathPattern: string,
  children: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>,
  guardUse: PageUse
): ComponentType<ViewProps> {
  return asViewComponent(
    lazy(async () => {
      const [{ default: Layout }, serverMod] = await Promise.all([
        layoutImport(),
        server ? server() : Promise.resolve(undefined),
      ]);
      const inner = buildInnerRoutes(children, viewCache);
      const Wrapper: ComponentType<ViewProps> = (location) => {
        // One load tracker per mounted inner Router instance (stable across
        // renders) so the cold-flush coordinator can tell this layout's leaf
        // Router apart from the outer Routes Router even though they share a url.
        const loadTracker = useMemo(makeRouterLoadTracker, []);
        const layoutLocation = deriveLayoutLocation(
          location,
          layoutPathPattern
        );
        const layoutNode = h(
          Layout,
          null,
          h(
            asRouteComponent(Router),
            {
              onLoadStart: loadTracker.onLoadStart,
              onLoadEnd: loadTracker.onLoadEnd,
            },
            ...inner
          )
        );
        const withLocations = wrapWithRouteLocations(
          serverMod,
          layoutLocation,
          layoutNode
        );
        // Gate the layout (and, via its inner Router, every descendant) on the
        // composed page-layer `use`, dispatching against the layout's OWN
        // matched location so the guard re-runs only when the layout's path
        // changes, not on every inner-leaf navigation. Nested layout hosts
        // compose ancestor -> leaf guards for free.
        return guardUse.length === 0
          ? withLocations
          : h(PageMiddlewareHost, {
              use: guardUse,
              location: layoutLocation,
              children: withLocations,
            });
      };
      return { default: Wrapper };
    })
  );
}

/**
 * Derive the layout's own matched location from the active (inner) RouteHook.
 *
 * When a layout matches `/movies/*`, the wildcard portion (`rest` or `0`) is
 * the child segment. The layout's location should be the path up to and
 * including the layout's own segments, with the wildcard stripped.
 */
function deriveLayoutLocation(
  active: ViewProps,
  layoutPathPattern: string
): ViewProps {
  const params = active.pathParams ?? {};
  const path = layoutPathPattern
    .split('/')
    .map((seg) =>
      seg.startsWith(':')
        ? String(params[seg.slice(1)] ?? '')
        : seg.startsWith('*')
          ? ''
          : seg
    )
    .filter(Boolean)
    .join('/');
  const finalPath = '/' + path;
  const filteredParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    // Drop the catch-all keys. `pathParams` is typed `Record<string, string>`,
    // so the old `as string` was redundant; the `v !== undefined` guard also
    // omits the `undefined` the matcher can store for an unmatched optional/rest
    // param (the static `string` type does not reflect that).
    if (k !== 'rest' && k !== '0' && v !== undefined) filteredParams[k] = v;
  }
  return {
    ...active,
    path: finalPath === '/' ? '/' : finalPath,
    pathParams: filteredParams,
  };
}

// Per-walker emit hooks for `walkRouteTree`. The fold builds every component
// and decides the branch; each walker supplies only how a built component
// becomes its output entry. `layoutGroup` is handed the group component once
// and must register it at BOTH the bare path and the `subtreePatternOf`
// wildcard (sharing the one component reference) so a navigation crossing
// between them is a single matched child, not a remount.
type RouteEmitter = {
  view: (component: ComponentType<ViewProps>, path: string) => void;
  layoutGroup: (component: ComponentType<ViewProps>, path: string) => void;
};

/**
 * The single tree-walk shared by `flattenTree` (absolute paths for the
 * top-level Router) and `buildInnerRoutes` (paths relative to a layout group's
 * inner Router). The two differ only in their emission target, so the
 * divergence lives entirely in the `emit` callbacks; the walk itself is
 * identical: join the path, compose the node's `use`, branch on
 * view / layout-group / bare-grouping, and build the component.
 *
 * Recursion happens only through bare groupings. Layout-group children are NOT
 * walked here -- `makeLayoutGroupComponent` defers them into a freshly mounted
 * inner Router (via `buildInnerRoutes`) so they remain separate code-split
 * chunks -- which is why both walkers share this single recursion shape.
 *
 * `inheritedUse` threads the composed page-layer `use` (ancestors outer-first)
 * down the tree; bare groupings have no component of their own, so their `use`
 * rides `inheritedUse` to the next node that actually renders one.
 */
function walkRouteTree(
  routes: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>,
  emit: RouteEmitter,
  parentPath = '',
  inheritedUse: PageUse = []
): void {
  for (const r of routes) {
    const here = joinRoutePath(parentPath, r.path);
    const ownUse: PageUse = composeUse(inheritedUse, r.use);
    if (r.view) {
      emit.view(
        withLeafGuard(getOrCreateLazyView(r.view, r.server, viewCache), ownUse),
        here
      );
    } else if (r.layout && r.children) {
      emit.layoutGroup(
        makeLayoutGroupComponent(
          r.layout,
          r.server,
          here,
          r.children,
          viewCache,
          ownUse
        ),
        here
      );
    } else if (r.children) {
      // Bare grouping: thread the prefix down and carry `use`. A root '/'
      // prefix is handled by joinRoutePath's root reset, so descendants
      // never pick up a doubled slash.
      walkRouteTree(r.children, viewCache, emit, here, ownUse);
    }
  }
}

/**
 * Build the inner <Route> children for a layout group's <Router>. Each child
 * is either a leaf (registered under its relative path) or another layout
 * group (registered under bare + wildcard paths within the inner router).
 *
 * `pendingUse` carries the composed page-layer `use` from bare groupings (which
 * have no component of their own) down to the next node that actually renders a
 * component, where it is applied via a host wrapper.
 *
 * Exported for direct unit testing only. The package barrel (`index.ts`)
 * re-exports named symbols, not `*`, so this stays off the public API surface.
 */
export function buildInnerRoutes(
  children: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>,
  pendingUse: PageUse = []
): VNode<any>[] {
  const nodes: VNode<any>[] = [];
  walkRouteTree(
    children,
    viewCache,
    {
      view: (component, path) =>
        nodes.push(h(Route, { path, component: asRouteComponent(component) })),
      layoutGroup: (component, path) => {
        nodes.push(h(Route, { path, component: asRouteComponent(component) }));
        nodes.push(
          h(Route, {
            path: subtreePatternOf(path),
            component: asRouteComponent(component),
          })
        );
      },
    },
    '',
    pendingUse
  );
  return nodes;
}

function flattenTree(
  routes: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>,
  keyCache: Map<ComponentType<ViewProps>, string>
): FlatRoute[] {
  const keyFor = (c: ComponentType<ViewProps>): string => {
    let k = keyCache.get(c);
    if (!k) {
      k = `r${keyCache.size}`;
      keyCache.set(c, k);
    }
    return k;
  };
  const out: FlatRoute[] = [];
  walkRouteTree(routes, viewCache, {
    view: (component, path) =>
      out.push({ path, component, key: keyFor(component) }),
    layoutGroup: (component, path) => {
      const key = keyFor(component);
      out.push({ path, component, key });
      out.push({ path: subtreePatternOf(path), component, key });
    },
  });
  return out;
}

export function defineRoutes<const T extends readonly RouteDef[]>(
  tree: T
): RoutesManifest<T> {
  validate(tree);
  const viewCache = new Map<unknown, ComponentType<ViewProps>>();
  const keyCache = new Map<ComponentType<ViewProps>, string>();
  return {
    tree,
    flat: flattenTree(tree, viewCache, keyCache),
    serverImports: collectServerImports(tree),
    serverRoutes: collectServerRoutes(tree),
    routeUse: collectRouteUse(tree),
  };
}

export type RoutesProps = {
  routes: RoutesManifest;
};

export const Routes: ComponentType<RoutesProps> = ({ routes }) => {
  // One load tracker for this top-level Router instance (stable across renders);
  // see makeRouterLoadTracker. Nested layout Routers each get their own.
  const loadTracker = useMemo(makeRouterLoadTracker, []);
  return h(
    RouteManifestContext.Provider,
    { value: routes.serverRoutes },
    h(
      asRouteComponent(Router),
      {
        onLoadStart: loadTracker.onLoadStart,
        onLoadEnd: loadTracker.onLoadEnd,
      },
      ...routes.flat.map((r) =>
        h(Route, {
          key: r.key,
          path: r.path,
          component: asRouteComponent(r.component),
        })
      )
    )
  );
};
