import { describe, it, expect } from 'vitest';
import { shallowEqual } from '../shallow-equal.js';

describe('shallowEqual', () => {
  it('treats the same reference as equal', () => {
    const a = { x: 1 };
    expect(shallowEqual(a, a)).toBe(true);
  });

  it('compares primitives by value, with Object.is semantics', () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual('a', 'a')).toBe(true);
    expect(shallowEqual(1, 2)).toBe(false);
    expect(shallowEqual(NaN, NaN)).toBe(true);
    expect(shallowEqual(0, -0)).toBe(false);
  });

  it('treats null and undefined as unequal to an object', () => {
    expect(shallowEqual(null, {})).toBe(false);
    expect(shallowEqual({}, null)).toBe(false);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(undefined, null)).toBe(false);
  });

  it('compares arrays element-wise by identity', () => {
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual([], [])).toBe(true);
    expect(shallowEqual([1, 2], [1, 3])).toBe(false);
    expect(shallowEqual([1, 2], [1])).toBe(false);
    const o = {};
    expect(shallowEqual([o], [o])).toBe(true);
    expect(shallowEqual([{}], [{}])).toBe(false);
  });

  it('does not recurse: nested equal-but-distinct values are unequal', () => {
    expect(shallowEqual([[1]], [[1]])).toBe(false);
    expect(shallowEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(false);
  });

  it('compares plain objects by own enumerable keys and values', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('ignores key ORDER, which a fresh object literal need not preserve', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('distinguishes a same-length object from a differently-keyed one', () => {
    expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('does not treat an array as equal to an object', () => {
    expect(shallowEqual([], {})).toBe(false);
    expect(shallowEqual({}, [])).toBe(false);
  });

  it('compares non-plain objects by identity only', () => {
    // A Map/Set/Date has no own enumerable keys, so a key-wise comparison would
    // call every pair of them equal. Identity is the only honest answer here.
    expect(shallowEqual(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(false);
    expect(shallowEqual(new Set([1]), new Set([1]))).toBe(false);
    expect(shallowEqual(new Date(0), new Date(0))).toBe(false);
    const d = new Date(0);
    expect(shallowEqual(d, d)).toBe(true);
  });
});
