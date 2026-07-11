import { useEffect, useRef } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useViewTransitionLifecycle } from 'hono-preact';

// Scroll to the URL hash target after a soft (preact-iso) navigation, which does
// not scroll on its own.
//
// The subtlety is the framework's View Transitions: every in-app navigation
// renders inside `startViewTransition`, and while that transition is animating,
// setting the scroll position is a no-op (the same way it is in a backgrounded
// tab). So WHEN we scroll matters more than how:
//
//   - `afterSwap` fires once the new route's content has committed to the DOM
//     (including a cold, code-split page, whose chunk the transition awaits) but
//     BEFORE the transition captures its final snapshot. An instant scroll here
//     lands and is captured, so the page animates in already at the heading.
//   - `afterTransition` is the safety net: if the heading was not in the DOM yet
//     at afterSwap (an unusually slow cold flush), the transition has finished by
//     now, so a scroll is no longer a no-op.
//
// A MutationObserver (the previous approach) cannot hit either window reliably:
// it fires on its own microtask timing, which in practice lands mid-transition,
// where scrollIntoView no-ops; it then disconnects, and the scroll is silently
// lost. That was the cross-page flake.
//
// A same-path hash link (`/docs/loaders#retries` clicked while already on
// `/docs/loaders`) is a fourth case neither trigger above reaches: preact-iso's
// click handler intercepts it, preventDefaults, and pushes the new URL, but its
// pathname and search are unchanged, so the view-transition scheduler never
// classifies the flush as a navigation. No transition runs and neither
// `afterSwap` nor `afterTransition` fires. There is also no transition to race,
// so nothing blocks scrolling as soon as the flush commits. We key an effect on
// `useLocation().url`, which preact-iso updates (hash included) for an
// intercepted click: when a `url` change lands on the same path as the previous
// one, it can only be that fourth case, so we scroll directly. A path change
// still defers to the `afterSwap`/`afterTransition` triggers above, since that
// flush IS wrapped in a transition.
//
// On the very first page load (a deep link to /docs/page#heading) no navigation
// and no transition fire, so we also scroll once on mount, and on `hashchange`
// (address-bar #anchor edits never reach the router). `scroll-margin-top` on the
// headings keeps them clear of the sticky top bar.
export function useHashScroll(): void {
  const { url } = useLocation();
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    scrollToHash(window.location.hash);
    const onHashChange = () => scrollToHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const path = url.split('#')[0] ?? url;
    const prevPath = prevPathRef.current;
    prevPathRef.current = path;
    if (prevPath !== null && prevPath === path)
      scrollToHash(window.location.hash);
  }, [url]);

  useViewTransitionLifecycle({
    onAfterSwap: () => scrollToHash(window.location.hash),
    onAfterTransition: () => scrollToHash(window.location.hash),
  });
}

function scrollToHash(rawHash: string): void {
  const hash = rawHash.replace(/^#/, '');
  if (!hash) return;
  let id: string;
  try {
    id = decodeURIComponent(hash);
  } catch {
    return; // malformed %-escape in the hash
  }
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ block: 'start' });
}
