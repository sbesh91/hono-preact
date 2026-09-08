import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { runSchemaGate } from '../action-schema-gate.js';
import { createActionOutcomeRecorder } from '../action-outcome-recorder.js';
import {
  getLastActionResult,
  clearLastActionResult,
} from '../action-result-store.js';
import { VALIDATION_ISSUES_KEY } from '../contract.js';

const MOD = 'm';
const ACT = 'a';
type Payload = { name: string };

const stored = () => getLastActionResult({ __module: MOD, __action: ACT });
const recorder = (payload: Payload) =>
  createActionOutcomeRecorder(MOD, ACT, payload);

/** A Standard Schema that passes, fails, or throws on demand. */
function schemaOf(
  behavior: 'pass' | 'fail' | 'throw',
  opts: { async?: boolean } = {}
): StandardSchemaV1<unknown, Payload> {
  const validate = (value: unknown) => {
    if (behavior === 'throw') throw new Error('schema exploded');
    const result =
      behavior === 'pass'
        ? { value: value as Payload }
        : { issues: [{ message: 'required', path: ['name'] }] };
    return opts.async ? Promise.resolve(result) : result;
  };
  return {
    '~standard': { version: 1, vendor: 'test', validate },
  } as StandardSchemaV1<unknown, Payload>;
}

beforeEach(() => {
  clearLastActionResult(MOD, ACT);
});

describe('runSchemaGate: proceed', () => {
  it('proceeds on a valid payload and records nothing', async () => {
    const payload = { name: 'ada' };
    const r = recorder(payload);
    const decision = await runSchemaGate({
      schema: schemaOf('pass'),
      payload,
      signal: undefined,
      recorder: r,
    });
    expect(decision).toEqual({ kind: 'proceed' });
    expect(r.recorded).toBe(false);
    expect(stored()).toBeNull();
  });
});

describe('runSchemaGate: deny', () => {
  it('denies an invalid payload and carries the issues', async () => {
    const payload = { name: '' };
    const decision = await runSchemaGate({
      schema: schemaOf('fail'),
      payload,
      signal: undefined,
      recorder: recorder(payload),
    });
    expect(decision.kind).toBe('denied');
    if (decision.kind !== 'denied') throw new Error('unreachable');
    expect(decision.issues).toEqual([{ message: 'required', path: ['name'] }]);
  });

  it('records a 422 deny whose data carries the issues under the wire key', async () => {
    // Parity with the server's authoritative 422: a consumer must not be able
    // to tell which side caught the failure.
    const payload = { name: '' };
    await runSchemaGate({
      schema: schemaOf('fail'),
      payload,
      signal: undefined,
      recorder: recorder(payload),
    });
    const rec = stored();
    expect(rec).toMatchObject({
      kind: 'deny',
      status: 422,
      submittedPayload: payload,
    });
    expect(
      (rec as { data: Record<string, unknown> }).data[VALIDATION_ISSUES_KEY]
    ).toEqual([{ message: 'required', path: ['name'] }]);
  });
});

describe('runSchemaGate: fails open', () => {
  it('proceeds when the schema throws, rather than blocking the request', async () => {
    // The server validates authoritatively; a throwing schema must cost at
    // most a wasted round-trip, never a validation error the user cannot fix.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const payload = { name: 'ada' };
      const r = recorder(payload);
      const decision = await runSchemaGate({
        schema: schemaOf('throw'),
        payload,
        signal: undefined,
        recorder: r,
      });
      expect(decision).toEqual({ kind: 'proceed' });
      expect(r.recorded).toBe(false);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe('runSchemaGate: abort during validation', () => {
  it('returns the aborted arm and records nothing when the signal fires mid-validation', async () => {
    const controller = new AbortController();
    const payload = { name: '' };
    const r = recorder(payload);
    // An async schema that aborts while it is still validating: the caller
    // gave up before the gate could decide, so no deny may be recorded.
    const schema: StandardSchemaV1<unknown, Payload> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async () => {
          controller.abort();
          return { issues: [{ message: 'required', path: ['name'] }] };
        },
      },
    } as StandardSchemaV1<unknown, Payload>;

    const decision = await runSchemaGate({
      schema,
      payload,
      signal: controller.signal,
      recorder: r,
    });
    expect(decision).toEqual({ kind: 'aborted' });
    expect(r.recorded).toBe(false);
    expect(stored()).toBeNull();
  });

  it('abort wins over an otherwise-valid payload too', async () => {
    const controller = new AbortController();
    const payload = { name: 'ada' };
    const schema: StandardSchemaV1<unknown, Payload> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value: unknown) => {
          controller.abort();
          return { value: value as Payload };
        },
      },
    } as StandardSchemaV1<unknown, Payload>;

    const decision = await runSchemaGate({
      schema,
      payload,
      signal: controller.signal,
      recorder: recorder(payload),
    });
    expect(decision).toEqual({ kind: 'aborted' });
  });
});
