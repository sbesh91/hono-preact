// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  vi.stubGlobal('document', {
    startViewTransition(cb: () => void) {
      cb();
      return {
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        finished,
        types: { add: (t: string) => typeAdds.push(t) },
      };
    },
  });
  return { typeAdds, resolveFinished };
}

describe('default nav-* types', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes nav-initial and nav-same-origin on the first dispatch', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();
    setNavDirectionForTesting('initial');

    __dispatchRouteChange('/', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toContain('nav-initial');
    expect(typeAdds).toContain('nav-same-origin');
  });

  it('includes exactly one direction marker per dispatch', async () => {
    const { typeAdds, resolveFinished } = installFakeVtWithTypes();

    // First dispatch to consume the initial marker
    __dispatchRouteChange('/', undefined);
    resolveFinished();
    await Promise.resolve();

    // Reset for the second dispatch test
    typeAdds.length = 0;
    setNavDirectionForTesting('back');

    __dispatchRouteChange('/a', '/b');
    resolveFinished();
    await Promise.resolve();

    const markers = typeAdds.filter((t) => t.startsWith('nav-'));
    const dirMarkers = markers.filter((t) =>
      [
        'nav-push',
        'nav-replace',
        'nav-back',
        'nav-forward',
        'nav-initial',
      ].includes(t)
    );
    expect(dirMarkers).toEqual(['nav-back']);
  });
});
