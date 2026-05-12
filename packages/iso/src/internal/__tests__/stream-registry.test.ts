// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { installStreamRegistry, subscribeToLoaderStream } from '../stream-registry.js';

beforeEach(() => {
  delete (window as { __HP_STREAM__?: unknown }).__HP_STREAM__;
});

describe('stream-registry', () => {
  it('drains pre-hydration queued events to subscribers on install', () => {
    (window as { __HP_STREAM__?: unknown }).__HP_STREAM__ = {
      queue: [
        { type: 'push', loaderId: 'L1', value: { count: 5 } },
        { type: 'push', loaderId: 'L1', value: { count: 6 } },
      ],
    } as unknown as Window['__HP_STREAM__'];

    let observed: unknown[] = [];
    const unsub = subscribeToLoaderStream('L1', {
      push: (v) => observed.push(v),
      end: () => {},
      error: () => {},
    });

    installStreamRegistry();

    expect(observed).toEqual([{ count: 5 }, { count: 6 }]);
    unsub();
  });

  it('routes post-hydration push() calls to subscribers', () => {
    installStreamRegistry();

    let observed: unknown[] = [];
    const unsub = subscribeToLoaderStream('L2', {
      push: (v) => observed.push(v),
      end: () => {},
      error: () => {},
    });

    window.__HP_STREAM__!.push('L2', { count: 1 });
    window.__HP_STREAM__!.push('L2', { count: 2 });

    expect(observed).toEqual([{ count: 1 }, { count: 2 }]);
    unsub();
  });

  it('routes error() to the subscriber as an Error instance', () => {
    installStreamRegistry();

    let caught: Error | null = null;
    const unsub = subscribeToLoaderStream('L3', {
      push: () => {},
      end: () => {},
      error: (err) => { caught = err; },
    });

    window.__HP_STREAM__!.error('L3', { message: 'boom', name: 'TypeError' });

    expect(caught).not.toBeNull();
    expect((caught as unknown as Error).message).toBe('boom');
    expect((caught as unknown as Error).name).toBe('TypeError');
    unsub();
  });

  it('drains queued events only to the matching loaderId, leaves others queued', () => {
    (window as { __HP_STREAM__?: unknown }).__HP_STREAM__ = {
      queue: [
        { type: 'push', loaderId: 'A', value: 1 },
        { type: 'push', loaderId: 'B', value: 2 },
      ],
    } as unknown as Window['__HP_STREAM__'];

    let aValues: unknown[] = [];
    const unsubA = subscribeToLoaderStream('A', {
      push: (v) => aValues.push(v),
      end: () => {},
      error: () => {},
    });

    expect(aValues).toEqual([1]);
    expect(window.__HP_STREAM__!.queue).toEqual([
      { type: 'push', loaderId: 'B', value: 2 },
    ]);
    unsubA();
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
});
