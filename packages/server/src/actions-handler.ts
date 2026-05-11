import type { MiddlewareHandler } from 'hono';
import { ActionGuardError, type ActionGuardFn, type ActionGuardContext } from '@hono-preact/iso';
import { runRequestScope } from '@hono-preact/iso/internal';
import { sseFromGenerator, sseEncode, sseEncodeError } from './sse.js';

function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown, unknown, unknown> {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function' &&
    typeof (value as { next?: unknown }).next === 'function'
  );
}

function readableStreamToSse(stream: ReadableStream<unknown>): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(sseEncode({ data: JSON.stringify(value) }));
        }
      } catch (err) {
        controller.enqueue(sseEncodeError(err));
      } finally {
        controller.close();
      }
    },
    cancel() {
      reader.cancel().catch(() => { /* swallow */ });
    },
  });
}

type GlobModule = {
  __moduleKey?: unknown;
  serverActions?: Record<string, unknown>;
  actionGuards?: ActionGuardFn[];
  [key: string]: unknown;
};
type LazyGlob = Record<string, () => Promise<unknown>>;
type EagerGlob = Record<string, GlobModule>;

type ModuleEntry = {
  actions: Record<string, unknown>;
  guards: ActionGuardFn[];
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
        guards: (mod.actionGuards as ActionGuardFn[] | undefined) ?? [],
      };
    }
  }
  return result;
}

async function runActionGuards(
  guards: ActionGuardFn[],
  ctx: ActionGuardContext
): Promise<void> {
  const run = async (index: number): Promise<void> => {
    if (index >= guards.length) return;
    await guards[index](ctx, () => run(index + 1));
  };
  await run(0);
}

export function actionsHandler(glob: LazyGlob | EagerGlob): MiddlewareHandler {
  let cachedMapPromise: Promise<Record<string, ModuleEntry>> | null = null;

  return async (c) => {
    const actionsMapPromise =
      import.meta.env.DEV
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
        return c.json({ error: 'Form data must include __module and __action fields' }, 400);
      }

      module = rawModule;
      action = rawAction;

      const payloadObj: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
      for (const [key, value] of formData.entries()) {
        if (key === '__module' || key === '__action') continue;
        const existing = payloadObj[key];
        if (existing !== undefined) {
          payloadObj[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
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
        return c.json({ error: 'Request body must include string fields: module, action' }, 400);
      }
      module = m;
      action = a;
      payload = p;
    }

    const entry = actionsMap[module];
    if (!entry) {
      return c.json({ error: `Module '${module}' not found` }, 404);
    }

    try {
      await runActionGuards(entry.guards, { c, module, action, payload });
    } catch (err) {
      if (err instanceof ActionGuardError) {
        return c.json({ error: err.message }, err.status as 400 | 401 | 403 | 404 | 429 | 500);
      }
      throw err;
    }

    const fn = entry.actions[action];
    if (typeof fn !== 'function') {
      return c.json({ error: `Action '${action}' not found in module '${module}'` }, 404);
    }

    const signal = c.req.raw.signal;
    const actionCtx = { c, signal };

    let result: unknown;
    try {
      result = await runRequestScope(() =>
        (fn as (ctx: unknown, payload: unknown) => Promise<unknown>)(actionCtx, payload)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }

    if (isAsyncGenerator(result)) {
      return new Response(sseFromGenerator(result, { emitResult: true, signal }), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    if (result instanceof ReadableStream) {
      return new Response(readableStreamToSse(result as ReadableStream<unknown>), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return c.json(result);
  };
}
