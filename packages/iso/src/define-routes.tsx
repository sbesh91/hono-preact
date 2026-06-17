import { h } from 'preact';
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
import { __noteLoadEnd, __noteLoadStart } from './internal/route-change.js';
import { PageMiddlewareHost } from './internal/page-middleware-host.js';
import type { PageUse } from './internal/use-types.js';

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
  server?: LazyServerImport;
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
   * Composed page-layer `use` per server-bearing route pattern (ancestors
   * outer-first, then the node's own `use`). One entry per node with a
   * `server` module, matching `serverRoutes`; those are the RPC targets the
   * resolver matches a request URL against. Guards declared on guard-only
   * grouping or layout nodes (no `server` module) are folded into these
   * descendant entries via composition rather than appearing themselves.
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
// layout-group wildcard leaf) contributes nothing; otherwise the child is
// appended under a single '/'. Shared by the tree walkers that need a node's
// absolute path. `validate` and `buildInnerRoutes` intentionally keep their
// own join rules (display-path with leading slash, and grandchild prefixing).
function joinRoutePath(parentPath: string, childPath: string): string {
  if (parentPath === '') return childPath;
  return childPath === '' ? parentPath : parentPath + '/' + childPath;
}

function validate(routes: ReadonlyArray<RouteDef>, parentPath = ''): void {
  for (const r of routes) {
    const here = parentPath + (r.path.startsWith('/') ? r.path : '/' + r.path);
    const hasView = !!r.view;
    const hasLayout = !!r.layout;
    const hasChildren = !!(r.children && r.children.length > 0);

    if (hasView && hasLayout) {
      throw new Error(
        `Route ${here}: cannot declare both \`view\` and \`layout\`.`
      );
    }

    if (hasView && hasChildren) {
      throw new Error(
        `Route ${here}: \`view\` route cannot have \`children\`.`
      );
    }

    if (hasLayout && !hasChildren) {
      throw new Error(`Route ${here}: \`layout\` requires \`children\`.`);
    }

    if (!hasView && !hasLayout && !hasChildren) {
      throw new Error(
        `Route ${here}: must declare \`view\`, \`layout\`+\`children\`, or \`children\`.`
      );
    }

    if (parentPath !== '' && r.path.startsWith('/')) {
      throw new Error(`Route ${here}: child path must not start with \`/\`.`);
    }

    if (hasChildren) {
      validate(r.children!, here === '/' ? '' : here);
    }
  }
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

function collectRouteUse(
  routes: ReadonlyArray<RouteDef>,
  parentPath = '',
  inherited: PageUse = []
): Array<{ path: string; use: PageUse }> {
  const out: Array<{ path: string; use: PageUse }> = [];
  for (const r of routes) {
    const here = joinRoutePath(parentPath, r.path);
    const composed: PageUse = r.use ? [...inherited, ...r.use] : inherited;
    // Emit one entry per server-bearing node (same key set as
    // `collectServerRoutes`): those are the only RPC targets. Ancestor `use`
    // from view/layout/grouping nodes with no server module is already folded
    // into `composed`, so their guards still reach these descendants.
    if (r.server) {
      out.push({ path: here, use: composed });
    }
    if (r.children) {
      out.push(...collectRouteUse(r.children, here, composed));
    }
  }
  return out;
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
              onLoadStart: __noteLoadStart,
              onLoadEnd: __noteLoadEnd,
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
  for (const k of Object.keys(params)) {
    if (k !== 'rest' && k !== '0') filteredParams[k] = params[k] as string;
  }
  return {
    ...active,
    path: finalPath === '/' ? '/' : finalPath,
    pathParams: filteredParams,
  };
}

/**
 * Build the inner <Route> children for a layout group's <Router>. Each child
 * is either a leaf (registered under its relative path) or another layout
 * group (registered under bare + wildcard paths within the inner router).
 *
 * `pendingUse` carries the composed page-layer `use` from bare groupings (which
 * have no component of their own) down to the next node that actually renders a
 * component, where it is applied via a host wrapper.
 */
function buildInnerRoutes(
  children: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>,
  pendingUse: PageUse = []
): VNode<any>[] {
  const nodes: VNode<any>[] = [];
  for (const child of children) {
    const ownUse: PageUse = child.use
      ? [...pendingUse, ...child.use]
      : pendingUse;
    if (child.view) {
      const component = withLeafGuard(
        getOrCreateLazyView(child.view, child.server, viewCache),
        ownUse
      );
      nodes.push(
        h(Route, { path: child.path, component: asRouteComponent(component) })
      );
    } else if (child.layout && child.children) {
      const Group = makeLayoutGroupComponent(
        child.layout,
        child.server,
        child.path,
        child.children,
        viewCache,
        ownUse
      );
      // Same shared-component trick at this nesting level.
      nodes.push(
        h(Route, { path: child.path, component: asRouteComponent(Group) })
      );
      nodes.push(
        h(Route, {
          path: child.path + '/*',
          component: asRouteComponent(Group),
        })
      );
    } else if (child.children) {
      // Bare grouping: prefix child paths and carry `use` down. A grouping
      // may now contain nested layouts/groupings, not just view leaves.
      const prefixed = child.children.map((grand) => ({
        ...grand,
        path: child.path === '' ? grand.path : child.path + '/' + grand.path,
      }));
      nodes.push(...buildInnerRoutes(prefixed, viewCache, ownUse));
    }
  }
  return nodes;
}

function flattenTree(
  routes: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>,
  keyCache: Map<ComponentType<ViewProps>, string>,
  parentPath = '',
  pendingUse: PageUse = []
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
  for (const r of routes) {
    const here = joinRoutePath(parentPath, r.path);
    const ownUse: PageUse = r.use ? [...pendingUse, ...r.use] : pendingUse;

    if (r.view) {
      const component = withLeafGuard(
        getOrCreateLazyView(r.view, r.server, viewCache),
        ownUse
      );
      out.push({ path: here, component, key: keyFor(component) });
    } else if (r.layout && r.children) {
      const Group = makeLayoutGroupComponent(
        r.layout,
        r.server,
        here,
        r.children,
        viewCache,
        ownUse
      );
      const key = keyFor(Group);
      out.push({ path: here, component: Group, key });
      out.push({ path: here + '/*', component: Group, key });
    } else if (r.children) {
      // Path-grouping at top level: recurse with the prefix, carrying `use`.
      const childParent = here === '/' ? '' : here;
      out.push(
        ...flattenTree(r.children, viewCache, keyCache, childParent, ownUse)
      );
    }
  }
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
  return h(
    RouteManifestContext.Provider,
    { value: routes.serverRoutes },
    h(
      asRouteComponent(Router),
      {
        onLoadStart: __noteLoadStart,
        onLoadEnd: __noteLoadEnd,
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
