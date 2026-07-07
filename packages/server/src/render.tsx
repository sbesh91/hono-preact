import type { Context } from 'hono';
import type { VNode } from 'preact';
import { createDispatcher, HoofdProvider } from 'hoofd/preact';
import { prerender, locationStub } from 'preact-iso/prerender';
import {
  isOutcome,
  type AppConfig,
  type Middleware,
  type Outcome,
  type ServerMiddleware,
  type ServerPageCtx,
  ActionResultContext,
  type ActionResultContextValue,
} from '@hono-preact/iso';
import { env } from '@hono-preact/iso/internal/runtime';
import {
  HonoRequestContext,
  runRequestScope,
  captureRequestScope,
  takeServerStreamingLoaders,
  dispatchServer,
  partitionUse,
  getActionResultSlot,
} from '@hono-preact/iso/internal';
import type { ServerLoaderStream } from '@hono-preact/iso/internal';
import { assembleDocument } from './document-shell.js';
import {
  resolvePreloadManifest,
  preloadLinkHeader,
} from './preload-modules.js';
import { routePreloadTags, selectRoutePreload } from './route-preload-tags.js';
import { streamDocumentResponse } from './stream-pump.js';
import { translateRootOutcome } from './outcome-translation.js';

function buildActionResultContext(): ActionResultContextValue {
  const slot = getActionResultSlot();
  if (!slot) return null;
  if (slot.resolution.kind === 'success') {
    return {
      module: slot.module,
      action: slot.action,
      kind: 'success',
      data: slot.resolution.data,
      submittedPayload: slot.submittedPayload,
    };
  }
  if (slot.resolution.kind === 'error') {
    return {
      module: slot.module,
      action: slot.action,
      kind: 'error',
      message: slot.resolution.message,
      submittedPayload: slot.submittedPayload,
    };
  }
  const { outcome } = slot.resolution;
  if (outcome.__outcome === 'deny') {
    return {
      module: slot.module,
      action: slot.action,
      kind: 'deny',
      status: outcome.status,
      message: outcome.message,
      data: outcome.data,
      ...(outcome.code !== undefined ? { code: outcome.code } : {}),
      submittedPayload: slot.submittedPayload,
    };
  }
  return null;
}

