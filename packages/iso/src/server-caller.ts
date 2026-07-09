import type { Context } from 'hono';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { LoaderRef } from './define-loader.js';
import type { ActionRef } from './action.js';
import { isOutcome, type Outcome } from './outcomes.js';
import {
  coerceLoaderLocation,
  coerceActionInput,
} from './internal/loader-schema.js';
import { dispatchServer } from './internal/middleware-runner.js';
import { runRequestScope, getRequestStore } from './cache.js';
import type {
  ServerLoaderCtx,
  ServerActionCtx,
  ServerMiddleware,
} from './define-middleware.js';

export type CallResult<T> =
  | { ok: true; value: T }
  | { ok: false; outcome: Outcome };

export type CallLoaderLocation = {
  path?: string;
  pathParams?: Record<string, string>;
  searchParams?: Record<string, string>;
};

/** Options for calling a single-value loader. */
export type CallLoaderOptions = { location?: CallLoaderLocation };

/**
 * Options for calling a streaming loader. `signal` is composed with the
 * request's own signal (`AbortSignal.any`) and threaded to the loader as
 * `ctx.signal`, so a caller (typically a test) can abort the stream it is
 * draining.
 */
export type CallStreamOptions = CallLoaderOptions & { signal?: AbortSignal };

// Overload order is load-bearing. The streaming loader overload is listed
// FIRST (mirroring defineLoader); a LoaderRef<T, false> cannot match it
// because its useData is a function, never assignable to `never`. The
// non-streaming action overload precedes the streaming one: an
// ActionRef<P, R, never> would otherwise match the generic streaming overload
// with TChunk inferred as never.
export interface ServerCaller {
  /**
   * Call a streaming loader. Middleware and schema coercion run when the
   * generator is PRODUCED; iterating the returned generator runs the loader
   * body. This mirrors the HTTP handler, where the SSE pump iterates outside
   * the middleware dispatch (and outside the request scope), so an error
   * thrown mid-stream propagates from the generator, not as an outcome.
   */
  call<T>(
    loader: LoaderRef<T, true>,
    opts?: CallStreamOptions
  ): Promise<CallResult<AsyncGenerator<T, void, unknown>>>;
  call<T>(
    loader: LoaderRef<T, false>,
    opts?: CallLoaderOptions
  ): Promise<CallResult<T>>;
  call<TPayload, TResult>(
    action: ActionRef<TPayload, TResult, never>,
    payload: TPayload
  ): Promise<CallResult<TResult>>;
  /**
   * Call a streaming action. Iterate the returned generator for its chunks;
   * the generator's return value (the final `next()`'s `value` when `done`)
   * is the action's `TResult`.
   */
  call<TPayload, TResult, TChunk>(
    action: ActionRef<TPayload, TResult, TChunk>,
    payload: TPayload
  ): Promise<CallResult<AsyncGenerator<TChunk, TResult, unknown>>>;
}

// Server-side action metadata is attached to the raw function by defineAction
// (non-enumerable `use` / `input`). The public ActionRef type does not declare
// these (they are server-only), so reading them off the imported value is the
// sanctioned structural-read boundary for a user-defined module export.
type ServerActionView = {
  (
    ctx: { c: Context; signal: AbortSignal; call: ServerCaller['call'] },
    payload: unknown
  ): unknown;
  use?: ReadonlyArray<{ __kind: string; runs?: string }>;
  input?: StandardSchemaV1;
  __module?: string;
  __action?: string;
};

function serverMiddleware(
  use: ReadonlyArray<{ __kind: string; runs?: string }> | undefined
): ReadonlyArray<ServerMiddleware> {
  const out: ServerMiddleware[] = [];
  for (const entry of use ?? []) {
    if (entry.__kind === 'middleware' && entry.runs === 'server') {
      out.push(entry as ServerMiddleware);
    }
  }
  return out;
}

function isLoaderRef(ref: unknown): ref is LoaderRef<unknown, boolean> {
  return (
    typeof ref === 'object' && ref !== null && 'fn' in ref && '__id' in ref
  );
}

export function createCaller(c: Context): ServerCaller {
  const caller: ServerCaller = {
    call: ((ref: unknown, arg?: unknown) =>
      isLoaderRef(ref)
        ? callLoader(
            c,
            caller,
            ref,
            // The erased-impl seam: the public overloads guarantee this shape.
            arg as CallStreamOptions | undefined
          )
        : callAction(
            c,
            caller,
            ref as ServerActionView,
            arg
          )) as ServerCaller['call'],
  };
  return caller;
}

// Run `inner` in the active request scope when one exists (so the loader cache
// and request-scoped state are shared with the outer request), else open a
// fresh scope bound to `c` for the standalone (test) path.
async function inScope<T>(c: Context, inner: () => Promise<T>): Promise<T> {
  return getRequestStore()
    ? inner()
    : runRequestScope(inner, { honoContext: c });
}

async function callLoader<T>(
  c: Context,
  caller: ServerCaller,
  ref: LoaderRef<T, boolean>,
  opts: CallStreamOptions | undefined
): Promise<CallResult<T>> {
  const location = opts?.location;
  // Compose the caller-supplied signal (streaming calls: lets the caller abort
  // the stream it is draining) with the request's own signal.
  const signal = opts?.signal
    ? AbortSignal.any([c.req.raw.signal, opts.signal])
    : c.req.raw.signal;
  const serverMw = serverMiddleware(ref.use);
  const ctx: ServerLoaderCtx = {
    scope: 'loader',
    c,
    signal,
    location: {
      path: location?.path ?? c.req.path,
      pathParams: location?.pathParams ?? {},
      searchParams: location?.searchParams ?? {},
    },
    module: ref.__moduleKey ?? '',
    loader: ref.__loaderName ?? '',
  };
  const dispatch = await inScope(c, () =>
    dispatchServer<T, 'loader'>({
      middleware: serverMw,
      ctx,
      inner: async () => {
        const { pathParams, searchParams } = await coerceLoaderLocation(
          { searchSchema: ref.searchSchema, paramsSchema: ref.paramsSchema },
          location?.pathParams ?? {},
          location?.searchParams ?? {}
        );
        const value = await ref.fn({
          c,
          location: {
            path: location?.path ?? c.req.path,
            pathParams,
            searchParams,
          },
          signal: ctx.signal,
          call: caller.call,
        } as Parameters<typeof ref.fn>[0]);
        if (isOutcome(value)) throw value;
        return value as T;
      },
    })
  );
  return dispatch.kind === 'ok'
    ? { ok: true, value: dispatch.value }
    : { ok: false, outcome: dispatch.outcome };
}

async function callAction<TResult>(
  c: Context,
  caller: ServerCaller,
  ref: ServerActionView,
  payload: unknown
): Promise<CallResult<TResult>> {
  const serverMw = serverMiddleware(ref.use);
  const ctx: ServerActionCtx = {
    scope: 'action',
    c,
    signal: c.req.raw.signal,
    module: ref.__module ?? '',
    action: ref.__action ?? '',
    payload,
  };
  const dispatch = await inScope(c, () =>
    dispatchServer<TResult, 'action'>({
      middleware: serverMw,
      ctx,
      inner: async () => {
        const effective = ref.input
          ? await coerceActionInput(ref.input, payload)
          : payload;
        const value = await ref(
          { c, signal: ctx.signal, call: caller.call },
          effective
        );
        if (isOutcome(value)) throw value;
        return value as TResult;
      },
    })
  );
  return dispatch.kind === 'ok'
    ? { ok: true, value: dispatch.value }
    : { ok: false, outcome: dispatch.outcome };
}
