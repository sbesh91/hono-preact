import type { ServerRoute } from '@hono-preact/iso';
import {
  subtreePatternOf,
  requiredParamSlots,
  declaredParamSlots,
  isConformingParamSegment,
} from '@hono-preact/iso/internal/runtime';

/**
 * A route-bound server unit (loader, action, socket, or room) stamps its
 * declared route pattern onto the export as `__routeId`. Read it
 * structurally; bare units leave it `undefined`.
 */
type RouteBoundExport = { __routeId?: unknown };
type SelfModule = {
  serverLoaders?: unknown;
  serverActions?: unknown;
  serverSockets?: unknown;
  serverRooms?: unknown;
};

const CONTAINERS = [
  ['serverLoaders', 'loader'],
  ['serverActions', 'action'],
  ['serverSockets', 'socket'],
  ['serverRooms', 'room'],
] as const;

function readExports(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export type BoundUnitKind = 'loader' | 'action' | 'socket' | 'room';

export type AliasedBindingInfo = {
  kind: BoundUnitKind;
  name: string;
  /** The exact pattern the unit is bound to (the page scope). */
  routeId: string;
  /** The sibling subtree pattern (the subtree scope). */
  subtreeId: string;
};

export type RoomParamBindingInfo = {
  name: string;
  /** The room's effective owning route pattern (declared __routeId or mount). */
  routeId: string;
  /** The route params the channel satisfies, in pattern order. */
  params: string[];
};

export type RoomParamExemptionInfo = {
  name: string;
  /** The room's effective owning route pattern (declared __routeId or mount). */
  routeId: string;
  /** The channel name pattern the route's params were checked against. */
  channelName: string;
  /** The route params NOT satisfied by the channel key. */
  params: string[];
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
   * `appConfig.use` (the outermost tier `composeServerChain` composes:
   * `[...appConfig.use, ...pageUse, ...def.use]`). Fed the SAME
   * `location.pathParams` as the page and def tiers, so a room's route/channel
   * congruence check must treat this tier as live too, not just page-use.
   * Defaults to an empty array when omitted (a guard-less app). Tier
   * liveness only counts entries with `runs === 'server'` (see
   * `serverTierSize`): `composeServerChain` filters to server middleware
   * before running the chain, so a client-scope middleware or a
   * `StreamObserver` in this array can never read `pathParams` and must not
   * count as a live guard.
   */
  appUse?: ReadonlyArray<unknown>;
  /**
   * Dev-only observer: called for each exact-path binding whose sibling
   * subtree key carries a strict PREFIX of the exact chain (the deepest-wins
   * exact entry was widened by the index child's own `use`). Purely
   * diagnostic, never feeds guard resolution. Omit in prod for zero cost.
   */
  onAliasedBinding?: (info: AliasedBindingInfo) => void;
  /**
   * Dev-only observer fired once per param-bearing room binding after
   * congruence holds: the room's route params are being satisfied by the
   * channel key of the same name. Purely diagnostic. Omit in prod.
   */
  onRoomParamBinding?: (info: RoomParamBindingInfo) => void;
  /**
   * Dev-only observer fired when a room's route/channel param mismatch is
   * exempted from the boot throw because all three guard tiers (app-use,
   * page-use, and the room's own use) are empty today. Purely diagnostic:
   * names the params a guard added to ANY of those three tiers later would
   * read as `undefined`. Omit in prod.
   */
  onRoomParamExemption?: (info: RoomParamExemptionInfo) => void;
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

// Read a room export's channel name pattern structurally (a sanctioned read of
// a user module export). A non-room unit or a channel-less value yields null.
function channelNameOf(value: unknown): string | null {
  const name = (value as { channel?: { name?: unknown } }).channel?.name;
  return typeof name === 'string' ? name : null;
}

// Read a room export's OWN `use` chain structurally (the same sanctioned
// user-module-export read as channelNameOf). This is the innermost of the
// three tiers composeServerChain feeds the same pathParams to
// (`[...appConfig.use, ...pageUse, ...def.use]`), so the room's own guard
// chain is just as live a hazard as a page-level one. A missing or
// non-array `use` yields an empty tier (no guard).
function defUseOf(value: unknown): ReadonlyArray<unknown> {
  const use = (value as { use?: unknown }).use;
  return Array.isArray(use) ? use : [];
}

// The first segment of `routeId` that carries a ':' anywhere in it (not just
// at the segment's start) but does not conform to the shared param grammar
// (`isConformingParamSegment`), or undefined if every segment conforms.
function nonConformingRouteSegment(routeId: string): string | undefined {
  return routeId
    .split('/')
    .find((seg) => seg.includes(':') && !isConformingParamSegment(seg));
}

/**
 * Fail closed at boot if a route-BOUND socket or room (`__routeId` set)
 * declares a route with a non-conforming `:`-segment (e.g. `:board-id`, a
 * hyphen; or `board:boardId`, a colon not at the segment's start).
 *
 * preact-iso's own runtime route matcher (`exec`) binds such a segment fine
 * at HTTP request time (it accepts any param name, hyphens included), but
 * `requiredParamSlots`/`declaredParamSlots` (the grammar this framework's
 * realtime layer relies on) do not recognize it as a param, so a bound
 * socket/room would require nothing, resolve an empty params object, and
 * hand its page-use guard `{}` for a param the SAME guard sees populated
 * over plain HTTP. This is the route-side twin of `defineChannel`'s own
 * definition-time check (define-channel.ts): both reuse
 * `isConformingParamSegment` so the two validators cannot drift.
 *
 * SCOPED to `socket`/`room` only. Loaders and actions are unaffected: they
 * read `ctx.location.pathParams` from the request URL via the SAME wider
 * `exec` matcher that resolved the route, so their param names already line
 * up and a hyphenated route param works correctly for them today. An
 * existing app may have a perfectly ordinary HTTP route like
 * `/board/:board-id`; only a `serverRoute(r).socket`/`.room` binding on such
 * a route is rejected. `serverRoute(r).socket`/`.room` shipped in
 * `hono-preact@0.10.1`, so this throw is a recorded breaking change (see the
 * v0.11 release-notes breaking-change record), not a pre-release tightening:
 * a released app that bound a socket/room to a non-conforming route param
 * now fails its boot instead of silently running that unit with an empty
 * params object. A colocated (unbound) socket/room carries no `__routeId`
 * and is never passed to this function.
 */
function assertConformingBoundRouteId(
  kind: BoundUnitKind,
  name: string,
  routeId: string
): void {
  if (kind !== 'socket' && kind !== 'room') return;
  const badSegment = nonConformingRouteSegment(routeId);
  if (badSegment === undefined) return;
  throw new Error(
    `Route-bound ${kind} '${name}' binds route '${routeId}', but its segment ` +
      `'${badSegment}' is not a conforming ':param' spelling. A route-bound ` +
      `${kind} resolves its params via 'requiredParamSlots'/'declaredParamSlots', ` +
      `which only recognize ':name' where 'name' is one or more of ` +
      `[A-Za-z0-9_], optionally followed by a single '?', '*', or '+' modifier ` +
      `(e.g. ':id', ':id?', ':rest*', ':rest+'). Left unrejected, this ${kind} ` +
      `would require no params, resolve an empty params object, and pass its ` +
      `page-use guard '{}' for a param the same guard sees populated over plain ` +
      `HTTP. Rename the route segment so it only uses letters, digits, and ` +
      `underscores.`
  );
}

// True for a structurally well-formed Middleware entry (server or client)
// whose `runs` discriminant is `'server'`. `composeServerChain` filters a
// tier to `m.runs === 'server'` before running it (compose-server-chain.ts),
// so a client-scope middleware, a logger, or a StreamObserver (which carries
// no `runs` field at all) never actually executes server-side and could
// never read `ctx.location.pathParams`. Reads `use` entries structurally,
// the same sanctioned read as `channelNameOf`/`defUseOf` above: a tier is
// read off a user-defined module (or `appConfig`) as `ReadonlyArray<unknown>`.
function isServerMiddleware(entry: unknown): boolean {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    (entry as { __kind?: unknown }).__kind === 'middleware' &&
    (entry as { runs?: unknown }).runs === 'server'
  );
}

// The count of SERVER middleware in a `use` tier: the tier-liveness unit
// `assertRoomChannelCongruent`'s three-guard-tier exemption counts, rather
// than raw array length (see `isServerMiddleware`).
function serverTierSize(tier: ReadonlyArray<unknown>): number {
  return tier.filter(isServerMiddleware).length;
}

/**
 * Fail closed when a room's effective owning route declares a `:param` the
 * channel cannot guarantee, AND at least one of the three guard tiers
 * `composeServerChain` feeds the same `pathParams` to is live: app-use
 * (`appConfig.use`), page-use (the route's own composed chain), and the
 * room's own `use`. A guard in ANY of those tiers COULD read the missing
 * param via `ctx.location.pathParams`, so an absent value there is a real
 * hazard regardless of which tier the guard lives in. No-op for a non-room
 * unit or a route with no declared params at all.
 *
 * The guard-readable namespace is checked under TWO conditions, both
 * required for congruence:
 *
 * 1. **Name coverage:** every param the route DECLARES (`declaredParamSlots`,
 *    which includes optional `?` and rest `*`/`+` slots) must also be a param
 *    the channel declares. preact-iso's runtime matcher (`exec`) binds an
 *    optional or rest route param over HTTP just as readily as a required
 *    one, and a guard reads `ctx.location.pathParams` the same way regardless
 *    of the modifier, so a route param `requiredParamSlots` excludes (because
 *    it is optional or rest-zero-or-more) is not exempt from this check: it
 *    is exactly as guard-readable as a required one, just not guaranteed
 *    present.
 * 2. **Presence guarantee:** every param the route REQUIRES
 *    (`requiredParamSlots`) must also be a param the channel REQUIRES. A
 *    channel param declared but only optional/rest cannot guarantee a
 *    required route param is present: an absent client-supplied slot
 *    resolves to `undefined` at connection time, so a guard keyed on it would
 *    misread a value the route promises is always there.
 *
 * The throw is exempted only when ALL THREE guard tiers are empty (not the
 * whole check: the declared-params early-return above is unconditional). A
 * room deliberately independent of its mount route's params, e.g.
 * `defineChannel('global-chat')` colocated on `/board/:id` with no live
 * app-use, page-use, or def.use, is a real, working v0.9/v0.10
 * configuration: no guard anywhere could ever read the missing param today,
 * so there is nothing for this rule to protect and no reason to fail the
 * boot. The exemption still fires a dev-only advisory (`onRoomParamExemption`),
 * since a guard added LATER to any of the three tiers would silently read
 * the missing param as `undefined`. Tier liveness counts only SERVER
 * middleware (`serverTierSize`), not raw array length.
 *
 * A route segment outside the supported `:[A-Za-z0-9_]+` param class (e.g. a
 * hyphenated `:board-id`) is invisible to `declaredParamSlots`, so
 * `declaredParamSlots(routeId)` is empty for such a route and this check
 * early-returns just as it would for a genuinely param-less route. That is
 * intentional, not a gap this function is meant to close: preact-iso's own
 * `exec` matcher still binds that segment fine over HTTP, but its value never
 * reaches `pathParams` for a REALTIME connection (rooms/sockets resolve
 * params via `requiredParamSlots`/`declaredParamSlots`, not `exec`), so a
 * room guard must not rely on such a param. A route-BOUND socket/room on a
 * non-conforming route is separately rejected at boot by
 * `assertConformingBoundRouteId`; a colocated room is not (see that
 * function's own doc), which is why this early-return exists at all.
 */
function assertRoomChannelCongruent(
  name: string,
  routeId: string,
  channelName: string,
  defUse: ReadonlyArray<unknown>,
  ctx: RouteBindingCheckContext
): void {
  const routeDeclared = declaredParamSlots(routeId);
  if (routeDeclared.length === 0) return;
  const channelDeclared = new Set(declaredParamSlots(channelName));
  const routeRequired = requiredParamSlots(routeId);
  const channelRequired = new Set(requiredParamSlots(channelName));

  // Condition 1: a route param the channel does not even declare is
  // unreachable there under any spelling.
  const undeclared = routeDeclared.filter((p) => !channelDeclared.has(p));
  // Condition 2: a route param the channel DOES declare, but only as
  // optional/rest, cannot guarantee a REQUIRED route param is present.
  // Disjoint from `undeclared` by construction (only checks params that
  // passed condition 1).
  const notGuaranteed = routeRequired.filter(
    (p) => channelDeclared.has(p) && !channelRequired.has(p)
  );
  const missing = [...undeclared, ...notGuaranteed];

  if (missing.length > 0) {
    const appUse = ctx.appUse ?? [];
    const pageUse = ctx.routeUseByPattern.get(routeId) ?? [];
    const liveTiers =
      serverTierSize(appUse) + serverTierSize(pageUse) + serverTierSize(defUse);
    if (liveTiers === 0) {
      ctx.onRoomParamExemption?.({
        name,
        routeId,
        channelName,
        params: missing,
      });
      return;
    }
    const parts: string[] = [];
    if (undeclared.length > 0) {
      parts.push(
        `its route param${undeclared.length > 1 ? 's' : ''} ` +
          `${undeclared.join(', ')} ${undeclared.length > 1 ? 'are' : 'is'} ` +
          `not a key of channel '${channelName}'`
      );
    }
    if (notGuaranteed.length > 0) {
      parts.push(
        `its route param${notGuaranteed.length > 1 ? 's' : ''} ` +
          `${notGuaranteed.join(', ')} ${notGuaranteed.length > 1 ? 'are' : 'is'} ` +
          `only an optional or rest key in channel '${channelName}', not a ` +
          `required one`
      );
    }
    throw new Error(
      `Route-bound room '${name}' binds route '${routeId}', but ` +
        `${parts.join('; and ')}. A room's guard chain (app-use, page-use, or ` +
        `the room's own use) reads route params from the channel key, so ` +
        `every route param the route declares must be a channel param of the ` +
        `same name, and every route param the route REQUIRES must be a ` +
        `REQUIRED channel param (an optional '?' or rest-zero-or-more '*' ` +
        `channel slot can be absent at runtime, so it cannot guarantee a ` +
        `required route param). Rename the channel or route param(s) to ` +
        `match, make the channel slot required, bind the room to a route ` +
        `whose params the channel supplies, or move the room into a ` +
        `src/server registry module: a registry room carries no __routeId, ` +
        `is route-independent, and skips this check entirely.`
    );
  }
  ctx.onRoomParamBinding?.({ name, routeId, params: routeRequired });
}

/**
 * Dev-only console advisory for a param-bearing room binding, fired through
 * `RouteBindingCheckContext.onRoomParamBinding`. One per binding for the life
 * of the `warned` set the caller owns.
 */
export function warnRoomParamBinding(
  warned: Set<string>,
  info: RoomParamBindingInfo
): void {
  const key = `${info.name}@${info.routeId}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `hono-preact: room '${info.name}' bound to '${info.routeId}': route ` +
      `param${info.params.length > 1 ? 's' : ''} ${info.params.join(', ')} ` +
      `${info.params.length > 1 ? 'are' : 'is'} satisfied by the channel key ` +
      `of the same name. Confirm the route and channel denote the same ` +
      `resource; the room's guard authorizes on the channel key, not the ` +
      `page URL.`
  );
}

