import type { MiddlewareHandler } from 'hono';

type GlobModule = { serverActions?: Record<string, unknown>; [key: string]: unknown };
type LazyGlob = Record<string, () => Promise<GlobModule>>;
type EagerGlob = Record<string, GlobModule>;

function moduleNameFromPath(filePath: string): string {
  return filePath
    .split('/')
    .pop()!
    .replace(/\.server\.[jt]sx?$/, '');
}

async function buildActionsMap(
  glob: LazyGlob | EagerGlob
): Promise<Record<string, Record<string, unknown>>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [filePath, moduleOrLoader] of Object.entries(glob)) {
    const mod =
      typeof moduleOrLoader === 'function'
        ? await (moduleOrLoader as () => Promise<GlobModule>)()
        : (moduleOrLoader as GlobModule);
    if (mod.serverActions) {
      result[moduleNameFromPath(filePath)] = mod.serverActions as Record<string, unknown>;
    }
  }
  return result;
}

export function actionsHandler(glob: LazyGlob | EagerGlob): MiddlewareHandler {
  let actionsMapPromise: Promise<Record<string, Record<string, unknown>>> | null = null;

  return async (c) => {
    if (!actionsMapPromise) {
      actionsMapPromise = buildActionsMap(glob).catch((err) => {
        actionsMapPromise = null;
        return Promise.reject(err);
      });
    }

    let actionsMap: Record<string, Record<string, unknown>>;
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

    const moduleActions = actionsMap[module];
    if (!moduleActions) {
      return c.json({ error: `Module '${module}' not found` }, 404);
    }

    const fn = moduleActions[action];
    if (typeof fn !== 'function') {
      return c.json({ error: `Action '${action}' not found in module '${module}'` }, 404);
    }

    try {
      const result = await (fn as (ctx: unknown, payload: unknown) => Promise<unknown>)(
        c,
        payload
      );
      if (result instanceof ReadableStream) {
        return new Response(result as ReadableStream<Uint8Array>, {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  };
}
