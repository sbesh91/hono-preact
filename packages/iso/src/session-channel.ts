import type { ClientPageCtx, ServerBaseCtx } from './define-middleware.js';
import { publishToChannel } from './internal/channel-registry.js';
import { readChannelValue } from './internal/channel-store.js';

/**
 * A typed value a server middleware publishes on each round-trip and its paired
 * client middleware reads.
 *
 * The type argument is explicit rather than inferred. `defineServerMiddleware`
 * infers its deny type because that type sits in the function's return position
 * and has to union across a whole `use` array; a channel payload is declared
 * once and read by one paired middleware, and this repo has already established
 * that a type-argument spelling is inference-dead.
 */
export type SessionChannel<T> = {
  /**
   * The cross-bundle identity of this channel. Public because the Vite plugin
   * rewrites it at the call site and the wire encoding is keyed by it, so a
   * debugging user who sees it on a response header can find its declaration.
   */
  readonly __channelId: string;
  /**
   * Publish from the server tier. A no-op outside a request scope.
   *
   * Takes `ctx` although the request store is ambient, because the parameter is
   * what makes the tier obvious at the call site and what stops this from being
   * callable from client code that has no ctx to hand it.
   *
   * Typed as `ServerBaseCtx`, the `{ c, signal }` shape every server-side
   * context carries, so a route-independent `defineAction` handler can clear a
   * channel from its own `ActionCtx` without going through route-node
   * middleware. `ClientPageCtx` carries neither field, so the client tier still
   * cannot reach this.
   */
  publish(ctx: ServerBaseCtx, value: T): void;
  /**
   * Read what the last server round-trip published, or `undefined` if no
   * round-trip has published on this channel. A guard treats `undefined` the
   * same way it treats an absent flag: not authorized.
   */
  read(ctx: ClientPageCtx): T | undefined;
};

// Fallback identity for the non-Vite paths: unit tests and the in-process
// `call()` path. Neither crosses a bundle boundary, so a per-instance counter
// is sufficient there. Under Vite the plugin rewrites the `defineSessionChannel()`
// call to pass a module-derived id, which is what makes the server and client
// bundles agree. See `packages/vite/src/guard-strip.ts`.
let fallbackId = 0;

export function defineSessionChannel<T>(id?: string): SessionChannel<T> {
  const channelId = id ?? `hp-channel-${++fallbackId}`;
  return {
    __channelId: channelId,
    publish(_ctx, value) {
      publishToChannel(channelId, value);
    },
    read(_ctx) {
      // The wire cannot prove the stored value matches `T`. The claim is made
      // once, here, by the handle that also owns the `publish` that produced
      // it, rather than at every call site. Same boundary discipline as
      // `decodeActionResponse` projecting a deny into its declared type.
      return readChannelValue(channelId) as T | undefined;
    },
  };
}
