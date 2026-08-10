import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createRootRef } from '../root.js';

describe('createRootRef', () => {
  it('falls back to process.cwd() before set() runs', () => {
    expect(createRootRef().get()).toBe(process.cwd());
  });

  it('resolves a relative userConfig.root to an absolute path', () => {
    const ref = createRootRef();
    expect(ref.set({ root: 'sub/app' })).toBe(
      path.resolve(process.cwd(), 'sub/app')
    );
    expect(ref.get()).toBe(path.resolve(process.cwd(), 'sub/app'));
  });

  it('keeps an absolute userConfig.root as-is', () => {
    const ref = createRootRef();
    const abs = path.resolve('/tmp/some-app');
    expect(ref.set({ root: abs })).toBe(abs);
  });

  it('uses process.cwd() when userConfig has no root', () => {
    const ref = createRootRef();
    expect(ref.set({})).toBe(process.cwd());
  });

  // First writer wins: `hono-preact:server-entry` (enforce: 'pre') and
  // `hono-preact:config` both call set() with the same userConfig, and a Vite
  // restart constructs a fresh ref. A second call must not be able to move the
  // root out from under a path already handed to an adapter.
  it('memoizes: a later set() cannot change the resolved root', () => {
    const ref = createRootRef();
    const first = ref.set({ root: '/tmp/first' });
    expect(ref.set({ root: '/tmp/second' })).toBe(first);
    expect(ref.get()).toBe(first);
  });
});
