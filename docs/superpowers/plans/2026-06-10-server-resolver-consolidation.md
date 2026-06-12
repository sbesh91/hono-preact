# Server Resolver Consolidation (PR 2 of Section A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One route matcher and one resolver-factory core in the server package, replacing the byte-identical matcher copies and the structurally-twin factories in `route-server-modules.ts` and `page-action-resolvers.ts`.

**Architecture:** Two new internal modules. `route-pattern.ts` holds `urlPathMatchesPattern`, `patternScore`, and a new `findBestPattern` that encapsulates the scan-and-score loop both factories inline today. `route-module-resolvers.ts` holds `makeRouteModuleResolvers<TMod, TComposed, TExtra>`, owning the per-build thunk cache, the dev-rebuild gate with evict-on-failure caching, the ancestor walk, and the `byPath` best-pattern lookup; a strategy object owns composition (pageUse array concat vs action Map merge) and any side index (`extra`). The two public factories become thin wrappers with their exact current signatures. ZERO behavior change; no public surface change.

**Tech Stack:** TypeScript, vitest. Vitest config is repo-root-level: run tests FROM THE REPO ROOT, e.g. `pnpm exec vitest run packages/server/src/__tests__/route-pattern.test.ts` (running from inside a package dir finds no tests).

**Spec:** `docs/superpowers/specs/2026-06-10-semantics-consolidation-design.md` (PR 2 section)

**Branch:** `feat/server-resolver-consolidation`

