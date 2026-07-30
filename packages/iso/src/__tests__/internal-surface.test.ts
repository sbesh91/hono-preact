// R12. `hono-preact/internal` has no semver guarantee, but it is the subpath
// `optimistic-ui.mdx` points users at, so its shape is worth pinning: the
// release notes describe exactly this list, and a silent addition or removal
// would make them wrong.
//
// The specific defect this closes: `<Loader>`'s `mode` prop became REQUIRED
// while `LoaderMode` was exported from neither entry point, so a consumer of
// this subpath could not construct the prop at all.
import { describe, it, expect } from 'vitest';
import * as internal from '../internal.js';

describe('the hono-preact/internal surface', () => {
  it("lets a consumer construct `<Loader>`'s required `mode`", () => {
    expect(typeof internal.Loader).toBe('function');
    expect(typeof internal.resolveLoaderMode).toBe('function');
    // The same derivation `.Boundary` / `.View` use, so a direct `<Loader>` does
    // not have to guess a literal.
    expect(internal.resolveLoaderMode(undefined, false)).toEqual({
      kind: 'single',
    });
    expect(internal.resolveLoaderMode(undefined, true)).toEqual({
      kind: 'collect',
    });
    // `AccumulateOptions` is exported too: without it a consumer can pass a
    // literal but cannot annotate one, which is the same gap one level down.
    const acc: internal.AccumulateOptions = {
      initial: 0,
      reduce: (a: unknown) => a,
    };
    expect(internal.resolveLoaderMode(acc, true).kind).toBe('fold');
  });

  it('exposes the signals that replaced the subscribe callbacks', () => {
    // Renamed, not dropped: the stores are signals now, so a callback registry
    // had nothing left to do.
    expect(internal.pendingSignal).toBeDefined();
    expect(internal.lastActionResultSignal).toBeDefined();
    expect('subscribeFormSubmit' in internal).toBe(false);
    expect('subscribeLastActionResult' in internal).toBe(false);
  });

  it('still exposes what the docs tell users to import', () => {
    expect(typeof internal.OptimisticOverlay).toBe('function');
    expect(internal.LoaderDataContext).toBeDefined();
  });
});
