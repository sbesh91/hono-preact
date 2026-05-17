// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';
import { createCache } from '../cache.js';
import { LoaderDataContext } from '../internal/contexts.js';
import { h } from 'preact';
import { render } from '@testing-library/preact';

describe('defineLoader', () => {
  it('returns an unkeyed LoaderRef when called with only a function (no name, no opts)', () => {
    // The (fn) form is now valid. The plugin will rewrite it to (fn, { __moduleKey })
    // at build time. Without opts the symbol is local (not registered), so
    // Symbol.keyFor returns undefined.
    const ref = defineLoader(async () => ({}));
    expect(typeof ref.__id).toBe('symbol');
    expect(Symbol.keyFor(ref.__id)).toBeUndefined();
  });
});

describe('defineLoader type-level guards', () => {
  it('rejects the legacy (name, fn) form at the type level', () => {
    // @ts-expect-error: defineLoader no longer accepts a string as the first
    // argument; the (name, fn) overload was removed in the path-keyed identity
    // refactor.
    defineLoader('movies', async () => ({}));
  });
});

describe('defineLoader (path-keyed __moduleKey form)', () => {
  it('accepts (fn, { __moduleKey }) and derives __id from the key', () => {
    const ref = defineLoader(async () => ({}), {
      __moduleKey: 'apps/site/src/pages/movies',
    });
    expect(Symbol.keyFor(ref.__id)).toBe(
      '@hono-preact/loader:apps/site/src/pages/movies'
    );
  });

  it('produces the same __id symbol for two calls with the same __moduleKey', () => {
    const a = defineLoader(async () => ({}), { __moduleKey: 'pages/movies' });
    const b = defineLoader(async () => ({}), { __moduleKey: 'pages/movies' });
    expect(a.__id).toBe(b.__id);
  });

  it('produces distinct __id for distinct __moduleKey values', () => {
    const a = defineLoader(async () => ({}), { __moduleKey: 'pages/movies' });
    const b = defineLoader(async () => ({}), {
      __moduleKey: 'pages/admin/movies',
    });
    expect(a.__id).not.toBe(b.__id);
  });
});

describe('LoaderRef methods', () => {
  it('attaches a cache to every loader by default', () => {
    const loader = defineLoader(async () => ({ value: 1 }));
    expect(loader.cache).toBeDefined();
    expect(typeof loader.cache.get).toBe('function');
    expect(typeof loader.cache.invalidate).toBe('function');
  });

  it('uses the cache passed in opts when provided', () => {
    const shared = createCache<{ value: number }>();
    const loader = defineLoader(async () => ({ value: 1 }), { cache: shared });
    expect(loader.cache).toBe(shared);
  });

  it('invalidate() clears the loader cache', () => {
    const loader = defineLoader(async () => ({ value: 1 }));
    loader.cache.set({ value: 1 });
    expect(loader.cache.has()).toBe(true);
    loader.invalidate();
    expect(loader.cache.has()).toBe(false);
  });

  it('two defineLoader calls with the same __moduleKey share a cache', () => {
    const a = defineLoader(async () => ({ x: 1 }), {
      __moduleKey: 'shared-cache-test',
    });
    const b = defineLoader(async () => ({ x: 1 }), {
      __moduleKey: 'shared-cache-test',
    });
    a.cache.set({ x: 1 });
    expect(b.cache.has()).toBe(true);
    expect(b.cache.get()).toEqual({ x: 1 });
    b.invalidate();
    expect(a.cache.has()).toBe(false);
  });

  it('unkeyed loaders get distinct caches', () => {
    const a = defineLoader(async () => ({ x: 1 }));
    const b = defineLoader(async () => ({ x: 1 }));
    a.cache.set({ x: 1 });
    expect(b.cache.has()).toBe(false);
  });

  it('useData() returns the data from LoaderDataContext', () => {
    const loader = defineLoader(async () => ({ value: 42 }));
    const Probe = () => {
      const data = loader.useData();
      return h('span', null, JSON.stringify(data));
    };
    const { container } = render(
      h(
        LoaderDataContext.Provider,
        { value: { data: { value: 42 } } },
        h(Probe, null)
      )
    );
    expect(container.textContent).toBe('{"value":42}');
  });

  it('useData() throws when called outside a LoaderDataContext', () => {
    const loader = defineLoader(async () => ({ value: 1 }));
    expect(() => {
      const Probe = () => {
        loader.useData();
        return null;
      };
      render(h(Probe, null));
    }).toThrow(/loader\.View.*render function|loader\.Boundary/);
  });
});

describe('defineLoader: streaming acceptance', () => {
  it('accepts an async-generator loader', () => {
    const ref = defineLoader(async function* (_ctx) {
      yield { tick: 1 };
      yield { tick: 2 };
    });
    expect(typeof ref.fn).toBe('function');
  });

  it('accepts a ReadableStream<T>-returning loader', () => {
    const ref = defineLoader(
      async (_ctx) =>
        new ReadableStream<{ tick: number }>({
          start(c) {
            c.enqueue({ tick: 1 });
            c.close();
          },
        })
    );
    expect(typeof ref.fn).toBe('function');
  });

  it('passes ctx with location and signal', async () => {
    let seen: { hasLocation: boolean; hasSignal: boolean } | null = null;
    const ref = defineLoader(async (ctx) => {
      seen = {
        hasLocation: typeof ctx.location === 'object',
        hasSignal: ctx.signal instanceof AbortSignal,
      };
      return {};
    });
    const ac = new AbortController();
    const fn = ref.fn as (props: {
      location: unknown;
      signal: AbortSignal;
    }) => Promise<unknown>;
    await fn({
      location: { path: '/', pathParams: {}, searchParams: {} },
      signal: ac.signal,
    });
    expect(seen).toEqual({ hasLocation: true, hasSignal: true });
  });
});
