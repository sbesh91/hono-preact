import type { JSX, VNode } from 'preact';
import { useRouteActive } from './route-active.js';

export type NavLinkProps = Omit<
  JSX.HTMLAttributes<HTMLAnchorElement>,
  'class' | 'className'
> & {
  href: string;
  /** Pattern to test for active state. Defaults to `href`. */
  match?: string;
  /** Default true. */
  exact?: boolean;
  /** Always applied. */
  class?: string;
  /** Merged in when active. */
  activeClass?: string;
  /** Merged in when not active. */
  inactiveClass?: string;
};

export function NavLink(props: NavLinkProps): VNode {
  const {
    href,
    match,
    exact = true,
    class: baseClass,
    activeClass,
    inactiveClass,
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

  return (
    <a {...rest} href={href} class={className} aria-current={ariaCurrent}>
      {children}
    </a>
  );
}
