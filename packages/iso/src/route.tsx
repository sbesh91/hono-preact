import type { ComponentType, VNode } from 'preact';
import { h, options } from 'preact';
import { Route as PreactIsoRoute, type RouteHook } from 'preact-iso';
import { PageHost } from './page-host.js';
import {
  registerRouteMode,
  findMatchingPattern,
  type NavigateMode,
} from './navigator.js';

export type RouteProps = {
  path?: string;
  default?: boolean;
  component: ComponentType<RouteHook>;
  navigate?: NavigateMode;
};

// Register SSR routes on VNode creation so that the mode registry is
// populated even for routes that are not currently matched. The Router
// iterates all child VNodes by reading their props directly, but only
// renders the matched one; without this hook, registerRouteMode would
// never fire for unmatched routes.
const _prevVNode = options.vnode;
options.vnode = (vnode: VNode) => {
  if (vnode.type === Route) {
    const props = vnode.props as unknown as RouteProps & { searchParams?: unknown };
    // Skip clones produced by preact-iso's Router, which add searchParams to
    // matchProps and overwrite `path` with the matched URL. Only the original
    // JSX VNode should drive registration.
    if (
      props.navigate === 'ssr' &&
      props.path &&
      !('searchParams' in props)
    ) {
      registerRouteMode(props.path, 'ssr');
    }
  }
  if (_prevVNode) _prevVNode(vnode);
};

export function Route({ component, navigate, path, ...rest }: RouteProps) {
  if (navigate === 'ssr' && path) {
    // When the Router matches a route, it overwrites the 'path' prop with
    // the current URL (e.g. '/docs/intro') rather than the original pattern
    // (e.g. '/docs/:slug'). PageHost uses the pattern as a subscription key
    // to receive fragments, so we resolve it back here.
    const pattern = findMatchingPattern(path) ?? path;
    const HostedComponent: ComponentType<RouteHook> = (props) => (
      <PageHost component={component} location={props} path={pattern} />
    );
    HostedComponent.displayName = `SsrRoute(${pattern})`;
    // preact-iso's Route uses a discriminated union ({ path } | { default: true })
    // that TypeScript cannot satisfy when forwarding a spread containing
    // `default?: boolean`. Use h() directly to bypass JSX prop checking.
    return h(PreactIsoRoute, { path, component: HostedComponent, ...rest } as any);
  }
  // Same discriminated-union bypass for the non-SSR path.
  return h(PreactIsoRoute, { path, component, ...rest } as any);
}
