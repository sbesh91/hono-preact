// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import type { ViewTransitionLifecycle } from 'hono-preact';

// Capture the lifecycle object the hook registers so tests can fire the
// afterSwap / afterTransition phases directly. The real View Transition timing
// (and the mid-transition scroll no-op this hook works around) only happens in a
// browser with a compositor, so a happy-dom test verifies the wiring: that the
// hook scrolls on mount, on hashchange, and in each post-swap phase.
const hoisted = vi.hoisted(() => ({
  lifecycle: null as ViewTransitionLifecycle | null,
  url: '/',
}));
vi.mock('hono-preact', () => ({
  useViewTransitionLifecycle: (lifecycle: ViewTransitionLifecycle) => {
    hoisted.lifecycle = lifecycle;
  },
}));
vi.mock('preact-iso', () => ({
  useLocation: () => ({ url: hoisted.url }),
}));

import { useHashScroll } from '../use-hash-scroll.js';

afterEach(() => {
  cleanup();
  hoisted.lifecycle = null;
  hoisted.url = '/';
  window.history.replaceState(null, '', '/');
});

function Harness() {
  useHashScroll();
  return null;
}

function presentTarget(id: string) {
  const el = document.createElement('h2');
  el.id = id;
  const spy = vi.fn();
  el.scrollIntoView = spy;
  document.body.appendChild(el);
  return { el, spy };
}

describe('useHashScroll', () => {
  it('scrolls to the live hash on mount (deep link / full page load)', () => {
    window.location.hash = '#options';
    const { el, spy } = presentTarget('options');
    render(<Harness />);
    expect(spy).toHaveBeenCalledWith({ block: 'start' });
    el.remove();
  });

  it('does nothing on mount when there is no hash', () => {
    const { el, spy } = presentTarget('options');
    render(<Harness />);
    expect(spy).not.toHaveBeenCalled();
    el.remove();
  });

  it('scrolls on an address-bar hashchange', () => {
    const { el, spy } = presentTarget('timeouts');
    render(<Harness />);
    expect(spy).not.toHaveBeenCalled(); // no hash yet

    window.location.hash = '#timeouts';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(spy).toHaveBeenCalledWith({ block: 'start' });
    el.remove();
  });

  // The cross-page flake this guards: a soft navigation runs inside a View
  // Transition, and a scroll issued while it animates is a no-op. afterSwap fires
  // once the (cold) content has committed but before the transition snapshots, so
  // the scroll lands. The hook reads the live hash at fire time, not a prop.
  it('scrolls in the afterSwap phase of a navigation', () => {
    render(<Harness />);
    window.location.hash = '#timeouts'; // the navigation updated the url
    const { el, spy } = presentTarget('timeouts');

    hoisted.lifecycle?.onAfterSwap?.({} as never);
    expect(spy).toHaveBeenCalledWith({ block: 'start' });
    el.remove();
  });

  // Safety net: if the cold target had not mounted yet at afterSwap (an unusually
  // slow chunk), afterSwap finds nothing, but afterTransition fires after the
  // transition finishes, where a scroll is no longer a no-op.
  it('scrolls in afterTransition when the target was absent at afterSwap', () => {
    render(<Harness />);
    window.location.hash = '#late';

    hoisted.lifecycle?.onAfterSwap?.({} as never); // target absent: nothing happens
    const { el, spy } = presentTarget('late');
    expect(spy).not.toHaveBeenCalled();

    hoisted.lifecycle?.onAfterTransition?.({} as never);
    expect(spy).toHaveBeenCalledWith({ block: 'start' });
    el.remove();
  });

  it('ignores a phase fire when the url has no hash', () => {
    const { el, spy } = presentTarget('timeouts');
    render(<Harness />);

    hoisted.lifecycle?.onAfterSwap?.({} as never);
    expect(spy).not.toHaveBeenCalled();
    el.remove();
  });

  // The gap this closes: preact-iso intercepts a click on a same-path hash link
  // (e.g. /docs/loaders#retries clicked while already on /docs/loaders),
  // preventDefaults, and pushes the URL, but the flush's path is unchanged so
  // the view-transition scheduler never classifies it as a navigation. No
  // transition runs, so neither afterSwap nor afterTransition fires; useLocation
  // ().url is the only trigger left standing.
  it('scrolls when useLocation().url changes hash on the same path', () => {
    window.history.replaceState(null, '', '/docs/loaders');
    hoisted.url = '/docs/loaders';
    const { rerender } = render(<Harness />);

    window.history.pushState(null, '', '/docs/loaders#retries');
    hoisted.url = '/docs/loaders#retries';
    const { el, spy } = presentTarget('retries');
    rerender(<Harness />);

    expect(spy).toHaveBeenCalledWith({ block: 'start' });
    el.remove();
  });

  // A cross-path url change also updates useLocation().url, but that flush IS
  // wrapped in a view transition, so scrolling here (ahead of the transition's
  // snapshot) would race it; afterSwap/afterTransition own that case instead.
  it('does not scroll from a url change that crosses paths', () => {
    window.history.replaceState(null, '', '/docs/loaders');
    hoisted.url = '/docs/loaders';
    const { rerender } = render(<Harness />);

    window.history.pushState(null, '', '/docs/actions#usage');
    hoisted.url = '/docs/actions#usage';
    const { el, spy } = presentTarget('usage');
    rerender(<Harness />);

    expect(spy).not.toHaveBeenCalled();
    el.remove();
  });
});
