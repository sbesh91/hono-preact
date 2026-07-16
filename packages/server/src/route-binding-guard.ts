import type { ServerRoute } from '@hono-preact/iso';
import {
  subtreePatternOf,
  requiredParamSlots,
  declaredParamSlots,
  guardReadableParamSlots,
  isHazardousColonSegment,
} from '@hono-preact/iso/internal/runtime';

/**
 * A route-bound server unit (loader, action, socket, or room) stamps its
 * declared route pattern onto the export as `__routeId`. Read it
 * structurally; bare units leave it `undefined`.
 */
type RouteBoundExport = { __routeId?: unknown };
type SelfModule = {
  __moduleKey?: unknown;
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

// The module's `__moduleKey` (the build-injected, path-derived key every
// `.server.*` file carries; see moduleKeyPlugin), read structurally, or `''`
// when absent (a hand-built test fixture, or a module the plugin never
// touched). Only used to module-qualify a dev advisory's dedup key and
// payload, so a missing key degrading to '' rather than throwing is the
// right failure mode: it is diagnostic, not security-relevant.
function moduleKeyOf(mod: SelfModule): string {
  return typeof mod.__moduleKey === 'string' ? mod.__moduleKey : '';
}

export type BoundUnitKind = 'loader' | 'action' | 'socket' | 'room';

export type AliasedBindingInfo = {
  kind: BoundUnitKind;
  name: string;
  /** The module's `__moduleKey` (the registry key is `moduleKey::name`). */
  moduleKey: string;
  /** The exact pattern the unit is bound to (the page scope). */
  routeId: string;
  /** The sibling subtree pattern (the subtree scope). */
  subtreeId: string;
};

export type RoomParamBindingInfo = {
  name: string;
  /** The module's `__moduleKey` (the registry key is `moduleKey::name`). */
  moduleKey: string;
  /** The room's effective owning route pattern (declared __routeId or mount). */
  routeId: string;
  /**
   * Every route param the channel satisfies, in pattern order, INCLUDING
   * optional (`:id?`) and rest (`:rest*`/`:rest+`) slots: the same
   * `declaredParamSlots` set the congruence check itself reasons over. A
   * required-only list would silently omit an optional/rest param from this
   * advisory even though a guard reads it exactly like a required one.
   */
  params: string[];
};

export type RoomParamExemptionInfo = {
  name: string;
  /** The module's `__moduleKey` (the registry key is `moduleKey::name`). */
  moduleKey: string;
  /** The room's effective owning route pattern (declared __routeId or mount). */
  routeId: string;
  /** The channel name pattern the route's params were checked against. */
  channelName: string;
  /** The route params NOT satisfied by the channel key. */
  params: string[];
};

export type ColocatedSocketParamAdvisoryInfo = {
  name: string;
  /** The module's `__moduleKey` (the registry key is `moduleKey::name`). */
  moduleKey: string;
  /** The socket's mount route pattern (its effective owning route). */
  routeId: string;
  /**
   * Every declared route param (including optional/rest) a guard on this
   * socket's chain would read as `undefined`, since a colocated socket
   * resolves no param wire at all.
   */
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
   * diagnostic (names a structural quirk, not a param-safety hazard), never
   * feeds guard resolution. Omit in prod for zero cost.
   */
  onAliasedBinding?: (info: AliasedBindingInfo) => void;
  /**
   * Dev-only observer fired once per param-bearing room binding after
   * congruence holds: the room's route params are being satisfied by the
   * channel key of the same name. Purely diagnostic (names a SUCCESSFUL
   * correspondence, not a hazard). Omit in prod.
   */
  onRoomParamBinding?: (info: RoomParamBindingInfo) => void;
  /**
   * Observer fired whenever a room's route/channel param mismatch does NOT
   * fail the boot: either the room is COLOCATED (no `__routeId`), which can
   * never fail the boot (the framework has no param wire to give it either
   * way, throwing here would break every released colocated-room app), or
   * the room is BOUND but all three guard tiers (app-use, page-use, and the
   * room's own use) are empty today. In the colocated case a guard on any
   * live tier reads the missing param as `undefined` RIGHT NOW; in the
   * bound/no-live-tier case a guard added LATER to any of those three tiers
   * would. Either way this describes a real hazard, so unlike
   * `onAliasedBinding`/`onRoomParamBinding` it must be wired in BOTH dev and
   * prod, not dev-only.
   */
  onRoomParamExemption?: (info: RoomParamExemptionInfo) => void;
  /**
   * Observer fired once per colocated socket (no `__routeId`) whose mount
   * route declares a param a guard could read (`guardReadableParamSlots`,
   * preact-iso's own WIDE `exec` grammar, not just the narrower
   * `declaredParamSlots` this framework's wire understands) and whose guard
   * chain (app-use, page-use, or the socket's own use) has at least one live
   * server-middleware tier. A colocated socket resolves no param wire
   * (`resolveConnection` always hands it `params: {}`), so any guard reading
   * those route params sees `undefined` forever. The room analog of this
   * situation is `onRoomParamExemption`; both are symmetric now (neither
   * throws for a colocated unit; a boot throw here would break every
   * released colocated-socket app, colocation predates the route-bound param
   * wire). This describes a real hazard, so it must be wired in BOTH dev and
   * prod, not dev-only.
   */
  onColocatedSocketParams?: (info: ColocatedSocketParamAdvisoryInfo) => void;
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
  moduleKey: string,
  routeId: string,
  ctx: RouteBindingCheckContext
): void {
  if (!ctx.onAliasedBinding || routeId.endsWith('/*')) return;
  const subtreeId = subtreePatternOf(routeId);
  const exact = ctx.routeUseByPattern.get(routeId);
  const subtree = ctx.routeUseByPattern.get(subtreeId);
  if (exact === undefined || subtree === undefined) return;
  if (!chainStrictlyExtends(exact, subtree)) return;
  ctx.onAliasedBinding({ kind, name, moduleKey, routeId, subtreeId });
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

// The first segment of `routeId` that is a real hazard: see
// `isHazardousColonSegment` (param-slots.ts, shared with defineChannel's own
// definition-time check) for the exact two shapes rejected. undefined if
// every segment is either conforming or a benign colon-namespaced literal.
function nonConformingRouteSegment(routeId: string): string | undefined {
  return routeId.split('/').find((seg) => isHazardousColonSegment(seg));
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
 * `isHazardousColonSegment` so the two validators cannot drift. A benign
 * colon-namespaced route segment (no realistic HTTP route uses one, but the
 * predicate is shared, so the rule is identical to `defineChannel`'s) is not
 * rejected; only a segment the type layer would still misread as a param, or
 * one that unambiguously spells an attempted `:param` with an invalid name,
 * is.
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
 * Check a room's effective owning route against its channel for param
 * congruence: does every param a guard could read off the route also
 * resolve through the channel key? No-op for a route with no guard-readable
 * param at all.
 *
 * The guard-readable namespace comes from `guardReadableParamSlots`, which
 * mirrors preact-iso's own runtime matcher (`exec`): it recognizes ANY
 * `:`-prefixed segment as a param, hyphens and all, not just the narrower
 * `:[A-Za-z0-9_]+` class `declaredParamSlots` supports. A route segment like
 * `:board-id` is invisible to `declaredParamSlots` (so a channel-congruence
 * check keyed on that function alone would silently pass it, and the
 * colocated-unit advisory below it would silently skip it too), but it IS a
 * live param over plain HTTP, so a guard reading it sees a real value there
 * while a realtime connection (which resolves params via
 * `requiredParamSlots`/`declaredParamSlots`, not `exec`) would never satisfy
 * it through any channel spelling. `guardReadableParamSlots` closes that
 * blind spot: it drives the early-return and the name-coverage condition
 * below, while the channel side of the comparison, and the presence
 * guarantee, stay on the narrower `declaredParamSlots`/`requiredParamSlots`
 * grammar (what the framework can actually SUPPLY and substitute).
 *
 * The guard-readable namespace is checked under TWO conditions, both
 * required for congruence:
 *
 * 1. **Name coverage:** every param a guard could read off the route
 *    (`guardReadableParamSlots`) must also be a param the channel declares
 *    (`declaredParamSlots`, which includes optional `?` and rest `*`/`+`
 *    slots). preact-iso's runtime matcher binds an optional or rest route
 *    param over HTTP just as readily as a required one, and a guard reads
 *    `ctx.location.pathParams` the same way regardless of the modifier, so a
 *    route param `requiredParamSlots` excludes (because it is optional or
 *    rest-zero-or-more) is not exempt from this check: it is exactly as
 *    guard-readable as a required one, just not guaranteed present. A
 *    hyphenated segment `guardReadableParamSlots` sees but `declaredParamSlots`
 *    does not can never pass this condition either: no legal channel spelling
 *    (`defineChannel` rejects the same hazardous segments, via the shared
 *    `isHazardousColonSegment`) could ever declare it.
 * 2. **Presence guarantee:** every param the route REQUIRES
 *    (`requiredParamSlots`) must also be a param the channel REQUIRES. A
 *    channel param declared but only optional/rest cannot guarantee a
 *    required route param is present: an absent client-supplied slot
 *    resolves to `undefined` at connection time, so a guard keyed on it would
 *    misread a value the route promises is always there.
 *
 * A mismatch fails the boot closed ONLY for a route-BOUND room (`bound`
 * true, i.e. it carries an explicit `__routeId`), and only while at least one
 * of the three guard tiers `composeServerChain` feeds the same `pathParams`
 * to is live: app-use (`appConfig.use`), page-use (the route's own composed
 * chain), and the room's own `use`. A guard in ANY of those tiers COULD read
 * the missing param via `ctx.location.pathParams`, so an absent value there
 * is a real hazard regardless of which tier the guard lives in. Tier
 * liveness counts only SERVER middleware (`serverTierSize`), not raw array
 * length. The author opted a bound room into the route contract, so a
 * mismatch is a bug in their code and a loud boot failure is the right
 * response.
 *
 * A COLOCATED room (`bound` false: a `.server.ts` sibling with no explicit
 * `serverRoute(...).room(...)`) NEVER fails the boot for a mismatch,
 * regardless of tier liveness: the framework cannot supply this room's
 * params either way (a colocated room's effective route is only its module's
 * mount, an accident of file layout, not an authored contract), so throwing
 * would break every released colocated-room app the moment it grows a guard
 * anywhere in that chain (`defineApp({ use: [...] })` is an extremely common
 * shape). A room deliberately independent of its mount route's params, e.g.
 * `defineChannel('global-chat')` colocated on `/board/:id`, is a real,
 * working configuration either way.
 *
 * Both non-throwing outcomes (a bound room with all three tiers empty today,
 * or any colocated room) fire the SAME advisory (`onRoomParamExemption`):
 * either a guard already reads the missing param as `undefined` right now
 * (colocated with a live tier), or one added later to any of the three tiers
 * would (both remaining cases). This observer must be wired in BOTH dev and
 * prod (see its own doc on `RouteBindingCheckContext`), unlike the
 * dev-only `onAliasedBinding`/`onRoomParamBinding`.
 */
function assertRoomChannelCongruent(
  name: string,
  moduleKey: string,
  routeId: string,
  channelName: string,
  defUse: ReadonlyArray<unknown>,
  bound: boolean,
  ctx: RouteBindingCheckContext
): void {
  const routeDeclared = guardReadableParamSlots(routeId);
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
    // Computed unconditionally (not just for `bound`): the COLOCATED
    // exemption advisory below is now ALSO gated on it (Finding 9, #274
    // round-8 fix), mirroring the socket twin
    // (`maybeReportColocatedSocketParams`'s `liveTiers === 0` early return).
    const appUse = ctx.appUse ?? [];
    const pageUse = ctx.routeUseByPattern.get(routeId) ?? [];
    const liveTiers =
      serverTierSize(appUse) + serverTierSize(pageUse) + serverTierSize(defUse);
    if (bound) {
      if (liveTiers > 0) {
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
            `whose params the channel supplies, or remove the explicit ` +
            `serverRoute(...).room(...) binding (a colocated room warns on this ` +
            `mismatch instead of failing the boot) or move the room into a ` +
            `src/server registry module (a bare registry room carries no ` +
            `__routeId, is route-independent, and skips this check entirely).`
        );
      }
    }
    // Either colocated (never fails the boot, regardless of tier liveness)
    // or bound with all three tiers empty today (exempted, but a guard added
    // later would misread the param): advise, don't throw. For the
    // COLOCATED case specifically, only advise while some tier IS live
    // (Finding 9): a genuinely guard-less route has no guard TODAY that
    // could misread the missing param, so there is nothing to warn about
    // yet -- matching the socket twin's identical gate. A BOUND room with
    // all tiers empty always advises regardless: it already opted into the
    // route contract, so "a guard added LATER would misread this" is worth
    // surfacing even at liveTiers === 0.
    if (!bound && liveTiers === 0) return;
    ctx.onRoomParamExemption?.({
      name,
      moduleKey,
      routeId,
      channelName,
      params: missing,
    });
    return;
  }
  // Report every DECLARED param (routeDeclared), not just the required ones
  // (routeRequired): an optional/rest route param is exactly as
  // guard-readable as a required one (see condition 1's doc above), so an
  // advisory scoped to `routeRequired` would silently omit it from the
  // author-facing eyeball check this callback exists to provide.
  ctx.onRoomParamBinding?.({ name, moduleKey, routeId, params: routeDeclared });
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
  // Module-qualified: a registry room and a colocated room can share a
  // `name`/`routeId` pair (they are distinct `moduleKey::name` registry
  // entries), and an unqualified key would let one binding's advisory
  // silently swallow the other's.
  const key = `${info.moduleKey}::${info.name}@${info.routeId}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `hono-preact: room '${info.name}' (${info.moduleKey}) bound to ` +
      `'${info.routeId}': route param${info.params.length > 1 ? 's' : ''} ` +
      `${info.params.join(', ')} ${info.params.length > 1 ? 'are' : 'is'} ` +
      `satisfied by the channel key of the same name. Confirm the route and ` +
      `channel denote the same resource; the room's guard authorizes on the ` +
      `channel key, not the page URL.`
  );
}

/**
 * Console advisory for a room's route/channel param mismatch that did NOT
 * fail the boot, fired through `RouteBindingCheckContext.onRoomParamExemption`.
 * Covers two distinct reasons (see `assertRoomChannelCongruent`'s own doc):
 * a colocated room (never fails the boot, whether or not a guard is live
 * today), or a bound room with all three guard tiers empty today (exempted,
 * but a later-added guard would misread the param). The message stays
 * accurate under both without needing to know which applied: a guard on the
 * route, live now or added later, reads the missing param as `undefined`
 * either way. Fires in BOTH dev and prod (see the field's own doc). One per
 * binding for the life of the `warned` set the caller owns.
 */
export function warnRoomParamExemption(
  warned: Set<string>,
  info: RoomParamExemptionInfo
): void {
  // Module-qualified for the same reason as warnRoomParamBinding above.
  const key = `${info.moduleKey}::${info.name}@${info.routeId}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `hono-preact: room '${info.name}' at route '${info.routeId}': route ` +
      `param${info.params.length > 1 ? 's' : ''} ${info.params.join(', ')} ` +
      `${info.params.length > 1 ? 'are' : 'is'} not a key of channel ` +
      `'${info.channelName}'. Boot did not fail closed for this room; a ` +
      `guard on the route (app-use, page-use, or the room's own use), ` +
      `whether live now or added later, reads ` +
      `ctx.location.pathParams.${info.params[0]} as undefined. Rename the ` +
      `channel or route param(s) to match, make the channel slot required, ` +
      `or ${bindingAdvice('room', info.routeId, false)}`
  );
}

// Advisory check behind ctx.onColocatedSocketParams: a colocated socket (no
// `__routeId`) whose mount route declares a param a guard could read
// (`guardReadableParamSlots`, preact-iso's own WIDE `exec` grammar), guarded
// by at least one live server-middleware tier, resolves NO param wire at all
// (`resolveConnection`'s param parse only runs for a route-BOUND
// socket). A guard on such a socket's chain reads those route params as
// `undefined` forever, silently. This is the socket analog of
// `assertRoomChannelCongruent`'s tier-liveness gate; unlike a BOUND room it
// never throws (a boot throw would break every released colocated-socket
// app), so it only ever reports through the callback.
function maybeReportColocatedSocketParams(
  name: string,
  moduleKey: string,
  route: ServerRoute,
  defUse: ReadonlyArray<unknown>,
  ctx: RouteBindingCheckContext
): void {
  if (!ctx.onColocatedSocketParams) return;
  const declared = guardReadableParamSlots(route.path);
  if (declared.length === 0) return;
  const appUse = ctx.appUse ?? [];
  const pageUse = ctx.routeUseByPattern.get(route.path) ?? [];
  const liveTiers =
    serverTierSize(appUse) + serverTierSize(pageUse) + serverTierSize(defUse);
  if (liveTiers === 0) return;
  ctx.onColocatedSocketParams({
    name,
    moduleKey,
    routeId: route.path,
    params: declared,
  });
}

/**
 * The actionable "how to fix" clause shared by the colocated-socket and
 * room-exemption advisories below: both end with "bind explicitly with
 * serverRoute(routeId).<kind>(...)", and that advice is WRONG when
 * `routeId` itself carries a non-conforming `:param` segment (e.g. a
 * hyphenated `/board/:board-id`), because binding such a route hard-fails
 * at boot (`assertConformingBoundRouteId` above). Followed literally, the
 * advice would break the app instead of fixing it. Detect that case and
 * give the correct advice instead: rename the route param to the supported
 * `[A-Za-z0-9_]+` class FIRST, then bind (or, without renaming, read the
 * value off the query/headers in the unit's own `use`/`open`/`onJoin`).
 *
 * `sentenceStart` capitalizes the leading word: `warnColocatedSocketParams`
 * uses this clause as its own sentence, `warnRoomParamExemption` splices it
 * mid-sentence after "...or ".
 */
function bindingAdvice(
  kind: 'socket' | 'room',
  routeId: string,
  sentenceStart: boolean
): string {
  const badSegment = nonConformingRouteSegment(routeId);
  if (badSegment === undefined) {
    return kind === 'socket'
      ? `${sentenceStart ? 'Bind' : 'bind'} with serverRoute('${routeId}').socket(...) to authorize on it.`
      : `${sentenceStart ? 'Bind' : 'bind'} the room explicitly with ` +
          `serverRoute('${routeId}').room(...) to authorize on it.`;
  }
  return (
    `serverRoute('${routeId}').${kind}(...) cannot fix this: its segment ` +
    `'${badSegment}' is not a conforming ':param' spelling, and binding it ` +
    `would hard-fail at boot (see the route-bound conformance check above). ` +
    `Rename the route param so it only uses letters, digits, and ` +
    `underscores, THEN bind with serverRoute('${routeId}').${kind}(...); or, ` +
    `without renaming, read the value off the query/headers in the ` +
    (kind === 'socket'
      ? `socket's own 'use'/'open' instead.`
      : `room's own 'use'/'onJoin' instead.`)
  );
}

/**
 * Console advisory for a colocated socket on a param-bearing, guarded route,
 * fired through `RouteBindingCheckContext.onColocatedSocketParams`. Fires in
 * BOTH dev and prod (see the field's own doc). One per socket for the life
 * of the `warned` set the caller owns.
 */
export function warnColocatedSocketParams(
  warned: Set<string>,
  info: ColocatedSocketParamAdvisoryInfo
): void {
  // Module-qualified for the same reason as warnRoomParamBinding above.
  const key = `${info.moduleKey}::${info.name}@${info.routeId}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `hono-preact: socket '${info.name}' (${info.moduleKey}) is colocated ` +
      `with '${info.routeId}', which declares route ` +
      `param${info.params.length > 1 ? 's' : ''} ${info.params.join(', ')}. ` +
      `A colocated socket resolves no param wire, so a guard on its chain ` +
      `will read ${info.params.length > 1 ? 'those params' : 'that param'} ` +
      `as undefined. ${bindingAdvice('socket', info.routeId, true)}`
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
 * `route.path` regardless, but a mismatch there only ever advises, never
 * fails the boot (see {@link assertRoomChannelCongruent}). A colocated
 * socket is an advisory-only exception in the same spirit, scoped to a
 * report rather than a throw (see {@link maybeReportColocatedSocketParams}).
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
      const moduleKey = moduleKeyOf(mod);
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
              maybeReportAliasedBinding(kind, name, moduleKey, routeId, ctx);
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
          } else if (kind === 'socket') {
            // A colocated socket (no __routeId) has no param wire; advise
            // when its mount route declares params a live guard tier could
            // misread as undefined (see maybeReportColocatedSocketParams).
            maybeReportColocatedSocketParams(
              name,
              moduleKey,
              route,
              defUseOf(value),
              ctx
            );
          }
          // A room's effective owning route is its declared __routeId, now
          // validated above to match the mount, or (a colocated room with
          // no __routeId) the mount itself.
          if (kind === 'room') {
            const channelName = channelNameOf(value);
            if (channelName !== null) {
              assertRoomChannelCongruent(
                name,
                moduleKey,
                typeof routeId === 'string' ? routeId : route.path,
                channelName,
                defUseOf(value),
                typeof routeId === 'string',
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
      const moduleKey = moduleKeyOf(mod);
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
          maybeReportAliasedBinding(kind, name, moduleKey, routeId, ctx);
          if (kind === 'room') {
            const channelName = channelNameOf(value);
            if (channelName !== null) {
              assertRoomChannelCongruent(
                name,
                moduleKey,
                routeId,
                channelName,
                defUseOf(value),
                // Every room reaching this point is route-bound: a bare
                // (no __routeId) registry unit was already `continue`d above.
                true,
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
  // Module-qualified for the same reason as warnRoomParamBinding above: two
  // modules can export a unit of the same kind/name bound to the same
  // route, and an unqualified key would let one binding's advisory silently
  // swallow the other's.
  const key = `${info.moduleKey}::${info.kind}:${info.name}@${info.routeId}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `hono-preact: ${info.kind} '${info.name}' (${info.moduleKey}) is bound ` +
      `to '${info.routeId}', the page scope for that pattern: it resolves ` +
      `the deepest composed chain, which includes the index child's own ` +
      `'use' on top of the layout's chain. For a subtree-scoped (layout ` +
      `shell) binding, use serverRoute('${info.subtreeId}') instead: the ` +
      `subtree scope runs the layout node's own composed chain without the ` +
      `index child's additions. Register your routes in the tree form ` +
      `({ tree: typeof routeTree }) to have every subtree spelling typed. ` +
      `Keep '${info.routeId}' if this ${info.kind} should run the index ` +
      `page's full gate chain.`
  );
}
