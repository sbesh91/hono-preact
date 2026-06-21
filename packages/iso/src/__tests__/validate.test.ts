import { describe, expect, it } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
  validateWithSchema,
  normalizeIssues,
  mapIssuesToFields,
} from '../validate.js';

// Hand-rolled Standard Schema so the adapter is tested against the raw spec,
// not one vendor's quirks. `make` builds a schema whose validate runs `check`.
function make<I, O>(
  check: (
    v: unknown
  ) => { value: O } | { issues: ReadonlyArray<StandardSchemaV1.Issue> },
  async = false
): StandardSchemaV1<I, O> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (v) => (async ? Promise.resolve(check(v)) : check(v)),
    },
  };
}

describe('validateWithSchema', () => {
  it('returns ok+value for a sync passing schema', async () => {
    const schema = make<unknown, number>(() => ({ value: 42 }));
    const res = await validateWithSchema(schema, '42');
    expect(res).toEqual({ ok: true, value: 42 });
  });

  it('awaits an async schema', async () => {
    const schema = make<unknown, string>(() => ({ value: 'x' }), true);
    const res = await validateWithSchema(schema, 'anything');
    expect(res).toEqual({ ok: true, value: 'x' });
  });

  it('treats an empty issues array as success (spec-violating schema, defensive case)', async () => {
    // A schema that returns { value, issues: [] } violates the spec but must not be
    // misclassified as a failure; the empty array should be ignored.
    const schema = make<unknown, string>(
      () => ({ value: 'ok', issues: [] }) as unknown as { value: string }
    );
    const res = await validateWithSchema(schema, 'anything');
    expect(res).toEqual({ ok: true, value: 'ok' });
  });

  it('returns ok:false with normalized issues on failure', async () => {
    const schema = make<unknown, never>(() => ({
      issues: [
        { message: 'Required', path: ['title'] },
        { message: 'Too small', path: ['address', { key: 'zip' }] },
        { message: 'Bad item', path: ['tags', 0] },
        { message: 'Whole-object problem' },
      ],
    }));
    const res = await validateWithSchema(schema, {});
    expect(res).toEqual({
      ok: false,
      issues: [
        { path: ['title'], message: 'Required' },
        { path: ['address', 'zip'], message: 'Too small' },
        { path: ['tags', 0], message: 'Bad item' },
        { path: [], message: 'Whole-object problem' },
      ],
    });
  });
});

describe('normalizeIssues', () => {
  it('coerces object path segments to their key and keeps numbers', () => {
    expect(
      normalizeIssues([{ message: 'm', path: [{ key: 'a' }, 2, 'b'] }])
    ).toEqual([{ path: ['a', 2, 'b'], message: 'm' }]);
  });
});

describe('mapIssuesToFields', () => {
  it('groups messages by dot-joined path; null -> {}', () => {
    expect(mapIssuesToFields(null)).toEqual({});
    expect(
      mapIssuesToFields([
        { path: ['title'], message: 'a' },
        { path: ['title'], message: 'b' },
        { path: ['address', 'zip'], message: 'c' },
        { path: [], message: 'form-level' },
      ])
    ).toEqual({
      title: ['a', 'b'],
      'address.zip': ['c'],
      '': ['form-level'],
    });
  });
});
