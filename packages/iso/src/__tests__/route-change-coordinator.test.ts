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

type DocWithVt = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => unknown;
};

// Like installFakeVt but augments the REAL happy-dom document instead of
// replacing it, so the scheduler's `view-transition-name` DOM scans (collectVt
// NameElements / hasFreshMorphPartner) see actual elements. Required to exercise the
// morph-partner grace path. Cleaned up in afterEach.
function installFakeVtOnDoc() {
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
  (document as DocWithVt).startViewTransition = startViewTransition;
  return { startViewTransition, typeAdds, resolveFinished };
}

// Paint an element carrying an inline `view-transition-name` (a morph endpoint).
function appendNamed(name: string): HTMLElement {
  const el = document.createElement('div');
  el.style.setProperty('view-transition-name', name);
  document.body.appendChild(el);
  return el;
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
    // Undo installFakeVtOnDoc's direct augmentation of the real document and
    // clear any morph endpoints it painted (vi.unstubAllGlobals doesn't, since
    // these aren't stubs).
    delete (document as DocWithVt).startViewTransition;
    document.body.innerHTML = '';
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

  it('morph grace: holds the swap until a partner that loads with the route data appears', async () => {
    // The outgoing route paints an element named `hero`.
    const oldHero = appendNamed('hero');
    const { startViewTransition } = installFakeVtOnDoc();
    installNavTransitionScheduler();
    const phases: string[] = [];
    const u = __subscribePhase('afterSwap', () => phases.push('afterSwap'));

    // Navigate. The destination shell renders without the `hero` partner — its
    // data is still loading behind inner Suspense, which doesn't move
    // loadingDepth — so the morph has no partner in the new snapshot yet.
    navigateTo('/b');
    flushRender(() => oldHero.remove());
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    // Held in the morph-partner grace window: no swap yet.
    expect(phases).toEqual([]);

    // The route data arrives and a new element claims the `hero` name. The
    // partner is now present, so the grace is satisfied and the swap commits.
    flushRender(() => appendNamed('hero'));
    await tick();
    expect(phases).toEqual(['afterSwap']);
    u();
  });

  it('morph grace: waits for a data-loaded partner even when an unrelated name persists across the nav', async () => {
    // A parent layout paints a name that SURVIVES the navigation (the layout
    // instance does not remount — e.g. ProjectLayout's `project-web` title when
    // navigating between two children of `projects/:projectId`). It is present
    // in the outgoing route AND still in the DOM after the swap.
    const persistent = appendNamed('layout-title');
    // The outgoing route also paints a real morph endpoint that DOES leave on
    // nav; its partner loads late with the route data.
    const oldHero = appendNamed('hero');
    const { startViewTransition } = installFakeVtOnDoc();
    installNavTransitionScheduler();
    const phases: string[] = [];
    const u = __subscribePhase('afterSwap', () => phases.push('afterSwap'));

    navigateTo('/b');
    // Shell commits: `hero` leaves, the persistent `layout-title` stays. The
    // `hero` partner is still loading behind inner Suspense.
    flushRender(() => oldHero.remove());
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    // Must still be held: the persistent name already pairs trivially, but the
    // real morph partner (`hero`) has not appeared yet, so the swap must wait.
    expect(phases).toEqual([]);

    // The route data arrives and a fresh element claims `hero`.
    flushRender(() => appendNamed('hero'));
    await tick();
    expect(phases).toEqual(['afterSwap']);
    expect(persistent.isConnected).toBe(true);
    u();
  });

  it('morph grace: commits the swap when the grace expires with no partner', async () => {
    // Fake timers so the 150ms grace cap advances instantly — a real wall-clock
    // wait here would hold a worker and starve the parallel pool (see the
    // pool-starvation note in vitest.config.ts).
    vi.useFakeTimers();
    try {
      const oldHero = appendNamed('hero');
      installFakeVtOnDoc();
      installNavTransitionScheduler();
      const phases: string[] = [];
      const u = __subscribePhase('afterSwap', () => phases.push('afterSwap'));

      navigateTo('/b');
      flushRender(() => oldHero.remove());
      // Flush the VT callback microtask so it parks on the grace timeout (the
      // fake-VT schedules the callback as a microtask, not a timer).
      await Promise.resolve();
      await Promise.resolve();
      // Held, waiting for a partner that never appears.
      expect(phases).toEqual([]);

      // Past the 150ms MORPH_PARTNER_GRACE_MS cap the transition stops waiting
      // and commits as-is rather than freezing the page.
      await vi.advanceTimersByTimeAsync(160);
      expect(phases).toEqual(['afterSwap']);
      u();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cold navigation: gives up after the cold-commit timeout if the content never loads', async () => {
    // Fake timers so the 500ms cap advances instantly (see the grace-expiry test).
    vi.useFakeTimers();
    try {
      installFakeVt();
      installNavTransitionScheduler();
      const phases: string[] = [];
      const u = __subscribePhase('afterSwap', () => phases.push('afterSwap'));

      // The route suspends during the nav render — so loadingDepth is raised
      // inside the transition, after the navigation's reset — and never resolves.
      navigateTo('/b');
      flushRender(() => __noteLoadStart());
      await Promise.resolve();
      await Promise.resolve();
      // Held cold, waiting for content that never arrives.
      expect(phases).toEqual([]);

      // Past the 500ms COLD_COMMIT_TIMEOUT_MS cap the transition stops waiting
      // and commits rather than freezing the page on a stalled load.
      await vi.advanceTimersByTimeAsync(520);
      expect(phases).toEqual(['afterSwap']);
      u();
    } finally {
      vi.useRealTimers();
    }
  });
});
