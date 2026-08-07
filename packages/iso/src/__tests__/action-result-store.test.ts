import { describe, expect, it, beforeEach } from 'vitest';
import {
  setLastActionResult,
  clearLastActionResult,
  getLastActionResult,
  lastActionResultSignal,
  pickLastActionResult,
} from '../internal/action-result-store.js';

describe('action-result-store', () => {
  beforeEach(() => {
    // Clear via the public API; the module has no reset.
    clearLastActionResult('m', 'a');
    clearLastActionResult('m', 'b');
    clearLastActionResult('other', 'x');
  });

  it('returns null when empty', () => {
    expect(getLastActionResult()).toBeNull();
    expect(getLastActionResult({ __module: 'm', __action: 'a' })).toBeNull();
  });

  it('stores and retrieves by stub identity', () => {
    setLastActionResult('m', 'a', {
      kind: 'success',
      data: { id: 1 },
      submittedPayload: null,
    });
    const entry = getLastActionResult({ __module: 'm', __action: 'a' });
    expect(entry).toMatchObject({
      kind: 'success',
      data: { id: 1 },
      module: 'm',
      action: 'a',
    });
  });

  it('filters by stub identity', () => {
    setLastActionResult('m', 'a', {
      kind: 'success',
      data: 1,
      submittedPayload: null,
    });
    expect(
      getLastActionResult({ __module: 'other', __action: 'a' })
    ).toBeNull();
  });

  it('most-recent wins when no stub given', () => {
    setLastActionResult('m', 'a', {
      kind: 'success',
      data: 1,
      submittedPayload: null,
    });
    setLastActionResult('m', 'b', {
      kind: 'deny',
      status: 422,
      message: 'no',
      submittedPayload: null,
    });
    const latest = getLastActionResult();
    expect(latest?.action).toBe('b');
  });

  it('overwriting the same key updates in place', () => {
    setLastActionResult('m', 'a', {
      kind: 'success',
      data: 1,
      submittedPayload: null,
    });
    setLastActionResult('m', 'a', {
      kind: 'deny',
      status: 422,
      message: 'bad',
      submittedPayload: { x: 'y' },
    });
    const entry = getLastActionResult({ __module: 'm', __action: 'a' });
    expect(entry?.kind).toBe('deny');
  });

  it('clear removes the entry', () => {
    setLastActionResult('m', 'a', {
      kind: 'success',
      data: 1,
      submittedPayload: null,
    });
    clearLastActionResult('m', 'a');
    expect(getLastActionResult({ __module: 'm', __action: 'a' })).toBeNull();
  });

  it('the store signal updates on set and clear', () => {
    const before = lastActionResultSignal.value;
    setLastActionResult('m', 'a', {
      kind: 'success',
      data: 1,
      submittedPayload: null,
    });
    const afterSet = lastActionResultSignal.value;
    expect(afterSet).not.toBe(before);
    expect(
      pickLastActionResult(afterSet, { __module: 'm', __action: 'a' })
    ).toMatchObject({ kind: 'success', data: 1 });

    clearLastActionResult('m', 'a');
    const afterClear = lastActionResultSignal.value;
    expect(afterClear).not.toBe(afterSet);
    expect(
      pickLastActionResult(afterClear, { __module: 'm', __action: 'a' })
    ).toBeNull();
  });

  it('clearing an absent key leaves the signal identity unchanged', () => {
    const before = lastActionResultSignal.value;
    clearLastActionResult('does-not', 'exist');
    expect(lastActionResultSignal.value).toBe(before);
  });
});
