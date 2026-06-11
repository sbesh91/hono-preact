import type { ServerRoute } from '@hono-preact/iso';
import { makeRouteModuleResolvers } from './route-module-resolvers.js';

type ActionFn = (ctx: unknown, payload: unknown) => Promise<unknown>;

export type ActionEntry = {
  fn: ActionFn;
  use: ReadonlyArray<unknown>;
  timeoutMs?: number | false;
  moduleKey: string;
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
    };
    out.push({
      name,
      entry: {
        fn: val as ActionFn,
        use: metadata.use ?? [],
        timeoutMs: metadata.timeoutMs,
        moduleKey,
      },
    });
  }
  return out;
}

/**
 * Build action resolvers keyed by route path and by module key. Each
 * ServerRoute contributes its own serverActions and its ancestors' serverActions
 * to the merged map for that path. Ancestor entries are written first so that
 * a page-level action shadows a same-named layout action when names collide.
 *
 * Build lifecycle (thunk dedup, evict-on-failure caching, dev rebuild)
 * and URL-path matching live in `makeRouteModuleResolvers`.
 *
 * NOTE: framework-private. Intended consumer is the generated server entry and
 * pageActionHandler.
 */
export function makePageActionResolvers(
  serverRoutes: ReadonlyArray<ServerRoute>,
  options: { dev?: boolean } = {}
): {
  byPath: (path: string) => Promise<Map<string, ActionEntry>>;
  byModuleKey: (
    moduleKey: string,
    actionName: string
  ) => Promise<ActionEntry | undefined>;
} {
  const core = makeRouteModuleResolvers<
    ServerModule,
    Map<string, ActionEntry>,
    Map<string, Map<string, ActionEntry>>
  >(serverRoutes, options, {
    createExtra: () => new Map<string, Map<string, ActionEntry>>(),
    compose: (_route, ancestorMods, selfMod, byModuleKeyMap) => {
      const merged = new Map<string, ActionEntry>();
      // Write ancestors first (outer -> inner), then self. Later writes
      // shadow earlier ones, so a page-level action wins over a layout
      // action of the same name.
      for (const mod of [...ancestorMods, selfMod]) {
        for (const { name, entry } of extractActions(mod)) {
          merged.set(name, entry);
          let m = byModuleKeyMap.get(entry.moduleKey);
          if (!m) {
            m = new Map();
            byModuleKeyMap.set(entry.moduleKey, m);
          }
          m.set(name, entry);
        }
      }
      return merged;
    },
  });

  return {
    async byPath(path: string): Promise<Map<string, ActionEntry>> {
      return (await core.byPath(path)) ?? new Map<string, ActionEntry>();
    },
    async byModuleKey(
      moduleKey: string,
      actionName: string
    ): Promise<ActionEntry | undefined> {
      const { extra: byModuleKeyMap } = await core.built();
      return byModuleKeyMap.get(moduleKey)?.get(actionName);
    },
  };
}
