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
  type LoaderFn,
  type RouteParams,
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
  // A streaming ref's `Boundary` is a collect-mode host (children fold via
  // `useData(initial, reduce)`), no longer `never`. `useData` takes
  // `(initial, reduce)` (the live arm), same as `.View`'s accumulating form.
  expectTypeOf(s.useData).toBeFunction();
  expectTypeOf(s.Boundary).not.toBeNever();
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

// 12. The exported `LoaderFn` COMPOSES with the exported constructor: a loader
// typed with the framework's own type is accepted by the framework's own
// `defineLoader`, and the resulting ref keeps the single-value discriminant.
// Regression guard: `LoaderFn` used to alias the internal `Loader` union, whose
// ctx was route-bound, so this call failed overload resolution and the result
// degraded to `LoaderRef<T, true>` (making `useData` a `never` that "has no
// call signatures").
type Movie = { id: string; title: string };

function _loaderFnComposesWithDefineLoader() {
  const fn: LoaderFn<Movie> = async () => ({ id: '1', title: 'Heat' });
  const ref = defineLoader<Movie>(fn);
  expectTypeOf(ref).toEqualTypeOf<LoaderRef<Movie, false>>();
  expectTypeOf(ref.useData).toBeFunction();
  // `T` also infers from the annotation, which is the spelling the docs show.
  expectTypeOf(defineLoader(fn)).toEqualTypeOf<LoaderRef<Movie, false>>();
}

// 13. The same, with the annotation arriving UNNARROWED (a parameter, or a
// `const` imported from another module). Narrowing-by-assignment hid the union
// half of the defect in the single-module spelling above.
function _loaderFnComposesUnnarrowed(fn: LoaderFn<Movie>) {
  expectTypeOf(defineLoader<Movie>(fn)).toEqualTypeOf<
    LoaderRef<Movie, false>
  >();
}

// 14. `LoaderFn<T, Live>` in, `LoaderRef<T, Live>` out: the streaming form
// composes too and keeps the accumulating discriminant.
function _streamingLoaderFnComposes(fn: LoaderFn<Movie, true>) {
  expectTypeOf(defineLoader<Movie>(fn)).toEqualTypeOf<LoaderRef<Movie, true>>();
}

// 15. The ctx shapes follow `LoaderCtx`: standalone by default, route-bound
// when params are supplied (this is what route-node guards read).
function _loaderFnCtxShapes() {
  const standalone: LoaderFn<Movie> = async (ctx) => {
    expectTypeOf(ctx).not.toHaveProperty('location');
    return { id: '1', title: 'Heat' };
  };
  const routeBound: LoaderFn<Movie, false, { id: string }> = async (ctx) => {
    expectTypeOf(ctx.location.pathParams).toEqualTypeOf<{ id: string }>();
    return { id: ctx.location.pathParams.id, title: 'Heat' };
  };
  void standalone;
  void routeBound;
}

// 16. Both bindings compose with `serverRoute(r).loader`: the route-bound form
// (params typed from the pattern, the spelling the loaders doc shows) and the
// standalone form (its ctx requires less, so the route ctx satisfies it).
function _loaderFnComposesWithServerRoute(
  routeBound: LoaderFn<Movie, false, RouteParams<'/movies/:id'>>,
  standalone: LoaderFn<Movie>
) {
  expectTypeOf(serverRoute('/movies/:id').loader(routeBound)).toEqualTypeOf<
    LoaderRef<Movie, false>
  >();
  expectTypeOf(serverRoute('/movies/:id').loader(standalone)).toEqualTypeOf<
    LoaderRef<Movie, false>
  >();
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
void _loaderFnComposesWithDefineLoader;
void _loaderFnComposesUnnarrowed;
void _streamingLoaderFnComposes;
void _loaderFnCtxShapes;
void _loaderFnComposesWithServerRoute;
