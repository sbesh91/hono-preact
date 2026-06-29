import type { Context } from 'hono';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { LoaderRef } from './define-loader.js';
import type { ActionRef } from './action.js';
import { isOutcome, type Outcome } from './outcomes.js';
import { coerceLoaderLocation } from './internal/loader-schema.js';
import { validateWithSchema } from './validate.js';
import { deny } from './outcomes.js';
import { VALIDATION_ISSUES_KEY } from './internal/contract.js';
import { partitionUse } from './internal/use-partitioner.js';
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

export interface ServerCaller {
  call<T>(
    loader: LoaderRef<T, false>,
    opts?: { location?: CallLoaderLocation }
  ): Promise<CallResult<T>>;
  call<TPayload, TResult>(
    action: ActionRef<TPayload, TResult, never>,
    payload: TPayload
  ): Promise<CallResult<TResult>>;
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

function isLoaderRef(ref: unknown): ref is LoaderRef<unknown, false> {
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
            (arg as { location?: CallLoaderLocation })?.location
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
  ref: LoaderRef<T, false>,
  location: CallLoaderLocation | undefined
): Promise<CallResult<T>> {
  const { middleware } = partitionUse(ref.use);
  const serverMw = serverMiddleware(middleware);
  const ctx: ServerLoaderCtx = {
    scope: 'loader',
    c,
    signal: c.req.raw.signal,
    location: {
      path: location?.path ?? c.req.path,
      pathParams: location?.pathParams ?? {},
      searchParams: location?.searchParams ?? {},
    } as ServerLoaderCtx['location'],
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
        let effective = payload;
        if (ref.input) {
          const validated = await validateWithSchema(ref.input, payload);
          if (!validated.ok) {
            throw deny(422, 'Validation failed', {
              data: { [VALIDATION_ISSUES_KEY]: validated.issues },
            });
          }
          effective = validated.value;
        }
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
