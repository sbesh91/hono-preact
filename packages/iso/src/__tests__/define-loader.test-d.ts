// Type-level assertions for the new defineLoader surface (Task 6):
// - bare ctx has NO location; route-form overload is gone
// - generator fn drives the accumulating LoaderRef<T, true> discriminant
// - serverRoute supplies typed location.pathParams
// - existing .View/.Boundary/.useData contract (from prior test) stays
//
// Run under `pnpm test:types`.
import { expectTypeOf } from 'vitest';
import { h } from 'preact';
import {
  defineLoader,
  serverRoute,
  type LoaderRef,
  type LoaderCtx,
} from '../index.js';
import type { DefineLoaderOptions } from '../define-loader.js';

// 0. The unified `LoaderCtx` surface: ONE exported ctx type, two shapes chosen
// by its generic. There is no separate exported standalone/route ctx type.
function _unifiedLoaderCtxSurface() {
  // Bare `LoaderCtx` is STANDALONE: no `location`, just the base fields.
  expectTypeOf<LoaderCtx>().not.toHaveProperty('location');
  expectTypeOf<LoaderCtx>().toHaveProperty('c');
  expectTypeOf<LoaderCtx>().toHaveProperty('signal');
  expectTypeOf<LoaderCtx>().toHaveProperty('call');

  // `LoaderCtx<Params>` is ROUTE-BOUND: it adds a typed `location`.
  expectTypeOf<LoaderCtx<{ id: string }>>().toHaveProperty('location');
  expectTypeOf<
    LoaderCtx<{ id: string }>['location']['pathParams']
  >().toEqualTypeOf<{ id: string }>();
}

// 1. Bare defineLoader infers the standalone `LoaderCtx`: ctx has NO location.
function _standaloneCtxHasNoLocation() {
  defineLoader(async (ctx) => {
    expectTypeOf(ctx).not.toHaveProperty('location');
    expectTypeOf(ctx).toHaveProperty('c');
    expectTypeOf(ctx).toHaveProperty('signal');
    return 1;
  });
}

// 2. Generator body drives the accumulating (live-capable) ref.
function _generatorBodyDrivesStreamingRef() {
  const s = defineLoader(async function* () {
    yield 1;
  });
  expectTypeOf(s.View).toBeFunction();
  // A streaming ref has no single value: useData and Boundary are never.
  expectTypeOf(s.useData).toBeNever();
  expectTypeOf(s.Boundary).toBeNever();
}

// 3. Route-form on defineLoader is GONE.
function _routeFormIsGone() {
  // @ts-expect-error defineLoader no longer takes a route string as first arg
  defineLoader('/movies/:id', async () => 1);
}

// 4. serverRoute supplies typed params via location.
function _serverRouteTypedParams() {
  serverRoute('/movies/:id').loader(async ({ location }) => {
    expectTypeOf(location.pathParams.id).toEqualTypeOf<string>();
    return 1;
  });
}

// 5. SingleValueView render arg is the discriminated `LoaderState<Serialize<T>>`.
function _singleValueRenderArg() {
  const loader = defineLoader(async () => ({ n: 1 }));
  loader.View((s) => {
    expectTypeOf(s.status).toEqualTypeOf<
      'loading' | 'success' | 'revalidating' | 'error'
    >();
    if (s.status === 'success' || s.status === 'revalidating') {
      expectTypeOf(s.data).toEqualTypeOf<{ n: number }>();
    }
    if (s.status === 'error') {
      expectTypeOf(s.error).toEqualTypeOf<Error>();
    }
    return null;
  });
}

// 6. SingleValueView opts does NOT accept `fallback`.
function _singleValueNoFallback() {
  const loader = defineLoader(async () => ({ n: 1 }));
  loader.View(
    () => null,
    // @ts-expect-error `fallback` is not accepted in single-value .View() opts
    { fallback: 'loading' }
  );
}

// 7. AccumulatingView opts does NOT accept `fallback`.
async function* gen(): AsyncGenerator<number, void, unknown> {
  yield 1;
}
function _accumulatingNoFallback() {
  const live = defineLoader(gen, { live: true });
  live.View(
    () => null,
    // @ts-expect-error `fallback` is not accepted in accumulating .View() opts
    { initial: 0, reduce: (acc: number) => acc + 1, fallback: 'connecting' }
  );
}

// 8. Boundary does NOT accept `fallback` (state-based model removed it).
function _boundaryNoFallback() {
  const loader = defineLoader(async () => ({ n: 1 }));
  const Boundary = loader.Boundary;
  // @ts-expect-error `fallback` is not accepted on loader.Boundary
  h(Boundary, { fallback: 'loading', children: null });
}

// 9. `fallbackDelay` is NOT present on DefineLoaderOptions.
function _noFallbackDelayOnOptions() {
  expectTypeOf<
    'fallbackDelay' extends keyof DefineLoaderOptions<number> ? true : false
  >().toEqualTypeOf<false>();
}

// 10. `fallbackDelay` is NOT present on LoaderRef.
function _noFallbackDelayOnRef() {
  expectTypeOf<
    'fallbackDelay' extends keyof LoaderRef<number> ? true : false
  >().toEqualTypeOf<false>();
}

// 11. defineLoader does NOT accept `fallbackDelay` at the call site.
function _noFallbackDelayAtCallSite() {
  // @ts-expect-error `fallbackDelay` is not accepted by defineLoader
  defineLoader(async () => 1, { fallbackDelay: 100 });
}

void _unifiedLoaderCtxSurface;
void _standaloneCtxHasNoLocation;
void _generatorBodyDrivesStreamingRef;
void _routeFormIsGone;
void _serverRouteTypedParams;
void _singleValueRenderArg;
void _singleValueNoFallback;
void _accumulatingNoFallback;
void _boundaryNoFallback;
void _noFallbackDelayOnOptions;
void _noFallbackDelayOnRef;
void _noFallbackDelayAtCallSite;
