import type { Context } from 'hono';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ServerCaller } from '../server-caller.js';
import { validateWithSchema } from '../validate.js';
import { deny } from '../outcomes.js';
import {
  VALIDATION_ISSUES_KEY,
  VALIDATION_FAILED_MESSAGE,
} from './contract.js';

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
  // The server caller threaded onto LoaderCtx (`ctx.call`). Typed via a
  // type-only import: it is erased at runtime, so the back-edge to
  // server-caller.ts (which imports `coerceLoaderLocation` from this file) is a
  // type-only cycle, not a runtime one.
  call: ServerCaller['call'];
}) => Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>;

/**
 * Validate + coerce a loader's path/search params against its schemas. Throws
 * `deny(404)` for an invalid route param (the URL names no valid resource) and
 * `deny(400)` for an invalid query string. Each deny carries the normalized
 * Standard Schema issues under `VALIDATION_ISSUES_KEY`, matching the action
 * path's `deny(422)` so `getValidationIssues` / `<FieldError>` surface
 * field-level errors uniformly on the loader path (the status differs by
 * intent: a bad route param is a 404 resource miss, a bad query string a 400).
 * Returns the coerced values (typed `unknown`: the schema output type is not
 * known here; the public `Loader<T, TParams, TSearch>` generic carries it to
 * the loader author). Shared by BOTH loader execution paths (SSR
 * `loader-runner.ts` and RPC `loaders-handler.ts`) so they cannot drift.
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
    if (!r.ok) {
      throw deny(404, 'Invalid route parameters', {
        data: { [VALIDATION_ISSUES_KEY]: r.issues },
      });
    }
    p = r.value;
  }
  if (schemas.searchSchema) {
    const r = await validateWithSchema(schemas.searchSchema, searchParams);
    if (!r.ok) {
      throw deny(400, 'Invalid search parameters', {
        data: { [VALIDATION_ISSUES_KEY]: r.issues },
      });
    }
    s = r.value;
  }
  return { pathParams: p, searchParams: s };
}

/**
 * Validate an action payload against its `input` schema. Returns the schema's
 * validated output, or throws `deny(422, 'Validation failed')` carrying the
 * normalized issues under VALIDATION_ISSUES_KEY. Mirrors coerceLoaderLocation
 * for the action path; shared by the page-actions handler (HTTP) and the
 * server caller (ctx.call) so the two cannot drift.
 */
export async function coerceActionInput(
  input: StandardSchemaV1,
  payload: unknown
): Promise<unknown> {
  const validated = await validateWithSchema(input, payload);
  if (!validated.ok) {
    throw deny(422, VALIDATION_FAILED_MESSAGE, {
      data: { [VALIDATION_ISSUES_KEY]: validated.issues },
    });
  }
  return validated.value;
}
