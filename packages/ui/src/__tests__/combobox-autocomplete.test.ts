import { describe, it, expect } from 'vitest';
import {
  computeInlineCompletion,
  isForwardEdit,
  matchSubstring,
} from '../combobox/autocomplete.js';

describe('computeInlineCompletion', () => {
  it('completes to the first label, suffix selected, when it starts with typed', () => {
    expect(computeInlineCompletion('ap', 'Apple')).toEqual({
      text: 'Apple',
      selStart: 2,
      selEnd: 5,
    });
  });

  it('is case-insensitive on the match but preserves the label casing in text', () => {
    expect(computeInlineCompletion('AP', 'Apple')).toEqual({
      text: 'Apple',
      selStart: 2,
      selEnd: 5,
    });
  });

  it('returns null when the label does not start with the typed text', () => {
    expect(computeInlineCompletion('xy', 'Apple')).toBeNull();
  });

  it('returns null for an empty typed string or a null label', () => {
    expect(computeInlineCompletion('', 'Apple')).toBeNull();
    expect(computeInlineCompletion('ap', null)).toBeNull();
  });

  it('returns null when label equals typed (nothing to complete)', () => {
    expect(computeInlineCompletion('Apple', 'Apple')).toBeNull();
  });
});

describe('isForwardEdit', () => {
  it('is true when characters were appended', () => {
    expect(isForwardEdit('ap', 'app')).toBe(true);
  });
  it('is false on deletion or no-growth', () => {
    expect(isForwardEdit('app', 'ap')).toBe(false);
    expect(isForwardEdit('ap', 'ap')).toBe(false);
  });
});

describe('matchSubstring', () => {
  it('matches case-insensitively, trimming the query', () => {
    expect(matchSubstring('Apple', '  pp ')).toBe(true);
    expect(matchSubstring('Apple', 'z')).toBe(false);
  });
});
