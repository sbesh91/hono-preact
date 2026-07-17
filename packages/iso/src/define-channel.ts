import type { RouteParams } from './internal/typed-routes.js';
import { interpolatePattern } from './internal/interpolate-pattern.js';
import {
  isHazardousColonSegment,
  reservedParamNamesIn,
  optionalOrRestParamSlots,
} from './internal/param-slots.js';

// A topic string branded with its payload type. The brand is phantom (a
// `unique symbol` optional key, never present at runtime), so it carries the
// payload for inference: the later publish/subscribe layer recovers `P` from a
// `Topic<P>` argument. Because the key is optional, the brand is permissive-in
// (a plain `string` is still assignable to `Topic<P>`); it is an inference
// carrier, not a nominal type, so it does not by itself reject an unbranded
// string. The string-to-topic relationship mirrors how `buildPath` produces a
// path from a typed pattern, but the value also carries the payload.
declare const TopicPayload: unique symbol;
export type Topic<Payload> = string & { readonly [TopicPayload]?: Payload };

// No argument for a param-less name; the params object for a `:param` name.
// Mirrors `build-path.ts`'s `BuildArgs`.
type KeyArgs<P> = keyof P extends never ? [] : [params: P];

/**
 * A strictly-typed channel address: a `/:param` name plus a payload type. The
 * `serverRoute`/`buildPath` analog for realtime channels. `key(params)` builds a
 * branded `Topic<Payload>`; the payload type rides the brand so later layers
 * (publish/subscribe, live loaders, rooms) infer it from one source.
 */
export interface Channel<Name extends string, Payload> {
  readonly name: Name;
  key(...args: KeyArgs<RouteParams<Name>>): Topic<Payload>;
}

/**
 * Reject a channel name carrying a segment that is a REAL hazard: see
 * `isHazardousColonSegment` (param-slots.ts) for the exact two shapes this
 * rejects (a non-conforming `:`-prefixed segment like `:board-id`, or a
 * namespaced literal like `board:boardId` whose suffix the type-level
 * `RouteParams` would still claim as a param). Left unvalidated, either
 * shape would collapse every connection onto a single constant topic while
 * looking correctly typed and required (the `board:boardId` case), or read
 * as a live param to a wider matcher elsewhere while resolving to nothing
 * here (the `:board-id` case).
 *
 * A colon-namespaced but non-param-shaped segment (e.g.
 * `defineChannel('notifications:user-alerts')`) is NOT rejected: the
 * type-level `RouteParams` does not claim a param there either (its suffix
 * fails the same `[A-Za-z0-9_]+` class), so the type layer and
 * `interpolatePattern` already agree the segment is a literal. This is an
 * ordinary, working colon-namespaced constant name, not a hazard.
 *
 * Also rejects a `:param` segment whose name `isReservedParamName`
 * (param-slots.ts): a name that resolves through `Object.prototype`, i.e. an
 * own member of it (`constructor`, `toString`, `__proto__`, ...). `toJSON` and
 * `prototype` are NOT members and stay valid. This is the convergent fix for
 * the prototype-chain param-read hazard: a channel can never DECLARE a param
 * of one of these names, so no guard reading `onJoin`'s resolved params can
 * ever misread a missing param of that name as the inherited (truthy) member
 * instead of `undefined`. Because the hazard is closed here, at the definition
 * boundary, the params objects themselves stay ordinary objects.
 *
 * Also rejects a name carrying MORE THAN ONE optional/rest slot
 * (`optionalOrRestParamSlots`, param-slots.ts): with two or more, two
 * distinct key sets that each omit a DIFFERENT slot collapse onto the SAME
 * topic (see that function's own doc for the full hazard). A name with at
 * most one such slot is unaffected.
 *
 * Throwing here, at definition time, is the loud failure that replaces the
 * old (correct) behavior of denying every connection: cheaper and louder
 * than a per-connection check.
 *
 * CHANNEL-ONLY here: this does not apply to ordinary (unbound) route
 * patterns. preact-iso's own route matcher (`exec`) accepts any param name,
 * hyphens included, so an existing app may legitimately have an HTTP route
 * like `/board/:board-id`; throwing on every route pattern would newly break
 * that app at boot. A route-BOUND realtime unit (`serverRoute(r).socket`/
 * `.room`) is a narrower case with the identical hazard (its guard reads
 * route params the same way a channel does) and is rejected separately, at
 * boot, by `@hono-preact/server`'s route-binding guard, reusing the SAME
 * `isHazardousColonSegment` predicate so the two validators cannot drift.
 *
 * Exported so `defineRoom` (define-room.ts) can run the SAME check on a
 * `Channel` passed in structurally: `Channel` is a public type export, so a
 * hand-rolled `{ name, key }` literal bypasses `defineChannel`'s own call to
 * this function entirely unless the room constructor re-validates it too.
 * `constructorLabel` names whichever public constructor actually ran the
 * check (`defineChannel` here; `defineRoom`/`serverRoute(r).room` when
 * `defineRoom` re-validates a hand-rolled `Channel`), so the thrown message
 * always points at the call the author actually made rather than always
 * blaming `defineChannel`.
 */
