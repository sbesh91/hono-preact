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

  it('requires the accumulating View form for a live loader', () => {
    const ref = defineLoader<number>(gen, { live: true });
    // The single-value View form throws; a live loader has no single value.
    expect(() => ref.View(() => null)).toThrow(/initial, reduce/);
    // The accumulating form hosts it.
    expect(() =>
      ref.View(() => null, { initial: [] as number[], reduce: (acc) => acc })
    ).not.toThrow();
    // useData has no single value for a live loader either.
    expect(() => ref.useData()).toThrow(/useData/);
  });

  it('throws when a live loader is consumed via the Boundary escape hatch', () => {
    const ref = defineLoader<number>(gen, { live: true });
    // A bare .Boundary (no accumulate) on a live loader would suspend forever;
    // it throws instead, consistent with the View/useData guards. (View's own
    // delegation passes `accumulate`, so it is unaffected.)
    expect(() => ref.Boundary({ children: null })).toThrow(/View/);
  });

  it('throws when the accumulating View form is used on a non-live loader', () => {
    const ref = defineLoader<number>(gen);
    // The accumulating form is hydration-safe only for live loaders.
    expect(() =>
      ref.View(() => null, { initial: [] as number[], reduce: (acc) => acc })
    ).toThrow(/requires a `live` loader/);
  });
});
