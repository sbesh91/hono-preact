import { expectTypeOf } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { defineLoader } from '../define-loader.js';
import { serverRoute } from '../server-route.js';

declare const searchSchema: StandardSchemaV1<
  { page: string },
  { page: number }
>;
declare const paramsSchema: StandardSchemaV1<{ id: string }, { id: number }>;

function _probes() {
  // searchSchema narrows ctx.location.searchParams; pathParams stays default.
  defineLoader(
    async (ctx) => {
      expectTypeOf(ctx.location.searchParams).toEqualTypeOf<{ page: number }>();
      expectTypeOf(ctx.location.pathParams).toEqualTypeOf<
        Record<string, string>
      >();
      return 1;
    },
    { searchSchema }
  );

  // No schema -> defaults are Record<string,string>.
  defineLoader(async (ctx) => {
    expectTypeOf(ctx.location.searchParams).toEqualTypeOf<
      Record<string, string>
    >();
    return 1;
  });

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
}

void _probes;
