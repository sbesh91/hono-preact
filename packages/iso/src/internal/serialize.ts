// Models what a value of type `T` becomes after a JSON round-trip
// (`JSON.parse(JSON.stringify(x))`) -- which is how EVERY loader/action value
// crosses the server->client wire in this framework. The wire is plain JSON on
// every path: the SSR embed (`internal/envelope.tsx`), the `/__loaders` fetch
// and the action `__outcome` envelope (`internal/loader-fetch.ts`,
// `internal/action-envelope.ts`), and the per-chunk SSE codec
// (`@hono-preact/server` `sse.ts`) all `JSON.stringify` to encode and
// `JSON.parse`/`res.json()` to decode. There is no richer codec (no
// superjson / Date / Map preservation).
//
// The client-facing types (`useData()`, `useAction().data`, `onChunk`,
// `useActionResult().data`) are therefore `Serialize<T>`, not the server-side
// `T`: typing them as `T` is a latent lie, since a loader returning
// `{ at: Date }` yields `{ at: string }` once it reaches the client.
//
// The transform mirrors `JSON.stringify` exactly:
//   - JSON primitives (string / number / boolean / null) pass through.
//   - A value with a `toJSON()` method serializes as that method's return
//     (`Date` -> its ISO string; any user type implementing `toJSON` likewise).
//   - `undefined`, functions, symbols and `bigint` cannot live at a value
//     position: in an object their KEY is dropped; in an array the ELEMENT
//     becomes `null`; as a whole value they collapse to `never`, so a
//     non-serializable WHOLE return surfaces as a compile error.
//   - Arrays / tuples recurse element-wise; tuple shape is preserved.
//   - `Map` / `Set` serialize to the empty object (no enumerable own props).
//   - Objects recurse; a key whose value can hold `undefined` becomes optional.
//   - `any` passes through unchanged (it cannot be meaningfully narrowed, and
//     recursing it would not terminate).
//
// Known imprecisions (shared with type-fest's `Jsonify`):
//   - For a class instance the transform reads `keyof`, which includes
//     prototype getters, so an accessor-backed property may appear that
//     `JSON.stringify` would omit. Plain data objects -- the overwhelmingly
//     common loader/action return -- are exact.
//   - A `bigint` is modeled as `never` at its value position (the key is then
//     dropped from an object). At runtime a `bigint` anywhere in the payload
//     makes `JSON.stringify` THROW, failing the whole response rather than
//     dropping just that key; the type flags the whole-value form, not a
//     bigint buried in an object.

type JsonPrimitive = string | number | boolean | null;

// `any` satisfies every `extends` arm below (including `{ toJSON() }` with
// `J = any`), which would recurse `Serialize<any>` forever ("excessively
// deep"). Detect it up front so it -- and any field typed `any` -- passes
// through unchanged, matching the pre-`Serialize` behavior at the boundary.
// The canonical detector: `1 & T` is `any` only when `T` is `any`, so only
// then does `0 extends 1 & T` hold.
//
// VARIANCE NOTE: branching `Serialize<T>` on `IsAny<T>` makes TypeScript
// measure `Serialize<T>` (and anything returning it, notably `LoaderRef<T>`
// via `useData(): Serialize<T>`) as INVARIANT in `T`. So a concrete
// `LoaderRef<Movie>` is no longer assignable to `LoaderRef<unknown>`. The
// data-type-agnostic loader APIs (`invalidate`, `prefetch`) absorb that by
// accepting `AnyLoaderRef` (= `LoaderRef<any>`) instead. This is inherent to
// any-detection here, not specific to the `1 & T` form.
type IsAny<T> = 0 extends 1 & T ? true : false;

// Value-position types JSON cannot represent. `bigint` throws; the others are
// dropped (object property) or nulled (array element).
type NonSerializable =
  | undefined
  | symbol
  | bigint
  | ((...args: never[]) => unknown);

// Array element transform: a non-serializable element -- including the
// `undefined` arm of a union like `(string | undefined)[]` -- becomes `null`,
// matching how `JSON.stringify` handles array holes / functions / undefined.
// Naked-`T` distribution splits the union before the check.
type SerializeElement<T> = T extends NonSerializable ? null : Serialize<T>;

type SerializeArray<T extends readonly unknown[]> = {
  [K in keyof T]: SerializeElement<T[K]>;
};

// A key is dropped when its value has no serializable arm at all (e.g. a
// required `() => void` or `bigint`, whose `Serialize` is `never`). Wrapped in
// tuples so the `extends never` test is not itself distributive.
type IsDropped<V> = [Serialize<V>] extends [never] ? true : false;

// Merge an intersection of mapped types into a single object literal,
// preserving optional/readonly modifiers (homomorphic over `keyof`). Keeps the
// serialized object types readable when hovered instead of `{ … } & { … }`.
type Flatten<T> = { [K in keyof T]: T[K] };

// Object transform, split into two mapped types so optionality is faithful:
// a key that can hold `undefined` (an optional property, or a `T | undefined`
// value) becomes optional with `undefined` removed from its type; every other
// retained key stays required. Either way a key whose value drops entirely is
// removed via the `as never` key filter. `Flatten` re-merges the two halves.
type SerializeObject<T> = Flatten<
  {
    [K in keyof T as undefined extends T[K]
      ? never
      : IsDropped<T[K]> extends true
        ? never
        : K]: Serialize<T[K]>;
  } & {
    [K in keyof T as undefined extends T[K]
      ? IsDropped<T[K]> extends true
        ? never
        : K
      : never]?: Serialize<T[K]>;
  }
>;

/**
 * The shape a value of type `T` takes after the JSON round-trip the wire
 * performs (server -> client). Apply at the consumer-facing boundary so the
 * declared type matches what the client actually receives. See the file header
 * for the full transform.
 */
export type Serialize<T> =
  IsAny<T> extends true
    ? T
    : T extends { toJSON(): infer J }
      ? Serialize<J>
      : T extends JsonPrimitive
        ? T
        : T extends NonSerializable
          ? never
          : T extends readonly unknown[]
            ? SerializeArray<T>
            : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>
              ? Record<string, never>
              : T extends object
                ? SerializeObject<T>
                : T;
