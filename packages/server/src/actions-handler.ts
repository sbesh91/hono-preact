import type { Context, MiddlewareHandler } from 'hono';
import {
  isOutcome,
  type AppConfig,
  type Outcome,
  type ServerMiddleware,
  type ServerActionCtx,
  type Middleware,
} from '@hono-preact/iso';
import {
  runRequestScope,
  dispatchServer,
  partitionUse,
} from '@hono-preact/iso/internal';
import {
  sseGeneratorResponse,
  sseReadableStreamResponse,
  isAsyncGenerator,
} from './sse.js';

type GlobModule = {
  __moduleKey?: unknown;
  serverActions?: Record<string, unknown>;
  [key: string]: unknown;
};
type LazyGlob = Record<string, () => Promise<unknown>>;
type EagerGlob = Record<string, GlobModule>;

type ModuleEntry = {
  actions: Record<string, unknown>;
};

async function buildActionsMap(
  glob: LazyGlob | EagerGlob
): Promise<Record<string, ModuleEntry>> {
  const result: Record<string, ModuleEntry> = {};
  for (const [, moduleOrLoader] of Object.entries(glob)) {
    const mod =
      typeof moduleOrLoader === 'function'
        ? await (moduleOrLoader as () => Promise<GlobModule>)()
        : (moduleOrLoader as GlobModule);
    const key = mod.__moduleKey;
    if (typeof key === 'string' && mod.serverActions) {
      result[key] = {
        actions: mod.serverActions as Record<string, unknown>,
      };
    }
  }
  return result;
}

function translateOutcomeForAction(c: Context, outcome: Outcome): Response {
  if (outcome.__outcome === 'redirect') {
    if (outcome.headers) {
      for (const [k, v] of Object.entries(outcome.headers)) c.header(k, v);
    }
    return c.json(
      {
        __outcome: 'redirect',
        to: outcome.to,
        status: outcome.status,
        headers: outcome.headers,
      },
      200
    );
  }
  if (outcome.__outcome === 'deny') {
    if (outcome.headers) {
      for (const [k, v] of Object.entries(outcome.headers)) c.header(k, v);
    }
    return c.json(
      { __outcome: 'deny', message: outcome.message },
      outcome.status
    );
  }
  // render outcome should never reach the action RPC.
  return c.json(
    {
      __outcome: 'error',
      message: 'render outcome is page-scope only',
    },
    500
  );
}

export interface ActionsHandlerOptions {
  /**
   * When true, rebuild the actions map on every request (so edits to
   * `.server.ts` files take effect without a server restart). When false
   * (default), the map is built once on first request and cached for the
   * life of the process. The framework's generated server entry passes
   * `{ dev: import.meta.env.DEV }`; custom wirings should set this
   * explicitly rather than relying on a Vite-only build-time constant.
   */
  dev?: boolean;
  /**
   * Called for every error an action throws (other than `ActionGuardError`,
   * which is treated as a structured response). Use it to hook into your
   * observability stack (Sentry, console, etc.). The handler still
   * responds with a sanitized 500; the hook is purely a side channel.
   */
  onError?: (err: unknown, ctx: { module: string; action: string }) => void;
  /**
   * Root layer of the middleware chain. The framework's generated server
   * entry threads the user's `defineApp({ use })` result here. Each action
   * request composes the chain as
   * `[...appConfig.use, ...resolvePageUse(module), ...action.use]`.
   */
  appConfig?: AppConfig;
  /**
   * Per-page layer lookup keyed by the action's owning module key (since an
   * action always belongs unambiguously to one page module). Returns the
   * `use` array declared on the matching page's `.server.*` module (as
   * `export const pageUse = [...]`). May be sync or async; the handler
   * awaits the result either way. Default returns an empty array.
   */
  resolvePageUse?: (
    moduleKey: string
  ) => ReadonlyArray<unknown> | Promise<ReadonlyArray<unknown>>;
}

