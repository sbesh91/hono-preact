import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Form } from '../form.js';
import { defineAction } from '../action.js';

declare const good: StandardSchemaV1<unknown, { title: string }>;
declare const wrong: StandardSchemaV1<unknown, { nope: number }>;

function _probes() {
  const create = defineAction(async (_c, _p: { title: string }) => 1, {
    __module: 'm',
    __action: 'a',
  });
  // OK: schema output matches the action payload.
  Form({ action: create, schema: good, children: null });
  // @ts-expect-error schema output { nope: number } != payload { title: string }
  Form({ action: create, schema: wrong, children: null });
}

void _probes;
