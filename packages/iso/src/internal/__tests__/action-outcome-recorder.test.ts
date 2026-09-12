import { describe, it, expect, beforeEach } from 'vitest';
import { createActionOutcomeRecorder } from '../action-outcome-recorder.js';
import {
  getLastActionResult,
  clearLastActionResult,
} from '../action-result-store.js';

const MOD = 'm';
const ACT = 'a';
const PAYLOAD = { name: 'ada' };

const stored = () => getLastActionResult({ __module: MOD, __action: ACT });
const recorder = () => createActionOutcomeRecorder(MOD, ACT, PAYLOAD);

beforeEach(() => {
  clearLastActionResult(MOD, ACT);
});

describe('createActionOutcomeRecorder: the bound constants', () => {
  it('carries the submitted payload onto every outcome kind', () => {
    // The payload is what `useActionResult()` re-renders a form from; a branch
    // that dropped it would strand the user's input.
    const r1 = recorder();
    r1.success({ id: 1 });
    expect(stored()).toMatchObject({ submittedPayload: PAYLOAD });

    clearLastActionResult(MOD, ACT);
    const r2 = recorder();
    r2.error('boom');
    expect(stored()).toMatchObject({ submittedPayload: PAYLOAD });

    clearLastActionResult(MOD, ACT);
    const r3 = recorder();
    r3.deny({ status: 403, message: 'nope' });
    expect(stored()).toMatchObject({ submittedPayload: PAYLOAD });
  });

  it('records under the module/action it was bound to', () => {
    recorder().success({ id: 1 });
    expect(stored()).toMatchObject({ kind: 'success', data: { id: 1 } });
    expect(
      getLastActionResult({ __module: 'other', __action: ACT })
    ).toBeNull();
  });
});

describe('createActionOutcomeRecorder: deny', () => {
  it('stores status, message and data', () => {
    recorder().deny({ status: 403, message: 'nope', data: { field: 'x' } });
    expect(stored()).toMatchObject({
      kind: 'deny',
      status: 403,
      message: 'nope',
      data: { field: 'x' },
    });
  });

  it('omits the code key entirely when no code was given', () => {
    // Presence, not value: a stored `code: undefined` would read as "a code
    // was returned" to a consumer doing an `in` / key check.
    recorder().deny({ status: 403, message: 'nope' });
    expect(stored() && 'code' in stored()!).toBe(false);
  });

  it('keeps the code key when one was given', () => {
    recorder().deny({ status: 403, message: 'nope', code: 'FORBIDDEN' });
    expect(stored()).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('createActionOutcomeRecorder: the recorded flag', () => {
  it('starts false and flips on any write', () => {
    const r = recorder();
    expect(r.recorded).toBe(false);
    r.success({ id: 1 });
    expect(r.recorded).toBe(true);
  });

  it('flips on error and on deny too, not just success', () => {
    const r1 = recorder();
    r1.error('boom');
    expect(r1.recorded).toBe(true);

    const r2 = recorder();
    r2.deny({ status: 403, message: 'nope' });
    expect(r2.recorded).toBe(true);
  });

  it('fallbackError writes when nothing has been recorded', () => {
    const r = recorder();
    r.fallbackError('network down');
    expect(stored()).toMatchObject({ kind: 'error', message: 'network down' });
    expect(r.recorded).toBe(true);
  });

  it('fallbackError does NOT overwrite a branch that already classified', () => {
    // The whole point of the flag: an unclassified outer-catch error must not
    // clobber the richer deny record the envelope branch already wrote.
    const r = recorder();
    r.deny({ status: 403, message: 'nope', data: { field: 'x' } });
    r.fallbackError('Error: nope');
    expect(stored()).toMatchObject({
      kind: 'deny',
      status: 403,
      data: { field: 'x' },
    });
  });

  it('fallbackError does not overwrite a recorded success either', () => {
    const r = recorder();
    r.success({ id: 1 });
    r.fallbackError('late failure');
    expect(stored()).toMatchObject({ kind: 'success', data: { id: 1 } });
  });

  it('scopes the flag per recorder, so a later mutate can still record', () => {
    const first = recorder();
    first.error('boom');
    const second = recorder();
    expect(second.recorded).toBe(false);
    second.fallbackError('second failure');
    expect(stored()).toMatchObject({ message: 'second failure' });
  });
});
