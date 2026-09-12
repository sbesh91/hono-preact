import { describe, it, expectTypeOf } from 'vitest';
import { useAction } from '../action.js';
import type { ActionRef } from '../action.js';
import type { Serialize } from '../internal/serialize.js';

// A stub of the shape `defineAction` produces, declared rather than built so
// these assertions stay about `useAction`'s option typing and nothing else.
declare const stub: ActionRef<{ id: string }, { count: number }, never, never>;

describe('useAction callback parameter inference', () => {
  it('A: types onError/onSuccess without onMutate', () => {
    useAction(stub, {
      onSuccess: (data) => {
        expectTypeOf(data).toEqualTypeOf<Serialize<{ count: number }>>();
      },
      // The defect in #411: the options union is discriminated on `onMutate`,
      // and an object literal that omits it left this parameter an implicit
      // `any` rather than resolving to the without-mutate arm.
      onError: (err) => {
        expectTypeOf(err).toEqualTypeOf<Error>();
      },
    });
  });

  it('B: still threads the onMutate snapshot into both callbacks', () => {
    useAction(stub, {
      onMutate: (payload) => {
        expectTypeOf(payload).toEqualTypeOf<{ id: string }>();
        return { undo: () => {} };
      },
      onSuccess: (data, snapshot) => {
        expectTypeOf(data).toEqualTypeOf<Serialize<{ count: number }>>();
        expectTypeOf(snapshot).toEqualTypeOf<{ undo: () => void }>();
      },
      onError: (err, snapshot) => {
        expectTypeOf(err).toEqualTypeOf<Error>();
        expectTypeOf(snapshot).toEqualTypeOf<{ undo: () => void }>();
      },
    });
  });

  it('C: a snapshot parameter is an error when onMutate is absent', () => {
    // @ts-expect-error no onMutate, so there is no snapshot to receive
    useAction(stub, { onError: (_e: Error, _snapshot: unknown) => {} });
  });

  it('D: the stub method form types its callbacks the same way', () => {
    stub.useAction({
      onSuccess: (data) => {
        expectTypeOf(data).toEqualTypeOf<Serialize<{ count: number }>>();
      },
      onError: (err) => {
        expectTypeOf(err).toEqualTypeOf<Error>();
      },
    });
    stub.useAction({
      onMutate: () => 'snap',
      onError: (err, snapshot) => {
        expectTypeOf(err).toEqualTypeOf<Error>();
        expectTypeOf(snapshot).toEqualTypeOf<string>();
      },
    });
  });
});
