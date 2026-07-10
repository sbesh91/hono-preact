// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { options } from 'preact';
import {
  installNavTransitionScheduler,
  skipNextNavTransition,
  makeRouterLoadTracker,
  resetDefaultTypesForTesting,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';
import {
  installHistoryShim,
  resetHistoryShimForTesting,
} from '../internal/history-shim.js';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function installFakeVt() {
  const startViewTransition = vi.fn((cb: () => void | Promise<void>) => {
    void Promise.resolve().then(() => cb());
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished: Promise.resolve(),
      types: { add: () => {} },
      skipTransition: () => {},
    };
  });
  vi.stubGlobal('document', { startViewTransition });
  return { startViewTransition };
}

const flushRender = (process: () => void) =>
  options.debounceRendering!(process);
const navigateTo = (url: string) => history.pushState(null, '', url);

describe('skipNextNavTransition', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
    __resetTransitionStateForTesting();
    history.replaceState(null, '', '/');
  });
  afterEach(() => {
    __resetTransitionStateForTesting();
    vi.unstubAllGlobals();
  });

  it('suppresses the view transition for the next navigated flush but still commits the render', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    const ran: string[] = [];
    skipNextNavTransition();
    navigateTo('/b');
    flushRender(() => ran.push('render'));
    await tick();
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(ran).toEqual(['render']);
  });

  it('is one-shot: the following navigation transitions again', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    skipNextNavTransition();
    navigateTo('/b');
    flushRender(() => {});
    await tick();
    expect(startViewTransition).not.toHaveBeenCalled();
    navigateTo('/c');
    flushRender(() => {});
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });

  it('an unarmed navigation still transitions (regression guard)', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    navigateTo('/b');
    flushRender(() => {});
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });

  it('a non-navigation flush does not consume the arm; the next real navigation is still skipped', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    skipNextNavTransition();
    flushRender(() => {}); // no location change
    await tick();
    expect(startViewTransition).not.toHaveBeenCalled();
    navigateTo('/b');
    flushRender(() => {});
    await tick();
    expect(startViewTransition).not.toHaveBeenCalled();
  });
});

describe('navigation classification (pathname + search)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
    __resetTransitionStateForTesting();
    history.replaceState(null, '', '/');
  });
  afterEach(() => {
    __resetTransitionStateForTesting();
    resetHistoryShimForTesting();
    vi.unstubAllGlobals();
  });

  it('a hash-only push never starts a view transition; the render still commits', async () => {
    // Covers both the plain in-page anchor and the TOC deferred-flash case: a
    // raw hash write followed by a flush of ANY origin (a scroll-spy setState,
    // anything) must not be classified as a navigation.
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    const ran: string[] = [];
    navigateTo('/#usage');
    flushRender(() => ran.push('render'));
    await tick();
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(ran).toEqual(['render']);
  });

  it('after a hash-only push, the next real navigation still transitions', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    navigateTo('/#usage');
    flushRender(() => {});
    await tick();
    expect(startViewTransition).not.toHaveBeenCalled();
    navigateTo('/docs');
    flushRender(() => {});
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });

  it('a soft nav whose target differs only in hash commits without a transition', async () => {
    // A preact-iso navigation /x -> /x#frag changes the URL state (a flush
    // occurs) but not the route; it must commit plainly (#148 behavior).
    history.replaceState(null, '', '/x');
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    const ran: string[] = [];
    navigateTo('/x#frag');
    flushRender(() => ran.push('render'));
    await tick();
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(ran).toEqual(['render']);
  });

  it('a search-only push still transitions (regression guard for the reclassification)', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    navigateTo('/?tab=2');
    flushRender(() => {});
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });

  it('a hash push during an in-flight cold navigation does not abandon it', async () => {
    const { startViewTransition } = installFakeVt();
    // Real client wiring: the shim's patched pushState notifies onNavObserved
    // synchronously at push time, which is the abandon path under test.
    installHistoryShim();
    installNavTransitionScheduler();
    const router = makeRouterLoadTracker();
    const ran: string[] = [];
    navigateTo('/b');
    flushRender(() => {
      ran.push('nav');
      router.onLoadStart();
    });
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    // A shareable-hash write lands while the cold content is still loading.
    navigateTo('/b#usage');
    // The cold content flush must still be routed INTO the held transition.
    flushRender(() => {
      ran.push('content');
      router.onLoadEnd();
    });
    await tick();
    expect(ran).toEqual(['nav', 'content']);
    // No second transition was started: the first was not abandoned.
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });
});
