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
    expect(() =>
      // @ts-expect-error deliberately the wrong consumption form: a streaming
      // LoaderRef's `.View` is the accumulating form only. This asserts the
      // RUNTIME guard rejects it as well as the type.
      ref.View(() => null)
    ).toThrow(/initial, reduce/);
    // The accumulating form hosts it.
    expect(() =>
      ref.View(() => null, { initial: [] as number[], reduce: (acc) => acc })
    ).not.toThrow();
    // useData has no single value for a streaming loader either.
    // @ts-expect-error deliberately calling `useData` on a streaming ref (typed
    // `never`); this asserts the runtime guard throws too.
    expect(() => ref.useData()).toThrow(/useData/);
  });

  it('exposes .Boundary as a collect-mode host on a streaming loader (no longer throws)', () => {
    const ref = defineLoader<number>(gen, { live: true });
    // A streaming .Boundary WITHOUT accumulate now runs collect-mode: it is the
    // public host for `useData(initial, reduce)` consumers, so it returns the
    // host vnode rather than throwing. The end-to-end collect behaviour (folding
    // through the public .Boundary) is covered in use-data-live.test.tsx.
    // @ts-expect-error `.Boundary` is typed `never` on a streaming ref; this
    // asserts the RUNTIME behaviour, which is a collect-mode host.
    expect(() => ref.Boundary({ children: null })).not.toThrow();
  });

  // Note: single-value + accumulate is prevented at the TYPE level (a
  // single-value LoaderRef's `.View` is the single-value form only, so the
  // accumulating form is a compile error). See define-loader-live.test-d.ts.
  // There is no runtime guard for it: the streaming discriminant is now driven
  // by the fn prototype (AsyncGeneratorFunction vs async function), which is
  // reliably detected at definition time.
});
