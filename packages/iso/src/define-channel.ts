import type { RouteParams } from './internal/typed-routes.js';
import { interpolatePattern } from './internal/interpolate-pattern.js';
import { isConformingParamSegment } from './internal/param-slots.js';

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
 * Reject a channel name carrying a `:`-prefixed segment whose param name does
 * not conform to the shared param grammar (`isConformingParamSegment`, the
 * same `[A-Za-z0-9_]+` class plus an optional single `?`/`*`/`+` modifier that
 * `interpolatePattern` and the type-level `ParamFrom` both enforce).
 *
 * A non-conforming segment (e.g. `:board-id`, a hyphen is outside the class)
 * is NOT a param to `requiredParamSlots`/`declaredParamSlots`: nothing is
 * required, and `interpolatePattern` leaves the segment LITERAL rather than
 * substituting a value. Left unvalidated, every connection would collapse
 * onto the single constant topic spelled with the literal `:board-id`
 * segment, silently merging every resource's presence roster and broadcasts
 * into one shared channel. Throwing here, at definition time, is the loud
 * failure that replaces the old (correct) behavior of denying every
 * connection: cheaper and louder than a per-connection check, and it cannot
 * be bypassed by a client.
 *
 * CHANNEL-ONLY: this does not apply to route patterns. preact-iso's route
 * matcher (`exec`) accepts any param name, hyphens included, so an existing
 * app may legitimately have a route like `/board/:board-id`; throwing on
 * route patterns would newly break that app at boot.
 */
function assertConformingChannelName(name: string): void {
  for (const segment of name.split('/')) {
    if (segment.startsWith(':') && !isConformingParamSegment(segment)) {
      throw new Error(
        `defineChannel('${name}'): the param segment '${segment}' is not a ` +
          `valid channel param. A channel param must be ':name', where ` +
          `'name' is one or more of [A-Za-z0-9_], optionally followed by a ` +
          `single '?', '*', or '+' modifier (e.g. ':id', ':id?', ':rest*', ` +
          `':rest+'). Rename the param so it only uses letters, digits, and ` +
          `underscores.`
      );
    }
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
 * a `:`-prefixed segment whose param name does not conform to the shared
 * param grammar; see {@link assertConformingChannelName}.
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
