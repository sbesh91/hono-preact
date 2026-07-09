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
import { pageActionsHandler } from './page-actions-handler.js';
import { renderPage } from './render.js';
import {
  routeServerModules,
  makePageUseResolver,
  makeSocketRoutePathResolver,
} from './route-server-modules.js';
import {
  assertRouteBindingsMatchMount,
  assertRegistryRouteBindingsValid,
} from './route-binding-guard.js';
import { makePageActionResolvers } from './page-action-resolvers.js';
import {
  buildSocketRegistry,
  socketsHandler,
  assertNoSocketRoomCollision,
} from './sockets-handler.js';
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
  /**
   * The `src/server/**` registry: lazy loaders for `.server.*` modules that
   * live in the blessed server folder rather than being attached to a route.
   * Their loaders (moduleKey RPC), rooms, and sockets register alongside the
   * route-attached modules; their actions dispatch via the moduleKey fallback.
   */
  serverRegistry?: ReadonlyArray<() => Promise<unknown>>;
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
    serverRegistry = [],
    dev = false,
  } = opts;

  // The act of building a server entry implies server mode; the iso runtime
  // reads env.current to branch server-only code paths. Set it before the
  // handlers (which run per request) can observe it.
  env.current = 'server';

  // Route-attached modules plus the src/server registry. Loaders, rooms, and
  // sockets resolve by moduleKey / registry walk, so both sources feed the same
  // flat module list.
  const serverModules = [...routeServerModules(routes), ...serverRegistry];
  const pageUseResolver = makePageUseResolver(routes);
  const pageActionResolvers = makePageActionResolvers(routes.serverRoutes, {
    dev,
    registryModules: serverRegistry,
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

  // Room registry, built from the `serverRooms` export (a distinct named export
  // from `serverSockets`). Same caching policy as the socket registry: one
  // async walk at boot; per-request in dev for hot-reload parity.
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

  // Boot-time guard: every route-bound loader/action must declare the route its
  // module is mounted on (`route.path`), so a route-bound unit can never resolve
  // its page-use (auth) chain from the wrong route. Awaited before the two
  // `byPattern` surfaces (the loaders RPC and the action POST); a mismatch fails
  // the request closed (500) rather than running through a wrong/empty gate
  // chain. Cached like the socket registries: one walk at boot, per-request in
  // dev for hot-reload parity.
  //
  // The registry check rides along: a `serverRoute(...)`-bound loader/action in
  // a src/server module resolves its gate chain by `byPattern(__routeId)`, which
  // fails open, so we require the bound route to be a real pattern (one every
  // `routeUse` entry covers). A stale/typo'd pattern fails the boot closed
  // rather than running the unit under no gates.
  const validRoutePatterns = new Set(routes.routeUse.map((r) => r.path));
  const runBootChecks = () =>
    Promise.all([
      assertRouteBindingsMatchMount(routes.serverRoutes),
      assertRegistryRouteBindingsValid(serverRegistry, validRoutePatterns),
    ]).then(() => undefined);
  let cachedRouteBindingCheck: Promise<void> | null = null;
  const routeBindingCheck = () =>
    dev
      ? runBootChecks()
      : (cachedRouteBindingCheck ??= runBootChecks().catch((err) => {
          cachedRouteBindingCheck = null;
          throw err;
        }));

  // Build the routed tree lazily: only the SSR (GET) and action-rerender paths
  // need it, and constructing per call keeps the two call sites from sharing a
  // mutable vnode.
  const pageTree = () =>
    h(Layout, null, h(LocationProvider, null, h(Routes, { routes })));

  // Construct the route-bound handlers once (their internal registry caches must
  // persist across requests); the binding guard wraps the two that dispatch
  // route-bound units by pattern.
  const loaders = loadersHandler(serverModules, {
    dev,
    appConfig,
    // The loaders RPC resolves page-use from the loader's OWN declared route
    // pattern (`ref.__routeId`), so it needs the exact pattern lookup, not the
    // URL fuzzy-matcher: `byPath` could collide `/a/:x` with `/a/:y`.
    resolvePageUse: pageUseResolver.byPattern,
  });
  const actions = pageActionsHandler({
    dev,
    resolverByPath: pageActionResolvers.byPath,
    // src/server registry actions are not attached to a route URL, so a
    // byPath miss falls back to a moduleKey lookup (the client always sends the
    // action's moduleKey).
    resolverByModuleKey: pageActionResolvers.byModuleKey,
    // Route-bound actions (serverRoute(r).action) resolve their page-use chain
    // from their declared pattern, mirroring the loaders RPC. Same resolver,
    // exact-pattern lookup: byPath could collide `/a/:x`/`/a/:y`. Bare actions
    // are route-independent and receive no page tier (EMPTY_PAGE_USE inside the
    // handler), matching bare loaders.
    resolvePageUseByPattern: pageUseResolver.byPattern,
    renderPage,
    resolvePageNode: pageTree,
    appConfig,
  });

  const app = new Hono();
  // Mount the user app first so middleware it registers (csrf, auth, etc.)
  // composes ahead of the framework's reserved /__loaders + catch-all routes.
  if (api) app.route('/', api);
  app
    .post(LOADERS_RPC_PATH, async (c, next) => {
      try {
        await routeBindingCheck();
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err) },
          500
        );
      }
      return loaders(c, next);
    })
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
      // Fail loudly if a socket and a room share a `moduleKey::name` key (the
      // socket would otherwise silently shadow the room). Both registries are
      // available together here; in production they are cached so this is a
      // boot-time check, in dev it re-runs per rebuild for hot-reload parity.
      assertNoSocketRoomCollision(registry, rooms);
      return socketsHandler({
        registry,
        rooms,
        appConfig,
        dev,
        // The socket-upgrade guard chain resolves page-use from the socket's
        // OWN owning-route pattern (via resolveRoutePath), so it needs the exact
        // pattern lookup, not the URL fuzzy-matcher: `byPath` could collide
        // `/a/:x` with `/a/:y` and apply the wrong route's auth gates.
        resolvePageUse: pageUseResolver.byPattern,
        resolveRoutePath: routePathResolver.byModuleKey,
      })(c, next);
    })
    .post('*', async (c, next) => {
      try {
        await routeBindingCheck();
      } catch (err) {
        return c.json(
          {
            __outcome: 'error',
            message: err instanceof Error ? err.message : String(err),
          },
          500
        );
      }
      return actions(c, next);
    })
    .get('*', (c) => renderPage(c, pageTree(), { appConfig }));

  return app;
}
