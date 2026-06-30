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

  it('defaults timeoutMs to false for streaming loaders (live or not)', () => {
    // `gen` is a generator fn, driving LoaderRef<T, true>. A stream legitimately
    // runs longer than the single-shot 30s default, so the timeout default is
    // keyed on streaming (isStreaming), not the `live` SSR flag: a finite,
    // non-live streaming loader is exempt from the cap too.
    const ref = defineLoader<number>(gen);
    expect(ref.timeoutMs).toBe(false);
  });

  it('requires the accumulating View form for a streaming (generator) loader', () => {
    // The runtime guard is keyed on the fn being an AsyncGeneratorFunction, not on
    // the `live` SSR flag. So both defineLoader(gen) and defineLoader(gen, { live: true })
    // enforce the accumulating form.
    const ref = defineLoader<number>(gen, { live: true });
    // The single-value View form throws; a streaming loader has no single value.
    expect(() => ref.View(() => null)).toThrow(/initial, reduce/);
    // The accumulating form hosts it.
    expect(() =>
      ref.View(() => null, { initial: [] as number[], reduce: (acc) => acc })
    ).not.toThrow();
    // useData has no single value for a streaming loader either.
    expect(() => ref.useData()).toThrow(/useData/);
  });

  it('throws when a streaming loader is consumed via the Boundary escape hatch', () => {
    const ref = defineLoader<number>(gen, { live: true });
    // A bare .Boundary (no accumulate) on a streaming loader would suspend forever;
    // it throws instead (runtime defense-in-depth; the type makes `.Boundary`
    // `never` on a streaming ref). View's own delegation passes `accumulate`, so
    // it is unaffected.
    expect(() => ref.Boundary({ children: null })).toThrow(/View/);
  });

  // Note: single-value + accumulate is prevented at the TYPE level (a
  // single-value LoaderRef's `.View` is the single-value form only, so the
  // accumulating form is a compile error). See define-loader-live.test-d.ts.
  // There is no runtime guard for it: the streaming discriminant is now driven
  // by the fn prototype (AsyncGeneratorFunction vs async function), which is
  // reliably detected at definition time.
});
