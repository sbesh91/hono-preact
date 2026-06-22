import { expectTypeOf } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { defineAction } from '../action.js';
import type { ActionStub } from '../action.js';

declare const NewTask: StandardSchemaV1<
  { title: string; count: string },
  { title: string; count: number }
>;

function _probes() {
  // With `input`: handler payload is InferOutput; stub TPayload is InferOutput.
  const create = defineAction(
    async (_ctx, payload) => {
      expectTypeOf(payload).toEqualTypeOf<{ title: string; count: number }>();
      return { id: 1 };
    },
    { input: NewTask }
  );
  expectTypeOf(create).toEqualTypeOf<
    ActionStub<{ title: string; count: number }, { id: number }, never>
  >();

  // Without `input`: payload generic still inferred from usage (existing).
  const plain = defineAction(async (_ctx, payload: { x: number }) => payload.x);
  expectTypeOf(plain).toEqualTypeOf<ActionStub<{ x: number }, number, never>>();
}

void _probes;
