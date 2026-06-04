import { describe, it, expect } from 'vitest';
import { mergeRefs } from '../merge-refs.js';

describe('mergeRefs', () => {
  it('calls function refs with the node', () => {
    let seen: unknown = 'unset';
    const fn = (node: unknown) => {
      seen = node;
    };
    mergeRefs<string>(fn)('hello');
    expect(seen).toBe('hello');
  });

  it('assigns object refs', () => {
    const ref = { current: null as string | null };
    mergeRefs<string>(ref)('world');
    expect(ref.current).toBe('world');
  });

  it('skips null and undefined refs', () => {
    const ref = { current: null as string | null };
    expect(() => mergeRefs<string>(null, undefined, ref)('x')).not.toThrow();
    expect(ref.current).toBe('x');
  });

  it('fans out to every ref', () => {
    const a = { current: null as number | null };
    let b: number | null = null;
    mergeRefs<number>(a, (n) => {
      b = n;
    })(7);
    expect(a.current).toBe(7);
    expect(b).toBe(7);
  });
});
