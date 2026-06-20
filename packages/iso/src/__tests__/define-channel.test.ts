import { describe, it, expect } from 'vitest';
import { defineChannel } from '../define-channel.js';

describe('defineChannel.key', () => {
  it('substitutes a single :param', () => {
    const c = defineChannel('board/:projectId')<{ x: number }>();
    expect(c.key({ projectId: 'p1' })).toBe('board/p1');
  });

  it('substitutes multiple :params', () => {
    const c = defineChannel('room/:roomId/user/:userId')();
    expect(c.key({ roomId: 'r1', userId: 'u9' })).toBe('room/r1/user/u9');
  });

  it('returns the bare name for a param-less channel', () => {
    const c = defineChannel('activity')<number>();
    expect(c.key()).toBe('activity');
  });

  it('url-encodes param values', () => {
    const c = defineChannel('board/:projectId')();
    expect(c.key({ projectId: 'a/b c' })).toBe('board/a%2Fb%20c');
  });

  it('exposes the channel name', () => {
    expect(defineChannel('board/:projectId')().name).toBe('board/:projectId');
  });
});
