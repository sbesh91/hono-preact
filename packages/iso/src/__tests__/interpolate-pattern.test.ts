import { describe, it, expect } from 'vitest';
import { interpolatePattern } from '../internal/interpolate-pattern.js';

describe('interpolatePattern', () => {
  it('substitutes a single :param', () => {
    expect(interpolatePattern('board/:projectId', { projectId: 'p1' })).toBe(
      'board/p1'
    );
  });

  it('substitutes multiple :params', () => {
    expect(
      interpolatePattern('room/:roomId/user/:userId', {
        roomId: 'r1',
        userId: 'u9',
      })
    ).toBe('room/r1/user/u9');
  });

  it('keeps static segments verbatim', () => {
    expect(interpolatePattern('activity', {})).toBe('activity');
  });

  it('url-encodes values', () => {
    expect(interpolatePattern('board/:projectId', { projectId: 'a/b c' })).toBe(
      'board/a%2Fb%20c'
    );
  });

  it('drops an absent optional segment', () => {
    expect(interpolatePattern('a/:b?', {})).toBe('a');
  });

  // ---------------------------------------------------------------------
  // (security, P0) prototype-chain hazard: a `:param` name that collides
  // with an inherited `Object.prototype` member (`toString`, `constructor`,
  // ...) must be treated exactly like any other absent value: the segment is
  // dropped, never substituted with the inherited member's own value.
  // ---------------------------------------------------------------------

  it('drops a :toString segment when the values object carries no own toString entry, rather than substituting the inherited function', () => {
    const result = interpolatePattern('presence/:toString', {});
    expect(result).toBe('presence');
    expect(result).not.toMatch(/native code/);
    expect(result).not.toMatch(/function/i);
  });

  it('drops a :constructor segment absent an own constructor entry', () => {
    expect(interpolatePattern('plugin/:constructor', {})).toBe('plugin');
  });

  it('still substitutes a legitimately-supplied own :toString value', () => {
    expect(interpolatePattern('presence/:toString', { toString: 'x' })).toBe(
      'presence/x'
    );
  });

  // ---------------------------------------------------------------------
  // (regression) a param value supplied via a PROTOTYPE getter (not an own
  // property) must still substitute. The previous `Object.hasOwn` gate only
  // sees own properties, so a class instance whose param is a getter (e.g.
  // `class M { get id() { return '1' } }`) had its value silently dropped:
  // `buildPath('/user/:id', new M())` returned '/user' instead of
  // '/user/1'. The fix reads the value directly and gates on
  // `typeof value === 'string'`, which both keeps a getter-provided string
  // AND still drops an inherited Object.prototype member for an absent slot
  // (that member is a function, not a string).
  // ---------------------------------------------------------------------

  it('substitutes a param value supplied via a prototype getter, not just an own property', () => {
    class WithGetterId {
      [key: string]: string;
      get id() {
        return '1';
      }
    }
    expect(interpolatePattern('user/:id', new WithGetterId())).toBe('user/1');
  });

  it('drops a missing :toString segment rather than splicing in the inherited function, even when the values object is a class instance', () => {
    class Empty {
      [key: string]: string;
    }
    const result = interpolatePattern('presence/:toString', new Empty());
    expect(result).toBe('presence');
    expect(result).not.toMatch(/native code/);
    expect(result).not.toMatch(/function/i);
  });
});
