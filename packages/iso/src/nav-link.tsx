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

// A plain left-click with no modifiers on a same-tab link: the conditions under
// which preact-iso will actually soft-navigate. Only then do we arm the
// one-shot skip, so a modifier / new-tab click never leaves it armed.
function isPlainLeftClick(
  e: JSX.TargetedMouseEvent<HTMLAnchorElement>
): boolean {
  return (
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.defaultPrevented &&
    !(e.currentTarget.target && e.currentTarget.target !== '_self')
  );
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
