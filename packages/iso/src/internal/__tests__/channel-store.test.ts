import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyChannelSnapshot,
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

  it('replaces rather than merges, so a dropped key clears', () => {
    applyChannelSnapshot({ a: 1, b: 2 });
    applyChannelSnapshot({ a: 1 });
    expect(readChannelValue('b')).toBeUndefined();
  });

  it('ignores a null snapshot so a response without the header is not a logout', () => {
    applyChannelSnapshot({ a: 1 });
    applyChannelSnapshot(null);
    expect(readChannelValue('a')).toBe(1);
  });
});
