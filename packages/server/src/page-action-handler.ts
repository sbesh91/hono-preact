import type { Context, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  isOutcome,
  timeoutOutcome,
  type AppConfig,
  type ServerMiddleware,
  type ServerActionCtx,
  type Middleware,
  type StreamObserver,
} from '@hono-preact/iso';
import {
  runRequestScope,
  setActionResultSlot,
  dispatchServer,
  partitionUse,
  serializeActionOutcome,
  type ActionResolution,
} from '@hono-preact/iso/internal';
import {
  sseGeneratorResponse,
  sseReadableStreamResponse,
  isAsyncGenerator,
} from './sse.js';
import type { ActionEntry } from './page-action-resolvers.js';
import type { VNode } from 'preact';

export interface PageActionHandlerOptions {
  /**
   * Resolves the action map for the page at the given URL path. Returns a
   * Map of action name to ActionEntry, merging actions from the page and
   * all ancestor layouts.
   */
  resolverByPath: (path: string) => Promise<Map<string, ActionEntry>>;
  /**
   * Optional per-page middleware resolver, keyed by URL path. The handler
   * composes the chain as [appConfig.use, resolvePageUseByPath(path), action.use].
   * Pass `pageUseResolvers.byPath` from makePageUseResolvers (same resolver
   * loadersHandler uses). Defaults to returning empty so the option is
   * additive: handlers wired without it lose page-level middleware (matches
   * the previous behavior of this handler, which dropped them entirely).
   */
  resolvePageUseByPath?: (
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

type Accept = 'html' | 'json' | 'event-stream';

/**
 * Parse the Accept header and return the highest-priority recognized type.
 * Follows RFC 9110 quality values (;q=0.9 etc) so that
 * "application/json, text/event-stream;q=0.9" correctly resolves to 'json',
 * not 'event-stream'. Unspecified quality defaults to 1.0.
 *
 * Internal: exported for unit testing only; not part of the public API.
 */
export function pickAccept(header: string | undefined): Accept {
  const h = header ?? '';
  type Candidate = { type: Accept; q: number };
  const candidates: Candidate[] = [];

  for (const part of h.split(',')) {
    const [mediaType, ...params] = part.trim().split(';');
    const mt = (mediaType ?? '').trim().toLowerCase();
    let q = 1.0;
    for (const p of params) {
      const kv = p.trim().split('=');
      if (kv[0]?.trim() === 'q' && kv[1] !== undefined) {
        const parsed = Number(kv[1].trim());
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }
    if (mt === 'text/event-stream') candidates.push({ type: 'event-stream', q });
    else if (mt === 'application/json') candidates.push({ type: 'json', q });
    else if (mt === 'text/html' || mt === '*/*') candidates.push({ type: 'html', q });
  }

  if (candidates.length === 0) return 'html';
  candidates.sort((a, b) => b.q - a.q);
  return candidates[0]!.type;
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
    const m = fd.get('__module');
    const a = fd.get('__action');
    if (typeof m !== 'string' || typeof a !== 'string') {
      return {
        error: 'Form data must include __module and __action fields',
        status: 400,
      };
    }
    const payload: Record<string, FormDataEntryValue | FormDataEntryValue[]> =
      {};
    for (const [key, value] of fd.entries()) {
      if (key === '__module' || key === '__action') continue;
      const existing = payload[key];
      if (existing !== undefined) {
        payload[key] = Array.isArray(existing)
          ? [...existing, value]
          : [existing, value];
      } else {
        payload[key] = value;
      }
    }
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
    const resolvedTimeoutMs: number | false =
      timeoutMs !== undefined ? timeoutMs : defaultTimeoutMs;
    const timeoutSignal =
      resolvedTimeoutMs === false
        ? undefined
        : AbortSignal.timeout(resolvedTimeoutMs);
    const signal = timeoutSignal
      ? AbortSignal.any([c.req.raw.signal, timeoutSignal])
      : c.req.raw.signal;
    const actionCtx = { c, signal };

    // Chain order: app-level (outermost) -> page-level (from the page's
    // `.server.ts` and ancestor layouts' pageUse arrays) -> action-level (from
    // defineAction's `use` option). Outer middleware runs first on the way in,
    // last on the way out, matching the convention every middleware system
    // users have seen (Hono, Express, Koa).
    const rootUse = appConfig?.use ?? [];
    const pageUse = (await resolvePageUseByPath?.(urlPath)) ?? [];
    const fullUse: ReadonlyArray<Middleware | StreamObserver<unknown, never>> =
      [...rootUse, ...pageUse, ...actionUse] as ReadonlyArray<
        Middleware | StreamObserver<unknown, never>
      >;
    const { middleware: allMiddleware, observers } = partitionUse(fullUse);
    const serverMw = allMiddleware.filter(
      (m): m is ServerMiddleware<'action'> => m.runs === 'server'
    );
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
      | AsyncGenerator<unknown>
      | ReadableStream<unknown>
      | undefined;

    try {
      const value = await runRequestScope(async () => {
        const dispatch = await dispatchServer<unknown, 'action'>({
          middleware: serverMw,
          ctx,
          inner: async () => {
            const inner = await fn(actionCtx, payload);
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
        streamingResult = value as
          | AsyncGenerator<unknown>
          | ReadableStream<unknown>;
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
      if (env.headers) {
        for (const [k, v] of Object.entries(env.headers)) c.header(k, v);
      }
      // env.status is one of: 200, 422, 403, 401, 504, 500.
      return c.json(env.body, env.status as ContentfulStatusCode);
    }

    // HTML / PE path.

    // Redirect: issue a real HTTP redirect so the browser follows it.
    if (
      resolution.kind === 'outcome' &&
      resolution.outcome.__outcome === 'redirect'
    ) {
      const { to, status, headers } = resolution.outcome;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) c.header(k, v);
      }
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
          return c.text(
            resolution.outcome.message,
            resolution.outcome.status
          );
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
