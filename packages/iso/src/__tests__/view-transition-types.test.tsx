// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';
import {
  useViewTransitionTypes,
  subscribeViewTransitionTypes,
} from '../view-transition-types.js';
import {
  __dispatchRouteChange,
  resetDefaultTypesForTesting,
} from '../internal/route-change.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../internal/history-shim.js';

function installFakeVtWithTypes() {
  const typeAdds: string[] = [];
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  const origDoc = globalThis.document;
  (
    globalThis.document as unknown as {
      startViewTransition: (cb: () => void) => unknown;
    }
  ).startViewTransition = (cb: () => void) => {
    cb();
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished,
      types: { add: (t: string) => typeAdds.push(t) },
    };
  };
  return {
    typeAdds,
    resolveFinished,
    restore: () => {
      (
        globalThis.document as unknown as { startViewTransition?: unknown }
      ).startViewTransition = (
        origDoc as unknown as { startViewTransition?: unknown }
      ).startViewTransition;
    },
  };
}

describe('useViewTransitionTypes', () => {
  beforeEach(() => {
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds a static string', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const { unmount } = renderHook(() =>
      useViewTransitionTypes('posts-listing')
    );

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toContain('posts-listing');
    unmount();
  });

  it('adds a static array of strings', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const { unmount } = renderHook(() => useViewTransitionTypes(['a', 'b']));

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toEqual(expect.arrayContaining(['a', 'b']));
    unmount();
  });

  it('calls a factory per nav with to/from/direction', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    setNavDirectionForTesting('back');
    const { unmount } = renderHook(() =>
      useViewTransitionTypes((nav) => {
        if (nav.direction === 'back') return ['from-back'];
        return [];
      })
    );

    __dispatchRouteChange('/posts', '/posts/1');
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toContain('from-back');
    unmount();
  });

  it('factory returning null/undefined contributes nothing', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const { unmount } = renderHook(() => useViewTransitionTypes(() => null));

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    // Only the default nav-* should appear; no extra entries from the hook.
    const nonNav = typeAdds.filter((t) => !t.startsWith('nav-'));
    expect(nonNav).toEqual([]);
    unmount();
  });

  it('unsubscribes on unmount', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const { unmount } = renderHook(() => useViewTransitionTypes('one'));

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toContain('one');
    unmount();

    typeAdds.length = 0;
    __dispatchRouteChange('/posts/1', '/posts');
    await Promise.resolve();

    expect(typeAdds).not.toContain('one');
  });
});

describe('subscribeViewTransitionTypes', () => {
  beforeEach(() => {
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds a static string', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const unsub = subscribeViewTransitionTypes('posts-listing');

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toContain('posts-listing');
    unsub();
  });

  it('adds a static array of strings', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const unsub = subscribeViewTransitionTypes(['a', 'b']);

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toEqual(expect.arrayContaining(['a', 'b']));
    unsub();
  });

  it('calls a resolver per nav with to/from/direction', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const seen: Array<{ to: string; from: string | undefined }> = [];
    const unsub = subscribeViewTransitionTypes((nav) => {
      seen.push({ to: nav.to, from: nav.from });
      return nav.to === '/docs' ? ['docs'] : [];
    });

    __dispatchRouteChange('/docs', '/');
    resolveFinished();
    await Promise.resolve();

    expect(seen).toContainEqual({ to: '/docs', from: '/' });
    expect(typeAdds).toContain('docs');
    unsub();
  });

  it('resolver returning null/undefined contributes nothing', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const unsub = subscribeViewTransitionTypes(() => null);

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();

    const nonNav = typeAdds.filter((t) => !t.startsWith('nav-'));
    expect(nonNav).toEqual([]);
    unsub();
  });

  it('returned unsubscribe stops further contributions', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    const unsub = subscribeViewTransitionTypes('one');

    __dispatchRouteChange('/posts', undefined);
    resolveFinished();
    await Promise.resolve();
    expect(typeAdds).toContain('one');

    unsub();
    typeAdds.length = 0;
    __dispatchRouteChange('/posts/1', '/posts');
    await Promise.resolve();
    expect(typeAdds).not.toContain('one');
  });

  it('is a no-op under SSR (no document)', () => {
    vi.stubGlobal('document', undefined);
    expect(() => {
      const unsub = subscribeViewTransitionTypes('x');
      expect(typeof unsub).toBe('function');
      unsub();
    }).not.toThrow();
  });
});
