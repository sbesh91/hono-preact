import { describe, it, expect } from 'vitest';
import { generateBoxOffice } from '../box-office.js';

describe('generateBoxOffice', () => {
  it('returns the expected shape', () => {
    const r = generateBoxOffice('1241982');
    expect(typeof r.budget).toBe('number');
    expect(typeof r.revenue).toBe('number');
    expect(typeof r.openingWeekend).toBe('number');
    expect(typeof r.screens).toBe('number');
  });

  it('is deterministic for the same id', () => {
    expect(generateBoxOffice('1241982')).toEqual(generateBoxOffice('1241982'));
  });

  it('uses real budget/revenue from movieData when present', () => {
    const r = generateBoxOffice('1241982');
    expect(r.budget).toBeGreaterThan(0);
    expect(r.revenue).toBeGreaterThan(0);
  });

  it('synthesizes plausible values for ids not in movieData', () => {
    const r = generateBoxOffice('99999999');
    expect(r.budget).toBeGreaterThan(0);
    expect(r.revenue).toBeGreaterThan(0);
    expect(r.openingWeekend).toBeGreaterThan(0);
    expect(r.screens).toBeGreaterThan(0);
  });
});
