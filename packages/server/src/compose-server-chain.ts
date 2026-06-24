import type {
  AppConfig,
  Middleware,
  ServerMiddleware,
  StreamObserver,
  Scope,
} from '@hono-preact/iso';
import { partitionUse } from '@hono-preact/iso/internal';

export interface ComposeServerChainArgs {
  /** The incoming request's abort signal (`c.req.raw.signal`). */
  requestSignal: AbortSignal;
  /** The unit's own `timeoutMs` (a loader/action), or undefined to fall back. */
  unitTimeoutMs: number | false | undefined;
  /** Handler default timeout; `false` disables the default. */
  defaultTimeoutMs: number | false;
  /** App-level `use` from defineApp(); its `use` is the outermost layer. */
  appConfig: AppConfig | undefined;
  /** Page-layer `use` resolver, keyed by the matched route's path. */
  resolvePageUse: (
    path: string
  ) => ReadonlyArray<unknown> | Promise<ReadonlyArray<unknown>>;
  /** Matched route path passed to `resolvePageUse`. */
  path: string;
  /** The unit's own `use` (a loader's or action's), the innermost layer. */
  unitUse: ReadonlyArray<unknown>;
}

export interface ComposedServerChain<S extends Scope> {
  /** Server middleware in outer->inner order, ready for `dispatchServer`. */
  serverMw: ReadonlyArray<ServerMiddleware<S>>;
  /** Stream observers partitioned out of the chain, for the SSE responders. */
  observers: ReadonlyArray<StreamObserver<unknown, never>>;
  /** Effective timeout after folding the unit value over the default. */
  resolvedTimeoutMs: number | false;
  /** The timeout's signal, or undefined when timeouts are disabled. */
  timeoutSignal: AbortSignal | undefined;
  /** Request signal combined with the timeout signal (or the request signal). */
  signal: AbortSignal;
}

/**
 * Build the server-side execution context shared by the loader and action
 * handlers: the timeout/abort signal, and the partitioned `use` chain in
 * outer->inner order (`[appConfig.use, resolvePageUse(path), unitUse]`).
 *
 * Both handlers composed this identically; centralizing it keeps the chain
 * ordering, the timeout-derivation rule, and the single `ReadonlyArray<unknown>`
 * -> typed-element cast in one place. The cast sits at the structural-read
 * boundary: page-level `use` and a unit's `use` are read off user-defined
 * modules as `ReadonlyArray<unknown>`, so the concatenation infers `unknown[]`;
 * we assert the known element type here, the one point the chain re-enters
 * typed land. The `runs === 'server'` predicate narrows to the caller's scope
 * `S` (the chain only carries that scope's middleware by construction).
 *
 * NOTE: framework-private; intended consumers are loadersHandler and
 * pageActionsHandler.
 */
export async function composeServerChain<S extends Scope = Scope>(
  args: ComposeServerChainArgs
): Promise<ComposedServerChain<S>> {
  const {
    requestSignal,
    unitTimeoutMs,
    defaultTimeoutMs,
    appConfig,
    resolvePageUse,
    path,
    unitUse,
  } = args;

  const resolvedTimeoutMs: number | false =
    unitTimeoutMs !== undefined ? unitTimeoutMs : defaultTimeoutMs;
  const timeoutSignal =
    resolvedTimeoutMs === false
      ? undefined
      : AbortSignal.timeout(resolvedTimeoutMs);
  const signal = timeoutSignal
    ? AbortSignal.any([requestSignal, timeoutSignal])
    : requestSignal;

  // Chain order is outer -> inner: app-level wraps every request, page-level
  // wraps the route's units, and the unit's own `use` wraps just this call.
  const rootUse = appConfig?.use ?? [];
  const pageUse = await resolvePageUse(path);
  const fullUse: ReadonlyArray<Middleware | StreamObserver<unknown, never>> = [
    ...rootUse,
    ...pageUse,
    ...unitUse,
  ] as ReadonlyArray<Middleware | StreamObserver<unknown, never>>;
  const { middleware: allMiddleware, observers } = partitionUse(fullUse);
  const serverMw = allMiddleware.filter(
    (m): m is ServerMiddleware<S> => m.runs === 'server'
  );

  return { serverMw, observers, resolvedTimeoutMs, timeoutSignal, signal };
}
