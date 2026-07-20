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
  takeServerDeny,
  dispatchServer,
  partitionUse,
  getActionResultSlot,
} from '@hono-preact/iso/internal';
import type {
  ServerDenyRecord,
  ServerLoaderStream,
} from '@hono-preact/iso/internal';
import { assembleDocument } from './document-shell.js';
import { getDevGlobalCss } from './dev-global-css.js';
import { fontPreloadLinkHeader } from './font-preload.js';
import {
  resolvePreloadManifest,
  preloadLinkHeader,
} from './preload-modules.js';
import { selectRoutePreload } from './route-preload-match.js';
import { streamDocumentResponse } from './stream-pump.js';
import {
  applyOutcomeHeaders,
  translateRootOutcome,
} from './outcome-translation.js';

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
  options?: {
    defaultTitle?: string;
    appConfig?: AppConfig;
    /**
     * When true, a streaming loader error's real message and name reach the
     * client. When false (default), the error is masked as `Stream failed`,
     * matching the SSE wire's masking. The framework's generated server entry
     * threads its own dev flag here, matching loadersHandler and
     * pageActionsHandler.
     */
    dev?: boolean;
  }
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
    serverDeny: ServerDenyRecord | null;
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
            // A loader that denied during SSR rendered its errorFallback
            // in-tree (see iso's DataReader / RouteBoundary) and recorded
            // the response facts here. Must be read now, still inside
            // runRequestScope: the AsyncLocalStorage store backing it is
            // not live once this scope's promise is awaited by the caller.
            const serverDeny = takeServerDeny();
            return {
              kind: 'value',
              html: rendered.html,
              streamingLoaders: loaders,
              serverDeny,
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

  // Apply the recorded deny (captured above, still inside runRequestScope) to
  // the assembled document so the branded page ships at the deny status with
  // the deny's headers, matching client-navigation output.
  const serverDeny = rootResult.serverDeny;
  if (serverDeny) {
    applyOutcomeHeaders(c, serverDeny.headers);
    c.status(serverDeny.status);
  }

  // The client entry's static-import closure plus the matched route's own
  // chunks, hinted as `modulepreload` in the document head. Resolving is
  // memoized, so the platform reader runs at most once per isolate.
  const { closure, routes, routeCss, globalCss } =
    await resolvePreloadManifest();
  // Decode the path so it matches the build-time pattern keys, which are decoded
  // source-derived slugs (a `%20`/unicode segment would otherwise never match).
  // `decodeURI` keeps `/` intact (unlike decodeURIComponent) and can't throw on
  // valid input; fall back to the raw path on a malformed sequence.
  let routePath = new URL(c.req.url).pathname;
  try {
    routePath = decodeURI(routePath);
  } catch {
    // keep the raw, encoded path
  }
  const routePreload = selectRoutePreload(routes, routePath) ?? [];
  // The dev-global-css seam is installed only in serve mode (see
  // dev-global-css.ts), so its presence here IS "we are running under `vite
  // dev`". On the node adapter that matters beyond styling: a stale
  // dist/client from a previous build reads successfully in dev (the file on
  // disk didn't go anywhere when the dev server started), so the artifact's
  // hashed route/global stylesheet URLs would resolve to chunk names that
  // don't exist in this dev session and 404 render-blockingly. The dev-served
  // global stylesheet source already carries every rule those artifact sheets
  // would have carried (nothing is scoped away in dev), so artifact-driven
  // render-critical CSS is never wanted alongside it, not even as a
  // supplement. Modulepreload hints are left untouched: they're droppable (a
  // stale hint just 404s a prefetch, never the page).
  const devGlobalCss = getDevGlobalCss();
  const routeStyleSheets = devGlobalCss
    ? []
    : (selectRoutePreload(routeCss, routePath) ?? []);
  const globalStyleSheets = devGlobalCss ? [...devGlobalCss] : globalCss;
  // Only the entry closure goes in the `Link` header. The header is honored
  // before body parse, but it cannot carry `fetchpriority`, so a route chunk
  // placed there would preload at default
  // priority and defeat the head tag's `fetchpriority="low"`. The closure is
  // the small, universal boot runtime (worth the earliest hint); the route
  // chunks are hinted low-priority via the head tags only.
  // Fonts first (render-critical, higher-priority hint), then the boot closure's
  // modulepreload entries. The closure's truncation budget is reduced by the
  // font part's byte length so the two parts combined, not each independently,
  // stay within the header-size cap (the font part is never truncated itself:
  // fonts are few and small enough that it isn't worth the complexity).
  const fontHeader = fontPreloadLinkHeader(options?.appConfig?.fonts ?? []);
  const usedBytes = fontHeader ? fontHeader.length + 2 : 0;
  const linkHeader = [fontHeader, preloadLinkHeader(closure, usedBytes)]
    .filter(Boolean)
    .join(', ');
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
    routePreloadModules: routePreload,
    routeStyleSheets,
    globalStyleSheets,
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
    dev: options?.dev ?? false,
    status: serverDeny ? serverDeny.status : undefined,
  });
}
