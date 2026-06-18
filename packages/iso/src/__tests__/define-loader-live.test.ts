// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';

async function* gen() {
  yield 1;
}

describe('defineLoader({ live })', () => {
  it('defaults timeoutMs to false for live loaders', () => {
    const ref = defineLoader<number>(gen, { live: true });
    expect(ref.timeoutMs).toBe(false);
  });

  it('keeps an explicit timeoutMs over the live default', () => {
    const ref = defineLoader<number>(gen, { live: true, timeoutMs: 5000 });
    expect(ref.timeoutMs).toBe(5000);
  });

  it('leaves timeoutMs undefined for non-live loaders', () => {
    const ref = defineLoader<number>(gen);
    expect(ref.timeoutMs).toBeUndefined();
  });

  it('throws from View/Boundary/useData on a live loader', () => {
    const ref = defineLoader<number>(gen, { live: true });
    expect(() => ref.View(() => null)).toThrow(/useStream/);
    expect(() => ref.Boundary({ children: null })).toThrow(/useStream/);
    expect(() => ref.useData()).toThrow(/useStream/);
  });
});
