// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { options } from 'preact';
import {
  installNavTransitionScheduler,
  skipNextNavTransition,
  resetDefaultTypesForTesting,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';
import { resetHistoryShimForTesting } from '../internal/history-shim.js';

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
