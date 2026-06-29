import type { LoaderRef } from './define-loader.js';

/**
 * Type extractors over an action / loader ref. They let code that does not
 * import the ref (form types, fixtures, adapters) share the inferred payload /
 * result / chunk / data types.
 *
 * They resolve to the AUTHORED type `T` (the server-side truth), not the wire
 * shape. The JSON round-trip is already expressed by the public `Serialize<T>`,
 * so the wire shape is `Serialize<InferActionResult<typeof action>>`. One source
 * of truth; no duplicate wire-vs-server extractor pair.
 *
 * The action helpers match the ref STRUCTURALLY via its `__phantom` field
 * (a covariant `readonly [TPayload, TResult, TChunk]` tuple), rather than via
 * `ActionRef<infer P, ...>`. `ActionRef` is invariant in `TPayload`/`TResult`
 * because `useAction` uses them in contravariant parameter positions, so
 * inferring through the whole interface degrades to `never`. The phantom tuple
 * carries the three type params in one purely-covariant site, where inference
 * is reliable. (This is why `ActionRef` is not imported here: it is never named
 * in a type position.)
 */
type ActionPhantom<A> = A extends { __phantom?: infer T }
  ? T extends readonly [unknown, unknown, unknown]
    ? T
    : never
  : never;

export type InferActionPayload<A> = ActionPhantom<A>[0];

export type InferActionResult<A> = ActionPhantom<A>[1];

export type InferActionChunk<A> = ActionPhantom<A>[2];

// `LoaderRef` surfaces `T` only covariantly (via `fn: Loader<T>` / `useData`),
// so inferring through the interface is reliable here. The liveness slot is
// matched with `boolean` (it is only ever `true`/`false`), accepting both live
// and non-live loaders.
export type InferLoaderData<L> =
  L extends LoaderRef<infer T, boolean> ? T : never;
