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
};

export type RoutesManifest = {
  tree: ReadonlyArray<RouteDef>;
  flat: ReadonlyArray<FlatRoute>;
  serverImports: ReadonlyArray<LazyServerImport>;
};

function validate(routes: ReadonlyArray<RouteDef>, parentPath = ''): void {
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

    if (hasChildren) validate(r.children!, here === '/' ? '' : here);
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
    component = lazy(view) as ComponentType<ViewProps>;
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
  return lazy(async () => {
    const Layout = (await layoutImport()).default;
    const inner = buildInnerRoutes(children, viewCache);
    const Wrapper: ComponentType = () =>
      h(Layout, null, h(Router, null, ...inner));
    return { default: Wrapper };
  }) as ComponentType<ViewProps>;
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
          component: getOrCreateLazyView(child.view, viewCache) as AnyComponent<any>,
        })
      );
    } else if (child.layout && child.children) {
      const Group = makeLayoutGroupComponent(child.layout, child.children, viewCache);
      // Same shared-component trick at this nesting level.
      nodes.push(h(Route, { path: child.path, component: Group as AnyComponent<any> }));
      nodes.push(
        h(Route, { path: child.path + '/*', component: Group as AnyComponent<any> })
      );
    } else if (child.children) {
      // Path-grouping inside a layout: inline child paths into this router.
      for (const grand of child.children) {
        const joined =
          child.path === '' ? grand.path : child.path + '/' + grand.path;
        if (grand.view) {
          nodes.push(
            h(Route, {
              path: joined,
              component: getOrCreateLazyView(grand.view, viewCache) as AnyComponent<any>,
            })
          );
        }
        // Note: deep recursion of grouping/layouts inside a grouping is rare
        // enough at v0.1 that we keep this one-level. If needed, extend later.
      }
    }
  }
  return nodes;
}

function flattenTree(
  routes: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>,
  parentPath = ''
): FlatRoute[] {
  const out: FlatRoute[] = [];
  for (const r of routes) {
    const here =
      parentPath === ''
        ? r.path
        : parentPath + (r.path === '' ? '' : '/' + r.path);

    if (r.view) {
      out.push({
        path: here,
        component: getOrCreateLazyView(r.view, viewCache),
      });
    } else if (r.layout && r.children) {
      const Group = makeLayoutGroupComponent(r.layout, r.children, viewCache);
      out.push({
        path: here,
        component: Group,
      });
      out.push({
        path: here + '/*',
        component: Group,
      });
    } else if (r.children) {
      // Path-grouping at top level: recurse with the prefix.
      const childParent = here === '/' ? '' : here;
      out.push(...flattenTree(r.children, viewCache, childParent));
    }
  }
  return out;
}

export function defineRoutes(tree: RouteDef[]): RoutesManifest {
  validate(tree);
  const viewCache = new Map<unknown, ComponentType<ViewProps>>();
  return {
    tree,
    flat: flattenTree(tree, viewCache),
    serverImports: collectServerImports(tree),
  };
}

export type RoutesProps = {
  routes: RoutesManifest;
  onRouteChange?: (url: string) => void;
};

export const Routes: ComponentType<RoutesProps> = ({ routes, onRouteChange }) => {
  return h(
    Router as AnyComponent<any>,
    onRouteChange ? { onRouteChange } : null,
    ...routes.flat.map((r) =>
      h(Route, {
        key: r.path,
        path: r.path,
        component: r.component as AnyComponent<any>,
      })
    )
  );
};
