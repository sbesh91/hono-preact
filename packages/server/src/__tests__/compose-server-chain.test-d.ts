// Type-level contract for the server middleware chain. Run under `pnpm test:types`.
// Guards two boundary types that otherwise rest on runtime tests alone (#180):
// ServerCtx<S> scope narrowing and the ComposedServerChain<S> result shape.
import { expectTypeOf } from 'vitest';
import type { ComposedServerChain } from '../compose-server-chain.js';
import type {
  ServerCtx,
  ServerPageCtx,
  ServerLoaderCtx,
  ServerActionCtx,
  ServerMiddleware,
  StreamObserver,
} from '@hono-preact/iso';

// ServerCtx<S> narrows to exactly one ctx per scope.
function _ctxNarrowingProbe() {
  expectTypeOf<ServerCtx<'page'>>().toEqualTypeOf<ServerPageCtx>();
  expectTypeOf<ServerCtx<'loader'>>().toEqualTypeOf<ServerLoaderCtx>();
  expectTypeOf<ServerCtx<'action'>>().toEqualTypeOf<ServerActionCtx>();
  // The default (unparameterized) ctx is the full union, not a single arm.
  expectTypeOf<ServerCtx>().toEqualTypeOf<
    ServerPageCtx | ServerLoaderCtx | ServerActionCtx
  >();
  // A loader ctx carries module/loader; it must NOT collapse to the action arm.
  expectTypeOf<ServerCtx<'loader'>>().not.toEqualTypeOf<ServerActionCtx>();
}

// ComposedServerChain<S> threads the scope into serverMw and keeps the
// result-shape contract the loader/action handlers depend on.
function _chainShapeProbe() {
  type LoaderChain = ComposedServerChain<'loader'>;
  expectTypeOf<LoaderChain['serverMw']>().toEqualTypeOf<
    ReadonlyArray<ServerMiddleware<'loader'>>
  >();
  expectTypeOf<LoaderChain['resolvedTimeoutMs']>().toEqualTypeOf<
    number | false
  >();
  expectTypeOf<LoaderChain['timeoutSignal']>().toEqualTypeOf<
    AbortSignal | undefined
  >();
  expectTypeOf<LoaderChain['signal']>().toEqualTypeOf<AbortSignal>();
  expectTypeOf<LoaderChain['observers']>().toEqualTypeOf<
    ReadonlyArray<StreamObserver<unknown, never>>
  >();

  // A middleware fn for the loader chain receives a ServerLoaderCtx, not the
  // wider union: the scope must flow through.
  const mw = {} as ServerMiddleware<'loader'>;
  expectTypeOf(mw.fn).parameter(0).toEqualTypeOf<ServerLoaderCtx>();
}

void _ctxNarrowingProbe;
void _chainShapeProbe;
