// `serverRoute(r).action` mirrors `defineAction`'s typing: the route binding is
// purely a server-side page-use concern, so the payload/result inference is
// identical (an action reads its data from the payload, not route params).
import { expectTypeOf } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { serverRoute } from '../server-route.js';
import type { ActionRef } from '../action.js';

declare const NewComment: StandardSchemaV1<
  { body: string; count: string },
  { body: string; count: number }
>;

function _probes() {
  const route = serverRoute('/things/:id');

  // With `input`: handler payload is InferOutput; ref TPayload is InferOutput.
  const create = route.action(
    async (_ctx, payload) => {
      expectTypeOf(payload).toEqualTypeOf<{ body: string; count: number }>();
      return { id: 1 };
    },
    { input: NewComment }
  );
  expectTypeOf(create).toEqualTypeOf<
    ActionRef<{ body: string; count: number }, { id: number }, never>
  >();

  // Without `input`: payload generic is inferred from usage, same as defineAction.
  const plain = route.action(async (_ctx, payload: { x: number }) => payload.x);
  expectTypeOf(plain).toEqualTypeOf<ActionRef<{ x: number }, number, never>>();
}

void _probes;
