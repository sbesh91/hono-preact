import type { Context } from 'hono';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { validateWithSchema } from '../validate.js';
import { deny } from '../outcomes.js';

/**
 * Loose view of a loader function for the post-coercion call seam: location
 * params are `unknown` because the schema output type is erased at the ref
 * (the public `Loader<T, TParams, TSearch>` generic carried it to the loader
 * author). Reading `loaderRef.fn` as this type is the sanctioned
 * structural-read boundary used by BOTH loader execution paths (SSR
 * loader-runner + RPC loaders-handler) so the two cannot diverge.
 */
export type LooseLoaderFn = (props: {
  c: Context;
  location: { path: string; pathParams: unknown; searchParams: unknown };
  signal: AbortSignal;
}) => Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>;

/**
 * Validate + coerce a loader's path/search params against its schemas. Throws
 * `deny(404)` for an invalid route param (the URL names no valid resource) and
 * `deny(400)` for an invalid query string. Returns the coerced values (typed
 * `unknown`: the schema output type is not known here; the public
 * `Loader<T, TParams, TSearch>` generic carries it to the loader author). Shared
 * by BOTH loader execution paths (SSR `loader-runner.ts` and RPC
 * `loaders-handler.ts`) so they cannot drift.
 */
export async function coerceLoaderLocation(
  schemas: { searchSchema?: StandardSchemaV1; paramsSchema?: StandardSchemaV1 },
  pathParams: unknown,
  searchParams: unknown
): Promise<{ pathParams: unknown; searchParams: unknown }> {
  let p = pathParams;
  let s = searchParams;
  if (schemas.paramsSchema) {
    const r = await validateWithSchema(schemas.paramsSchema, pathParams);
    if (!r.ok) throw deny(404, 'Invalid route parameters');
    p = r.value;
  }
  if (schemas.searchSchema) {
    const r = await validateWithSchema(schemas.searchSchema, searchParams);
    if (!r.ok) throw deny(400, 'Invalid search parameters');
    s = r.value;
  }
  return { pathParams: p, searchParams: s };
}
