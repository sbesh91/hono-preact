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

  it('throws for a colon that is not at the start of the segment (the RouteParams hole)', () => {
    // RouteParams<'board:boardId'> splits on ':' ANYWHERE in the segment, not
    // just at its start, so it types a required `boardId` even though
    // PARAM_SEGMENT (and interpolatePattern) never treat this segment as a
    // param: nothing is substituted, and every connection collapses onto the
    // one constant topic 'board:boardId'. The old `segment.startsWith(':')`
    // gate missed this spelling entirely; it must throw now.
    expect(() => defineChannel('board:boardId')).toThrow(/board:boardId/);
    // The colon-namespaced-literal shape gets its OWN advice (Finding 10):
    // there is no ':param' to rename here, so the message explains the
    // RouteParams/interpolatePattern mismatch instead.
    expect(() => defineChannel('board:boardId')).toThrow(
      /RouteParams still reads 'boardId'/
    );
  });

  it('throws for a colon-hyphen segment (colon not at start, plus a non-conforming char)', () => {
    expect(() => defineChannel('board-:id')).toThrow(/board-:id/);
  });

  it('throws for a minimal single-letter colon-anywhere segment', () => {
    expect(() => defineChannel('a:b')).toThrow(/a:b/);
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

  // -------------------------------------------------------------------------
  // (P0) the over-wide "any colon throws" rule rejected working v0.10.1 apps:
  // a colon-namespaced CONSTANT channel name (no param ever claimed by
  // RouteParams, since the suffix after the colon is not an identifier) must
  // not throw. Only a segment the type layer would still misread as a
  // required/optional param stays rejected.
  // -------------------------------------------------------------------------

  it('does not throw for a colon-namespaced constant name whose suffix is not an identifier (hyphen)', () => {
    const c = defineChannel('notifications:user-alerts')();
    expect(c.key()).toBe('notifications:user-alerts');
  });

  it('does not throw for a colon-namespaced constant name with a numeric-suffixed hyphen', () => {
    const c = defineChannel('chat:lobby-1')();
    expect(c.key()).toBe('chat:lobby-1');
  });

  it('does not throw for a colon-namespaced constant name whose suffix contains a period', () => {
    const c = defineChannel('events:order.created')();
    expect(c.key()).toBe('events:order.created');
  });

  it('still throws for a colon-namespaced name whose suffix IS a claimable identifier (the type layer would require it as a param)', () => {
    expect(() => defineChannel('board:boardId')).toThrow(
      /RouteParams still reads 'boardId'/
    );
    expect(() => defineChannel('metrics:cpu')).toThrow(
      /RouteParams still reads 'cpu'/
    );
  });

  it('advises a colon-namespaced-literal hazard to make a real segment or drop the colon (not "rename the param")', () => {
    // The ':'-prefixed shape's "rename the param" advice does not fit here:
    // 'board:boardId' never used a ':param' at all, so there is nothing to
    // rename. The message must point at the real fix instead.
    expect(() => defineChannel('board:boardId')).toThrow(
      /make it a real ':param' segment/
    );
    expect(() => defineChannel('board:boardId')).toThrow(/board\/:boardId/);
    expect(() => defineChannel('board:boardId')).toThrow(
      /remove the colon from the constant name/
    );
  });

  it('still throws for a hyphenated leading-colon param (board/:board-id): an unambiguous attempted :param with an invalid name', () => {
    expect(() => defineChannel('board/:board-id')).toThrow(
      /not a valid channel param/
    );
  });
});

describe('defineChannel multi-optional-slot validation (F2)', () => {
  it('throws for a channel with two optional slots (topic-collapse hazard)', () => {
    // room/:a?/:b? -- key {a:'x'} and key {b:'x'} both drop the OTHER
    // absent slot and resolve to the same topic 'room/x', cross-leaking
    // presence/broadcasts between what the author modeled as two distinct
    // resources.
    expect(() => defineChannel('room/:a?/:b?')).toThrow(/unambiguous topic/);
    expect(() => defineChannel('room/:a?/:b?')).toThrow(/:a/);
    expect(() => defineChannel('room/:a?/:b?')).toThrow(/:b/);
  });

  it('throws for a mix of optional and rest slots', () => {
    expect(() => defineChannel('room/:a*/:b?')).toThrow(/unambiguous topic/);
    expect(() => defineChannel('room/:a+/:b?')).toThrow(/unambiguous topic/);
  });

  it('does not throw for at most one optional slot', () => {
    expect(() => defineChannel('room/:a/:b?')).not.toThrow();
    expect(() => defineChannel('room/:a?')).not.toThrow();
    expect(() => defineChannel('room/:a/:b')).not.toThrow();
  });
});
