// Schema type-level tests: schemas live on serverRoute(r).loader only.
// Bare defineLoader has no location in ctx, so searchSchema/paramsSchema
// are not accepted there.
import { expectTypeOf } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { serverRoute } from '../server-route.js';

declare const searchSchema: StandardSchemaV1<
  { page: string },
  { page: number }
>;
declare const paramsSchema: StandardSchemaV1<{ id: string }, { id: number }>;

function _probes() {
  // serverRoute route form: paramsSchema overrides RouteParams; default keeps it.
  const route = serverRoute('/task/:id');
  route.loader(
    async (ctx) => {
      expectTypeOf(ctx.location.pathParams).toEqualTypeOf<{ id: number }>();
      return 1;
    },
    { paramsSchema }
  );
  route.loader(async (ctx) => {
    // RouteParams<'/task/:id'> = { id: string }
    expectTypeOf(ctx.location.pathParams).toEqualTypeOf<{ id: string }>();
    return 1;
  });

  // searchSchema narrows ctx.location.searchParams.
  route.loader(
    async (ctx) => {
      expectTypeOf(ctx.location.searchParams).toEqualTypeOf<{ page: number }>();
      expectTypeOf(ctx.location.pathParams).toEqualTypeOf<{ id: string }>();
      return 1;
    },
    { searchSchema }
  );

  // No schema -> defaults are Record<string,string> for search, RouteParams for path.
  route.loader(async (ctx) => {
    expectTypeOf(ctx.location.searchParams).toEqualTypeOf<
      Record<string, string>
    >();
    expectTypeOf(ctx.location.pathParams).toEqualTypeOf<{ id: string }>();
    return 1;
  });
}

void _probes;
