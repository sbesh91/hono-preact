import { describe, expectTypeOf, it } from 'vitest';
import { defineSessionChannel } from '../index.js';
import type { ClientPageCtx, ServerCtx } from '../index.js';

describe('SessionChannel types', () => {
  it('reads back the declared type as optional', () => {
    const channel = defineSessionChannel<{ signedIn: boolean }>();
    expectTypeOf(channel.read).returns.toEqualTypeOf<
      { signedIn: boolean } | undefined
    >();
  });

  it('rejects publishing a value of the wrong type', () => {
    const channel = defineSessionChannel<{ signedIn: boolean }>();
    const ctx = {} as ServerCtx;
    // @ts-expect-error a number is not the declared payload
    channel.publish(ctx, 3);
  });

  it('rejects a client ctx on publish', () => {
    const channel = defineSessionChannel<number>();
    const clientCtx = {} as ClientPageCtx;
    // @ts-expect-error publish is the server tier
    channel.publish(clientCtx, 1);
  });
});