export function assertConformingChannelName(
  name: string,
  constructorLabel: string = 'defineChannel'
): void {
  for (const segment of name.split('/')) {
    if (!isHazardousColonSegment(segment)) continue;
    // Two distinct hazard shapes (see this function's own doc), each needing
    // DIFFERENT advice: a ':'-prefixed segment IS an attempted ':param' with
    // an invalid name, so "rename the param" is correct and actionable. A
    // colon-namespaced LITERAL segment (the colon is not at the segment's
    // start, e.g. 'board:boardId') is not a ':param' at all -- there is no
    // param to rename -- the hazard is that the type-level RouteParams still
    // reads the text after the colon as a REQUIRED param this channel's
    // interpolatePattern never substitutes, so advice must point at THAT
    // mismatch instead.
    if (segment.startsWith(':')) {
      throw new Error(
        `${constructorLabel}('${name}'): the param segment '${segment}' is not ` +
          `a valid channel param. A channel param must be ':name', where ` +
          `'name' is one or more of [A-Za-z0-9_], optionally followed by a ` +
          `single '?', '*', or '+' modifier (e.g. ':id', ':id?', ':rest*', ` +
          `':rest+'). Rename the param so it only uses letters, digits, and ` +
          `underscores.`
      );
    }
    const colonIndex = segment.indexOf(':');
    const claimedParam = segment.slice(colonIndex + 1).replace(/[?*+]$/, '');
    throw new Error(
      `${constructorLabel}('${name}'): the segment '${segment}' is a ` +
        `colon-namespaced literal, not a ':param' -- but the type-level ` +
        `RouteParams still reads '${claimedParam}' (the text after the ` +
        `colon) as a REQUIRED param, and interpolatePattern never ` +
        `substitutes it (it is not a real ':param' segment), so every call ` +
        `to key() would collapse onto the one constant topic '${name}' while ` +
        `the type still promises a param that is never there. Either make it ` +
        `a real ':param' segment (e.g. '${segment.slice(0, colonIndex)}/:` +
        `${claimedParam}' instead of '${segment}') so the value actually ` +
        `substitutes, or remove the colon from the constant name so it reads ` +
        `as an ordinary literal.`
    );
  }
  // Reject a conforming ':param' segment whose name is RESERVED (an own member
  // of Object.prototype, so it resolves through the prototype chain):
  // see this function's own doc and `reservedParamNamesIn` (param-slots.ts,
  // the same scan `defineRoutes`/`serverRoute` run). A non-conforming spelling
  // of the same name (e.g. ':constructor-id') is not caught here (it is a
  // different, ordinary name), and a non-`:`-prefixed hazard was already
  // rejected by the loop above.
  const reserved = reservedParamNamesIn(name);
  if (reserved.length > 0) {
    throw new Error(
      `${constructorLabel}('${name}'): the param ':${reserved[0]}' is reserved -- ` +
        `it is an Object.prototype member, so on a plain params object a ` +
        `guard reading an ABSENT param of this name would read the ` +
        `inherited member instead of undefined and wrongly treat it as ` +
        `present. Rename the param to something that is not '${reserved[0]}'.`
    );
  }
  const ambiguousSlots = optionalOrRestParamSlots(name);
  if (ambiguousSlots.length > 1) {
    throw new Error(
      `${constructorLabel}('${name}'): more than one optional or rest param ` +
        `slot (${ambiguousSlots.map((s) => `':${s}'`).join(', ')}). A channel ` +
        `key must resolve to ONE unambiguous topic, but interpolatePattern ` +
        `drops an absent or empty segment, so two distinct key sets that each ` +
        `omit a DIFFERENT one of these slots would collapse onto the SAME ` +
        `topic (a cross-resource presence and broadcast leak). Use at most ` +
        `one optional ('?') or rest ('*'/'+') slot in a channel name, or make ` +
        `the extra slot(s) required.`
    );
  }
}

/**
 * Define a typed channel. The name uses the route `/:param` grammar, so its
 * params are extracted by the same engine that types route params:
 *
 * ```ts
 * const boardChannel = defineChannel('board/:projectId')<{ taskId: string }>();
 * boardChannel.key({ projectId: 'p1' }); // Topic<{ taskId: string }> ('board/p1')
 * ```
 *
 * Curried so the name is inferred while the payload is given explicitly. A
 * payload-less channel (`defineChannel('x')()`) is a signal channel (`void`).
 *
 * Throws immediately (before the payload is even supplied) if `name` carries
 * a segment with a `:` anywhere in it (not just at the segment's start) whose
 * param name does not conform to the shared param grammar; see
 * {@link assertConformingChannelName}.
 */
export function defineChannel<const Name extends string>(name: Name) {
  assertConformingChannelName(name);
  return <Payload = void>(): Channel<Name, Payload> => ({
    name,
    // The `key` impl is intentionally loose (a `Record` in, a `string` out); the
    // strict params and branded `Topic` return are supplied by the `Channel`
    // type. This single assertion is the one sanctioned brand boundary.
    key: ((params?: Record<string, string | undefined>) =>
      interpolatePattern(name, params ?? {})) as Channel<Name, Payload>['key'],
  });
}
