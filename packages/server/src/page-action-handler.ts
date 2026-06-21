import type { Context, MiddlewareHandler } from 'hono';
import {
  isOutcome,
  timeoutOutcome,
  deny,
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
import { composeServerChain } from './compose-server-chain.js';
import {
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
  VALIDATION_ISSUES_KEY,
  validateWithSchema,
  collectFormData,
} from '@hono-preact/iso/internal/runtime';
import { applyOutcomeHeaders } from './outcome-translation.js';
import {
  sseGeneratorResponse,
  sseReadableStreamResponse,
  isAsyncGenerator,
} from './sse.js';
import type { ActionEntry } from './page-action-resolvers.js';
import { pickAccept } from './accept.js';
import type { VNode } from 'preact';

export interface PageActionHandlerOptions {
  /**
   * Resolves the action map for the page at the given URL path. Returns a
   * Map of action name to ActionEntry, merging actions from the page and
   * all ancestor layouts.
   */
  resolverByPath: (path: string) => Promise<Map<string, ActionEntry>>;
  /**
   * Per-page middleware resolver, keyed by URL path. The handler composes the
   * chain as [appConfig.use, resolvePageUseByPath(path), action.use]. Pass
   * `pageUseResolver.byPath` from makePageUseResolver (the same resolver
   * loadersHandler uses).
   *
   * REQUIRED: page-level `use` is where route/layout auth gates live, so an
   * absent resolver would silently drop them on the action POST path (an
   * auth-bypass footgun). The handler validates this at construction and
   * throws rather than composing a guard-less chain.
   */
  resolvePageUseByPath: (
    path: string
  ) => ReadonlyArray<unknown> | Promise<ReadonlyArray<unknown>>;
  /**
   * Re-renders the page after a deny or error outcome. The handler calls
   * this inside a fresh runRequestScope after injecting the action result
   * slot so the page tree can read it via useActionResult().
   */
  renderPage: (
    c: Context,
    node: VNode,
    opts: { appConfig?: AppConfig }
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
   * Called for every unexpected error an action throws. Use it to hook into
   * your observability stack. The handler still responds with a sanitized
   * 500; this is a side channel only.
   */
  onError?: (err: unknown, ctx: { module: string; action: string }) => void;
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

export function pageActionHandler(
  opts: PageActionHandlerOptions
): MiddlewareHandler {
  const {
    resolverByPath,
    resolvePageUseByPath,
    renderPage,
    resolvePageNode,
    appConfig,
    defaultTimeoutMs = 30_000,
    onError,
  } = opts;

  if (typeof resolvePageUseByPath !== 'function') {
    // page-level `use` carries route/layout auth gates; a missing resolver
    // would silently drop them on the action POST path. Fail loudly at
    // construction (the type also marks this required) instead of composing a
    // guard-less chain.
    throw new Error(
      'pageActionHandler requires a resolvePageUseByPath function; without it ' +
        'page-level middleware (including auth gates) is silently dropped on ' +
        'the action POST path. Pass makePageUseResolver(routes).byPath.'
    );
  }

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
    const entry = map.get(action);
    if (!entry || entry.moduleKey !== module) {
      const msg = `Action '${action}' not found on '${urlPath}'`;
      return accept === 'json'
        ? c.json({ __outcome: 'error', message: msg }, 404)
        : c.text(msg, 404);
    }
    const { fn, use: actionUse, timeoutMs } = entry;
    // Chain order is app (outermost) -> page (route-node `use`) -> action
    // (defineAction's `use`); composeServerChain owns the ordering, timeout
    // derivation, partitioning, and the structural-read cast (shared with the
    // loader handler).
    const { serverMw, observers, resolvedTimeoutMs, timeoutSignal, signal } =
      await composeServerChain<'action'>({
        requestSignal: c.req.raw.signal,
        unitTimeoutMs: timeoutMs,
        defaultTimeoutMs,
        appConfig,
        resolvePageUse: resolvePageUseByPath,
        path: urlPath,
        unitUse: actionUse,
      });
    const actionCtx = { c, signal };
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
            let effectivePayload: unknown = payload;
            if (entry.input) {
              const validated = await validateWithSchema(entry.input, payload);
              if (!validated.ok) {
                // Schema failure: short-circuit to a 422 deny carrying the
                // normalized issues under the reserved key. The handler never
                // runs. Caught below by `isOutcome(err)`, serialized into the
                // envelope (JSON) or the deny re-render (PE) like any deny.
                throw deny(422, 'Validation failed', {
                  data: { [VALIDATION_ISSUES_KEY]: validated.issues },
                });
              }
              effectivePayload = validated.value;
            }
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
        if (accept !== 'event-stream') {
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
        onError?.(err, { module, action });
        resolution = { kind: 'error', message: 'Action failed' };
      }
    }

    // Streaming success: hand off to SSE responders.
    if (streamingResult) {
      const sseOpts = {
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
        return c.text('Action failed', 500);
      }
      const rendered = await renderPage(c, node, { appConfig });
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
