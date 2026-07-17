import { describe, it, expect } from 'vitest';
import { boardHref } from '../board-links.js';

describe('boardHref', () => {
  it('returns the bare project path when both knobs are at their default', () => {
    expect(boardHref('inf', {})).toBe('/demo/projects/inf');
  });

  it('sets only ?priority= when insights is left at its default', () => {
    expect(boardHref('inf', { priority: 'urgent' })).toBe(
      '/demo/projects/inf?priority=urgent'
    );
  });

  it('sets only ?insights= when priority is left at its default', () => {
    expect(boardHref('inf', { insights: 'deep' })).toBe(
      '/demo/projects/inf?insights=deep'
    );
  });

  it('composes both knobs when both are set to a non-default value', () => {
    const href = boardHref('inf', { priority: 'high', insights: 'deep' });
    const [path, qs] = href.split('?');
    expect(path).toBe('/demo/projects/inf');
    expect(new URLSearchParams(qs).get('priority')).toBe('high');
    expect(new URLSearchParams(qs).get('insights')).toBe('deep');
  });

  it('treats priority "all" as the default (dropped from the query)', () => {
    expect(boardHref('inf', { priority: 'all', insights: 'deep' })).toBe(
      '/demo/projects/inf?insights=deep'
    );
  });

  it('treats insights "quick" as the default (dropped from the query)', () => {
    expect(boardHref('inf', { priority: 'high', insights: 'quick' })).toBe(
      '/demo/projects/inf?priority=high'
    );
  });

  it('treats both "all" and "quick" as defaults, yielding the bare path', () => {
    expect(boardHref('inf', { priority: 'all', insights: 'quick' })).toBe(
      '/demo/projects/inf'
    );
  });
});
