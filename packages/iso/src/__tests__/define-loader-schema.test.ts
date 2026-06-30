import { describe, expect, it } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { serverRoute } from '../server-route.js';

const s: StandardSchemaV1<unknown, unknown> = {
  '~standard': { version: 1, vendor: 'test', validate: (v) => ({ value: v }) },
};

describe('serverRoute.loader schema options', () => {
  it('stores searchSchema and paramsSchema on the ref', () => {
    const route = serverRoute('/items/:id');
    const ref = route.loader(async () => 1, {
      searchSchema: s,
      paramsSchema: s,
    });
    expect(ref.searchSchema).toBe(s);
    expect(ref.paramsSchema).toBe(s);
  });

  it('leaves them undefined when not provided', () => {
    const route = serverRoute('/items/:id');
    const ref = route.loader(async () => 1);
    expect(ref.searchSchema).toBeUndefined();
    expect(ref.paramsSchema).toBeUndefined();
  });
});
