import type {
  ServerMiddleware,
  ClientMiddleware,
  ServerCtx,
  ClientPageCtx,
  Next,
  Scope,
} from '../define-middleware.js';
import { isOutcome, type Outcome } from '../outcomes.js';

export type DispatchResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'outcome'; outcome: Outcome };

// A dispatchable middleware is anything exposing the middleware `fn` contract:
// it receives the (scope-specific) ctx plus `next`, and either awaits/returns
// next() or short-circuits by throwing/returning an Outcome. ServerMiddleware<S>
// and ClientMiddleware both satisfy this structurally, so one engine runs both.
type Dispatchable<Ctx> = {
  fn: (ctx: Ctx, next: Next) => Promise<void | Outcome>;
};

type DispatchArgs<Ctx, T> = {
  middleware: ReadonlyArray<Dispatchable<Ctx>>;
  ctx: Ctx;
  inner: () => Promise<T>;
};

/**
 * Run an ordered middleware chain around `inner`, scope-agnostic.
 *
 * Each middleware must call `next()` exactly once (to pass control inward) or
 * short-circuit by throwing/returning an Outcome. Outer middleware runs first
 * on the way in and last on the way out (the Hono/Express/Koa convention). A
 * thrown Outcome anywhere unwinds to `{ kind: 'outcome' }`; any other throw
 * propagates. The inner value is threaded back out through the chain so
 * `next()` returns it to each middleware and the top-level result carries it.
 *
 * `dispatchServer` / `dispatchClient` are thin scope-typed facades over this;
 * keeping one engine means the chain semantics are written and tested once.
 */
export async function dispatch<Ctx, T>(
  args: DispatchArgs<Ctx, T>
): Promise<DispatchResult<T>> {
  const { middleware, ctx, inner } = args;

  const runChain = async (index: number): Promise<T> => {
    if (index >= middleware.length) return inner();
    const mw = middleware[index];
    // `downstream` doubles as the called-once guard: it is set exactly when
    // next() runs (always to an object, so it stays truthy even when the inner
    // value is falsy), and the `if (!downstream)` narrowing lets us return the
    // threaded value as `T` with no cast.
    let downstream: { value: T } | undefined;
    const next: Next = async () => {
      if (downstream) {
        throw new Error(
          `Middleware at index ${index} called next() more than once. ` +
            `Each middleware must call next() exactly once: a second call ` +
            `would re-run the downstream chain (and the inner function) ` +
            `with the original ctx, producing duplicate side effects.`
        );
      }
      downstream = { value: await runChain(index + 1) };
      return downstream.value;
    };
    const ret = await mw.fn(ctx, next);
    if (isOutcome(ret)) throw ret;
    if (!downstream) {
      throw new Error(
        `Middleware at index ${index} returned without calling next() or short-circuiting via a thrown outcome. ` +
          `Middleware must either: (a) await/return next() to pass control on, or (b) throw a redirect/deny/render outcome to short-circuit. ` +
          `Returning silently is ambiguous and would let downstream code run.`
      );
    }
    return downstream.value;
  };

  try {
    const value = await runChain(0);
    return { kind: 'ok', value };
  } catch (thrown) {
    if (isOutcome(thrown)) {
      return { kind: 'outcome', outcome: thrown };
    }
    throw thrown;
  }
}

type ServerDispatchArgs<T, S extends Scope> = {
  middleware: ReadonlyArray<ServerMiddleware<S>>;
  ctx: ServerCtx<S>;
  inner: () => Promise<T>;
};

/** Scope-typed server facade over {@link dispatch}. */
export function dispatchServer<T, S extends Scope = Scope>(
  args: ServerDispatchArgs<T, S>
): Promise<DispatchResult<T>> {
  return dispatch<ServerCtx<S>, T>(args);
}

type ClientDispatchArgs<T> = {
  middleware: ReadonlyArray<ClientMiddleware>;
  ctx: ClientPageCtx;
  inner: () => Promise<T>;
};

/** Page-scope client facade over {@link dispatch}. */
export function dispatchClient<T>(
  args: ClientDispatchArgs<T>
): Promise<DispatchResult<T>> {
  return dispatch<ClientPageCtx, T>(args);
}