export async function renderPage(
  c: Context,
  node: VNode,
  options?: { defaultTitle?: string; appConfig?: AppConfig }
): Promise<Response> {
  const dispatcher = createDispatcher();
  const previousEnv = env.current;
  env.current = 'server';

  let html: string;
  let streamingLoaders: ServerLoaderStream[];
  // Binder that re-enters the per-request ALS store; populated inside the
  // scope below. Streaming loaders that yield, then resume from outside
  // `runRequestScope` (the ReadableStream.start callback runs after this
  // frame returns) lose ALS propagation on V8. Wrapping the drain in this
  // binder restores per-request isolation for `getRequestStore` /
  // `getRequestHonoContext` reads from generator continuations.
  let bindRequestScope: <R>(fn: () => R | Promise<R>) => R | Promise<R> = (
    fn
  ) => fn();

  // Sentinel returned by the root chain when middleware short-circuits with
  // a redirect or deny outcome. We translate to a Response outside the scope
  // (after env.current restoration) so the abort-before-render path stays
  // symmetric with the regular outcome path.
  type RootOutcome = { kind: 'outcome'; outcome: Outcome };
  type RootValue = {
    kind: 'value';
    html: string;
    streamingLoaders: ServerLoaderStream[];
  };
  let rootResult: RootOutcome | RootValue;
  try {
    rootResult = await runRequestScope(
      async (): Promise<RootOutcome | RootValue> => {
        const reqUrl = new URL(c.req.url);
        const location = {
          path: reqUrl.pathname,
          searchParams: Object.fromEntries(reqUrl.searchParams),
          // Path params are route-match output; the root layer runs before
          // route matching, so they're empty here. Page-layer middleware
          // (added in a follow-up) will have them populated.
          pathParams: {},
        };

        const rootUse = options?.appConfig?.use ?? [];
        const serverMw = partitionUse(
          rootUse as ReadonlyArray<Middleware>
        ).middleware.filter(
          (m): m is ServerMiddleware<'page'> => m.runs === 'server'
        );

        const ctx: ServerPageCtx = {
          scope: 'page',
          c,
          signal: c.req.raw.signal,
          location,
        };

        const dispatch = await dispatchServer<RootValue, 'page'>({
          middleware: serverMw,
          ctx,
          inner: async (): Promise<RootValue> => {
            // preact-iso's `LocationProvider` reads `globalThis.location`
            // once, synchronously, when it mounts. Set it on the same
            // microtask as the `prerender` call so no other request can
            // interleave and trample the global between us writing it and
            // the provider reading it. Children resume from reducer state,
            // never re-reading the global, so the rest of this render is
            // safe even if another request resets `globalThis.location`
            // while we await suspended children.
            locationStub(reqUrl.pathname + reqUrl.search);
            bindRequestScope = captureRequestScope();
            const rendered = await prerender(
              <ActionResultContext.Provider value={buildActionResultContext()}>
                <HonoRequestContext.Provider value={{ context: c }}>
                  <HoofdProvider value={dispatcher}>{node}</HoofdProvider>
                </HonoRequestContext.Provider>
              </ActionResultContext.Provider>
            );
            const loaders = takeServerStreamingLoaders();
            return {
              kind: 'value',
              html: rendered.html,
              streamingLoaders: loaders,
            };
          },
        });

        if (dispatch.kind === 'outcome') {
          return { kind: 'outcome', outcome: dispatch.outcome };
        }
        return dispatch.value;
      },
      { honoContext: c }
    );
  } catch (e: unknown) {
    if (isOutcome(e)) return translateRootOutcome(c, e);
    throw e;
  } finally {
    env.current = previousEnv;
  }

  if (rootResult.kind === 'outcome') {
    return translateRootOutcome(c, rootResult.outcome);
  }
  html = rootResult.html;
  streamingLoaders = rootResult.streamingLoaders;

  // The client entry's static-import closure plus the matched route's own
  // chunks, hinted as `modulepreload` both in the document head and as a `Link`
  // response header (the header is honored before body parse and is promotable
  // to 103 Early Hints by the CDN/adapter). Resolving is memoized, so the
  // platform reader runs at most once per isolate.
  const { closure, routes } = await resolvePreloadManifest();
  const routePath = new URL(c.req.url).pathname;
  const routePreload = selectRoutePreload(routes, routePath);
  // Closure first (needed by every route), then the active route's chunks
  // (layout `high` before leaf `low`) so the header preserves priority order.
  const headerUrls = [
    ...closure,
    ...(routePreload?.high ?? []),
    ...(routePreload?.low ?? []),
  ];
  const linkHeader = preloadLinkHeader(headerUrls);
  // Append rather than set: a user's middleware may already have written a
  // `Link` header (e.g. a preconnect/preload of their own). Multiple `Link`
  // headers are valid (RFC 8288) and the browser merges them.
  if (linkHeader) c.header('Link', linkHeader, { append: true });

  const fullHtml = assembleDocument({
    html,
    head: dispatcher.toStatic(),
    defaultTitle: options?.defaultTitle,
    appConfig: options?.appConfig,
    preloadModules: closure,
    routePreloadTags: routePreloadTags(routes, routePath),
  });

  // Non-streaming case: preserve existing single-shot behavior.
  if (streamingLoaders.length === 0) {
    return c.html(`<!doctype html>${fullHtml}`);
  }

  // Streaming case: interleave per-loader chunk script tags into the document
  // and stream with multi-producer backpressure. See `stream-pump.ts`.
  return streamDocumentResponse(c, {
    fullHtml,
    streamingLoaders,
    requestSignal: c.req.raw.signal,
    bindRequestScope,
  });
}
