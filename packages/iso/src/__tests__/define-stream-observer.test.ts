import { describe, it, expect } from 'vitest';
import { defineStreamObserver } from '../define-stream-observer.js';

describe('defineStreamObserver', () => {
  it('produces a record branded with kind and the provided hooks', () => {
    const o = defineStreamObserver({
      onStart: () => {},
      onChunk: () => {},
    });
    expect(o.__kind).toBe('observer');
    expect(typeof o.onStart).toBe('function');
    expect(typeof o.onChunk).toBe('function');
  });

  it('omitted hooks remain undefined', () => {
    const o = defineStreamObserver({ onChunk: () => {} });
    expect(o.onStart).toBeUndefined();
    expect(o.onEnd).toBeUndefined();
    expect(o.onError).toBeUndefined();
    expect(o.onAbort).toBeUndefined();
  });
});
