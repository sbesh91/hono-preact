import { describe, it, expect } from 'vitest';
import { createStoreSignal } from '../store-signal.js';

describe('createStoreSignal', () => {
  it('exposes a readonly signal that reflects set()', () => {
    const store = createStoreSignal<number | null>(null);
    expect(store.signal.value).toBe(null);
    store.set(5);
    expect(store.signal.value).toBe(5);
  });
});
