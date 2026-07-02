import type { JSX, VNode } from 'preact';
import { useRouteActive } from './route-active.js';
import type { RoutePattern } from './internal/typed-routes.js';
import { skipNextNavTransition } from './internal/route-change.js';

export type NavLinkProps = Omit<
  JSX.HTMLAttributes<HTMLAnchorElement>,
  'class' | 'className'
> & {
  href: string;
  /** Pattern to test for active state. Defaults to `href`. */
  match?: RoutePattern;
  /** Default true. */
  exact?: boolean;
  /** Always applied. */
  class?: string;
  /** Merged in when active. */
  activeClass?: string;
  /** Merged in when not active. */
  inactiveClass?: string;
  /** Set false to navigate without a view transition. Default: animate. */
  transition?: boolean;
};

// Whether a plain left-click on this link will trigger a preact-iso client
// soft-navigation (and thus a view transition worth suppressing). Mirrors
// preact-iso's handleNav link gate (same-origin, raw href not starting with #,
// self/empty target, no download) so we arm the one-shot skip only when a
// navigation will actually follow. Best-effort: preact-iso's optional router
// `scope` is not mirrored (it is rarely set), so a link outside a scoped router
// is the one residual case that could arm without navigating.
function willSoftNavigate(
  e: JSX.TargetedMouseEvent<HTMLAnchorElement>,
  href: string
): boolean {
  if (
    e.button !== 0 ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey ||
    e.altKey ||
    e.defaultPrevented
  ) {
    return false;
  }
  const a = e.currentTarget;
  if (a.hasAttribute('download')) return false;
  if (!/^(_?self)?$/i.test(a.target)) return false; // non-self target = new context
  if (href[0] === '#') return false; // bare in-page anchor: no soft-nav
  if (a.origin !== location.origin) return false; // cross-origin = full load
  return true;
}

export function NavLink(props: NavLinkProps): VNode {
  const {
    href,
    match,
    exact = true,
    class: baseClass,
    activeClass,
    inactiveClass,
    transition,
    onClick: onClickProp,
    'aria-current': ariaCurrentProp,
    children,
    ...rest
  } = props;

  const active = useRouteActive(match ?? href, { exact });

  const className =
    [baseClass, active ? activeClass : inactiveClass]
      .filter(Boolean)
      .join(' ') || undefined;

  const ariaCurrent = ariaCurrentProp ?? (active ? 'page' : undefined);

  const handleClick = (e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
    if (transition === false && willSoftNavigate(e, href))
      skipNextNavTransition();
    onClickProp?.(e);
  };

  return (
    <a
      {...rest}
      href={href}
      class={className}
      aria-current={ariaCurrent}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
