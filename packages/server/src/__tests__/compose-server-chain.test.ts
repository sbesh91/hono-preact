import { describe, it, expect } from 'vitest';
import {
  defineServerMiddleware,
  defineClientMiddleware,
  defineStreamObserver,
} from '@hono-preact/iso';
import { composeServerChain } from '../compose-server-chain.js';

const baseArgs = {
  requestSignal: new AbortController().signal,
  unitTimeoutMs: undefined as number | false | undefined,
  defaultTimeoutMs: 30_000 as number | false,
  appConfig: undefined,
  resolvePageUse: async () => [] as ReadonlyArray<unknown>,
  path: '/x',
  unitUse: [] as ReadonlyArray<unknown>,
};

describe('composeServerChain', () => {
  it('composes [app, page, unit] server middleware in outer->inner order', async () => {
    const app = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    const page = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    const unit = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    const { serverMw } = await composeServerChain<'action'>({
      ...baseArgs,
      appConfig: { use: [app] },
      resolvePageUse: async () => [page],
      unitUse: [unit],
    });
    expect(serverMw).toEqual([app, page, unit]);
  });

  it('keeps only runs===server middleware and partitions observers out', async () => {
    const srv = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    const cli = defineClientMiddleware(async (_c, n) => {
      await n();
    });
    const obs = defineStreamObserver({});
    const { serverMw, observers } = await composeServerChain<'action'>({
      ...baseArgs,
      unitUse: [srv, cli, obs],
    });
    expect(serverMw).toEqual([srv]); // client middleware filtered out of the server chain
    expect(observers).toEqual([obs]); // observer partitioned out
  });

  it('derives the timeout: unit overrides default, false disables, signal combines', async () => {
    const reqSignal = new AbortController().signal;

    const withUnit = await composeServerChain<'loader'>({
      ...baseArgs,
      requestSignal: reqSignal,
      unitTimeoutMs: 50,
    });
    expect(withUnit.resolvedTimeoutMs).toBe(50);
    expect(withUnit.timeoutSignal).toBeInstanceOf(AbortSignal);
    expect(withUnit.signal).not.toBe(reqSignal); // combined via AbortSignal.any

    const withDefault = await composeServerChain<'loader'>({
      ...baseArgs,
      requestSignal: reqSignal,
    });
    expect(withDefault.resolvedTimeoutMs).toBe(30_000);

    const disabled = await composeServerChain<'loader'>({
      ...baseArgs,
      requestSignal: reqSignal,
      unitTimeoutMs: false,
    });
    expect(disabled.resolvedTimeoutMs).toBe(false);
    expect(disabled.timeoutSignal).toBeUndefined();
    expect(disabled.signal).toBe(reqSignal); // no timeout -> request signal passes through as-is
  });
});
