import { describe, it, expect } from 'vitest';
import { generateCast } from '../cast.js';

describe('generateCast', () => {
  it('returns 6 members for a known movie id', () => {
    const result = generateCast('1241982');
    expect(result).toHaveLength(6);
  });

  it('is deterministic for the same id', () => {
    const a = generateCast('1241982');
    const b = generateCast('1241982');
    expect(a).toEqual(b);
  });

  it('returns different rosters for different ids', () => {
    const a = generateCast('1241982');
    const b = generateCast('558449');
    expect(a).not.toEqual(b);
  });

  it('each member has name and role', () => {
    const result = generateCast('1241982');
    for (const m of result) {
      expect(typeof m.name).toBe('string');
      expect(m.name.length).toBeGreaterThan(0);
      expect(typeof m.role).toBe('string');
      expect(m.role.length).toBeGreaterThan(0);
    }
  });
});
