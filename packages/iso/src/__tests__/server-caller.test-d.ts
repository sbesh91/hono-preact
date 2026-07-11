import { describe, it, expectTypeOf } from 'vitest';
import type { Context } from 'hono';
import { createCaller, type CallResult } from '../server-caller.js';
import { defineLoader } from '../define-loader.js';
import { defineAction } from '../action.js';

declare const c: Context;

describe('createCaller type surface', () => {
  it('types a single-value loader call as CallResult<T>', () => {
    const movie = defineLoader(async () => ({ title: 'Dune' }));
    expectTypeOf(createCaller(c).call(movie)).resolves.toEqualTypeOf<
      CallResult<{ title: string }>
    >();
  });

  it('types a streaming loader call as CallResult<AsyncGenerator<T>>', () => {
    const stream = defineLoader(async function* () {
      yield Math.random();
    });
    expectTypeOf(createCaller(c).call(stream)).resolves.toEqualTypeOf<
      CallResult<AsyncGenerator<number, void, unknown>>
    >();
  });

  it('types a non-streaming action call as CallResult<TResult>', () => {
    const act = defineAction(async (_ctx, p: { x: number }) => ({ y: p.x }));
    expectTypeOf(createCaller(c).call(act, { x: 1 })).resolves.toEqualTypeOf<
      CallResult<{ y: number }>
    >();
  });

  it('types a streaming action call as CallResult<AsyncGenerator<TChunk, TResult>>', () => {
    const act = defineAction(async function* (_ctx, p: { x: number }) {
      yield String(p.x);
      return { y: p.x };
    });
    expectTypeOf(createCaller(c).call(act, { x: 1 })).resolves.toEqualTypeOf<
      CallResult<AsyncGenerator<string, { y: number }, unknown>>
    >();
  });
});
