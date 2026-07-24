import { describe, it, expect, afterEach } from 'vitest';
import {
  registerLoaderReactiveImpl,
  getLoaderReactiveImpl,
  type LoaderReactiveImpl,
} from '../reactive.js';

afterEach(() => registerLoaderReactiveImpl(null));

describe('loader reactive registration', () => {
  it('is null until an implementation registers', () => {
    expect(getLoaderReactiveImpl()).toBeNull();
  });

  it('returns the registered implementation and clears on null', () => {
    const impl = {
      createPhaseCell: () => {
        throw new Error('unused');
      },
      derive: () => {
        throw new Error('unused');
      },
    } as unknown as LoaderReactiveImpl;
    registerLoaderReactiveImpl(impl);
    expect(getLoaderReactiveImpl()).toBe(impl);
    registerLoaderReactiveImpl(null);
    expect(getLoaderReactiveImpl()).toBeNull();
  });
});
