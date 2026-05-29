import { describe, it, expect, beforeEach } from 'vitest';
import {
  __persistRegistryWrite,
  __persistRegistryRead,
  __persistRegistrySubscribe,
  __persistRegistryResetForTesting,
} from '../internal/persist-registry.js';

describe('persist-registry', () => {
  beforeEach(() => {
    __persistRegistryResetForTesting();
  });

  it('round-trips an entry', () => {
    __persistRegistryWrite('player', {
      children: 'audio',
      viewTransitionName: undefined,
    });
    expect(__persistRegistryRead().get('player')).toEqual({
      children: 'audio',
      viewTransitionName: undefined,
    });
  });

  it('notifies subscribers on write', () => {
    const calls: number[] = [];
    const unsub = __persistRegistrySubscribe(() => calls.push(1));
    __persistRegistryWrite('a', {
      children: 'x',
      viewTransitionName: undefined,
    });
    __persistRegistryWrite('a', {
      children: 'y',
      viewTransitionName: undefined,
    });
    expect(calls.length).toBe(2);
    unsub();
    __persistRegistryWrite('a', {
      children: 'z',
      viewTransitionName: undefined,
    });
    expect(calls.length).toBe(2);
  });

  it('does not clear entries on its own', () => {
    __persistRegistryWrite('a', {
      children: 'x',
      viewTransitionName: undefined,
    });
    expect(__persistRegistryRead().get('a')).toBeDefined();
  });
});
