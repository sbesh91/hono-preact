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
});