/**
 * Dev-only console advisory for a room's route/channel param mismatch that was
 * exempted from the boot throw (all three guard tiers empty today), fired
 * through `RouteBindingCheckContext.onRoomParamExemption`. One per binding for
 * the life of the `warned` set the caller owns.
 */
export function warnRoomParamExemption(
  warned: Set<string>,
  info: RoomParamExemptionInfo
): void {
  const key = `${info.name}@${info.routeId}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `hono-preact: room '${info.name}' bound to '${info.routeId}': route ` +
      `param${info.params.length > 1 ? 's' : ''} ${info.params.join(', ')} ` +
      `${info.params.length > 1 ? 'are' : 'is'} not a key of channel ` +
      `'${info.channelName}'. Boot did not fail closed because no guard ` +
      `reads it today (app-use, page-use, and the room's own use are all ` +
      `empty), but a guard added later to any of those three tiers would ` +
      `read ctx.location.pathParams.${info.params[0]} as undefined. Rename ` +
      `the channel or route param(s) to match before adding a guard.`
  );
}

/**
 * Fail closed at boot if any route-bound unit (loader/action/socket/room)
 * declares a route other than the one its module is registered on.
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
 * and carry no binding to check. A room is the one exception: a colocated
 * room (a `.server.ts` sibling with no `__routeId`) is still owned by the
 * module's mount, so its route/channel param congruence is checked against
 * `route.path` regardless (see {@link assertRoomChannelCongruent}).
 *
 * A module mounted on a children-bearing node may alternatively bind its
 * subtree pattern (subtreePatternOf(route.path), so the root's is '/*'),
 * which must exist as a routeUse key; a
 * wildcard on a childless path fails here rather than resolving an empty
 * chain at request time.
 *
 * NOTE: framework-private. The only intended consumer is the generated server
 * entry, which awaits this before serving the loaders RPC, action POST, and
 * /__sockets upgrade paths.
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
          // Validate the mount binding FIRST, before any room congruence
          // check: a unit misbound to the wrong route should report that
          // misbinding, not a congruence error computed against a pattern
          // it was never actually bound to.
          if (typeof routeId === 'string') {
            // A malformed param segment in the bound route id is a defect in
            // the pattern itself, independent of where it is mounted: check
            // it before the mount-match branches below (a route bound to
            // ITS OWN mount, routeId === route.path, still needs this check;
            // the mount-match branches alone would never catch it).
            assertConformingBoundRouteId(kind, name, routeId);
            if (routeId === route.path) {
              maybeReportAliasedBinding(kind, name, routeId, ctx);
            } else if (routeId === subtreeId) {
              if (!ctx.routeUseByPattern.has(subtreeId)) {
                throw new Error(
                  `Route-bound ${kind} '${name}' binds the subtree pattern '${subtreeId}', ` +
                    `but route '${route.path}' has no child routes, so no subtree entry ` +
                    `exists and the binding would resolve an empty page-level \`use\` ` +
                    `chain. Bind serverRoute('${route.path}') for the route itself, or ` +
                    `give '${route.path}' children to make its subtree bindable.`
                );
              }
            } else {
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
          // A room's effective owning route is its declared __routeId, now
          // validated above to match the mount, or (a colocated room with
          // no __routeId) the mount itself.
          if (kind === 'room') {
            const channelName = channelNameOf(value);
            if (channelName !== null) {
              assertRoomChannelCongruent(
                name,
                typeof routeId === 'string' ? routeId : route.path,
                channelName,
                defUseOf(value),
                ctx
              );
            }
          }
        }
      }
    })
  );
}

/**
 * Fail closed at boot if a `src/server` registry module has a route-bound
 * unit (loader/action/socket/room) whose route is not real.
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
 * by request URL. A bare registry room has no owning route and is skipped for
 * the same reason: it runs only app-use and its own use, so route/channel
 * param congruence does not apply to it.
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
          assertConformingBoundRouteId(kind, name, routeId);
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
          if (kind === 'room') {
            const channelName = channelNameOf(value);
            if (channelName !== null) {
              assertRoomChannelCongruent(
                name,
                routeId,
                channelName,
                defUseOf(value),
                ctx
              );
            }
          }
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
      `the page scope for that pattern: it resolves the deepest composed ` +
      `chain, which includes the index child's own 'use' on top of the ` +
      `layout's chain. For a subtree-scoped (layout shell) binding, use ` +
      `serverRoute('${info.subtreeId}') instead: the subtree scope runs the ` +
      `layout node's own composed chain without the index child's additions. ` +
      `Register your routes in the tree form ({ tree: typeof routeTree }) to ` +
      `have every subtree spelling typed. Keep '${info.routeId}' if this ` +
      `${info.kind} should run the index page's full gate chain.`
  );
}
