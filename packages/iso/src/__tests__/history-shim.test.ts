// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  installHistoryShim,
  getNavDirection,
  resetHistoryShimForTesting,
} from '../internal/history-shim.js';

describe('history-shim', () => {
  beforeEach(() => {
    resetHistoryShimForTesting();
    history.replaceState(null, '', '/');
    installHistoryShim();
  });

  it('reports initial direction at install time', () => {
    expect(getNavDirection()).toBe('initial');
  });

  it('classifies pushState as push', () => {
    history.pushState(null, '', '/a');
    expect(getNavDirection()).toBe('push');
  });

  it('classifies replaceState as replace', () => {
    history.replaceState(null, '', '/a');
    expect(getNavDirection()).toBe('replace');
  });

  it('classifies popstate back as back and forward as forward', async () => {
    history.pushState(null, '', '/a');
    history.pushState(null, '', '/b');
    expect(getNavDirection()).toBe('push');

    await new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      history.back();
    });
    expect(getNavDirection()).toBe('back');

    await new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      history.forward();
    });
    expect(getNavDirection()).toBe('forward');
  });

  it('preserves the original pushState/replaceState behavior (URL updates)', () => {
    history.pushState(null, '', '/c');
    expect(location.pathname).toBe('/c');
    history.replaceState(null, '', '/d');
    expect(location.pathname).toBe('/d');
  });

  it('preserves caller-provided state object alongside the shim counter', () => {
    history.pushState({ foo: 'bar' }, '', '/e');
    expect((history.state as { foo: string }).foo).toBe('bar');
    expect((history.state as { __hpVtIdx: number }).__hpVtIdx).toBeTypeOf(
      'number'
    );
  });

  it('is idempotent: calling install twice does not double-patch', () => {
    installHistoryShim();
    history.pushState(null, '', '/again');
    // If double-patched the counter would jump by 2 on a single pushState.
    const first = (history.state as { __hpVtIdx: number }).__hpVtIdx;
    history.pushState(null, '', '/again2');
    const second = (history.state as { __hpVtIdx: number }).__hpVtIdx;
    expect(second - first).toBe(1);
  });
});
