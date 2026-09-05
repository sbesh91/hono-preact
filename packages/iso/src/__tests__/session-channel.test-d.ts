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

  it('accepts a flat record of primitives', () => {
    defineSessionChannel<{ signedIn: boolean }>();
    defineSessionChannel<{ role: string; plan: string }>();
    defineSessionChannel<{ roles: readonly string[] }>();
  });

  it('accepts a bare primitive', () => {
    defineSessionChannel<boolean>();
  });

  it('rejects a nested object', () => {
    // @ts-expect-error a channel carries one level, not a record
    defineSessionChannel<{ user: { id: string } }>();
  });

  it('rejects a Date field', () => {
    // @ts-expect-error a Date is not a channel primitive
    defineSessionChannel<{ expiresAt: Date }>();
  });

  it('rejects a method', () => {
    // @ts-expect-error a channel carries data, not behaviour
    defineSessionChannel<{ isAdmin(): boolean }>();
  });
});
