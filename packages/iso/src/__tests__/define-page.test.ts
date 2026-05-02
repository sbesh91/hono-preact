import { describe, it, expect } from 'vitest';
import { definePage, PAGE_BINDINGS, type PageComponent } from '../define-page.js';
import { defineLoader } from '../define-loader.js';
import { createCache } from '../cache.js';

describe('definePage', () => {
  it('attaches bindings under the realm-wide PAGE_BINDINGS symbol', () => {
    const fn = async () => ({ msg: 'ok' });
    const loader = defineLoader<{ msg: string }>('define-page-test-1', fn);
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
    const loader1 = defineLoader('define-page-test-replace-1', fn1);
    const loader2 = defineLoader('define-page-test-replace-2', fn2);
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
