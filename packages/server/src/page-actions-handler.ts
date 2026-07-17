import type { Context, MiddlewareHandler } from 'hono';
import {
  isOutcome,
  timeoutOutcome,
  createCaller,
  type AppConfig,
  type ServerActionCtx,
} from '@hono-preact/iso';
import {
  runRequestScope,
  setActionResultSlot,
  dispatchServer,
  serializeActionOutcome,
  type ActionResolution,
} from '@hono-preact/iso/internal';
import { composeServerChainOrFailClosed } from './compose-server-chain.js';
import { assertPageUseResolver } from './page-use-guard.js';
import {
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
  coerceActionInput,
  collectFormData,
} from '@hono-preact/iso/internal/runtime';
import { applyOutcomeHeaders } from './outcome-translation.js';
import {
  sseGeneratorResponse,
  sseReadableStreamResponse,
  isAsyncGenerator,
} from './sse.js';
import type { ActionEntry } from './page-action-resolvers.js';
import { pickAccept, acceptsEventStream } from './accept.js';
import type { VNode } from 'preact';

export interface PageActionsHandlerOptions {
  /**
   * Resolves the action map for the page at the given URL path. Returns a
   * Map of action name to ActionEntry, merging actions from the page and
   * all ancestor layouts.
   */
  resolverByPath: (path: string) => Promise<Map<string, ActionEntry>>;
  /**
   * Fallback resolver keyed by (moduleKey, actionName), for actions in the
   * `src/server` registry that are not attached to any route URL. Tried only
   * when the byPath lookup misses (or its moduleKey does not match the posted
   * one). Optional: absent means no registry, and a byPath miss is a 404.
   */
  resolverByModuleKey?: (
    moduleKey: string,
    actionName: string
  ) => Promise<ActionEntry | undefined>;
  /**
   * Per-route middleware resolver, keyed by EXACT route pattern. Used for
   * actions defined via `serverRoute(r).action(fn)` (their `ActionEntry`
   * carries `routeId`): the chain is composed from the action's OWN declared
   * pattern rather than fuzzy-matching the POST URL, closing the `/a/:x` vs
   * `/a/:y` collision window. Pass `pageUseResolver.byPattern` from
   * makePageUseResolver (the same resolver the loaders handler uses for
   * route-bound loaders).
   *
   * REQUIRED to avoid an auth-bypass: a route-bound action with no pattern
   * resolver would silently drop its route-level gates. The handler validates
   * this at construction.
   *
   * A BARE action (`defineAction`, no `routeId`) is route-independent and
   * receives NO page tier, mirroring bare loaders (see loadersHandler's
   * EMPTY_PAGE_USE). It never fuzzy-matches the POST URL: doing so would let the
   * client pick which route's guards apply by choosing where to POST (a sibling
   * route with weaker gates). Guard a bare action at the unit level
   * (`defineAction({ use })`) or bind it with `serverRoute(r).action`.
   */
  resolvePageUseByPattern: (
    pattern: string
  ) => ReadonlyArray<unknown> | Promise<ReadonlyArray<unknown>>;
  /**
   * Re-renders the page after a deny or error outcome. The handler calls
   * this inside a fresh runRequestScope after injecting the action result
   * slot so the page tree can read it via useActionResult().
   */
  renderPage: (
    c: Context,
    node: VNode,
    opts: { appConfig?: AppConfig; dev?: boolean }
  ) => Promise<Response>;
  /**
   * Resolves the VNode to render for the given URL path. Returns null when
   * no page is registered; the handler passes null through to renderPage,
   * which is expected to produce a graceful error response in that case.
   */
  resolvePageNode: (path: string) => VNode | null;
  /** App-level middleware/observer array from defineApp({ use }). */
  appConfig?: AppConfig;
  /**
   * Default timeout in milliseconds for actions that don't declare their
   * own timeoutMs. Defaults to 30000. Pass false to disable the default.
   */
  defaultTimeoutMs?: number | false;
  /**
   * When true, error responses pass the thrown error's message through to
   * the client and the handler emits console diagnostics (e.g. the deny()
   * hint when an action throws a plain Error). When false (default), a
   * thrown non-outcome error is masked as 'Action failed'; the raw error
   * still reaches `onError`. The framework's generated server entry threads
   * its own dev flag here, matching loadersHandler.
   */
  dev?: boolean;
  /**
   * Called for every unexpected error an action throws. Use it to hook into
   * your observability stack. The handler still responds with a sanitized
   * 500; this is a side channel only.
   */
  onError?: (
    err: unknown,
    ctx: { module: string; action: string; routeId?: string }
  ) => void;
}

