import type { ServerRoute } from '@hono-preact/iso';
import { subtreePatternOf } from '@hono-preact/iso/internal/runtime';

/**
 * A route-bound loader/action stamps its declared route pattern onto the export
 * as a non-enumerable `__routeId` (`serverRoute(r).loader` / `.action`). Read it
 * structurally; bare units leave it `undefined`.
 */
type RouteBoundExport = { __routeId?: unknown };
type SelfModule = {
  serverLoaders?: unknown;
  serverActions?: unknown;
};

const CONTAINERS = [
  ['serverLoaders', 'loader'],
  ['serverActions', 'action'],
] as const;

function readExports(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export type BoundUnitKind = 'loader' | 'action';

export type AliasedBindingInfo = {
  kind: BoundUnitKind;
  name: string;
  /** The exact pattern the unit is bound to (the page scope). */
  routeId: string;
  /** The sibling subtree pattern (the subtree scope). */
  subtreeId: string;
};

export type RouteBindingCheckContext = {
  /**
   * Every routeUse pattern mapped to its composed page-use chain
   * (`new Map(routes.routeUse.map((r) => [r.path, r.use]))`). Key presence
   * validates bindings (`byPattern` fails open on a miss, so a bound
   * pattern must be a real key); the chain values feed the dev-only
   * aliasing diagnostic.
   */
  routeUseByPattern: ReadonlyMap<string, ReadonlyArray<unknown>>;
  /**
   * Dev-only observer: called for each exact-path binding whose sibling
   * subtree key carries a strict PREFIX of the exact chain (the deepest-wins
   * exact entry was widened by the index child's own `use`). Purely
   * diagnostic, never feeds guard resolution. Omit in prod for zero cost.
   */
  onAliasedBinding?: (info: AliasedBindingInfo) => void;
};

// True when `exact` extends `subtree` with extra members appended: the index
// child declared its own `use` on top of the layout's composed chain (the
// aliasing signal). `composeUse` appends, so index-child widening is always a
// prefix extension.
function chainStrictlyExtends(
  exact: ReadonlyArray<unknown>,
  subtree: ReadonlyArray<unknown>
): boolean {
  return (
    exact.length > subtree.length && subtree.every((m, i) => m === exact[i])
  );
}

// Dev-only observational check behind ctx.onAliasedBinding. Both entries come
// from the same collectRouteUse walk; the exact chain strictly extending the
// sibling subtree chain is the aliasing signal (index-child widening), and
// only that direction is reported. When the chains diverge the other way (a
// literal `path: '*'` catch-all child overwrote the subtree key with a WIDER
// chain), the exact binding already runs exactly the page's own chain, no
// spelling would improve it, and the aliasing message's explanation would be
// inverted, so we stay silent.
function maybeReportAliasedBinding(
  kind: BoundUnitKind,
  name: string,
  routeId: string,
  ctx: RouteBindingCheckContext
): void {
  if (!ctx.onAliasedBinding || routeId.endsWith('/*')) return;
  const subtreeId = subtreePatternOf(routeId);
  const exact = ctx.routeUseByPattern.get(routeId);
  const subtree = ctx.routeUseByPattern.get(subtreeId);
  if (exact === undefined || subtree === undefined) return;
  if (!chainStrictlyExtends(exact, subtree)) return;
  ctx.onAliasedBinding({ kind, name, routeId, subtreeId });
}

/**
 * Fail closed at boot if any route-bound loader/action declares a route other
 * than the one its module is registered on.
 *
 * A route-bound unit resolves its page-level `use` (auth) chain by its declared
 * `__routeId` pattern (`makePageUseResolver.byPattern`), NOT by the request URL.
 * That lookup fails OPEN on a key miss, and a routeId that points at a different
 * route resolves that route's gates. Either way a misbound unit can run under a
 * weaker (or empty) gate chain than the route it is actually reachable from. The
 * binding is only correct when `__routeId` equals the path of the route node the
 * module is mounted on (`route.path`), which is also the invariant `byPattern`
 * relies on to resolve a real `routeUse` entry. We assert it once here so a
 * misconfiguration surfaces as a loud startup error instead of a silently
 * dropped auth gate at request time.
 *
 * Bare units (no `__routeId`) are skipped: they resolve page-use by request URL
 * and carry no binding to check.
 *
 * A module mounted on a children-bearing node may alternatively bind its
 * subtree pattern (subtreePatternOf(route.path), so the root's is '/*'),
 * which must exist as a routeUse key; a
 * wildcard on a childless path fails here rather than resolving an empty
 * chain at request time.
 *
 * NOTE: framework-private. The only intended consumer is the generated server
 * entry, which awaits this before serving the loaders RPC and action POST paths.
 */
export async function assertRouteBindingsMatchMount(
  serverRoutes: ReadonlyArray<ServerRoute>,
  ctx: RouteBindingCheckContext
): Promise<void> {
  await Promise.all(
    serverRoutes.map(async (route) => {
      // Structural read of a user-defined module's exports (a sanctioned cast
      // boundary); only the server-unit containers and their `__routeId` are read.
      const mod = (await route.server()) as SelfModule;
      const subtreeId = subtreePatternOf(route.path);
      for (const [container, kind] of CONTAINERS) {
        const exports = readExports(mod[container]);
        if (!exports) continue;
        for (const [name, value] of Object.entries(exports)) {
          const routeId = (value as RouteBoundExport).__routeId;
          if (typeof routeId !== 'string') continue;
          if (routeId === route.path) {
            maybeReportAliasedBinding(kind, name, routeId, ctx);
            continue;
          }
          if (routeId === subtreeId) {
            if (ctx.routeUseByPattern.has(subtreeId)) continue;
            throw new Error(
              `Route-bound ${kind} '${name}' binds the subtree pattern '${subtreeId}', ` +
                `but route '${route.path}' has no child routes, so no subtree entry ` +
                `exists and the binding would resolve an empty page-level \`use\` ` +
                `chain. Bind serverRoute('${route.path}') for the route itself, or ` +
                `give '${route.path}' children to make its subtree bindable.`
            );
          }
          throw new Error(
            `Route-bound ${kind} '${name}' is bound to route '${routeId}', but its ` +
              `module is registered on route '${route.path}'. A route-bound ${kind} must ` +
              `use serverRoute('${route.path}') (the page scope) or ` +
              `serverRoute('${subtreeId}') (the subtree scope, when the route has child ` +
              `routes) to match the route it is mounted on; otherwise it resolves its ` +
              `page-level \`use\` (auth) chain from the wrong route.`
          );
        }
      }
    })
  );
}

/**
 * Fail closed at boot if a `src/server` registry module has a route-bound
 * (`serverRoute(r).loader` / `.action`) unit whose route is not real.
 *
 * A registry module is not attached to a route node, so a route-bound unit in
 * it resolves its page-level `use` (auth) chain by `byPattern(__routeId)`. That
 * lookup fails OPEN (empty chain) on a miss, so a `__routeId` that does not name
 * a real route pattern would run the unit under NO gates. routeUse carries an
 * entry for every bindable pattern, exact and subtree (see iso
 * `collectRouteUse`), so we require the `__routeId` to be one of those keys; a
 * real pattern always resolves its composed gate chain, and a typo / stale
 * pattern fails loudly here instead of silently dropping auth at request time.
 *
 * Bare units (no `__routeId`) are route-less and skipped; they resolve page-use
 * by request URL.
 *
 * NOTE: framework-private. Consumed by the generated server entry alongside
 * {@link assertRouteBindingsMatchMount}.
 */
export async function assertRegistryRouteBindingsValid(
  registry: ReadonlyArray<() => Promise<unknown>>,
  ctx: RouteBindingCheckContext
): Promise<void> {
  await Promise.all(
    registry.map(async (load) => {
      // Structural read of a user-defined module's exports (a sanctioned cast
      // boundary); only the server-unit containers and their `__routeId` are read.
      const mod = (await load()) as SelfModule;
      for (const [container, kind] of CONTAINERS) {
        const exports = readExports(mod[container]);
        if (!exports) continue;
        for (const [name, value] of Object.entries(exports)) {
          const routeId = (value as RouteBoundExport).__routeId;
          if (typeof routeId !== 'string') continue;
          if (!ctx.routeUseByPattern.has(routeId)) {
            throw new Error(
              `Route-bound ${kind} '${name}' in the src/server registry is bound to ` +
                `route '${routeId}', which is not a route in your route table. A ` +
                `serverRoute('${routeId}') unit must target a real route pattern so it ` +
                `resolves that route's page-level \`use\` (auth) chain; otherwise it would ` +
                `run under no gates. Fix the pattern to match a route in routes.ts (an ` +
                `exact pattern like '/movies/:id', or a subtree pattern like '/movies/*' ` +
                `for a node with child routes), or move the unit to that route's module.`
            );
          }
          maybeReportAliasedBinding(kind, name, routeId, ctx);
        }
      }
    })
  );
}

/**
 * Dev-only console warning for an aliased exact-path binding, fired through
 * `RouteBindingCheckContext.onAliasedBinding`. One warning per binding key
 * for the life of the `warned` set the caller owns (the generated entry
 * re-runs boot checks per request in dev; the set dedups across runs).
 *
 * NOTE: framework-private. The only intended consumer is the generated
 * server entry.
 */
export function warnAliasedLayoutBinding(
  warned: Set<string>,
  info: AliasedBindingInfo
): void {
  const key = `${info.kind}:${info.name}@${info.routeId}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `hono-preact: ${info.kind} '${info.name}' is bound to '${info.routeId}', ` +
      `the page scope for that pattern: its RPC runs the deepest composed ` +
      `chain, which includes the index child's own 'use' on top of the ` +
      `layout's chain. For subtree-scoped (layout shell) data, bind ` +
      `serverRoute('${info.subtreeId}') instead: the subtree scope runs the ` +
      `layout node's own composed chain without the index child's additions. ` +
      `Register your routes in the tree form ({ tree: typeof routeTree }) to ` +
      `have every subtree spelling typed. Keep '${info.routeId}' if this ` +
      `${info.kind} should run the index page's full gate chain.`
  );
}
