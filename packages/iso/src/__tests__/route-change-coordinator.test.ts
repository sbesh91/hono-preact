// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { options } from 'preact';
import {
  installNavTransitionScheduler,
  __noteLoadStart,
  __noteLoadEnd,
  __subscribePhase,
  resetDefaultTypesForTesting,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';
import { resetHistoryShimForTesting } from '../internal/history-shim.js';

// The scheduler runs an async view-transition callback; `tick` lets it run after
// startViewTransition returns (the browser invokes the callback async, so the
// fake below does too).
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function installFakeVt() {
  const typeAdds: string[] = [];
  let resolveFinished!: () => void;
  const finished = new Promise<void>((r) => (resolveFinished = r));
  const startViewTransition = vi.fn((cb: () => void | Promise<void>) => {
    void Promise.resolve().then(() => cb());
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished,
      types: { add: (t: string) => typeAdds.push(t) },
      skipTransition: () => {},
    };
  });
  vi.stubGlobal('document', { startViewTransition });
  return { startViewTransition, typeAdds, resolveFinished };
}

// Simulate Preact scheduling a render flush (Preact calls options.debounceRendering).
function flushRender(process: () => void): void {
  options.debounceRendering!(process);
}
// Simulate a navigation: the router pushes state before re-rendering.
function navigateTo(url: string): void {
  history.pushState(null, '', url);
}

describe('debounceRendering view-transition scheduler', () => {
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

  it('navigation: wraps the render flush in a view transition; the render runs inside it', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    const ran: string[] = [];
    navigateTo('/b');
    flushRender(() => ran.push('render'));
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    // The render runs inside the transition (so the browser captures the old
    // route first, then this flush swaps in the new one).
    expect(ran).toEqual(['render']);
  });

  it('non-navigation render schedules normally, with no transition', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    const ran: string[] = [];
    flushRender(() => ran.push('render')); // no location change
    await tick();
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(ran).toEqual(['render']);
  });

  it('navigation: phases fire in order with the nav types', async () => {
    const { typeAdds, resolveFinished } = installFakeVt();
    installNavTransitionScheduler();
    const phases: string[] = [];
    const subs = (
      [
        'beforeTransition',
        'beforeSwap',
        'afterSwap',
        'afterTransition',
      ] as const
    ).map((p) => __subscribePhase(p, () => phases.push(p)));

    navigateTo('/b');
    flushRender(() => {});
    await tick();
    expect(phases).toEqual(['beforeTransition', 'beforeSwap', 'afterSwap']);
    resolveFinished();
    await tick();
    expect(phases).toEqual([
      'beforeTransition',
      'beforeSwap',
      'afterSwap',
      'afterTransition',
    ]);
    expect(typeAdds).toContain('nav-same-origin');
    subs.forEach((u) => u());
  });

  it('cold navigation: holds the transition until the route modules finish loading', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    const ran: string[] = [];
    navigateTo('/b');
    __noteLoadStart(); // the route suspended on a module load
    flushRender(() => ran.push('nav'));
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    // The nav render ran, but the transition is awaiting the content.
    expect(ran).toEqual(['nav']);
    // The module loads: its content flushes (same URL) and is routed into the
    // transition.
    __noteLoadEnd();
    flushRender(() => ran.push('content'));
    await tick();
    expect(ran).toEqual(['nav', 'content']);
  });

  it('a second navigation supersedes an in-flight cold one', async () => {
    const { startViewTransition } = installFakeVt();
    installNavTransitionScheduler();
    navigateTo('/b');
    __noteLoadStart();
    flushRender(() => {});
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    // A new navigation arrives before /b's content loaded; it abandons /b and
    // starts its own transition.
    navigateTo('/c');
    flushRender(() => {});
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(2);
  });

  it('a navigation resets a leaked loadingDepth so the next nav is not stuck cold', async () => {
    installFakeVt();
    installNavTransitionScheduler();
    const phases: string[] = [];
    const u = __subscribePhase('afterSwap', () => phases.push('afterSwap'));

    // Simulate a leaked load: a prior route suspended (onLoadStart) but
    // unmounted before committing, so its onLoadEnd never fired.
    __noteLoadStart();

    // A new warm navigation must reset that leaked depth and complete its
    // transition immediately — not hang on the cold loop waiting for content
    // that will never come (which would only resolve at the 500ms timeout, well
    // past this `tick`).
    navigateTo('/b');
    flushRender(() => {});
    await tick();
    expect(phases).toEqual(['afterSwap']);
    u();
  });
});
