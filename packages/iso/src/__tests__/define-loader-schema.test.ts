import { describe, expect, it } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { defineLoader } from '../define-loader.js';

const s: StandardSchemaV1<unknown, unknown> = {
  '~standard': { version: 1, vendor: 'test', validate: (v) => ({ value: v }) },
};

describe('defineLoader schema options', () => {
  it('stores searchSchema and paramsSchema on the ref', () => {
    const ref = defineLoader(async () => 1, {
      searchSchema: s,
      paramsSchema: s,
    });
    expect(ref.searchSchema).toBe(s);
    expect(ref.paramsSchema).toBe(s);
  });

  it('leaves them undefined when not provided', () => {
    const ref = defineLoader(async () => 1);
    expect(ref.searchSchema).toBeUndefined();
    expect(ref.paramsSchema).toBeUndefined();
  });
});
