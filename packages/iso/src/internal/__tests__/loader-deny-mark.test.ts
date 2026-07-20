import { describe, it, expect } from 'vitest';
import { deny } from '../../outcomes.js';
import {
  markLoaderDeny,
  isLoaderDeny,
} from '../loader-deny-mark.js';

describe('loader-deny-mark', () => {
  it('an untagged deny is not a loader deny', () => {
    expect(isLoaderDeny(deny(404, 'nope'))).toBe(false);
  });

  it('markLoaderDeny tags in place and returns the same object', () => {
    const d = deny(404, 'nope');
    const out = markLoaderDeny(d);
    expect(out).toBe(d);
    expect(isLoaderDeny(d)).toBe(true);
  });

  it('isLoaderDeny is false for non-deny values', () => {
    expect(isLoaderDeny(null)).toBe(false);
    expect(isLoaderDeny({ __outcome: 'redirect', to: '/x', status: 302 })).toBe(
      false
    );
    expect(isLoaderDeny(new Error('x'))).toBe(false);
  });
});
