import { describe, it, expect, expectTypeOf } from 'vitest';
import { definePage, PAGE_BINDINGS, type PageComponent, type PageBindings } from '../define-page.js';
import { defineLoader } from '../define-loader.js';
import { createCache } from '../cache.js';
import type { JSX } from 'preact';
import type { GuardFn } from '../guard.js';

describe('definePage', () => {
  it('attaches bindings under the realm-wide PAGE_BINDINGS symbol', () => {
    const fn = async () => ({ msg: 'ok' });
    const loader = defineLoader<{ msg: string }>(fn, { __moduleKey: 'define-page-test-1' });
    const cache = createCache<{ msg: string }>('define-page-test-1');
    const Inner = () => null;

    const Wrapped = definePage(Inner, { loader, cache });

    expect(Wrapped).toBe(Inner);
    expect((Wrapped as PageComponent<{ msg: string }>)[PAGE_BINDINGS]).toEqual({
      loader,
      cache,
    });
  });

  it('uses Symbol.for for cross-module identity', () => {
    expect(PAGE_BINDINGS).toBe(Symbol.for('@hono-preact/iso/page-bindings'));
  });

  it('returns the same component reference (no wrapper)', () => {
    const Inner = () => null;
    const Wrapped = definePage(Inner);
    expect(Wrapped).toBe(Inner);
  });

  it('treats omitted bindings as no-op (no symbol attached)', () => {
    const Inner = () => null;
    definePage(Inner);
    expect((Inner as PageComponent<unknown>)[PAGE_BINDINGS]).toBeUndefined();
  });

  it('replaces previously-attached bindings if called twice on the same component', () => {
    const fn1 = async () => ({ a: 1 });
    const fn2 = async () => ({ b: 2 });
    const loader1 = defineLoader(fn1, { __moduleKey: 'define-page-test-replace-1' });
    const loader2 = defineLoader(fn2, { __moduleKey: 'define-page-test-replace-2' });
    const Inner = () => null;

    definePage(Inner, { loader: loader1 });
    definePage(Inner, { loader: loader2 });

    expect((Inner as PageComponent<unknown>)[PAGE_BINDINGS]).toEqual({
      loader: loader2,
    });
  });

  it('accepts a Wrapper component in bindings', () => {
    const Inner = () => null;
    const Wrapper = (props: { children: unknown }) =>
      props.children as never;

    const Wrapped = definePage(Inner, { Wrapper });

    expect((Wrapped as PageComponent<unknown>)[PAGE_BINDINGS]).toEqual({
      Wrapper,
    });
  });
});

describe('PageBindings widened surface', () => {
  it('accepts fallback, errorFallback, serverGuards, clientGuards on the bindings type', () => {
    const guard: GuardFn = async (_ctx, next) => next();
    const bindings: PageBindings<{ ok: true }> = {
      fallback: <p>loading</p>,
      errorFallback: (err, reset) => <button onClick={reset}>{err.message}</button>,
      serverGuards: [guard],
      clientGuards: [guard],
    };
    expectTypeOf(bindings.fallback).toEqualTypeOf<JSX.Element | undefined>();
    expectTypeOf(bindings.errorFallback).toMatchTypeOf<
      JSX.Element | ((error: Error, reset: () => void) => JSX.Element) | undefined
    >();
    expectTypeOf(bindings.serverGuards).toEqualTypeOf<GuardFn[] | undefined>();
    expectTypeOf(bindings.clientGuards).toEqualTypeOf<GuardFn[] | undefined>();
  });
});
