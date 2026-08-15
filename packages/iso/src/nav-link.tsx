import type {
  VNode,
  JSX,
  TargetedMouseEvent,
  TargetedPointerEvent,
  TargetedFocusEvent,
} from 'preact';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { DistributiveOmit } from './internal/element-props.js';
import { useRouteActive } from './route-active.js';
import type { RoutePattern } from './internal/typed-routes.js';
import { skipNextNavTransition } from './internal/route-change.js';
import type { AnyLoaderRef } from './define-loader.js';
import { usePrefetch } from './use-prefetch.js';

// Hoisted so its identity is stable across renders: usePrefetch's internal
// useCallback depends on `refs`, and a fresh `[]` literal on every render
// would defeat that memo for every NavLink that doesn't pass prefetchLoaders.
const EMPTY_LOADER_REFS: ReadonlyArray<AnyLoaderRef> = [];

// Debounce before a hover counts as intent to navigate, so a cursor merely
// passing over the link on its way elsewhere doesn't trigger a fetch.
const HOVER_INTENT_MS = 150;

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
  /**
   * Prefetch `prefetchLoaders` for this link's target route. `'hover'` warms on
   * hover intent (and immediately on focus, so keyboard users get the same
   * warming); `'visible'` warms once the link enters the viewport. Default: no
   * prefetching.
   */
  prefetch?: 'hover' | 'visible' | false;
  /** Loaders to prefetch. Required for `prefetch` to do anything. */
  prefetchLoaders?: AnyLoaderRef | ReadonlyArray<AnyLoaderRef>;
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
    prefetch,
    prefetchLoaders,
    onClick: onClickProp,
    onPointerEnter: onPointerEnterProp,
    onPointerLeave: onPointerLeaveProp,
    onFocus: onFocusProp,
    'aria-current': ariaCurrentProp,
    children,
    ...rest
  } = props;

  const active = useRouteActive(match ?? href, { exact });

  const runPrefetch = usePrefetch(href, prefetchLoaders ?? EMPTY_LOADER_REFS);
  const prefetchEnabled = prefetch === 'hover' || prefetch === 'visible';
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  // Fires at most once per href: a warm loader cache already makes repeat
  // `runPrefetch()` calls a no-op, but this also skips the redundant call.
  // Preact can reuse a component instance across a re-render with a different
  // href (a reorderable list, a "recently viewed" rail at a stable position),
  // so the guard is reset below whenever href changes, rather than only once
  // per mount.
  const fired = useRef(false);

  useEffect(() => {
    fired.current = false;
    // A hover debounce started for the PREVIOUS href is stale: the pointer
    // never left (no `pointerLeave` fires when the list reorders under a
    // stationary cursor), so without this the pending timer would fire the
    // captured callback and burn the freshly reset guard on the old target,
    // leaving the new href permanently unprefetchable.
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, [href]);

  const firePrefetch = useCallback(() => {
    if (!prefetchEnabled || fired.current) return;
    fired.current = true;
    runPrefetch();
  }, [prefetchEnabled, runPrefetch]);

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

  const handlePointerEnter = (e: TargetedPointerEvent<HTMLAnchorElement>) => {
    if (prefetch === 'hover') {
      // Defensive: real `pointerenter` cannot repeat without an intervening
      // `pointerleave` (it does not bubble and does not re-fire across
      // descendants -- that is `pointerover`), but a synthetic or
      // programmatically dispatched re-entry would otherwise orphan the first
      // timer where `handlePointerLeave` can no longer cancel it.
      if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(firePrefetch, HOVER_INTENT_MS);
    }
    onPointerEnterProp?.(e);
  };

  const handlePointerLeave = (e: TargetedPointerEvent<HTMLAnchorElement>) => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    onPointerLeaveProp?.(e);
  };

  const handleFocus = (e: TargetedFocusEvent<HTMLAnchorElement>) => {
    // No debounce on focus: focus is already an explicit intent signal, and a
    // keyboard user tabbing through gets the same warming a pointer user gets.
    if (prefetch === 'hover') firePrefetch();
    onFocusProp?.(e);
  };

  useEffect(() => {
    if (prefetch !== 'visible') return;
    const el = anchorRef.current;
    // Guard for SSR and older runtimes: fail open (no prefetch) rather than
    // throw when IntersectionObserver isn't available.
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          firePrefetch();
          io.disconnect();
          return;
        }
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [prefetch, firePrefetch]);

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    },
    []
  );

  return (
    <a
      {...rest}
      ref={anchorRef}
      href={href}
      class={className}
      aria-current={ariaCurrent}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
    >
      {children}
    </a>
  );
}
