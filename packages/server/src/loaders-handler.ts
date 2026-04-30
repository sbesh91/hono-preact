import type { MiddlewareHandler } from 'hono';
import { runRequestScope } from '@hono-preact/iso';

type GlobModule = { default?: unknown; [key: string]: unknown };
type LazyGlob = Record<string, () => Promise<unknown>>;
type EagerGlob = Record<string, GlobModule>;

function moduleNameFromPath(filePath: string): string {
  return filePath
    .split('/')
    .pop()!
    .replace(/\.server\.[jt]sx?$/, '');
}

type SerializedLocation = {
  path: string;
  pathParams: Record<string, string>;
  searchParams: Record<string, string>;
};

type LoaderFn = (props: { location: SerializedLocation }) => Promise<unknown>;

async function buildLoadersMap(
  glob: LazyGlob | EagerGlob
): Promise<Record<string, LoaderFn>> {
  const result: Record<string, LoaderFn> = {};
  for (const [filePath, moduleOrLoader] of Object.entries(glob)) {
    const mod =
      typeof moduleOrLoader === 'function'
        ? await (moduleOrLoader as () => Promise<GlobModule>)()
        : (moduleOrLoader as GlobModule);
    if (typeof mod.default === 'function') {
      result[moduleNameFromPath(filePath)] = mod.default as LoaderFn;
    }
  }
  return result;
}

export function loadersHandler(glob: LazyGlob | EagerGlob): MiddlewareHandler {
  let loadersMapPromise: Promise<Record<string, LoaderFn>> | null = null;

  return async (c) => {
    if (!loadersMapPromise) {
      loadersMapPromise = buildLoadersMap(glob).catch((err) => {
        loadersMapPromise = null;
        return Promise.reject(err);
      });
    }

    let loadersMap: Record<string, LoaderFn>;
    try {
      loadersMap = await loadersMapPromise;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to load loaders: ${message}` }, 503);
    }

    let body: { module: unknown; location: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { module, location } = body;
    if (typeof module !== 'string') {
      return c.json({ error: 'Request body must include string field: module' }, 400);
    }

    const loader = loadersMap[module];
    if (!loader) {
      return c.json({ error: `Module '${module}' not found` }, 404);
    }

    try {
      const result = await runRequestScope(() =>
        loader({ location: location as SerializedLocation })
      );
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  };
}
