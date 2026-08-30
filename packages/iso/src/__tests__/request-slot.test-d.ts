import { expectTypeOf } from 'vitest';
import {
  requestSlotKey,
  readRequestSlot,
  writeRequestSlot,
  type RequestSlotKey,
} from '../internal/request-scoped-slot.js';

type Record = { status: number };

function _probes() {
  const KEY = requestSlotKey<Record>('probe');
  expectTypeOf(KEY).toEqualTypeOf<RequestSlotKey<Record>>();

  // The key carries the value type, so the read needs no type argument and no
  // cast. This is the whole point: before, every call site restated `<T>` and
  // an inconsistent restatement was silently accepted.
  expectTypeOf(readRequestSlot(KEY)).toEqualTypeOf<Record | undefined>();

  // A write must match the key's type.
  writeRequestSlot(KEY, { status: 404 });

  // @ts-expect-error a value of the wrong shape cannot be stored under this key
  writeRequestSlot(KEY, { status: 'nope' });

  // @ts-expect-error a bare symbol is not a slot key: the value type is required
  readRequestSlot(Symbol('untyped'));

  // Two keys with different value types do not interchange.
  const OTHER = requestSlotKey<string[]>('other');
  expectTypeOf(readRequestSlot(OTHER)).toEqualTypeOf<string[] | undefined>();
  // @ts-expect-error a Record is not a string[]
  writeRequestSlot(OTHER, { status: 404 });

  // A slot whose absence is meaningful spells the undefined itself, so
  // clearing it typechecks without widening every read.
  const CLEARABLE = requestSlotKey<Record | undefined>('clearable');
  writeRequestSlot(CLEARABLE, undefined);
  expectTypeOf(readRequestSlot(CLEARABLE)).toEqualTypeOf<Record | undefined>();
}

void _probes;
