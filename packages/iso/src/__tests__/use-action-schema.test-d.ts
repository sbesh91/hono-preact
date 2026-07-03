import { expectTypeOf } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { UseActionOptions } from '../action.js';

// schema is optional and typed to the payload.
expectTypeOf<
  UseActionOptions<{ title: string }, { ok: boolean }>['schema']
>().toEqualTypeOf<StandardSchemaV1<unknown, { title: string }> | undefined>();

// A schema whose output mismatches the payload is a type error.
const wrong = {} as StandardSchemaV1<unknown, { nope: number }>;
// @ts-expect-error output shape must match the action payload
const _bad: UseActionOptions<{ title: string }, unknown> = { schema: wrong };
