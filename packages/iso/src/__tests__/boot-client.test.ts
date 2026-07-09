// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootClient } from '../boot-client.js';

describe('bootClient', () => {
  it('installs the history shim (pushState is patched)', () => {
    const before = history.pushState;
    bootClient();
    expect(history.pushState).not.toBe(before);
  });

  it('installs the stream registry on window', () => {
    bootClient();
    expect('__HP_STREAM__' in window).toBe(true);
  });

  it('is safe to call twice (installers are guarded)', () => {
    bootClient();
    const patched = history.pushState;
    bootClient();
    expect(history.pushState).toBe(patched);
  });
});
