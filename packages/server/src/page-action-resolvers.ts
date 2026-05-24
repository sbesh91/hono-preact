import type { ServerRoute } from '@hono-preact/iso';

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

function segmentsOf(p: string): string[] {
  return p.split('/').filter((s) => s !== '');
}

function urlPathMatchesPattern(urlPath: string, pattern: string): boolean {
  const ps = segmentsOf(pattern);
  const us = segmentsOf(urlPath);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p === '*') return true;
    if (i >= us.length) return false;
    if (p.startsWith(':')) continue;
    if (p !== us[i]) return false;
  }
  return ps.length === us.length;
}

function patternScore(pattern: string): number {
  let score = 0;
  for (const seg of segmentsOf(pattern)) {
    if (seg === '*') score += 0;
    else if (seg.startsWith(':')) score += 1;
    else score += 2;
  }
  return score;
}

/**
 * Build action resolvers keyed by route path and by module key. Each
 * ServerRoute contributes its own serverActions and its ancestors' serverActions
 * to the merged map for that path. Ancestor entries are written first so that
 * a page-level action shadows a same-named layout action when names collide.
 *
 * Lazy semantics: the first call triggers loading all server modules. The result
 * is cached for the process lifetime (unless dev=true, which rebuilds on every
 * call so edits take effect without restarting the server).
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
  const dev = options.dev ?? false;

  type Built = {
    byPathMap: Map<string, Map<string, ActionEntry>>;
    byModuleKeyMap: Map<string, Map<string, ActionEntry>>;
  };
  let buildPromise: Promise<Built> | null = null;

  const build = async (): Promise<Built> => {
    // Load each distinct server thunk once; a thunk may appear as `server`
    // on one route and as an `ancestor` on its children.
    const thunkCache = new Map<
      () => Promise<unknown>,
      Promise<ServerModule>
    >();
    const load = (thunk: () => Promise<unknown>): Promise<ServerModule> => {
      let p = thunkCache.get(thunk);
      if (!p) {
        p = thunk().then((m) => m as ServerModule);
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
        byPathMap.set(route.path, merged);
      })
    );

    return { byPathMap, byModuleKeyMap };
  };

  const get = (): Promise<Built> => {
    if (dev) return build();
    if (buildPromise) return buildPromise;
    buildPromise = build().catch((err) => {
      buildPromise = null;
      return Promise.reject(err);
    });
    return buildPromise;
  };

  return {
    async byPath(path: string): Promise<Map<string, ActionEntry>> {
      const { byPathMap } = await get();
      let bestPattern: string | null = null;
      let bestScore = -1;
      let bestDepth = -1;
      for (const pattern of byPathMap.keys()) {
        if (!urlPathMatchesPattern(path, pattern)) continue;
        const score = patternScore(pattern);
        const depth = segmentsOf(pattern).length;
        if (score > bestScore || (score === bestScore && depth > bestDepth)) {
          bestPattern = pattern;
          bestScore = score;
          bestDepth = depth;
        }
      }
      return bestPattern ? (byPathMap.get(bestPattern) ?? new Map()) : new Map();
    },
    async byModuleKey(
      moduleKey: string,
      actionName: string
    ): Promise<ActionEntry | undefined> {
      const { byModuleKeyMap } = await get();
      return byModuleKeyMap.get(moduleKey)?.get(actionName);
    },
  };
}
