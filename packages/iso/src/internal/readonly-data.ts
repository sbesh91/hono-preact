/**
 * Shallow `Readonly<T>`, except identity for `unknown`/`any`. The internal
 * realtime plumbing types per-connection data as `unknown` at its seams;
 * `Readonly<unknown>` degenerates to `{}` (which `unknown` is not assignable
 * to), so the bare `Readonly<T>` breaks those seams. This guard keeps the
 * read-only contract for real user data while staying assignable at the
 * `unknown` boundary.
 */
export type ReadonlyData<T> = unknown extends T ? T : Readonly<T>;
