import type { MiddlewareHandler } from 'hono';
import { runRequestScope } from '@hono-preact/iso/internal';
import { sseFromGenerator, sseEncode, sseEncodeError } from './sse.js';

type GlobModule = {
  default?: unknown;
  __moduleKey?: unknown;
  [key: string]: unknown;
};
type LazyGlob = Record<string, () => Promise<unknown>>;
type EagerGlob = Record<string, GlobModule>;

type SerializedLocation = {
  path: string;
  pathParams: Record<string, string>;
  searchParams: Record<string, string>;
};

type LoaderFn = (props: {
  location: SerializedLocation;
  signal: AbortSignal;
}) => Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>;

async function buildLoadersMap(
  glob: LazyGlob | EagerGlob
): Promise<Record<string, LoaderFn>> {
  const result: Record<string, LoaderFn> = {};
  for (const [, moduleOrLoader] of Object.entries(glob)) {
    const mod =
      typeof moduleOrLoader === 'function'
        ? await (moduleOrLoader as () => Promise<GlobModule>)()
        : (moduleOrLoader as GlobModule);
    const key = mod.__moduleKey;
    if (typeof key === 'string' && typeof mod.default === 'function') {
      result[key] = mod.default as LoaderFn;
    }
  }
  return result;
}

function validateLocation(loc: unknown): SerializedLocation | null {
  if (typeof loc !== 'object' || loc === null) return null;
  const o = loc as Record<string, unknown>;
  if (typeof o.path !== 'string') return null;
  if (typeof o.pathParams !== 'object' || o.pathParams === null) return null;
  if (typeof o.searchParams !== 'object' || o.searchParams === null) return null;
  return {
    path: o.path,
    pathParams: o.pathParams as Record<string, string>,
    searchParams: o.searchParams as Record<string, string>,
  };
}

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

export function loadersHandler(glob: LazyGlob | EagerGlob): MiddlewareHandler {
  let cachedMapPromise: Promise<Record<string, LoaderFn>> | null = null;

  return async (c) => {
    const loadersMapPromise =
      import.meta.env.DEV
        ? buildLoadersMap(glob)
        : (cachedMapPromise ??= buildLoadersMap(glob).catch((err) => {
            cachedMapPromise = null;
            return Promise.reject(err);
          }));

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
      return c.json(
        { error: 'Request body must include string field: module' },
        400
      );
    }

    const validatedLocation = validateLocation(location);
    if (!validatedLocation) {
      return c.json(
        {
          error:
            'Request body must include object field: location with shape { path: string, pathParams: object, searchParams: object }',
        },
        400
      );
    }

    const loader = loadersMap[module];
    if (!loader) {
      return c.json({ error: `Module '${module}' not found` }, 404);
    }

    const signal = c.req.raw.signal;

    try {
      const result = await runRequestScope(() =>
        Promise.resolve(loader({ location: validatedLocation, signal }))
      );

      if (isAsyncGenerator(result)) {
        return new Response(sseFromGenerator(result, { emitResult: false, signal }), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      if (result instanceof ReadableStream) {
        return new Response(readableStreamToSse(result as ReadableStream<unknown>), {
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
