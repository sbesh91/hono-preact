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

// A plain left-click on a same-origin, non-hash-only, non-download link with no
// modifiers and a self target: the cases where preact-iso performs a client
// soft-navigation and a view transition would run. We arm the one-shot skip
// only for these, so a click that does not soft-navigate (a new-tab, download,
// cross-origin, or in-page hash click) can never leave the flag armed for a
// later, unrelated navigation.
function isPlainLeftClick(
  e: JSX.TargetedMouseEvent<HTMLAnchorElement>
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
  if (a.target && a.target !== '_self') return false;
  if (a.origin !== location.origin) return false;
  // Same path and query means a hash-only (or identical) URL: an in-page jump,
  // not a soft navigation.
  if (a.pathname === location.pathname && a.search === location.search) {
    return false;
  }
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
    if (transition === false && isPlainLeftClick(e)) skipNextNavTransition();
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
