import { describe, it, expect, afterEach } from 'vitest';
import {
  registerPresenceReactiveImpl,
  getPresenceReactiveImpl,
  type PresenceReactiveImpl,
} from '../reactive.js';

afterEach(() => registerPresenceReactiveImpl(null));

describe('presence reactive registration', () => {
  it('is null until an implementation registers', () => {
    expect(getPresenceReactiveImpl()).toBeNull();
  });

  it('returns the registered implementation and clears on null', () => {
    const impl = {
      createRoster: () => {
        throw new Error('unused');
      },
    } as unknown as PresenceReactiveImpl;
    registerPresenceReactiveImpl(impl);
    expect(getPresenceReactiveImpl()).toBe(impl);
    registerPresenceReactiveImpl(null);
    expect(getPresenceReactiveImpl()).toBeNull();
  });
});
