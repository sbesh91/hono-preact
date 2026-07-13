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

describe('defineChannel param-name validation', () => {
  it('throws at definition time for a param name outside [A-Za-z0-9_] (e.g. a hyphen)', () => {
    // A non-conforming param name (a hyphen is outside the class) is not a
    // param to requiredParamSlots/declaredParamSlots or to
    // interpolatePattern: nothing is required, and interpolatePattern leaves
    // the segment literal, so every connection would collapse onto the one
    // constant topic 'board/:board-id' and silently share state across
    // resources. That must fail loudly here instead.
    expect(() => defineChannel('board/:board-id')).toThrow(/board\/:board-id/);
    expect(() => defineChannel('board/:board-id')).toThrow(
      /not a valid channel param/
    );
  });

  it('names the offending segment and the allowed name class in the error', () => {
    expect(() => defineChannel('room/:room-id/user/:userId')).toThrow(
      /:room-id/
    );
    expect(() => defineChannel('room/:room-id/user/:userId')).toThrow(
      /\[A-Za-z0-9_\]/
    );
  });

  it('does not throw for conforming param names, including modifier forms', () => {
    expect(() => defineChannel('board/:boardId')).not.toThrow();
    expect(() => defineChannel('board/:board_id')).not.toThrow();
    expect(() => defineChannel('files/:x?')).not.toThrow();
    expect(() => defineChannel('files/:rest*')).not.toThrow();
    expect(() => defineChannel('files/:rest+')).not.toThrow();
  });

  it('does not throw for a param-less or literal-only name', () => {
    expect(() => defineChannel('activity')).not.toThrow();
    expect(() => defineChannel('a/b/c')).not.toThrow();
  });
});
