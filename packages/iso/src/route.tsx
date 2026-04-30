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
import {
  Route as PreactIsoRoute,
  Router as PreactIsoRouter,
  type RouteHook,
} from 'preact-iso';
import { Page, type PageProps } from './page.js';

export type PageConfig<T> = Omit<PageProps<T>, 'location' | 'children'>;

export function wrapWithPage<T>(
  Component: ComponentType,
  config: PageConfig<T>
): (location: RouteHook) => JSX.Element {
  return function PageRouteHandler(location: RouteHook) {
    return (
      <Page {...config} location={location}>
        <Component />
      </Page>
    );
  };
}

export type RouteProps<T> = PageConfig<T> & {
  path: string;
  component: ComponentType;
};

// Marker component. <Router> from this package replaces <Route> elements with
// preact-iso <Route> elements whose `component` prop is wrapped in <Page>.
// Rendering <Route> directly (outside our <Router>) is a programmer error;
// we silently render nothing rather than throw.

// Using Symbol.for ensures the marker survives duplicate module copies (HMR,
// pnpm phantom deps, etc.) because Symbol.for is realm-wide by key.
const ROUTE_MARKER = Symbol.for('@hono-preact/iso/Route');

export function Route<T>(_props: RouteProps<T>): null {
  return null;
}
Route.displayName = 'Route';
(Route as unknown as Record<symbol, unknown>)[ROUTE_MARKER] = true;

function isOurRoute(node: unknown): node is VNode<RouteProps<unknown>> {
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

function isFragmentNode(node: unknown): node is VNode<{ children?: ComponentChildren }> {
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