**One deviation from the spec's wording:** the spec says the core owns "the moduleKey reverse map". The two factories' reverse maps have different shapes (`moduleKey -> pattern` vs `moduleKey -> actionName -> ActionEntry`) and different membership rules (pageUse indexes only the route's own module; actions index every contributing module), so one core-owned shape cannot serve both. The core instead provides the generic `extra` accumulator and each strategy builds its own index there. Same dedup outcome, honest about the asymmetry.

**Known subtlety to preserve, not fix:** `byPathMap` insertion order arises inside a `Promise.all` over `serverRoutes`, so the "first inserted" tiebreak depends on async completion order exactly as it does today. The core must keep the same `Promise.all(serverRoutes.map(...))` shape. Do not serialize the loop.

---

### Task 1: route-pattern module

**Files:**
- Create: `packages/server/src/route-pattern.ts`
- Test: `packages/server/src/__tests__/route-pattern.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/__tests__/route-pattern.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  urlPathMatchesPattern,
  patternScore,
  findBestPattern,
} from '../route-pattern.js';

describe('urlPathMatchesPattern', () => {
  it('matches literal segments exactly', () => {
    expect(urlPathMatchesPattern('/a/b', '/a/b')).toBe(true);
    expect(urlPathMatchesPattern('/a/c', '/a/b')).toBe(false);
  });

  it('matches :param segments against any value', () => {
    expect(urlPathMatchesPattern('/users/42', '/users/:id')).toBe(true);
    expect(urlPathMatchesPattern('/users', '/users/:id')).toBe(false);
  });

  it('requires equal segment counts absent a wildcard', () => {
    expect(urlPathMatchesPattern('/a/b/c', '/a/b')).toBe(false);
    expect(urlPathMatchesPattern('/a', '/a/b')).toBe(false);
  });

  it('a trailing * matches any remainder including none', () => {
    expect(urlPathMatchesPattern('/docs/a/b', '/docs/*')).toBe(true);
    expect(urlPathMatchesPattern('/docs', '/docs/*')).toBe(true);
  });

  it('ignores leading/trailing slashes via segment comparison', () => {
    expect(urlPathMatchesPattern('/a/b/', '/a/b')).toBe(true);
    expect(urlPathMatchesPattern('a/b', '/a/b')).toBe(true);
  });
});

describe('patternScore', () => {
  it('scores literal=2, param=1, wildcard=0 per segment', () => {
    expect(patternScore('/a/b')).toBe(4);
    expect(patternScore('/a/:id')).toBe(3);
    expect(patternScore('/a/*')).toBe(2);
    expect(patternScore('/')).toBe(0);
  });
});

describe('findBestPattern', () => {
  it('returns null when nothing matches', () => {
    expect(findBestPattern(['/a', '/b'], '/c')).toBeNull();
  });

  it('prefers higher specificity: literal beats param at the same depth', () => {
    expect(
      findBestPattern(['/admin/users/:id', '/admin/users/me'], '/admin/users/me')
    ).toBe('/admin/users/me');
  });

  it('prefers depth when scores tie', () => {
    // Both match '/a/b/c' with score 2 ('/a/*' = 2+0; '/:a/:b/*' = 1+1+0);
    // the deeper pattern wins regardless of iteration order.
    expect(findBestPattern(['/a/*', '/:a/:b/*'], '/a/b/c')).toBe('/:a/:b/*');
    expect(findBestPattern(['/:a/:b/*', '/a/*'], '/a/b/c')).toBe('/:a/:b/*');
  });

  it('keeps the first-seen pattern when score and depth both tie', () => {
    expect(findBestPattern(['/x/:a', '/:x/a'], '/x/a')).toBe('/x/:a');
    expect(findBestPattern(['/:x/a', '/x/:a'], '/x/a')).toBe('/:x/a');
  });

  it('accepts any iterable of patterns (Map keys)', () => {
    const m = new Map([
      ['/p/:id', 1],
      ['/p/new', 2],
    ]);
    expect(findBestPattern(m.keys(), '/p/new')).toBe('/p/new');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/server/src/__tests__/route-pattern.test.ts`
Expected: FAIL (module `../route-pattern.js` does not exist).

- [ ] **Step 3: Create the module**

Create `packages/server/src/route-pattern.ts`. The first three functions are EXACT moves of the byte-identical copies in `route-server-modules.ts:23-65` and `page-action-resolvers.ts:47-72` (doc comments taken from route-server-modules.ts, which has the richer ones); `findBestPattern` is the scan loop both factories inline today, lifted verbatim:

```ts
function segmentsOf(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

/**
 * True when `urlPath` (the concrete URL the user navigated to, with all
 * params substituted) matches `pattern` exactly: same segment count, and
 * each pattern segment either equals the URL segment, is a `:param`, or is
 * a trailing `*`.
 *
 * Used at lookup time. Callers resolve the URL to the most specific
 * pattern in their map via `findBestPattern`.
 */
export function urlPathMatchesPattern(
  urlPath: string,
  pattern: string
): boolean {
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

/**
 * Score a route pattern for tiebreaker purposes when multiple patterns at
 * the same segment depth match the URL. Mirrors preact-iso's runtime
 * preference for literal segments: literal=2, param=1, wildcard=0. Within
 * the same score, `findBestPattern` falls back to depth, and within the
 * same depth, to iteration order. Pre-merged literal wins over
 * `/admin/users/:id` when the URL is `/admin/users/me`.
 */
export function patternScore(pattern: string): number {
  let score = 0;
  for (const seg of segmentsOf(pattern)) {
    if (seg === '*') score += 0;
    else if (seg.startsWith(':')) score += 1;
    else score += 2;
  }
  return score;
}

/**
 * Pick the best-matching pattern for a concrete URL path. Tiebreaker:
 * (1) higher specificity score (literal=2, param=1, wildcard=0);
 * (2) within the same score, more segments; (3) within the same depth,
 * first in iteration order. Returns null when nothing matches.
 *
 * NOTE: O(patterns) linear scan. Fine for small apps; a precomputed trie
 * or a request-keyed memo would help at scale.
 */
export function findBestPattern(
  patterns: Iterable<string>,
  urlPath: string
): string | null {
  let bestPattern: string | null = null;
  let bestScore = -1;
  let bestDepth = -1;
  for (const pattern of patterns) {
    if (!urlPathMatchesPattern(urlPath, pattern)) continue;
    const score = patternScore(pattern);
    const depth = segmentsOf(pattern).length;
    if (score > bestScore || (score === bestScore && depth > bestDepth)) {
      bestPattern = pattern;
      bestScore = score;
      bestDepth = depth;
    }
  }
  return bestPattern;
}
```

`segmentsOf` stays module-private (no external consumer after this PR). Do NOT export this module from the server package index.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/server/src/__tests__/route-pattern.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/route-pattern.ts packages/server/src/__tests__/route-pattern.test.ts
git commit -m "feat(server): extract the single route-pattern matcher module

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: resolver core

**Files:**
- Create: `packages/server/src/route-module-resolvers.ts`
- Test: `packages/server/src/__tests__/route-module-resolvers.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/__tests__/route-module-resolvers.test.ts`. The fixtures build `ServerRoute` objects directly (`{ path, server, ancestors }` is the whole type) and use a trivial strategy that records loads:

```ts
import { describe, it, expect } from 'vitest';
import type { ServerRoute } from '@hono-preact/iso';
import { makeRouteModuleResolvers } from '../route-module-resolvers.js';

type TestMod = { tag?: string };

function countingThunk(tag: string, calls: { n: number }) {
  return () => {
    calls.n++;
    return Promise.resolve({ tag });
  };
}

/** Strategy that composes the loaded tags outer-first into one array. */
const tagStrategy = {
  createExtra: () => new Map<string, string>(),
  compose: (
    route: ServerRoute,
    ancestorMods: ReadonlyArray<TestMod>,
    selfMod: TestMod,
    extra: Map<string, string>
  ) => {
    const tags = [...ancestorMods, selfMod].map((m) => m.tag ?? '?');
    extra.set(route.path, tags.join('+'));
    return tags;
  },
};

describe('makeRouteModuleResolvers', () => {
  it('loads each distinct thunk exactly once per build (server + ancestor reuse)', async () => {
    const calls = { n: 0 };
    const layout = countingThunk('layout', calls);
    const leaf = countingThunk('leaf', calls);
    const routes: ServerRoute[] = [
      { path: '/g', server: layout, ancestors: [] },
      { path: '/g/leaf', server: leaf, ancestors: [layout] },
    ];
    const core = makeRouteModuleResolvers<TestMod, string[], Map<string, string>>(
      routes,
      {},
      tagStrategy
    );
    expect(await core.byPath('/g/leaf')).toEqual(['layout', 'leaf']);
    expect(calls.n).toBe(2);
  });

  it('caches the build across calls when dev is false', async () => {
    const calls = { n: 0 };
    const routes: ServerRoute[] = [
      { path: '/a', server: countingThunk('a', calls), ancestors: [] },
    ];
    const core = makeRouteModuleResolvers<TestMod, string[], Map<string, string>>(
      routes,
      {},
      tagStrategy
    );
    await core.byPath('/a');
    await core.byPath('/a');
    await core.built();
    expect(calls.n).toBe(1);
  });

  it('rebuilds on every call when dev is true', async () => {
    const calls = { n: 0 };
    const routes: ServerRoute[] = [
      { path: '/a', server: countingThunk('a', calls), ancestors: [] },
    ];
    const core = makeRouteModuleResolvers<TestMod, string[], Map<string, string>>(
      routes,
      { dev: true },
      tagStrategy
    );
    await core.byPath('/a');
    await core.byPath('/a');
    expect(calls.n).toBe(2);
  });

  it('does not cache a failed build: the next call retries and can succeed', async () => {
    let failOnce = true;
    const calls = { n: 0 };
    const flaky = () => {
      calls.n++;
      if (failOnce) {
        failOnce = false;
        return Promise.reject(new Error('transient import error'));
      }
      return Promise.resolve({ tag: 'ok' });
    };
    const routes: ServerRoute[] = [
      { path: '/a', server: flaky, ancestors: [] },
    ];
    const core = makeRouteModuleResolvers<TestMod, string[], Map<string, string>>(
      routes,
      {},
      tagStrategy
    );
    await expect(core.byPath('/a')).rejects.toThrow('transient import error');
    expect(await core.byPath('/a')).toEqual(['ok']);
    expect(calls.n).toBe(2);
  });

  it('byPath resolves through findBestPattern and returns undefined on no match', async () => {
    const calls = { n: 0 };
    const routes: ServerRoute[] = [
      { path: '/p/:id', server: countingThunk('param', calls), ancestors: [] },
      { path: '/p/new', server: countingThunk('lit', calls), ancestors: [] },
    ];
    const core = makeRouteModuleResolvers<TestMod, string[], Map<string, string>>(
      routes,
      {},
      tagStrategy
    );
    expect(await core.byPath('/p/new')).toEqual(['lit']);
    expect(await core.byPath('/p/42')).toEqual(['param']);
    expect(await core.byPath('/nope')).toBeUndefined();
  });

  it('built() exposes the byPathMap and the strategy-accumulated extra', async () => {
    const calls = { n: 0 };
    const layout = countingThunk('layout', calls);
    const routes: ServerRoute[] = [
      { path: '/g/leaf', server: countingThunk('leaf', calls), ancestors: [layout] },
    ];
    const core = makeRouteModuleResolvers<TestMod, string[], Map<string, string>>(
      routes,
      {},
      tagStrategy
    );
    const { byPathMap, extra } = await core.built();
    expect(byPathMap.get('/g/leaf')).toEqual(['layout', 'leaf']);
    expect(extra.get('/g/leaf')).toBe('layout+leaf');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/server/src/__tests__/route-module-resolvers.test.ts`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Create the module**

Create `packages/server/src/route-module-resolvers.ts`:

```ts
import type { ServerRoute } from '@hono-preact/iso';
import { findBestPattern } from './route-pattern.js';

/**
 * Shared core of the page-layer resolver factories (`makePageUseResolvers`
 * and `makePageActionResolvers`). Owns the lazy build lifecycle and the
 * URL-path lookup:
 *
 * - Loads every distinct server thunk exactly once per build. A given
 *   thunk may appear as `server` on one ServerRoute and as an `ancestor`
 *   on descendants; calling it just once keeps module-init side effects
 *   (e.g. logging, registry insertion) idempotent.
 * - Caches the built result for the process lifetime. A failed build is
 *   not cached (the next call retries), so a transient import error does
 *   not permanently poison the resolver. When `dev` is true the cache is
 *   bypassed on every call so editing a `.server.*` file takes effect
 *   without restarting the server.
 * - `byPath` resolves a concrete URL path (params substituted) to the
 *   most specific matching route pattern (see `findBestPattern`) and
 *   returns that route's composed value, or undefined when no pattern
 *   matches.
 *
 * The strategy owns everything route-shape-specific: how to compose one
 * route's value from its ancestor modules plus its own module (ancestors
 * arrive outermost-first, matching the middleware dispatcher's
 * outer -> inner contract), and any side index it accumulates during the
 * build (`extra`, e.g. a moduleKey reverse map).
 */
export function makeRouteModuleResolvers<TMod, TComposed, TExtra>(
  serverRoutes: ReadonlyArray<ServerRoute>,
  options: { dev?: boolean },
  strategy: {
    createExtra: () => TExtra;
    compose: (
      route: ServerRoute,
      ancestorMods: ReadonlyArray<TMod>,
      selfMod: TMod,
      extra: TExtra
    ) => TComposed;
  }
): {
  byPath: (path: string) => Promise<TComposed | undefined>;
  built: () => Promise<{ byPathMap: Map<string, TComposed>; extra: TExtra }>;
} {
  const dev = options.dev ?? false;

  type Built = { byPathMap: Map<string, TComposed>; extra: TExtra };
  let buildPromise: Promise<Built> | null = null;

  const build = async (): Promise<Built> => {
    const thunkCache = new Map<() => Promise<unknown>, Promise<TMod>>();
    const load = (thunk: () => Promise<unknown>): Promise<TMod> => {
      let p = thunkCache.get(thunk);
      if (!p) {
        // Structural read of a user-defined module's exports (a sanctioned
        // cast boundary); the strategy narrows the fields it actually reads.
        p = thunk().then((mod) => mod as TMod);
        thunkCache.set(thunk, p);
      }
      return p;
    };

    const byPathMap = new Map<string, TComposed>();
    const extra = strategy.createExtra();

    await Promise.all(
      serverRoutes.map(async (route) => {
        const ancestorMods = await Promise.all(route.ancestors.map(load));
        const selfMod = await load(route.server);
        // Two ServerRoutes sharing the same path mean two `.server.*` files
        // claim the same route, a route-table error. The route validator is
        // the right place to surface that; here last write wins, matching
        // the pre-consolidation factories.
        byPathMap.set(
          route.path,
          strategy.compose(route, ancestorMods, selfMod, extra)
        );
      })
    );

    return { byPathMap, extra };
  };

  const built = (): Promise<Built> => {
    if (dev) {
      // In dev, always rebuild so edits to any `.server.*` file take
      // effect on the next request without restarting the process.
      return build();
    }
    if (buildPromise) return buildPromise;
    buildPromise = build().catch((err) => {
      buildPromise = null;
      return Promise.reject(err);
    });
    return buildPromise;
  };

  return {
    built,
    async byPath(path: string) {
      const { byPathMap } = await built();
      const pattern = findBestPattern(byPathMap.keys(), path);
      return pattern === null ? undefined : byPathMap.get(pattern);
    },
  };
}
```

Do NOT export this module from the server package index.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/server/src/__tests__/route-module-resolvers.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/route-module-resolvers.ts packages/server/src/__tests__/route-module-resolvers.test.ts
git commit -m "feat(server): add makeRouteModuleResolvers, the shared resolver core

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: rewire makePageUseResolvers onto the core

**Files:**
- Modify: `packages/server/src/route-server-modules.ts`
- Test: existing `packages/server/src/__tests__/route-server-modules.test.ts` (staying green is the check; no edits expected)

- [ ] **Step 1: Rewrite the file**

Replace the contents of `packages/server/src/route-server-modules.ts` below the `routeServerModules` function (keep lines 1-21 as they are: the import, `routeServerModules`, and the `PageUseModule` type). Delete `segmentsOf`, `urlPathMatchesPattern`, and `patternScore` (now in route-pattern.ts). Keep `pageUseFromMod` unchanged. Replace `makePageUseResolvers` with:

```ts
import { makeRouteModuleResolvers } from './route-module-resolvers.js';
```

(add to the imports at the top), and:

```ts
/**
 * Build the two page-layer `use` resolvers wired into loadersHandler and
 * pageActionHandler. The loader handler matches by the location's URL path;
 * the action handler matches by the action's owning module key. Both
 * lookups share one underlying composed map populated by loading every
 * routed `.server.*` module exactly once (then caching the result).
 *
 * Ancestor composition: each ServerRoute carries an explicit list of
 * ancestor server thunks captured during the route-tree walk. The
 * resolver loads each ancestor's `pageUse` (if any) and concatenates them
 * outer-first, with the route's own pageUse appended last. So a layout
 * group's pageUse runs before each nested leaf's pageUse without the user
 * having to repeat the import in every leaf .server.*. Order matches the
 * middleware dispatcher's outer -> inner contract: app -> outermost
 * layout -> ... -> leaf -> per-unit.
 *
 * Why route-tree ancestry (not URL-prefix ancestry): two routes can share
 * a URL prefix without being parent/child in the tree. For example,
 * `/demo/projects` and `/demo/projects/:projectId/issues/:issueId` are
 * siblings of the `/demo` layout group; the latter is NOT a descendant of
 * the former. URL-prefix matching incorrectly conflates them and runs the
 * shared gate twice on every nested request.
 *
 * Build lifecycle (thunk dedup, evict-on-failure caching, dev rebuild)
 * and URL-path matching live in `makeRouteModuleResolvers`.
 *
 * NOTE: framework-private. The only intended consumer outside tests is
 * the generated server entry. Reach for it at your own risk.
 */
export function makePageUseResolvers(
  serverRoutes: ReadonlyArray<ServerRoute>,
  options: { dev?: boolean } = {}
): {
  byPath: (path: string) => Promise<ReadonlyArray<unknown>>;
  byModuleKey: (key: string) => Promise<ReadonlyArray<unknown>>;
} {
  const core = makeRouteModuleResolvers<
    PageUseModule,
    ReadonlyArray<unknown>,
    Map<string, string>
  >(serverRoutes, options, {
    createExtra: () => new Map<string, string>(),
    compose: (route, ancestorMods, selfMod, patternByModuleKey) => {
      const composed: unknown[] = [];
      for (const mod of ancestorMods) {
        composed.push(...pageUseFromMod(mod, route.path));
      }
      composed.push(...pageUseFromMod(selfMod, route.path));
      if (typeof selfMod.__moduleKey === 'string') {
        patternByModuleKey.set(selfMod.__moduleKey, route.path);
      }
      return composed;
    },
  });

  return {
    async byPath(path: string) {
      return (await core.byPath(path)) ?? [];
    },
    async byModuleKey(key: string) {
      const { byPathMap, extra } = await core.built();
      const pattern = extra.get(key);
      return pattern ? (byPathMap.get(pattern) ?? []) : [];
    },
  };
}
```

Behavior notes the rewrite must hold (all verified by the existing test suite):
- ancestors compose outer-first, self last (compose receives them in that order)
- `byPath` returns `[]` when no pattern matches
- `byModuleKey` returns `[]` for an unknown key
- the moduleKey index uses the route's OWN module key only (ancestors do not register)

- [ ] **Step 2: Run the existing suites**

Run: `pnpm exec vitest run packages/server/src/__tests__/route-server-modules.test.ts packages/server/src/__tests__/loaders-handler.test.ts packages/server/src/__tests__/middleware-chain.test.ts`
Expected: PASS unchanged.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter '@hono-preact/server' exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/route-server-modules.ts
git commit -m "refactor(server): makePageUseResolvers onto the shared resolver core

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: rewire makePageActionResolvers onto the core

**Files:**
- Modify: `packages/server/src/page-action-resolvers.ts`
- Test: existing `packages/server/src/__tests__/page-action-resolvers.test.ts` and `packages/server/src/__tests__/page-action-handler.test.ts` (staying green is the check)

- [ ] **Step 1: Rewrite the file**

In `packages/server/src/page-action-resolvers.ts`: keep the `ActionFn`/`ActionEntry`/`ServerModule` types and `extractActions` unchanged (lines 1-45). Delete `segmentsOf`, `urlPathMatchesPattern`, and `patternScore` (lines 47-72). Add the import:

```ts
import { makeRouteModuleResolvers } from './route-module-resolvers.js';
```

Replace `makePageActionResolvers` with:

```ts
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
    compose: (route, ancestorMods, selfMod, byModuleKeyMap) => {
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
      const { extra } = await core.built();
      return extra.get(moduleKey)?.get(actionName);
    },
  };
}
```

Behavior notes the rewrite must hold:
- ancestor actions register in the byModuleKey index too (unlike pageUse, every extracted entry registers under ITS OWN moduleKey)
- `byPath` returns an empty Map when no pattern matches
- same-name shadowing: self overwrites ancestor in the per-path merged Map

- [ ] **Step 2: Run the existing suites**

Run: `pnpm exec vitest run packages/server/src/__tests__/page-action-resolvers.test.ts packages/server/src/__tests__/page-action-handler.test.ts packages/server/src/__tests__/pe-form-no-js.integration.test.ts`
Expected: PASS unchanged.

- [ ] **Step 3: Full server suite + grep for stragglers**

Run: `pnpm exec vitest run packages/server/src`
Expected: PASS (143 pre-existing + 17 new from Tasks 1-2 = 160).

Run: `rg -n "urlPathMatchesPattern|patternScore|segmentsOf" packages/server/src --glob '!__tests__' --glob '!route-pattern.ts'`
Expected: no hits (the only definitions live in route-pattern.ts).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/page-action-resolvers.ts
git commit -m "refactor(server): makePageActionResolvers onto the shared resolver core

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification (CI mirror)

**Files:** none (verification only)

- [ ] **Step 1: Run the six CI steps in order, from the repo root**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all six PASS. If `format:check` fails, run `pnpm format`, re-run, and commit the formatting. Never pipe test output through `| tail` in a way that masks the exit code.

- [ ] **Step 2: Commit any formatting fallout**

```bash
git add -A
git commit -m "chore: pnpm format

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip if clean.)

---

### Task 6: PR

- [ ] **Step 1: Push and open the PR** (only after every Task 5 step passed)

```bash
git push -u origin feat/server-resolver-consolidation
gh pr create --title "refactor(server): single route matcher + shared resolver core" --body "$(cat <<'EOF'
PR 2 of 3 for Section A of the primitives DX review (spec: docs/superpowers/specs/2026-06-10-semantics-consolidation-design.md).

- One route matcher: the byte-identical `segmentsOf`/`urlPathMatchesPattern`/`patternScore` copies in route-server-modules.ts and page-action-resolvers.ts collapse into `route-pattern.ts`, plus `findBestPattern` encapsulating the scan-and-score loop both factories inlined.
- One resolver core: `makeRouteModuleResolvers<TMod, TComposed, TExtra>` owns the thunk cache, evict-on-failure build caching, dev rebuild, ancestor walk, and byPath lookup; `makePageUseResolvers` and `makePageActionResolvers` are thin strategy wrappers with their exact previous signatures.
- Zero behavior change; zero public-surface change (the boundary redraw is Section B). New direct tests for the matcher tiebreakers and the core's cache/dev/eviction semantics, which were previously tested only indirectly, twice.

PR 3 (shared cross-package constants module) follows.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Deep PR review**

Per the project PR workflow, immediately run a deep review as the first post-open step, including replacement parity: enumerate the behaviors of the two pre-PR factories from the deletion diff (thunk dedup scope, eviction, dev gate, tiebreak order, empty-result defaults, moduleKey index membership differences between the twins) and verify each in the new code.
