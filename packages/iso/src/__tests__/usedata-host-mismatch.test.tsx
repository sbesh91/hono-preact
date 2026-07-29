// @vitest-environment happy-dom
//
// `useData()` routes on the LOADER's shape (`isStreaming`, fixed by the fn
// prototype) while the HOST decides what lands on context
// (`resolveLoaderMode(accumulate, isStreaming)`). The two disagree in exactly
// the `fold` cells of that 2x2, and both were failing badly:
//
//   loader          host              mode      on context      useData()
//   non-streaming   .Boundary         single    LoaderState     fine
//   non-streaming   .Boundary + acc   FOLD      StreamState     R2: silent forever-loading
//   streaming       .Boundary         collect   stream ctx      fine
//   streaming       .View / acc       FOLD      no stream ctx   R3: throws, naming .View
//
// Neither cell can be made to work by routing differently, which is worth
// stating because it is not obvious:
//
// - A fold host holds `StreamState<Acc>`. `useData()` on a non-streaming ref is
//   typed `ReadonlySignal<LoaderState<Serialize<T>>>`. `Acc` is the caller's
//   accumulator, unrelated to `Serialize<T>`, and `StreamState` is not
//   `LoaderState`. There is no honest value to return, which is why the merge
//   base threw here. `.View(render, { initial, reduce })` is how a fold host's
//   state is meant to be read.
// - A `.View` host on a streaming loader folds into ONE accumulator and retains
//   no chunk log, so a child cannot fold the stream its own way. Supporting that
//   would mean every `.View` pays collect-mode retention. `.Boundary` is the
//   host that supports it, and the error must say so.
//
// So the fix is to make both failures LOUD and correctly named, not to reroute.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../define-loader.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Swallow Preact's console error for the expected render throw. */
function silenceRenderError() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('useData() under a mismatched host', () => {
  it('R2: a non-streaming loader hosted with `accumulate` reports the mismatch instead of loading forever', () => {
    const loader = defineLoader<{ n: number }>(async () => ({ n: 1 }), {
      __moduleKey: 'r2',
    });
    function Child() {
      // Reading `.value` is what triggers it: the projection lives in a
      // `useComputed`, so the mismatch surfaces at the READ, not at the
      // `useData()` call. That is the right place -- a consumer that holds the
      // signal without reading it has not asked for a value yet.
      return <p>{String(loader.useData().value.status)}</p>;
    }
    silenceRenderError();

    // The host resolves to fold mode and puts a `StreamState` on context. The
    // old behaviour was `COLD_LOADING` on every render for the life of the page:
    // a skeleton that never resolves, with nothing in the console.
    expect(() =>
      render(
        <LocationProvider>
          <loader.Boundary accumulate={{ initial: [], reduce: (a) => a }}>
            <Child />
          </loader.Boundary>
        </LocationProvider>
      )
    ).toThrow(/accumulate/);
  });

  it('R2: the message names `.View` as the way to read an accumulating host', () => {
    const loader = defineLoader<{ n: number }>(async () => ({ n: 1 }), {
      __moduleKey: 'r2b',
    });
    function Child() {
      return <p>{String(loader.useData().value.status)}</p>;
    }
    silenceRenderError();

    let message = '';
    try {
      render(
        <LocationProvider>
          <loader.Boundary accumulate={{ initial: [], reduce: (a) => a }}>
            <Child />
          </loader.Boundary>
        </LocationProvider>
      );
    } catch (e) {
      message = (e as Error).message;
    }
    // Naming the fix is the point: the old throw said "internal invariant
    // violation", which tells a user nothing they can act on.
    expect(message).toMatch(/\.View\(/);
    expect(message).not.toMatch(/internal invariant/);
  });
});

describe('live useData(initial, reduce) under a mismatched host', () => {
  it('R3: the error names `.Boundary`, not the `.View` host the caller is already inside', async () => {
    async function* gen(): AsyncGenerator<number, void, unknown> {
      yield 1;
    }
    const loader = defineLoader<number>(gen, { __moduleKey: 'r3' });
    function Child() {
      // The live arm throws from the `useData` CALL (it needs the host context
      // to build the fold), so no read is required here.
      loader.useData(0, (acc: number, n) => acc + n);
      return null;
    }
    // `.View` always builds `accumulate`, so this host is fold mode and
    // provides no `LoaderStreamContext`.
    const View = loader.View(() => <Child />, {
      initial: [] as number[],
      reduce: (acc) => acc,
    });
    silenceRenderError();

    let message = '';
    try {
      render(
        <LocationProvider>
          <View />
        </LocationProvider>
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/Boundary/);
    // The old message named `.View` as a supported host while throwing from
    // inside one, which left the user no way to discover the actual fix.
    expect(message).not.toMatch(/`\.View` host/);
  });
});
