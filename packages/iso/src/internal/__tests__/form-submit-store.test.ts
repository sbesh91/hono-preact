import { describe, expect, it, beforeEach } from 'vitest';
import {
  beginSubmit,
  endSubmit,
  isPending,
  pendingSignal,
  pickIsPending,
} from '../form-submit-store.js';

describe('form-submit-store', () => {
  beforeEach(() => {
    // Clear via the public API; the module has no reset. endSubmit is a no-op
    // once a key's count reaches zero, so this drains any leftover counts.
    endSubmit('m', 'a');
    endSubmit('m', 'b');
    endSubmit('other', 'x');
  });

  it('is idle when empty', () => {
    expect(isPending()).toBe(false);
    expect(isPending({ __module: 'm', __action: 'a' })).toBe(false);
  });

  it('beginSubmit/endSubmit toggle pending by stub identity', () => {
    beginSubmit('m', 'a');
    expect(isPending({ __module: 'm', __action: 'a' })).toBe(true);
    expect(isPending({ __module: 'other', __action: 'a' })).toBe(false);
    endSubmit('m', 'a');
    expect(isPending({ __module: 'm', __action: 'a' })).toBe(false);
  });

  it('no-stub isPending is true while ANY submit is in flight', () => {
    beginSubmit('m', 'a');
    expect(isPending()).toBe(true);
    endSubmit('m', 'a');
    expect(isPending()).toBe(false);
  });

  it('overlapping submits on the same key stay pending until the count drains', () => {
    beginSubmit('m', 'a');
    beginSubmit('m', 'a');
    endSubmit('m', 'a');
    expect(isPending({ __module: 'm', __action: 'a' })).toBe(true);
    endSubmit('m', 'a');
    expect(isPending({ __module: 'm', __action: 'a' })).toBe(false);
  });

  it('the store signal updates on begin and end', () => {
    const before = pendingSignal.value;
    beginSubmit('m', 'a');
    const afterBegin = pendingSignal.value;
    expect(afterBegin).not.toBe(before);
    expect(pickIsPending(afterBegin, { __module: 'm', __action: 'a' })).toBe(
      true
    );

    endSubmit('m', 'a');
    const afterEnd = pendingSignal.value;
    expect(afterEnd).not.toBe(afterBegin);
    expect(pickIsPending(afterEnd, { __module: 'm', __action: 'a' })).toBe(
      false
    );
  });
});
