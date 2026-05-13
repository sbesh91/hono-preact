import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';

describe('defineLoader: params opt', () => {
  it('defaults params to []', () => {
    const ref = defineLoader(async () => ({}));
    expect(ref.params).toEqual([]);
  });

  it('persists params: string[]', () => {
    const ref = defineLoader(async () => ({}), { params: ['genre', 'page'] });
    expect(ref.params).toEqual(['genre', 'page']);
  });

  it('persists params: "*"', () => {
    const ref = defineLoader(async () => ({}), { params: '*' });
    expect(ref.params).toBe('*');
  });
});

describe('defineLoader: __loaderName opt', () => {
  it('defaults __loaderName to undefined when not provided', () => {
    const ref = defineLoader(async () => ({}));
    expect(ref.__loaderName).toBeUndefined();
  });

  it('persists __loaderName from opts', () => {
    const ref = defineLoader(async () => ({}), {
      __moduleKey: 'pages/movie',
      __loaderName: 'summary',
    });
    expect(ref.__loaderName).toBe('summary');
  });

  it('__id symbol incorporates __loaderName when both __moduleKey and __loaderName are set', () => {
    const ref = defineLoader(async () => ({}), {
      __moduleKey: 'pages/movie',
      __loaderName: 'summary',
    });
    expect(Symbol.keyFor(ref.__id)).toBe(
      '@hono-preact/loader:pages/movie::summary'
    );
  });

  it('two loaders with same moduleKey but different loaderName have different __id', () => {
    const a = defineLoader(async () => ({}), { __moduleKey: 'pages/movie', __loaderName: 'summary' });
    const b = defineLoader(async () => ({}), { __moduleKey: 'pages/movie', __loaderName: 'cast' });
    expect(a.__id).not.toBe(b.__id);
  });

  it('two loaders with same moduleKey but no loaderName collapse (back-compat)', () => {
    const a = defineLoader(async () => ({}), { __moduleKey: 'pages/foo' });
    const b = defineLoader(async () => ({}), { __moduleKey: 'pages/foo' });
    expect(a.__id).toBe(b.__id);
  });
});
