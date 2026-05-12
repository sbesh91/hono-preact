// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  installStreamRegistry,
  subscribeToLoaderStream,
  __resetStreamRegistryForTests,
} from '../stream-registry.js';

beforeEach(() => {
  __resetStreamRegistryForTests();
  delete (window as { __HP_STREAM__?: unknown }).__HP_STREAM__;
});

describe('stream-registry', () => {
  it('subscribe-first, then install: pre-hydration events drain via the queue', () => {
    let observed: unknown[] = [];
    subscribeToLoaderStream('L1', {
      push: (v) => observed.push(v),
      end: () => {},
      error: () => {},
    });

    (window as { __HP_STREAM__?: unknown }).__HP_STREAM__ = {
      queue: [
        { type: 'push', loaderId: 'L1', value: { count: 5 } },
        { type: 'push', loaderId: 'L1', value: { count: 6 } },
      ],
    } as unknown as Window['__HP_STREAM__'];

    installStreamRegistry();

    expect(observed).toEqual([{ count: 5 }, { count: 6 }]);
  });

  it('install-first, then subscribe (real-world order): pre-hydration events still drain', () => {
    (window as { __HP_STREAM__?: unknown }).__HP_STREAM__ = {
      queue: [
        { type: 'push', loaderId: 'L1', value: { count: 5 } },
        { type: 'push', loaderId: 'L1', value: { count: 6 } },
      ],
    } as unknown as Window['__HP_STREAM__'];

    installStreamRegistry();

    let observed: unknown[] = [];
    subscribeToLoaderStream('L1', {
      push: (v) => observed.push(v),
      end: () => {},
      error: () => {},
    });

    expect(observed).toEqual([{ count: 5 }, { count: 6 }]);
  });

  it('events arriving post-install but pre-subscribe are buffered and drained on subscribe', () => {
    installStreamRegistry();

    window.__HP_STREAM__!.push('LATE', { tick: 1 });
    window.__HP_STREAM__!.push('LATE', { tick: 2 });

    let observed: unknown[] = [];
    subscribeToLoaderStream('LATE', {
      push: (v) => observed.push(v),
      end: () => {},
      error: () => {},
    });

    expect(observed).toEqual([{ tick: 1 }, { tick: 2 }]);
  });

  it('routes live post-subscribe push() calls to subscribers', () => {
    installStreamRegistry();

    let observed: unknown[] = [];
    subscribeToLoaderStream('L2', {
      push: (v) => observed.push(v),
      end: () => {},
      error: () => {},
    });

    window.__HP_STREAM__!.push('L2', { count: 1 });
    window.__HP_STREAM__!.push('L2', { count: 2 });

    expect(observed).toEqual([{ count: 1 }, { count: 2 }]);
  });

  it('routes error() to the subscriber as an Error instance', () => {
    installStreamRegistry();

    let caught = null as Error | null;
    subscribeToLoaderStream('L3', {
      push: () => {},
      end: () => {},
      error: (err) => { caught = err; },
    });

    window.__HP_STREAM__!.error('L3', { message: 'boom', name: 'TypeError' });

    expect(caught).not.toBeNull();
    expect((caught as unknown as Error).message).toBe('boom');
    expect((caught as unknown as Error).name).toBe('TypeError');
  });

  it('does not deliver events for other loader ids to a subscriber', () => {
    installStreamRegistry();

    let aValues: unknown[] = [];
    subscribeToLoaderStream('A', {
      push: (v) => aValues.push(v),
      end: () => {},
      error: () => {},
    });

    window.__HP_STREAM__!.push('B', { x: 1 });
    window.__HP_STREAM__!.push('A', { x: 2 });

    expect(aValues).toEqual([{ x: 2 }]);
  });

  it('unsubscribe stops dispatching to that subscriber', () => {
    installStreamRegistry();

    let observed: unknown[] = [];
    const unsub = subscribeToLoaderStream('L4', {
      push: (v) => observed.push(v),
      end: () => {},
      error: () => {},
    });

    window.__HP_STREAM__!.push('L4', 1);
    unsub();
    window.__HP_STREAM__!.push('L4', 2);

    expect(observed).toEqual([1]);
  });

  it('after unsubscribe, post-unsubscribe events for that id are buffered until a new subscriber appears', () => {
    installStreamRegistry();

    const observed: unknown[] = [];
    const unsub = subscribeToLoaderStream('L5', {
      push: (v) => observed.push(v),
      end: () => {},
      error: () => {},
    });
    unsub();

    window.__HP_STREAM__!.push('L5', 1);
    // First subscriber is gone; event is buffered.

    const reobserved: unknown[] = [];
    subscribeToLoaderStream('L5', {
      push: (v) => reobserved.push(v),
      end: () => {},
      error: () => {},
    });

    expect(observed).toEqual([]);
    expect(reobserved).toEqual([1]);
  });
});