// The page tier for a bare (route-independent) action: no route-node `use`.
// Mirrors loadersHandler's constant of the same name so bare actions and bare
// loaders share one contract (guard at the unit level, not the page).
const EMPTY_PAGE_USE = (): ReadonlyArray<unknown> => [];

// Dev-only console hint for an action that threw a plain (non-outcome)
// error. The JSON envelope masks such errors as 'Action failed' in
// production, so an intentional denial thrown as `new Error(...)` silently
// loses its message; point at deny(status, message), which reaches the
// client with its status and message in every mode.
function warnPlainErrorThrown(
  module: string,
  action: string,
  err: unknown
): void {
  const detail =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.warn(
    `hono-preact: action '${module}::${action}' threw (${detail}). ` +
      `Production responses mask this as 'Action failed'. If this is an ` +
      `intentional denial, throw deny(status, message) instead so the ` +
      `client receives the status and message in every mode.`
  );
}

// Dev-only warning for an action invoked with a real client-supplied payload
// but no input schema. Explicit payload generics read as safe yet validate
// nothing at runtime; the raw client payload reaches the handler as-is,
// whether it's an object, an array, or a primitive. Fires once per action key
// (not per request) via the handler-instance Set the caller owns. `undefined`
// and `null` carry no client data (payload-less invocations), and an empty
// object carries no client data to validate (empty form posts serialize to
// `{}`), so both are exempt; an empty array still warns like any other
// unvalidated payload.
function warnMissingInputSchema(
  warned: Set<string>,
  module: string,
  action: string,
  payload: unknown
): void {
  if (payload === undefined || payload === null) return;
  if (
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    Object.keys(payload).length === 0
  ) {
    return;
  }
  const key = `${module}::${action}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `hono-preact: action '${key}' received a payload but declares no ` +
      `input schema, so the payload reaches the handler unvalidated ` +
      `(payload type generics are compile-time only). Pass a Standard ` +
      `Schema via defineAction(fn, { input: schema }) to validate and type ` +
      `it at runtime.`
  );
}

async function parseBody(
  c: Context
): Promise<
  | { module: string; action: string; payload: unknown }
  | { error: string; status: 400 | 415 }
> {
  const ct = (c.req.header('Content-Type') ?? '').toLowerCase();
  if (ct.startsWith('application/json')) {
    let body: { module?: unknown; action?: unknown; payload?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return { error: 'Invalid JSON body', status: 400 };
    }
    const { module: m, action: a, payload: p } = body;
    if (typeof m !== 'string' || typeof a !== 'string') {
      return {
        error: 'JSON body must include string fields: module, action',
        status: 400,
      };
    }
    return { module: m, action: a, payload: p };
  }
  if (
    ct.startsWith('multipart/form-data') ||
    ct.startsWith('application/x-www-form-urlencoded')
  ) {
    let fd: FormData;
    try {
      fd = await c.req.formData();
    } catch {
      return { error: 'Invalid form data', status: 400 };
    }
    const m = fd.get(FORM_MODULE_FIELD);
    const a = fd.get(FORM_ACTION_FIELD);
    if (typeof m !== 'string' || typeof a !== 'string') {
      return {
        error: `Form data must include ${FORM_MODULE_FIELD} and ${FORM_ACTION_FIELD} fields`,
        status: 400,
      };
    }
    const payload = collectFormData(fd);
    return { module: m, action: a, payload };
  }
  return {
    error: `Unsupported Content-Type: ${ct || '(empty)'}`,
    status: 415,
  };
}

export function pageActionsHandler(
  opts: PageActionsHandlerOptions
): MiddlewareHandler {
  const {
    resolverByPath,
    resolverByModuleKey,
    resolvePageUseByPattern,
    renderPage,
    resolvePageNode,
    appConfig,
    defaultTimeoutMs = 30_000,
    dev = false,
    onError,
  } = opts;

  assertPageUseResolver(resolvePageUseByPattern, {
    handler: 'pageActionsHandler',
    option: 'resolvePageUseByPattern',
    surface: 'route-bound action POST path',
  });

  // Dedup store for warnMissingInputSchema: one warning per action key for
  // the life of this handler instance (per process in prod, per module-map
  // rebuild boundary in dev, which is close enough for a console hint).
  const warnedMissingSchema = new Set<string>();

  return async (c) => {
    const accept = pickAccept(c.req.header('Accept'));
    const parsed = await parseBody(c);
    if ('error' in parsed) {
      return accept === 'json'
        ? c.json({ __outcome: 'error', message: parsed.error }, parsed.status)
        : c.text(parsed.error, parsed.status);
    }
    const { module, action, payload } = parsed;
    const urlPath = new URL(c.req.url).pathname;
    const map = await resolverByPath(urlPath);
    const byPathHit = map.get(action);
    // A route-attached action resolves by URL; a src/server registry action is
    // not on any route URL, so fall back to the moduleKey index. Both paths
    // require the posted moduleKey to match, so a page cannot invoke another
    // module's same-named action.
    const entry =
      byPathHit && byPathHit.moduleKey === module
        ? byPathHit
        : await resolverByModuleKey?.(module, action);
    if (!entry || entry.moduleKey !== module) {
      const msg = `Action '${action}' not found on '${urlPath}'`;
      return accept === 'json'
        ? c.json({ __outcome: 'error', message: msg }, 404)
        : c.text(msg, 404);
    }
    if (dev && entry.input === undefined) {
      warnMissingInputSchema(warnedMissingSchema, module, action, payload);
    }
    const { fn, use: actionUse, timeoutMs, routeId } = entry;
    // Chain order is app (outermost) -> page (route-node `use`) -> action
    // (defineAction's `use`); composeServerChain owns the ordering, timeout
    // derivation, partitioning, and the structural-read cast (shared with the
    // loader handler).
    //
    // Route-bound actions (serverRoute(r).action, `routeId` set) resolve their
    // page tier from their OWN declared pattern, so a `/a/:x` vs `/a/:y` URL
    // collision cannot apply the wrong route's gates. A route-bound action whose
    // pattern resolver throws fails closed (500) rather than running through a
    // guard-less chain (auth-gate bypass).
    //
    // Bare actions (`defineAction`, no `routeId`) are route-independent and
    // receive NO page tier -- identical to bare loaders (loadersHandler's
    // EMPTY_PAGE_USE). Resolving the page tier by the request URL would let the
    // client select which route's guards run by choosing where to POST, so a
    // bare action colocated under a guarded route could be invoked from a weaker
    // sibling. There is no route-level guard to honor for a bare unit; the app
    // guards it at the unit level (`defineAction({ use })`) or binds it with
    // `serverRoute(r).action`. `actionUse` (below) is always composed either way.
    //
    // The resolver, its lookup key, and the fail-closed flag are derived from ONE
    // `typeof routeId` check so they cannot desync. The guard narrows `routeId`
    // to `string` for the `key`, keeping the pairing cast-free.
    const pageTier =
      typeof routeId === 'string'
        ? { resolve: resolvePageUseByPattern, key: routeId, routeBound: true }
        : { resolve: EMPTY_PAGE_USE, key: '', routeBound: false };
    const composed = await composeServerChainOrFailClosed<'action'>(
      {
        requestSignal: c.req.raw.signal,
        unitTimeoutMs: timeoutMs,
        defaultTimeoutMs,
        appConfig,
        resolvePageUse: pageTier.resolve,
        path: pageTier.key,
        unitUse: actionUse,
      },
      pageTier.routeBound
    );
    if (!composed.ok) {
      onError?.(composed.error, { module, action, routeId });
      // The raw resolver message may carry internal detail; surface it only
      // in dev, matching the loaders-handler twin. Both mask in production.
      const detail = dev
        ? `: ${composed.error instanceof Error ? composed.error.message : String(composed.error)}`
        : '';
      const message = `Route-bound action '${routeId}' could not resolve its page-use chain${detail}`;
      return accept === 'json'
        ? c.json({ __outcome: 'error', message }, 500)
        : c.text(message, 500);
    }
    const { serverMw, observers, resolvedTimeoutMs, timeoutSignal, signal } =
      composed.chain;
    const actionCtx = { c, signal, call: createCaller(c).call };
    const ctx: ServerActionCtx = {
      scope: 'action',
      c,
      signal,
      module,
      action,
      payload,
    };

    let resolution: ActionResolution;
    let streamingResult:
      | AsyncGenerator<unknown, unknown, unknown>
      | ReadableStream<unknown>
      | undefined;

    try {
      const value = await runRequestScope(async () => {
        const dispatch = await dispatchServer<unknown, 'action'>({
          middleware: serverMw,
          ctx,
          inner: async () => {
            // Schema failure: short-circuit to a 422 deny carrying the
            // normalized issues under the reserved key. The handler never
            // runs. Caught below by `isOutcome(err)`, serialized into the
            // envelope (JSON) or the deny re-render (PE) like any deny.
            const effectivePayload = entry.input
              ? await coerceActionInput(entry.input, payload)
              : payload;
            const inner = await fn(actionCtx, effectivePayload);
            // Normalize return-style outcomes to throw-style so the catch
            // path handles all outcomes uniformly.
            if (isOutcome(inner)) throw inner;
            return inner;
          },
        });
        if (dispatch.kind === 'outcome') throw dispatch.outcome;
        return dispatch.value;
      });

      if (isAsyncGenerator(value) || value instanceof ReadableStream) {
        streamingResult = value;
        // Stream whenever the client can accept SSE at all, not only when
        // event-stream WINS the negotiation: useAction's mutate sends a dual
        // header (json preferred, event-stream at q=0.9) so onChunk keeps
        // working even though json wins pickAccept. The 405 below is
        // reserved for clients that cannot accept SSE at all (a no-JS
        // progressive-enhancement form post).
        if (!acceptsEventStream(c.req.header('Accept'))) {
          const message = 'Streaming actions require Accept: text/event-stream';
          return accept === 'json'
            ? c.json({ __outcome: 'error', message }, 405)
            : c.text(message, 405);
        }
        resolution = { kind: 'success', data: undefined };
      } else {
        resolution = { kind: 'success', data: value };
      }
    } catch (err) {
      if (isOutcome(err)) {
        resolution = { kind: 'outcome', outcome: err };
      } else if (
        timeoutSignal?.aborted &&
        timeoutSignal.reason instanceof DOMException &&
        timeoutSignal.reason.name === 'TimeoutError' &&
        typeof resolvedTimeoutMs === 'number'
      ) {
        resolution = {
          kind: 'outcome',
          outcome: timeoutOutcome(resolvedTimeoutMs),
        };
      } else {
        onError?.(err, { module, action, routeId });
        // In production the client never sees the raw error text (it may
        // carry PII or internal detail); denials users want to surface
        // should be thrown as deny(status, message), not plain errors.
        if (dev) warnPlainErrorThrown(module, action, err);
        resolution = {
          kind: 'error',
          message: dev && err instanceof Error ? err.message : 'Action failed',
        };
      }
    }

    // Streaming success: hand off to SSE responders.
    if (streamingResult) {
      const sseOpts = {
        dev,
        observers,
        observerCtx: ctx,
        signal: timeoutSignal,
        timeoutMs:
          typeof resolvedTimeoutMs === 'number' ? resolvedTimeoutMs : undefined,
      };
      if (isAsyncGenerator(streamingResult)) {
        return sseGeneratorResponse(c, streamingResult, {
          ...sseOpts,
          emitResult: true,
        });
      }
      if (streamingResult instanceof ReadableStream) {
        return sseReadableStreamResponse(c, streamingResult, sseOpts);
      }
    }

    // JSON path: serialize the resolution into the uniform envelope.
    if (accept === 'json') {
      const env = serializeActionOutcome(resolution);
      applyOutcomeHeaders(c, env.headers);
      return c.json(env.body, env.status);
    }

    // HTML / PE path.

    // Redirect: issue a real HTTP redirect so the browser follows it.
    if (
      resolution.kind === 'outcome' &&
      resolution.outcome.__outcome === 'redirect'
    ) {
      const { to, status, headers } = resolution.outcome;
      applyOutcomeHeaders(c, headers);
      return c.redirect(to, status);
    }

    // Success: POST-Redirect-GET pattern. Auto 303 to the same URL so the
    // browser re-GETs the page and loaders run fresh.
    if (resolution.kind === 'success') {
      return c.redirect(urlPath, 303);
    }

    // Timeout: plain text, no re-render needed.
    if (
      resolution.kind === 'outcome' &&
      resolution.outcome.__outcome === 'timeout'
    ) {
      return c.text(
        `Action timed out after ${resolution.outcome.timeoutMs}ms`,
        504
      );
    }

    // Deny or unexpected error: re-render the page with the resolution
    // injected into the request scope so useActionResult() reads it.
    return await runRequestScope(async () => {
      setActionResultSlot({
        module,
        action,
        resolution,
        submittedPayload: payload,
      });
      const node = resolvePageNode(urlPath);
      if (!node) {
        if (
          resolution.kind === 'outcome' &&
          resolution.outcome.__outcome === 'deny'
        ) {
          return c.text(resolution.outcome.message, resolution.outcome.status);
        }
        return c.text(
          resolution.kind === 'error' ? resolution.message : 'Action failed',
          500
        );
      }
      const rendered = await renderPage(c, node, { appConfig, dev });
      if (
        resolution.kind === 'outcome' &&
        resolution.outcome.__outcome === 'deny'
      ) {
        return new Response(rendered.body, {
          status: resolution.outcome.status,
          headers: rendered.headers,
        });
      }
      return new Response(rendered.body, {
        status: 500,
        headers: rendered.headers,
      });
    });
  };
}
