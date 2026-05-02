import {
  Fragment,
  isValidElement,
  toChildArray,
  type ComponentChild,
  type ComponentChildren,
  type ComponentType,
  type JSX,
  type VNode,
} from 'preact';
import { useRef, useState } from 'preact/hooks';
import {
  Route as PreactIsoRoute,
  Router as PreactIsoRouter,
  type RouteHook,
} from 'preact-iso';
import { Page, type PageProps } from './page.js';
import { PAGE_BINDINGS, type PageComponent } from './define-page.js';
import type { LazyComponent } from './lazy.js';

// Route-level config — these stay on <Route>. Page-level (loader, cache,
// Wrapper) come from the component's PAGE_BINDINGS.
export type RouteConfig = Pick<
  PageProps<unknown>,
  'fallback' | 'errorFallback' | 'serverGuards' | 'clientGuards'
>;

export type RouteProps = RouteConfig & {
  path: string;
  component: ComponentType;
};

// Kept for back-compat consumers and tests.
export type PageConfig = RouteConfig;

function isLazyComponent(component: ComponentType): component is LazyComponent {
  const lazyish = component as LazyComponent;
  return (
    typeof lazyish.preload === 'function' &&
    typeof lazyish.getResolvedDefault === 'function'
  );
}

function readBindings(component: ComponentType) {
  // Eager components carry PAGE_BINDINGS directly. Lazy components carry it
  // on their resolved default; callers must check isLazyComponent first and
  // ensure the lazy is resolved before reading.
  if (isLazyComponent(component)) {
    const resolved = component.getResolvedDefault();
    return resolved
      ? (resolved as PageComponent<unknown>)[PAGE_BINDINGS]
      : undefined;
  }
  return (component as PageComponent<unknown>)[PAGE_BINDINGS];
}

// PageBoundary reads PAGE_BINDINGS at render time. For a lazy component it
// kicks off preload() and self-suspends with its own state-update on resolve,
// mirroring preact-iso's LazyComponent pattern (so we don't depend on a
// parent <Suspense>/Router re-render to recover from the throw). Once the
// lazy is resolved, the resolved default is introspected for bindings and
// <Page> mounts with them.
type PageBoundaryProps = {
  Component: ComponentType;
  config: RouteConfig;
  location: RouteHook;
};

function PageBoundary({ Component, config, location }: PageBoundaryProps) {
  // The state-update closure mirrors preact-iso's lazy.js — gives us a
  // re-render trigger that's local to this component instance.
  const [, update] = useState(0);
  const tracked = useRef<Promise<unknown> | null>(null);

  if (isLazyComponent(Component)) {
    const resolved = Component.getResolvedDefault();
    if (!resolved) {
      const p = Component.preload();
      if (tracked.current !== p) {
        tracked.current = p;
        // Both arms re-render so the throw on the next render either succeeds
        // (resolved) or re-fires through Suspense to a parent error boundary.
        // The rejection arm also satisfies window.onunhandledrejection.
        p.then(
          () => update((n) => n + 1),
          () => update((n) => n + 1)
        );
      }
      throw p;
    }
  }

  const bindings = readBindings(Component);
  return (
    <Page
      loader={bindings?.loader}
      cache={bindings?.cache}
      Wrapper={bindings?.Wrapper}
      fallback={config.fallback}
      errorFallback={config.errorFallback}
      serverGuards={config.serverGuards}
      clientGuards={config.clientGuards}
      location={location}
    >
      <Component />
    </Page>
  );
}

export function wrapWithPage(
  Component: ComponentType,
  config: RouteConfig
): (location: RouteHook) => JSX.Element {
  return function PageRouteHandler(location: RouteHook) {
    return (
      <PageBoundary Component={Component} config={config} location={location} />
    );
  };
}

// Marker component. <Router> from this package replaces <Route> elements with
// preact-iso <Route> elements whose `component` prop is wrapped in <Page>.
// Rendering <Route> directly (outside our <Router>) is a programmer error;
// we silently render nothing rather than throw.

// Using Symbol.for ensures the marker survives duplicate module copies (HMR,
// pnpm phantom deps, etc.) because Symbol.for is realm-wide by key.
const ROUTE_MARKER = Symbol.for('@hono-preact/iso/Route');

export function Route(_props: RouteProps): null {
  return null;
}
Route.displayName = 'Route';
(Route as unknown as Record<symbol, unknown>)[ROUTE_MARKER] = true;

function isOurRoute(node: unknown): node is VNode<RouteProps> {
  return (
    isValidElement(node) &&
    typeof node.type === 'function' &&
    (node.type as unknown as Record<symbol, unknown>)[ROUTE_MARKER] === true
  );
}

// preact-iso doesn't export RouterProps from its public surface, so we mirror
// the shape from `node_modules/preact-iso/src/router.d.ts` here.
type PreactIsoRouterProps = {
  onRouteChange?: (url: string) => void;
  onLoadEnd?: (url: string) => void;
  onLoadStart?: (url: string) => void;
  children?: ComponentChildren;
};

export type RouterProps = Omit<PreactIsoRouterProps, 'children'> & {
  children?: ComponentChildren;
};

function isFragmentNode(
  node: unknown
): node is VNode<{ children?: ComponentChildren }> {
  return isValidElement(node) && node.type === Fragment;
}

function flattenFragments(children: ComponentChildren): ComponentChild[] {
  const out: ComponentChild[] = [];
  for (const child of toChildArray(children)) {
    if (isFragmentNode(child)) {
      out.push(...flattenFragments(child.props.children));
    } else {
      out.push(child);
    }
  }
  return out;
}

/** Routes one matching child path; recurses through nested Fragments, but not through other component wrappers. */
export function Router({ children, ...rest }: RouterProps): JSX.Element {
  const transformed = flattenFragments(children).map((child) => {
    if (!isOurRoute(child)) return child;
    const { path, component, ...config } = child.props;
    return (
      <PreactIsoRoute
        path={path}
        component={wrapWithPage(component, config)}
      />
    );
  });
  // PreactIsoRouter's children type is NestedArray<VNode>; cast through unknown
  // because toChildArray returns ComponentChild[].
  return (
    <PreactIsoRouter {...rest}>
      {transformed as unknown as JSX.Element[]}
    </PreactIsoRouter>
  );
}
