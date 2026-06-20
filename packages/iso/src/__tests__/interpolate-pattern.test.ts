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
});
