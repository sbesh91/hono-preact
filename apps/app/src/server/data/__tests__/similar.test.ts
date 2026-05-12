import { describe, it, expect } from 'vitest';
import { pickSimilar } from '../similar.js';

describe('pickSimilar', () => {
  it('returns 4 ids for a known movie', () => {
    const result = pickSimilar('1241982');
    expect(result).toHaveLength(4);
  });

  it('never includes the input id', () => {
    const result = pickSimilar('1241982');
    expect(result).not.toContain(1241982);
  });

  it('is deterministic for the same id', () => {
    expect(pickSimilar('1241982')).toEqual(pickSimilar('1241982'));
  });

  it('all picks exist in the movies catalog', async () => {
    const { moviesData } = await import('../movies.js');
    const allIds = new Set(moviesData.results.map((m) => m.id));
    const result = pickSimilar('1241982');
    for (const id of result) {
      expect(allIds.has(id)).toBe(true);
    }
  });
});
