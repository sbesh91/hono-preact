import { Hono } from 'hono';
import { h, type ComponentType, type ComponentChildren } from 'preact';
import { LocationProvider } from 'preact-iso';
import { Routes, type AppConfig, type RoutesManifest } from '@hono-preact/iso';
import {
  env,
  LOADERS_RPC_PATH,
  SOCKETS_RPC_PATH,
} from '@hono-preact/iso/internal/runtime';
import { loadersHandler } from './loaders-handler.js';
import { pageActionHandler } from './page-action-handler.js';
import { renderPage } from './render.js';
import {
  routeServerModules,
  makePageUseResolver,
  makeSocketRoutePathResolver,
} from './route-server-modules.js';
import { makePageActionResolvers } from './page-action-resolvers.js';
import { buildSocketRegistry, socketsHandler } from './sockets-handler.js';
import { buildRoomRegistry } from './rooms-handler.js';

export interface CreateServerEntryOptions {
  /** The manifest produced by defineRoutes(...) in the user's routes file. */
  routes: RoutesManifest;
  /** The user's root Layout component; wraps the routed tree during SSR. */
  layout: ComponentType<{ children?: ComponentChildren }>;
  /** defineApp(...) result. Defaults to an empty config when omitted. */
  appConfig?: AppConfig;
  /** Optional user-authored Hono app, mounted ahead of the reserved paths. */
  api?: Hono;
  /** Rebuild server-module maps per request so .server edits hot-reload. */
  dev?: boolean;
}

/**
 * Assemble the framework's core Hono app: the loaders RPC endpoint, the page
 * action POST handler, and the SSR catch-all, with an optional user api app
 * mounted first so user middleware composes ahead of the reserved paths.
 *
 * This is the single wiring contract the framework's generated server entry
 * calls. It is framework-private (exposed only on
 * hono-preact/server/internal/runtime); it has no standalone user story today.
 * It exists as a real typed function rather than codegen string concatenation
 * so the wiring is type-checked and unit-tested, and so the generated entry
 * exercises the exact same path it would hand a user if this ever goes public.
 */
export function createServerEntry(opts: CreateServerEntryOptions): Hono {
  const {
    routes,
    layout: Layout,
    appConfig = { use: [] },
    api,
    dev = false,
  } = opts;

  // The act of building a server entry implies server mode; the iso runtime
  // reads env.current to branch server-only code paths. Set it before the
  // handlers (which run per request) can observe it.
  env.current = 'server';

  const serverModules = routeServerModules(routes);
  const pageUseResolver = makePageUseResolver(routes);
  const pageActionResolvers = makePageActionResolvers(routes.serverRoutes, {
    dev,
  });

  // Build socket registry from the same server imports that build the loaders
  // map. Cached as a promise so the async glob walk runs once per boot (or per
  // request when dev: true for hot-reload parity with loadersHandler).
  let cachedSocketRegistryPromise: ReturnType<
    typeof buildSocketRegistry
  > | null = null;
  const socketRegistryPromise = () =>
    dev
      ? buildSocketRegistry(serverModules)
      : (cachedSocketRegistryPromise ??= buildSocketRegistry(serverModules));

  // Room registry, partitioned from the same serverSockets map by the channel
  // discriminator. Same caching policy as the socket registry: one async walk
  // at boot; per-request in dev for hot-reload parity.
  let cachedRoomRegistryPromise: ReturnType<typeof buildRoomRegistry> | null =
    null;
  const roomRegistryPromise = () =>
    dev
      ? buildRoomRegistry(serverModules)
      : (cachedRoomRegistryPromise ??= buildRoomRegistry(serverModules));

  // Build the moduleKey -> route path resolver for sockets. Cached for the
  // same reasons as the socket registry (one async walk at boot; per-request
  // in dev for hot-reload parity). Used by socketsHandler to derive the owning
  // route path server-side so resolvePageUse receives the correct path for
  // route-node use inheritance.
  let cachedSocketRoutePathResolverPromise: ReturnType<
    typeof makeSocketRoutePathResolver
  > | null = null;
  const socketRoutePathResolverPromise = () =>
    dev
      ? makeSocketRoutePathResolver(routes.serverRoutes)
      : (cachedSocketRoutePathResolverPromise ??= makeSocketRoutePathResolver(
          routes.serverRoutes
        ));

  // Build the routed tree lazily: only the SSR (GET) and action-rerender paths
  // need it, and constructing per call keeps the two call sites from sharing a
  // mutable vnode.
  const pageTree = () =>
    h(Layout, null, h(LocationProvider, null, h(Routes, { routes })));

  const app = new Hono();
  // Mount the user app first so middleware it registers (csrf, auth, etc.)
  // composes ahead of the framework's reserved /__loaders + catch-all routes.
  if (api) app.route('/', api);
  app
    .post(
      LOADERS_RPC_PATH,
      loadersHandler(serverModules, {
        dev,
        appConfig,
        resolvePageUse: pageUseResolver.byPath,
      })
    )
    // The WebSocket upgrade endpoint must be registered before the SSR GET *
    // catch-all so it is not swallowed. The handler resolves the socket
    // registry and the moduleKey -> route path resolver lazily per request
    // (same caching policy as loadersHandler). resolvePageUse and
    // resolveRoutePath together give socketsHandler the route-node use chain
    // for the socket's owning route, which is where auth gates live.
    .get(SOCKETS_RPC_PATH, async (c, next) => {
      const [registry, rooms, routePathResolver] = await Promise.all([
        socketRegistryPromise(),
        roomRegistryPromise(),
        socketRoutePathResolverPromise(),
      ]);
      return socketsHandler({
        registry,
        rooms,
        appConfig,
        resolvePageUse: pageUseResolver.byPath,
        resolveRoutePath: routePathResolver.byModuleKey,
      })(c, next);
    })
    .post(
      '*',
      pageActionHandler({
        resolverByPath: pageActionResolvers.byPath,
        resolvePageUseByPath: pageUseResolver.byPath,
        renderPage,
        resolvePageNode: pageTree,
        appConfig,
      })
    )
    .get('*', (c) => renderPage(c, pageTree(), { appConfig }));

  return app;
}
