import type { ServerRoute, StandardSchemaV1 } from '@hono-preact/iso';
import { findBestPattern } from './route-pattern.js';

type ActionFn = (ctx: unknown, payload: unknown) => Promise<unknown>;

export type ActionEntry = {
  fn: ActionFn;
  use: ReadonlyArray<unknown>;
  timeoutMs?: number | false;
  moduleKey: string;
  input?: StandardSchemaV1;
  /**
   * The owning route pattern, present only for actions defined via
   * `serverRoute(r).action(fn)`. When set, the handler resolves the action's
   * page-level `use` chain by this EXACT pattern; when absent (bare
   * `defineAction`), it falls back to fuzzy-matching the request URL.
   */
  routeId?: string;
};

type ServerModule = {
  __moduleKey?: unknown;
  serverActions?: Record<string, unknown>;
};

function extractActions(
  mod: ServerModule
): Array<{ name: string; entry: ActionEntry }> {
  const moduleKey = mod.__moduleKey;
  if (typeof moduleKey !== 'string' || !mod.serverActions) return [];
  const out: Array<{ name: string; entry: ActionEntry }> = [];
  for (const [name, val] of Object.entries(mod.serverActions)) {
    if (typeof val !== 'function') continue;
    // `defineAction` attaches `use` and `timeoutMs` as non-enumerable
    // properties on the function (see packages/iso/src/action.ts). Read
    // them here as the single deserialization boundary; the handler reads
    // `entry.fn`, `entry.use`, `entry.timeoutMs` through the typed
    // ActionEntry shape from this point on.
    const metadata = val as {
      use?: ReadonlyArray<unknown>;
      timeoutMs?: number | false;
      input?: StandardSchemaV1;
      __routeId?: string;
    };
    out.push({
      name,
      entry: {
        fn: val as ActionFn,
        use: metadata.use ?? [],
        timeoutMs: metadata.timeoutMs,
        moduleKey,
        input: metadata.input,
        routeId: metadata.__routeId,
      },
    });
  }
  return out;
}

/**
 * Build action resolvers. `byPath` is keyed by route path: each ServerRoute
 * contributes its own serverActions and its ancestors' serverActions to the
 * merged map for that path (ancestors first, so a page-level action shadows a
 * same-named layout action). `byModuleKey` is keyed by module key and holds
 * ONLY the `registryModules` (src/server) actions, never route-attached ones,
 * so the handler's moduleKey fallback cannot reach a route-gated action from an
 * ungated URL. Route-attached actions are byPath-only, which keeps their route
 * `use` (auth) chain always in force.
 *
 * Owns the build lifecycle directly: each distinct `.server.*` thunk is loaded
 * exactly once per build (a thunk may appear as `server` on one route and as an
 * `ancestor` on descendants); the built result is cached for the process
 * lifetime; a failed build is not cached (the next call retries); when `dev` is
 * true the cache is bypassed so editing a `.server.*` file takes effect without
 * a restart. `byPath` resolves a concrete URL to the most specific matching
 * pattern via `findBestPattern`.
 *
 * NOTE: framework-private. Intended consumer is the generated server entry and
 * pageActionsHandler.
 */
export function makePageActionResolvers(
  serverRoutes: ReadonlyArray<ServerRoute>,
  options: {
    dev?: boolean;
    /**
     * src/server registry modules. Their actions are indexed into `byModuleKey`
     * only (they have no route path, so they never enter `byPath`); the handler
     * falls back to `byModuleKey` when a byPath lookup misses.
     */
    registryModules?: ReadonlyArray<() => Promise<unknown>>;
  } = {}
): {
  byPath: (path: string) => Promise<Map<string, ActionEntry>>;
  byModuleKey: (
    moduleKey: string,
    actionName: string
  ) => Promise<ActionEntry | undefined>;
} {
  const dev = options.dev ?? false;
  const registryModules = options.registryModules ?? [];

  type Built = {
    byPathMap: Map<string, Map<string, ActionEntry>>;
    byModuleKeyMap: Map<string, Map<string, ActionEntry>>;
  };
  let buildPromise: Promise<Built> | null = null;

  const build = async (): Promise<Built> => {
    const thunkCache = new Map<() => Promise<unknown>, Promise<ServerModule>>();
    const load = (thunk: () => Promise<unknown>): Promise<ServerModule> => {
      let p = thunkCache.get(thunk);
      if (!p) {
        // Structural read of a user-defined module's exports (a sanctioned
        // cast boundary); extractActions narrows the fields it reads.
        p = thunk().then((mod) => mod as ServerModule);
        thunkCache.set(thunk, p);
      }
      return p;
    };

    const byPathMap = new Map<string, Map<string, ActionEntry>>();
    const byModuleKeyMap = new Map<string, Map<string, ActionEntry>>();

    await Promise.all(
      serverRoutes.map(async (route) => {
        const ancestorMods = await Promise.all(route.ancestors.map(load));
        const selfMod = await load(route.server);
        const merged = new Map<string, ActionEntry>();
        // Write ancestors first (outer -> inner), then self. Later writes
        // shadow earlier ones, so a page-level action wins over a layout
        // action of the same name.
        //
        // Route-attached actions go into byPath ONLY, never byModuleKey. The
        // handler's byModuleKey fallback must not reach them: a route-attached
        // action is gated by its route's `use` chain via byPath, and exposing
        // it by module key would let a client invoke it from an ungated URL and
        // bypass that gate. Only registry actions (below) are moduleKey-addressable.
        for (const mod of [...ancestorMods, selfMod]) {
          for (const { name, entry } of extractActions(mod)) {
            merged.set(name, entry);
          }
        }
        // Last write wins if two ServerRoutes share a route.path (two
        // .server.* files claiming the same route); the route validator is
        // the right place to surface that.
        byPathMap.set(route.path, merged);
      })
    );

    // src/server registry modules have no route path, so they are the ONLY
    // entries in byModuleKey. The action handler falls back here when the
    // request URL's route map has no matching (name, moduleKey) entry.
    await Promise.all(
      registryModules.map(async (thunk) => {
        const mod = await load(thunk);
        for (const { name, entry } of extractActions(mod)) {
          let m = byModuleKeyMap.get(entry.moduleKey);
          if (!m) {
            m = new Map();
            byModuleKeyMap.set(entry.moduleKey, m);
          }
          m.set(name, entry);
        }
      })
    );

    return { byPathMap, byModuleKeyMap };
  };

  const built = (): Promise<Built> => {
    if (dev) return build();
    if (buildPromise) return buildPromise;
    buildPromise = build().catch((err) => {
      buildPromise = null;
      throw err;
    });
    return buildPromise;
  };

  return {
    async byPath(path: string): Promise<Map<string, ActionEntry>> {
      const { byPathMap } = await built();
      const pattern = findBestPattern(byPathMap.keys(), path);
      return pattern === null
        ? new Map<string, ActionEntry>()
        : (byPathMap.get(pattern) ?? new Map<string, ActionEntry>());
    },
    async byModuleKey(
      moduleKey: string,
      actionName: string
    ): Promise<ActionEntry | undefined> {
      const { byModuleKeyMap } = await built();
      return byModuleKeyMap.get(moduleKey)?.get(actionName);
    },
  };
}
