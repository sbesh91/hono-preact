import { describe, it, expect } from 'vitest';
import { generateSummary } from '../summaries.js';

describe('generateSummary', () => {
  it('returns a non-empty string', () => {
    expect(generateSummary('1241982').length).toBeGreaterThan(0);
  });

  it('is deterministic for the same id', () => {
    expect(generateSummary('1241982')).toEqual(generateSummary('1241982'));
  });

  it('returns different output for different ids', () => {
    expect(generateSummary('1241982')).not.toEqual(generateSummary('558449'));
  });

  it('is roughly 40-60 words', () => {
    const words = generateSummary('1241982').split(/\s+/).filter(Boolean);
    expect(words.length).toBeGreaterThanOrEqual(40);
    expect(words.length).toBeLessThanOrEqual(60);
  });
});
