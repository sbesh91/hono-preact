import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyChannelSnapshot,
  hydrateChannelsFromDocument,
  readChannelValue,
  resetChannelStore,
} from '../channel-store.js';

describe('channel store', () => {
  beforeEach(() => resetChannelStore());

  it('reads back an applied snapshot', () => {
    applyChannelSnapshot({ a: { signedIn: true } });
    expect(readChannelValue('a')).toEqual({ signedIn: true });
  });

  it('returns undefined for a channel never published', () => {
    applyChannelSnapshot({ a: 1 });
    expect(readChannelValue('b')).toBeUndefined();
  });

  it('preserves a key the new snapshot says nothing about', () => {
    applyChannelSnapshot({ a: 1, b: 2 });
    applyChannelSnapshot({ a: 9 });
    expect(readChannelValue('a')).toBe(9);
    expect(readChannelValue('b')).toBe(2);
  });

  it('clears a channel only on an explicit falsy publish', () => {
    applyChannelSnapshot({ a: { signedIn: true } });
    applyChannelSnapshot({ a: null });
    expect(readChannelValue('a')).toBeNull();
  });

  it('publishing on one channel leaves another channel alone', () => {
    applyChannelSnapshot({ a: 'first', b: 'second' });
    applyChannelSnapshot({ a: 'updated' });
    expect(readChannelValue('b')).toBe('second');
  });

  it('ignores a null snapshot so a response without the header is not a logout', () => {
    applyChannelSnapshot({ a: 1 });
    applyChannelSnapshot(null);
    expect(readChannelValue('a')).toBe(1);
  });
});

describe('hydrateChannelsFromDocument', () => {
  beforeEach(() => resetChannelStore());
  afterEach(() => {
    delete (globalThis as { __HP_CHANNELS__?: unknown }).__HP_CHANNELS__;
  });

  it('flows the SSR global through to readChannelValue', () => {
    (globalThis as { __HP_CHANNELS__?: unknown }).__HP_CHANNELS__ = {
      demo: { signedIn: true },
    };
    hydrateChannelsFromDocument();
    expect(readChannelValue('demo')).toEqual({ signedIn: true });
  });

  it('is a no-op when the global is absent', () => {
    applyChannelSnapshot({ demo: 1 });
    hydrateChannelsFromDocument();
    expect(readChannelValue('demo')).toBe(1);
  });

  it('cannot throw on a malformed global', () => {
    (globalThis as { __HP_CHANNELS__?: unknown }).__HP_CHANNELS__ =
      'not-an-object';
    expect(() => hydrateChannelsFromDocument()).not.toThrow();
    expect(readChannelValue('demo')).toBeUndefined();
  });
});
