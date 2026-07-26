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
 * ordering and the timeout-derivation rule in one place. Page-level `use` and
 * a unit's `use` are structural reads off user-defined modules, so they enter
 * as `ReadonlyArray<unknown>`; `partitionUse` validates every entry and its
 * predicates are what return the chain to typed land.
 *
 * The app tier is the reason `AppConfig['use']` admits only all-scope
 * middleware: this function folds that one array into the loader chain AND the
 * action chain, and the handlers dispatch it with a `ServerLoaderCtx` /
 * `ServerActionCtx`. An app-level entry typed `ServerMiddleware<'page'>` would
 * be promised a `location` that the bare-action ctx does not carry.
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
  // Each layer is partitioned on its own so a rejected entry reports which
  // `use` array it came from and its index WITHIN that array; concatenating
  // the three results is identical to partitioning the merged chain, since
  // partitioning preserves relative order within each bucket.
  const root = partitionUse(appConfig?.use ?? [], 'the app-level `use`');
  const page = partitionUse(
    await resolvePageUse(path),
    `the page \`use\` for ${path}`
  );
  const unit = partitionUse(unitUse, "the unit's own `use`");

  const allMiddleware = [
    ...root.middleware,
    ...page.middleware,
    ...unit.middleware,
  ];
  const observers = [...root.observers, ...page.observers, ...unit.observers];
  // `runs === 'server'` is the only half of this the runtime can decide; the
  // scope half is the authoring seam's guarantee. Two of the three tiers make
  // it: `AppConfig['use']` admits only all-scope middleware (this function
  // dispatches it in all three), and a unit's own `use` is typed for that
  // unit's own scope. The page tier does NOT yet: `PageUse` spells its server
  // entries `ServerMiddleware<'page'>` even though a route node's `use` also
  // wraps that route's bound loaders and actions, so a page-tier entry reading
  // page-only ctx fields is a mis-scope this narrowing cannot catch.
  //
  // The intersection keeps the runtime check instead of replacing it with a
  // cast: a classified entry, read at the scope this chain is composed for.
  const serverMw = allMiddleware.filter(
    (m): m is Middleware & ServerMiddleware<S> => m.runs === 'server'
  );

  return { serverMw, observers, resolvedTimeoutMs, timeoutSignal, signal };
}

/**
 * Compose the chain with the fail-closed discipline shared by the loader and
 * action handlers. Composition can fail two ways: a route-bound unit's page-use
 * resolver throws for the unit's OWN declared pattern, or any of the three
 * layers (`appConfig.use`, the page tier, the unit's `use`) holds an entry
 * `partitionUse` cannot classify. Either way the composed chain is missing
 * middleware, so the unit MUST NOT run: running it would run it without the
 * guard that failed to compose, which is exactly the auth-gate bypass this
 * discipline exists to prevent. Every failure therefore surfaces to the caller
 * as `{ ok: false }` for it to translate into a fail-closed response.
 *
 * This applies to route-independent (bare) units too. A bare unit gets no page
 * tier (`EMPTY_PAGE_USE`), but the app-level and unit-level layers still apply
 * to it, and a malformed entry in either is just as capable of dropping a gate.
 *
 * This single-sources the security INVARIANT (composition failed => do not run);
 * each handler still owns its own response shape and observability on the
 * `{ ok: false }` branch.
 *
 * NOTE: framework-private; consumers are loadersHandler and pageActionsHandler.
 */
export async function composeServerChainOrFailClosed<S extends Scope = Scope>(
  args: ComposeServerChainArgs
): Promise<
  { ok: true; chain: ComposedServerChain<S> } | { ok: false; error: unknown }
> {
  try {
    return { ok: true, chain: await composeServerChain<S>(args) };
  } catch (error) {
    return { ok: false, error };
  }
}
