import { describe, it, expect } from 'vitest';
import { resolveSocketParams } from '../socket-resolution.js';

describe('resolveSocketParams', () => {
  const enc = (o: unknown) => JSON.stringify(o);

  it('accepts a wire covering every required slot', () => {
    expect(resolveSocketParams('/board/:id', enc({ id: 'b1' }))).toEqual({
      ok: true,
      params: { id: 'b1' },
    });
  });

  it('requires nothing for a param-less pattern', () => {
    expect(resolveSocketParams('/chat', undefined)).toEqual({
      ok: true,
      params: {},
    });
  });

  it('reports the missing slot when the wire omits it', () => {
    expect(resolveSocketParams('/board/:id', undefined)).toEqual({
      ok: false,
      missing: ['id'],
    });
    expect(resolveSocketParams('/board/:id', enc({}))).toEqual({
      ok: false,
      missing: ['id'],
    });
  });

  it('rejects a non-string value (treats the slot as missing)', () => {
    expect(resolveSocketParams('/board/:id', enc({ id: 42 }))).toEqual({
      ok: false,
      missing: ['id'],
    });
  });

  it('rejects malformed JSON / non-object wire', () => {
    expect(resolveSocketParams('/board/:id', 'not-json')).toEqual({
      ok: false,
      missing: ['id'],
    });
    expect(resolveSocketParams('/board/:id', enc([1, 2]))).toEqual({
      ok: false,
      missing: ['id'],
    });
  });

  it('rejects an empty-string value (treats the slot as missing)', () => {
    // Pinned: the check below is `!params[slot]`, which reads an empty string
    // as falsy and denies. A future refactor to `slot in params` would flip
    // this to ALLOW an empty id through, an auth regression.
    expect(resolveSocketParams('/board/:id', enc({ id: '' }))).toEqual({
      ok: false,
      missing: ['id'],
    });
  });

  it('does not require an optional slot', () => {
    expect(resolveSocketParams('/a/:x?', undefined)).toEqual({
      ok: true,
      params: {},
    });
  });

  it('(security) drops a wire key that is not a declared slot on the pattern', () => {
    // A client for `/board/:id` sends an extra `orgId`, a key no real HTTP
    // request could ever produce (Hono only populates declared slots). The
    // resolver must restrict the result to the pattern's declared slots.
    expect(
      resolveSocketParams('/board/:id', enc({ id: 'b1', orgId: 'victim' }))
    ).toEqual({
      ok: true,
      params: { id: 'b1' },
    });
  });

  it('keeps a legitimately-supplied optional slot (declared, not required)', () => {
    // Filtering must use the DECLARED slot set, not the required one: an
    // optional slot is a legitimate declared slot and must survive.
    expect(resolveSocketParams('/a/:x?', enc({ x: 'v' }))).toEqual({
      ok: true,
      params: { x: 'v' },
    });
  });

  it('does not require a rest slot and keeps its value through the declared-slot filter', () => {
    // `:rest*` (zero-or-more) and `:rest+` (one-or-more) are declared but never
    // required (requiredParamSlots excludes the `*`/`+` flags), so a wire with
    // no rest value still resolves ok, and a wire that DOES supply one is not
    // dropped by the declared-slot filter (declaredParamSlots includes it).
    expect(resolveSocketParams('/files/:rest*', undefined)).toEqual({
      ok: true,
      params: {},
    });
    expect(resolveSocketParams('/files/:rest*', enc({ rest: 'a/b' }))).toEqual({
      ok: true,
      params: { rest: 'a/b' },
    });
    expect(resolveSocketParams('/files/:rest+', undefined)).toEqual({
      ok: true,
      params: {},
    });
  });
});
