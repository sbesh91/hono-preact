import { describe, expect, it } from 'vitest';
import { runRequestScope } from '../../cache.js';
import { publishToChannel, takeChannelSnapshot } from '../channel-registry.js';
import { decodeSnapshot, encodeSnapshot } from '../channel-wire.js';

describe('channel registry', () => {
  it('accumulates publishes from separate channels into one snapshot', async () => {
    const snapshot = await runRequestScope(async () => {
      publishToChannel('a', { signedIn: true });
      publishToChannel('b', 3);
      return takeChannelSnapshot();
    });
    expect(snapshot).toEqual({ a: { signedIn: true }, b: 3 });
  });

  it('last write wins for the same channel', async () => {
    const snapshot = await runRequestScope(async () => {
      publishToChannel('a', 1);
      publishToChannel('a', 2);
      return takeChannelSnapshot();
    });
    expect(snapshot).toEqual({ a: 2 });
  });

  it('returns null when nothing published', async () => {
    const snapshot = await runRequestScope(async () => takeChannelSnapshot());
    expect(snapshot).toBeNull();
  });

  it('clears the slot so a second take sees nothing', async () => {
    const second = await runRequestScope(async () => {
      publishToChannel('a', 1);
      takeChannelSnapshot();
      return takeChannelSnapshot();
    });
    expect(second).toBeNull();
  });

  it('does not throw outside a request scope', () => {
    expect(() => publishToChannel('a', 1)).not.toThrow();
    expect(takeChannelSnapshot()).toBeNull();
  });

  it('round-trips a snapshot through the wire encoding', () => {
    const snapshot = { a: { signedIn: true } };
    expect(decodeSnapshot(encodeSnapshot(snapshot))).toEqual(snapshot);
  });

  it('decodes malformed input to null rather than throwing', () => {
    expect(decodeSnapshot('not json')).toBeNull();
    expect(decodeSnapshot(null)).toBeNull();
    expect(decodeSnapshot('[1,2]')).toBeNull();
    expect(decodeSnapshot('"a string"')).toBeNull();
  });
});
