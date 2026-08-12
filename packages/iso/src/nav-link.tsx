import type { VNode, JSX, TargetedMouseEvent } from 'preact';
import type { DistributiveOmit } from './internal/element-props.js';
import { useRouteActive } from './route-active.js';
import type { RoutePattern } from './internal/typed-routes.js';
import { skipNextNavTransition } from './internal/route-change.js';

// Anchor-specific, not the generic element attributes: `target`, `rel`,
// `download`, `ping`, and `referrerpolicy` are anchor-only, and
// `willSoftNavigate` below reads `target` and `download` off the rendered
// anchor. Deriving from the generic element attributes made props the runtime
// already depends on unspellable by a caller. `JSX.IntrinsicElements['a']` is
// the spelling that carries them *and* preserves the per-element `role`
// narrowing; see `DistributiveOmit` for why the omit has to distribute.
export type NavLinkProps = DistributiveOmit<
  JSX.IntrinsicElements['a'],
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
// soft-navigation, as opposed to the browser handling the click itself
// (non-primary or modifier clicks, download links, non-self targets, bare
// in-page anchors, cross-origin hrefs). Mirrors preact-iso's handleNav link
// gate. Deliberately does NOT gate on `e.defaultPrevented`: handleNav ignores
// it too, so an upstream capture-phase preventDefault still soft-navigates.
function willSoftNavigate(
  e: TargetedMouseEvent<HTMLAnchorElement>,
  href: string
): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
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

  // Presence check, not nullish-coalesce: an explicit `aria-current={undefined}`
  // must suppress the computed value, which requires distinguishing "written as
  // undefined" from "omitted". Both the classic-`h` and jsx-runtime transforms
  // keep a written-but-undefined key present in the props object (and drop an
  // omitted one), so `in` is the reliable signal. Destructuring above does not
  // remove the key from `props`.
  const ariaCurrent =
    'aria-current' in props ? ariaCurrentProp : active ? 'page' : undefined;

  const handleClick = (e: TargetedMouseEvent<HTMLAnchorElement>) => {
    // Keyed to the resolved href: if no navigated flush follows (a same-URL
    // push), the arm expires at the next navigation instead of stranding.
    if (transition === false && willSoftNavigate(e, href))
      skipNextNavTransition(e.currentTarget.href);
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
