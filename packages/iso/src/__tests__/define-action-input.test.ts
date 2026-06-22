import { describe, expect, it } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { defineAction } from '../action.js';

const schema: StandardSchemaV1<unknown, unknown> = {
  '~standard': { version: 1, vendor: 'test', validate: (v) => ({ value: v }) },
};

describe('defineAction input metadata', () => {
  it('attaches the schema as a non-enumerable `input` property', () => {
    const stub = defineAction(async () => 'ok', { input: schema });
    // Read it the way extractActions does (off the function value).
    expect((stub as unknown as { input?: unknown }).input).toBe(schema);
    // Non-enumerable: must not appear in Object.keys.
    expect(Object.keys(stub as object)).not.toContain('input');
  });

  it('omits `input` when no schema is given', () => {
    const stub = defineAction(async () => 'ok');
    expect((stub as unknown as { input?: unknown }).input).toBeUndefined();
  });
});
