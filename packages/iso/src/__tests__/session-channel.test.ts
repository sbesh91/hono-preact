import { afterEach, describe, expect, it, vi } from 'vitest';
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

// The warning is gated on `import.meta.env.DEV`, which vitest leaves true, so
// this exercises the branch a production bundle folds away.
describe('oversized payload warning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns and still publishes when the encoded value is over 256 bytes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // An explicit id keeps this test on the payload-size warning alone: an
    // unnamed channel also warns about its missing build-time id.
    const channel = defineSessionChannel<{ blob: string }>('test/oversized');
    const value = { blob: 'x'.repeat(400) };
    const snapshot = await runRequestScope(async () => {
      channel.publish(serverCtx, value);
      return takeChannelSnapshot();
    });

    expect(snapshot).toEqual({ [channel.__channelId]: value });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain(channel.__channelId);
    expect(message).toContain('411 bytes');
    expect(message).toContain('decision');
  });

  it('stays quiet for a decision-sized value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const channel = defineSessionChannel<{ signedIn: boolean }>('test/small');
    await runRequestScope(async () => {
      channel.publish(serverCtx, { signedIn: true });
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

// The Vite plugin injects a module-derived id at every `defineSessionChannel`
// call site it can see. A call site it cannot see (a `.mts`/`.cjs` module, a
// `.server.*` module, a pre-bundled dependency) falls back to the eval-order
// counter, which the two bundles do not share, so the channel silently never
// resolves. Dev-only, like the oversized-payload warning above.
describe('missing build-time id warning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns once per channel when no id was supplied', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const channel = defineSessionChannel<{ signedIn: boolean }>();

    await runRequestScope(async () => {
      channel.publish(serverCtx, { signedIn: true });
      channel.publish(serverCtx, { signedIn: false });
    });
    channel.read(clientCtx);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain(channel.__channelId);
    expect(message).toContain('build-time id');
    expect(message).toContain('undefined');
  });

  it('warns from read() alone, which is the tier that observes the failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    defineSessionChannel<number>().read(clientCtx);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the call site was given an id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const channel = defineSessionChannel<{ signedIn: boolean }>(
      'src/auth/session-channel.ts:0'
    );
    await runRequestScope(async () => {
      channel.publish(serverCtx, { signedIn: true });
    });
    channel.read(clientCtx);
    expect(warn).not.toHaveBeenCalled();
  });
});
