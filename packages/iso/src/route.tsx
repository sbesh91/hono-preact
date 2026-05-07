import type { ComponentType, VNode } from 'preact';
import { options } from 'preact';
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
    const props = vnode.props as RouteProps;
    if (props.navigate === 'ssr' && props.path) {
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
    return <PreactIsoRoute path={path} component={HostedComponent} {...rest} />;
  }
  return <PreactIsoRoute path={path} component={component} {...rest} />;
}
