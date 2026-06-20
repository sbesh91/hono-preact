import type { RouteParams } from './internal/typed-routes.js';
import { interpolatePattern } from './internal/interpolate-pattern.js';

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
 */
export function defineChannel<const Name extends string>(name: Name) {
  return <Payload = void>(): Channel<Name, Payload> => ({
    name,
    // The `key` impl is intentionally loose (a `Record` in, a `string` out); the
    // strict params and branded `Topic` return are supplied by the `Channel`
    // type. This single assertion is the one sanctioned brand boundary.
    key: ((params?: Record<string, string | undefined>) =>
      interpolatePattern(name, params ?? {})) as Channel<Name, Payload>['key'],
  });
}
