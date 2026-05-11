import { h } from 'preact';
import type { AnyComponent, ComponentChildren, ComponentType, VNode } from 'preact';
import { lazy, Route, Router } from 'preact-iso';
import type { RouteHook } from 'preact-iso';

export type LayoutProps = { children: ComponentChildren };

export type ViewProps = RouteHook;

type LazyImport<T> = () => Promise<{ default: T }>;
type LazyServerImport = () => Promise<unknown>;

export type RouteDef = {
  path: string;
  view?: LazyImport<ComponentType<ViewProps>>;
  layout?: LazyImport<ComponentType<LayoutProps>>;
  server?: LazyServerImport;
  children?: RouteDef[];
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

export type RoutesManifest = {
  tree: ReadonlyArray<RouteDef>;
  flat: ReadonlyArray<FlatRoute>;
  serverImports: ReadonlyArray<LazyServerImport>;
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

/**
 * Where in the tree a route is being validated. Determines which structural
 * shapes are legal at that position.
 *
 * - `top`: at top level or inside a top-level path-grouping. Anything goes.
 * - `layout`: a direct child of a layout group. May be a leaf, a layout
 *    group, or a path-grouping (which is restricted further).
 * - `layout-grouping`: a child of a path-grouping that is itself inside a
 *    layout group. `buildInnerRoutes` only inlines view-leaves at this depth,
 *    so layouts and further grouping here would silently disappear at runtime.
 *    Reject them at validation time instead.
 */
type ValidationContext = 'top' | 'layout' | 'layout-grouping';

function validate(
  routes: ReadonlyArray<RouteDef>,
  parentPath = '',
  context: ValidationContext = 'top'
): void {
  for (const r of routes) {
    const here = parentPath + (r.path.startsWith('/') ? r.path : '/' + r.path);
    const hasView = !!r.view;
    const hasLayout = !!r.layout;
    const hasChildren = !!(r.children && r.children.length > 0);
    const hasServer = !!r.server;

    if (hasView && hasLayout) {
      throw new Error(`Route ${here}: cannot declare both \`view\` and \`layout\`.`);
    }
    if (hasView && hasChildren) {
      throw new Error(`Route ${here}: \`view\` route cannot have \`children\`.`);
    }
    if (hasLayout && !hasChildren) {
      throw new Error(`Route ${here}: \`layout\` requires \`children\`.`);
    }
    if (hasLayout && hasServer) {
      throw new Error(`Route ${here}: \`layout\` cannot declare \`server\` (one loader per leaf).`);
    }
    if (!hasView && !hasLayout && !hasChildren) {
      throw new Error(`Route ${here}: must declare \`view\`, \`layout\`+\`children\`, or \`children\`.`);
    }

    if (parentPath !== '' && r.path.startsWith('/')) {
      throw new Error(`Route ${here}: child path must not start with \`/\`.`);
    }

    if (context === 'layout-grouping' && (hasLayout || hasChildren)) {
      throw new Error(
        `Route ${here}: a path-grouping inside a layout group may only contain view leaves at v0.1. ` +
          `Move this route up a level (direct child of the layout group) or restructure as its own layout group.`
      );
    }

    if (hasChildren) {
      const childContext: ValidationContext = hasLayout
        ? 'layout'
        : context === 'layout'
          ? 'layout-grouping'
          : 'top';
      validate(r.children!, here === '/' ? '' : here, childContext);
    }
  }
}

function collectServerImports(routes: ReadonlyArray<RouteDef>): LazyServerImport[] {
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

/**
 * Memoize `lazy(view)` per view-thunk identity. When the same `view` thunk is
 * referenced by multiple route registrations (e.g. `/docs` and `/docs/*`),
 * they should share one component reference so preact-iso's Router does not
 * treat the navigation as a route change and remount the layout.
 */
function getOrCreateLazyView(
  view: NonNullable<RouteDef['view']>,
  cache: Map<unknown, ComponentType<ViewProps>>
): ComponentType<ViewProps> {
  let component = cache.get(view);
  if (!component) {
    component = asViewComponent(lazy(view));
    cache.set(view, component);
  }
  return component;
}

/**
 * Build the component for a layout group: <Layout><Router>{childRoutes}</Router></Layout>.
 * Returned via preact-iso's lazy so the layout module loads only when matched.
 * Children are themselves wrapped in preact-iso's lazy via their own `view`/`layout`,
 * so each child remains a separate code-split chunk.
 */
function makeLayoutGroupComponent(
  layoutImport: NonNullable<RouteDef['layout']>,
  children: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>
): ComponentType<ViewProps> {
  return asViewComponent(
    lazy(async () => {
      const Layout = (await layoutImport()).default;
      const inner = buildInnerRoutes(children, viewCache);
      const Wrapper: ComponentType = () =>
        h(Layout, null, h(Router, null, ...inner));
      return { default: Wrapper };
    })
  );
}

/**
 * Build the inner <Route> children for a layout group's <Router>. Each child
 * is either a leaf (registered under its relative path) or another layout
 * group (registered under bare + wildcard paths within the inner router).
 */
function buildInnerRoutes(
  children: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>
): VNode<any>[] {
  const nodes: VNode<any>[] = [];
  for (const child of children) {
    if (child.view) {
      nodes.push(
        h(Route, {
          path: child.path,
          component: asRouteComponent(getOrCreateLazyView(child.view, viewCache)),
        })
      );
    } else if (child.layout && child.children) {
      const Group = makeLayoutGroupComponent(child.layout, child.children, viewCache);
      // Same shared-component trick at this nesting level.
      nodes.push(h(Route, { path: child.path, component: asRouteComponent(Group) }));
      nodes.push(
        h(Route, { path: child.path + '/*', component: asRouteComponent(Group) })
      );
    } else if (child.children) {
      // Path-grouping inside a layout. `validate()` already enforces that all
      // descendants here are view leaves, so we only inline grandchild views.
      for (const grand of child.children) {
        const joined =
          child.path === '' ? grand.path : child.path + '/' + grand.path;
        if (grand.view) {
          nodes.push(
            h(Route, {
              path: joined,
              component: asRouteComponent(getOrCreateLazyView(grand.view, viewCache)),
            })
          );
        }
      }
    }
  }
  return nodes;
}

function flattenTree(
  routes: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>,
  keyCache: Map<ComponentType<ViewProps>, string>,
  parentPath = ''
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
    const here =
      parentPath === ''
        ? r.path
        : parentPath + (r.path === '' ? '' : '/' + r.path);

    if (r.view) {
      const component = getOrCreateLazyView(r.view, viewCache);
      out.push({ path: here, component, key: keyFor(component) });
    } else if (r.layout && r.children) {
      const Group = makeLayoutGroupComponent(r.layout, r.children, viewCache);
      const key = keyFor(Group);
      out.push({ path: here, component: Group, key });
      out.push({ path: here + '/*', component: Group, key });
    } else if (r.children) {
      // Path-grouping at top level: recurse with the prefix.
      const childParent = here === '/' ? '' : here;
      out.push(...flattenTree(r.children, viewCache, keyCache, childParent));
    }
  }
  return out;
}

export function defineRoutes(tree: RouteDef[]): RoutesManifest {
  validate(tree);
  const viewCache = new Map<unknown, ComponentType<ViewProps>>();
  const keyCache = new Map<ComponentType<ViewProps>, string>();
  return {
    tree,
    flat: flattenTree(tree, viewCache, keyCache),
    serverImports: collectServerImports(tree),
  };
}

export type RoutesProps = {
  routes: RoutesManifest;
  onRouteChange?: (url: string) => void;
};

export const Routes: ComponentType<RoutesProps> = ({ routes, onRouteChange }) => {
  return h(
    asRouteComponent(Router),
    onRouteChange ? { onRouteChange } : null,
    ...routes.flat.map((r) =>
      h(Route, {
        key: r.key,
        path: r.path,
        component: asRouteComponent(r.component),
      })
    )
  );
};
