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

type ServerDispatchArgs<T, S extends Scope> = {
  middleware: ReadonlyArray<ServerMiddleware<S>>;
  ctx: ServerCtx<S>;
  inner: () => Promise<T>;
};

export async function dispatchServer<T, S extends Scope = Scope>(
  args: ServerDispatchArgs<T, S>
): Promise<DispatchResult<T>> {
  let innerResult: T | undefined;

  const runChain = async (index: number): Promise<void> => {
    if (index >= args.middleware.length) {
      innerResult = await args.inner();
      return;
    }
    const mw = args.middleware[index];
    let nextCalled = false;
    const next: Next = async () => {
      nextCalled = true;
      await runChain(index + 1);
      return innerResult;
    };
    const ret = await mw.fn(args.ctx, next);
    if (isOutcome(ret)) {
      throw ret;
    }
    if (!nextCalled) {
      throw new Error(
        `Middleware at index ${index} returned without calling next() or short-circuiting via a thrown outcome. ` +
          `Middleware must either: (a) await/return next() to pass control on, or (b) throw a redirect/deny/render outcome to short-circuit. ` +
          `Returning silently is ambiguous and would let downstream code run.`
      );
    }
  };

  try {
    await runChain(0);
  } catch (thrown) {
    if (isOutcome(thrown)) {
      return { kind: 'outcome', outcome: thrown };
    }
    throw thrown;
  }

  return { kind: 'ok', value: innerResult as T };
}

type ClientDispatchArgs<T> = {
  middleware: ReadonlyArray<ClientMiddleware>;
  ctx: ClientPageCtx;
  inner: () => Promise<T>;
};

export async function dispatchClient<T>(
  args: ClientDispatchArgs<T>
): Promise<DispatchResult<T>> {
  let innerResult: T | undefined;

  const runChain = async (index: number): Promise<void> => {
    if (index >= args.middleware.length) {
      innerResult = await args.inner();
      return;
    }
    const mw = args.middleware[index];
    let nextCalled = false;
    const next: Next = async () => {
      nextCalled = true;
      await runChain(index + 1);
      return innerResult;
    };
    const ret = await mw.fn(args.ctx, next);
    if (isOutcome(ret)) throw ret;
    if (!nextCalled) {
      throw new Error(
        `Middleware at index ${index} returned without calling next() or short-circuiting via a thrown outcome.`
      );
    }
  };

  try {
    await runChain(0);
  } catch (thrown) {
    if (isOutcome(thrown)) return { kind: 'outcome', outcome: thrown };
    throw thrown;
  }

  return { kind: 'ok', value: innerResult as T };
}