export function actionsHandler(
  glob: LazyGlob | EagerGlob,
  opts: ActionsHandlerOptions = {}
): MiddlewareHandler {
  const { dev = false, onError, appConfig, resolvePageUse } = opts;
  let cachedMapPromise: Promise<Record<string, ModuleEntry>> | null = null;

  return async (c) => {
    const actionsMapPromise = dev
      ? buildActionsMap(glob)
      : (cachedMapPromise ??= buildActionsMap(glob).catch((err) => {
          cachedMapPromise = null;
          return Promise.reject(err);
        }));

    let actionsMap: Record<string, ModuleEntry>;
    try {
      actionsMap = await actionsMapPromise;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to load actions: ${message}` }, 503);
    }

    let module: string;
    let action: string;
    let payload: unknown;

    const contentType = c.req.header('Content-Type') ?? '';
    if (contentType.startsWith('multipart/form-data')) {
      let formData: FormData;
      try {
        formData = await c.req.formData();
      } catch {
        return c.json({ error: 'Invalid form data' }, 400);
      }

      const rawModule = formData.get('__module');
      const rawAction = formData.get('__action');
      if (typeof rawModule !== 'string' || typeof rawAction !== 'string') {
        return c.json(
          { error: 'Form data must include __module and __action fields' },
          400
        );
      }

      module = rawModule;
      action = rawAction;

      const payloadObj: Record<
        string,
        FormDataEntryValue | FormDataEntryValue[]
      > = {};
      for (const [key, value] of formData.entries()) {
        if (key === '__module' || key === '__action') continue;
        const existing = payloadObj[key];
        if (existing !== undefined) {
          payloadObj[key] = Array.isArray(existing)
            ? [...existing, value]
            : [existing, value];
        } else {
          payloadObj[key] = value;
        }
      }
      payload = payloadObj;
    } else {
      let body: { module: unknown; action: unknown; payload: unknown };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }
      const { module: m, action: a, payload: p } = body;
      if (typeof m !== 'string' || typeof a !== 'string') {
        return c.json(
          { error: 'Request body must include string fields: module, action' },
          400
        );
      }
      module = m;
      action = a;
      payload = p;
    }

    const entry = actionsMap[module];
    if (!entry) {
      return c.json({ error: `Module '${module}' not found` }, 404);
    }

    const fn = entry.actions[action];
    if (typeof fn !== 'function') {
      return c.json(
        { error: `Action '${action}' not found in module '${module}'` },
        404
      );
    }

    const signal = c.req.raw.signal;
    const actionCtx = { c, signal };

    // Chain ordering is outer -> inner: app-level middleware wraps every
    // request, page-level wraps actions owned by that page, and per-action
    // middleware (attached via defineAction(fn, { use })) wraps just this
    // call. Outer middleware runs first on the way in and last on the way
    // out, matching every middleware system users have seen (Hono, Express,
    // Koa). The action's owning page is unambiguous from `module`, so the
    // page-layer lookup keys by module rather than by location path.
    const rootUse = appConfig?.use ?? [];
    const pageUse = (await resolvePageUse?.(module)) ?? [];
    const actionUse = (fn as { use?: ReadonlyArray<unknown> }).use ?? [];
    const fullUse = [
      ...rootUse,
      ...pageUse,
      ...actionUse,
    ] as ReadonlyArray<Middleware>;
    const allMiddleware = partitionUse(fullUse).middleware;
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

    let result: unknown;
    try {
      result = await runRequestScope(async () => {
        const dispatch = await dispatchServer<unknown, 'action'>({
          middleware: serverMw,
          ctx,
          inner: async () =>
            (fn as (ctx: unknown, payload: unknown) => Promise<unknown>)(
              actionCtx,
              payload
            ),
        });
        if (dispatch.kind === 'outcome') {
          throw dispatch.outcome;
        }
        return dispatch.value;
      });
    } catch (err) {
      if (isOutcome(err)) {
        return translateOutcomeForAction(c, err);
      }
      onError?.(err, { module, action });
      const message =
        dev && err instanceof Error ? err.message : 'Action failed';
      return c.json({ error: message }, 500);
    }

    if (isAsyncGenerator(result)) {
      return sseGeneratorResponse(c, result, { emitResult: true });
    }
    if (result instanceof ReadableStream) {
      return sseReadableStreamResponse(c, result as ReadableStream<unknown>);
    }
    return c.json(result);
  };
}
