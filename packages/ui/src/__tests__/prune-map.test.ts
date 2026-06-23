import { describe, it, expect } from 'vitest';
import { pruneMapToIds } from '../toast/prune-map.js';

describe('pruneMapToIds', () => {
  it('removes entries whose key is not in the live set', () => {
    const m = new Map<string, number>([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
    pruneMapToIds(m, new Set(['a', 'c']));
    expect([...m.keys()]).toEqual(['a', 'c']);
  });

  it('keeps every entry when all keys are live', () => {
    const m = new Map<number, string>([
      [1, 'x'],
      [2, 'y'],
    ]);
    pruneMapToIds(m, new Set([1, 2]));
    expect(m.size).toBe(2);
  });

  it('empties the map when nothing is live', () => {
    const m = new Map([['a', 1]]);
    pruneMapToIds(m, new Set<string>());
    expect(m.size).toBe(0);
  });
});
