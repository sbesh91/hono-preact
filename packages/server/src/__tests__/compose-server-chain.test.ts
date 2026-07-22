import { describe, it, expect } from 'vitest';
import {
  defineServerMiddleware,
  defineClientMiddleware,
  defineStreamObserver,
  type AppConfig,
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

  it('names the app layer and a layer-relative index for a bad app-level entry', async () => {
    const ok = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    // AppConfig['use'] cannot express an invalid entry, which is the point of
    // the test; go through `unknown` to build one.
    const appConfig = { use: [ok, null] } as unknown as AppConfig;
    await expect(
      composeServerChain<'action'>({ ...baseArgs, appConfig })
    ).rejects.toThrow(
      /Invalid `use` entry at index 1 of the app-level `use`: null\./
    );
  });

  it('names the page layer and its own path for a bad page-level entry', async () => {
    await expect(
      composeServerChain<'action'>({
        ...baseArgs,
        path: '/admin/:id',
        resolvePageUse: async () => [{ __kind: 'middlware' }],
      })
    ).rejects.toThrow(
      /Invalid `use` entry at index 0 of the page `use` for \/admin\/:id: an object with `__kind` "middlware"/
    );
  });

  it("names the unit layer, indexed within the unit's own use", async () => {
    const ok = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    await expect(
      composeServerChain<'action'>({
        ...baseArgs,
        appConfig: { use: [ok] },
        resolvePageUse: async () => [ok],
        // Index 0 within the unit layer, which would be index 2 of the
        // merged chain: the layer-relative index is the point.
        unitUse: [{ __kind: 'middleware', runs: 'server' }],
      })
    ).rejects.toThrow(
      /Invalid `use` entry at index 0 of the unit's own `use`: a middleware whose `fn` is not a function \(undefined\)/
    );
  });

  it('keeps [app, page, unit] order when every layer is partitioned separately', async () => {
    const appMw = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    const appObs = defineStreamObserver({ onStart: () => {} });
    const pageMw = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    const unitObs = defineStreamObserver({ onEnd: () => {} });
    const unitMw = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    const { serverMw, observers } = await composeServerChain<'action'>({
      ...baseArgs,
      appConfig: { use: [appMw, appObs] },
      resolvePageUse: async () => [pageMw],
      unitUse: [unitObs, unitMw],
    });
    expect(serverMw).toEqual([appMw, pageMw, unitMw]);
    expect(observers).toEqual([appObs, unitObs]);
  });
});
