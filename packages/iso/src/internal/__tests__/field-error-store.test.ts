// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createFieldErrorStore } from '../store-signal.js';

describe('createFieldErrorStore', () => {
  it('returns a STABLE signal per field name (identity preserved across calls)', () => {
    const store = createFieldErrorStore();
    expect(store.fieldError('a')).toBe(store.fieldError('a'));
  });

  it('setAll is value-gated: updating one field does not touch a sibling field signal', () => {
    const store = createFieldErrorStore();
    store.setAll({ a: ['a1'], b: ['b1'] });
    const bSignal = store.fieldError('b');
    const bValueBefore = bSignal.value;

    // Only 'a' changes; 'b' keeps the same messages.
    store.setAll({ a: ['a2'], b: ['b1'] });

    // Same signal object, and its value reference is unchanged -- setAll's
    // `sameMessages` gate means 'b' was never written to.
    expect(store.fieldError('b')).toBe(bSignal);
    expect(store.fieldError('b').value).toBe(bValueBefore);
    // 'a' did change.
    expect(store.fieldError('a').value).toEqual(['a2']);
  });

  it('reuses the same signal object across a clear and a later reappear', () => {
    const store = createFieldErrorStore();
    store.setAll({ a: ['a1'] });
    const aSignal = store.fieldError('a');
    expect(aSignal.value).toEqual(['a1']);

    // Clear: 'a' drops out of the map. The signal is zeroed, not deleted.
    store.setAll({});
    expect(store.fieldError('a')).toBe(aSignal);
    expect(aSignal.value).toEqual([]);

    // Reappear: 'a' comes back.
    store.setAll({ a: ['a3'] });
    expect(store.fieldError('a')).toBe(aSignal);
    expect(aSignal.value).toEqual(['a3']);
  });

  it('all reflects the union of current field errors across several setAll calls', () => {
    const store = createFieldErrorStore();
    expect(store.all.value).toEqual({});

    store.setAll({ a: ['a1'], b: ['b1'] });
    expect(store.all.value).toEqual({ a: ['a1'], b: ['b1'] });

    // 'a' drops out, 'c' appears, 'b' unchanged.
    store.setAll({ b: ['b1'], c: ['c1'] });
    expect(store.all.value).toEqual({ b: ['b1'], c: ['c1'] });

    // Everything clears.
    store.setAll({});
    expect(store.all.value).toEqual({});
  });
});
