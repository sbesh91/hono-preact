// Type-level assertions for the public `.View()` and `.Boundary` contracts.
// Run under `pnpm test:types`.
//
// SingleValueView render arg: LoaderState<Serialize<T>> (discriminated on `status`)
// SingleValueView opts: { errorFallback? } (no `fallback`)
// AccumulatingView opts: { initial; reduce; errorFallback? } (no `fallback`)
// Boundary props: { errorFallback?; accumulate?; children } (no `fallback`)
// DefineLoaderOptions + LoaderRef: no `fallbackDelay`
import { expectTypeOf } from 'vitest';
import { h } from 'preact';
import {
  defineLoader,
  type DefineLoaderOptions,
  type LoaderRef,
} from '../define-loader.js';

// 1. SingleValueView render arg is the discriminated `LoaderState<Serialize<T>>`.
function _singleValueRenderArg() {
  const loader = defineLoader<{ n: number }>(async () => ({ n: 1 }));
  loader.View((s) => {
    expectTypeOf(s.status).toEqualTypeOf<
      'loading' | 'success' | 'revalidating' | 'error'
    >();
    // The data-carrying arms expose `Serialize<T>`, narrowed with no cast.
    if (s.status === 'success' || s.status === 'revalidating') {
      expectTypeOf(s.data).toEqualTypeOf<{ n: number }>();
    }
    if (s.status === 'error') {
      expectTypeOf(s.error).toEqualTypeOf<Error>();
      expectTypeOf(s.data).toEqualTypeOf<{ n: number }>();
    }
    return null;
  });
}

// 2. SingleValueView opts does NOT accept `fallback`.
function _singleValueNoFallback() {
  const loader = defineLoader<{ n: number }>(async () => ({ n: 1 }));
  loader.View(
    () => null,
    // @ts-expect-error `fallback` is not accepted in single-value .View() opts
    { fallback: 'loading' }
  );
}

// 3. AccumulatingView opts does NOT accept `fallback`.
async function* gen(): AsyncGenerator<number, void, unknown> {
  yield 1;
}
function _accumulatingNoFallback() {
  const live = defineLoader<number>(gen, { live: true });
  live.View(
    () => null,
    // @ts-expect-error `fallback` is not accepted in accumulating .View() opts
    { initial: 0, reduce: (acc: number) => acc + 1, fallback: 'connecting' }
  );
}

// 4. Boundary does NOT accept `fallback` (state-based model removed it).
function _boundaryNoFallback() {
  const loader = defineLoader<{ n: number }>(async () => ({ n: 1 }));
  const Boundary = loader.Boundary;
  // @ts-expect-error `fallback` is not accepted on loader.Boundary
  h(Boundary, { fallback: 'loading', children: null });
}

// 5. `fallbackDelay` is NOT present on DefineLoaderOptions.
function _noFallbackDelayOnOptions() {
  expectTypeOf<DefineLoaderOptions<number>>().not.toHaveProperty(
    'fallbackDelay'
  );
}

// 6. `fallbackDelay` is NOT present on LoaderRef.
function _noFallbackDelayOnRef() {
  expectTypeOf<LoaderRef<number>>().not.toHaveProperty('fallbackDelay');
}

// 7. defineLoader does NOT accept `fallbackDelay` at the call site.
function _noFallbackDelayAtCallSite() {
  // @ts-expect-error `fallbackDelay` is not accepted by defineLoader
  defineLoader(async () => 1, { fallbackDelay: 100 });
}

void _singleValueRenderArg;
void _singleValueNoFallback;
void _accumulatingNoFallback;
void _boundaryNoFallback;
void _noFallbackDelayOnOptions;
void _noFallbackDelayOnRef;
void _noFallbackDelayAtCallSite;
