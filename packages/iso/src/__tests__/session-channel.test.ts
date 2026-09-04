import { describe, expect, it } from 'vitest';
import type { ServerPageCtx, ClientPageCtx } from '../define-middleware.js';
import { runRequestScope } from '../cache.js';
import { defineSessionChannel } from '../session-channel.js';
import { takeChannelSnapshot } from '../internal/channel-registry.js';
import {
  applyChannelSnapshot,
  resetChannelStore,
} from '../internal/channel-store.js';

// Neither tier's implementation touches anything on the ctx beyond its type, so
// a minimal cast-free stand-in is enough. If a future change starts reading a
// ctx field, this stub must grow rather than be cast away.
const clientCtx = { scope: 'page', location: {} } as unknown as ClientPageCtx;
const serverCtx = { scope: 'page' } as unknown as ServerPageCtx;

describe('defineSessionChannel', () => {
  it('gives each channel a distinct id', () => {
    expect(defineSessionChannel().__channelId).not.toBe(
      defineSessionChannel().__channelId
    );
  });

  it('publishes into the request snapshot under its own id', async () => {
    const channel = defineSessionChannel<{ signedIn: boolean }>();
    const snapshot = await runRequestScope(async () => {
      channel.publish(serverCtx, { signedIn: true });
      return takeChannelSnapshot();
    });
    expect(snapshot).toEqual({ [channel.__channelId]: { signedIn: true } });
  });

  it('reads back the value the server published', async () => {
    resetChannelStore();
    const channel = defineSessionChannel<{ signedIn: boolean }>();
    const snapshot = await runRequestScope(async () => {
      channel.publish(serverCtx, { signedIn: true });
      return takeChannelSnapshot();
    });
    applyChannelSnapshot(snapshot);
    expect(channel.read(clientCtx)).toEqual({ signedIn: true });
  });

  it('reads undefined before any round-trip has published', () => {
    resetChannelStore();
    expect(defineSessionChannel<number>().read(clientCtx)).toBeUndefined();
  });

  it('does not leak one channel value into another', async () => {
    resetChannelStore();
    const a = defineSessionChannel<number>();
    const b = defineSessionChannel<number>();
    const snapshot = await runRequestScope(async () => {
      a.publish(serverCtx, 1);
      return takeChannelSnapshot();
    });
    applyChannelSnapshot(snapshot);
    expect(a.read(clientCtx)).toBe(1);
    expect(b.read(clientCtx)).toBeUndefined();
  });
});
