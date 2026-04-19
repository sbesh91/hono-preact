import { describe, it, expect, afterEach } from 'vitest';
import { env, isBrowser } from '../is-browser.js';

const original = env.current;
afterEach(() => { env.current = original; });

describe('isBrowser', () => {
  it('returns false when env.current is server', () => {
    env.current = 'server';
    expect(isBrowser()).toBe(false);
  });

  it('returns true when env.current is browser', () => {
    env.current = 'browser';
    expect(isBrowser()).toBe(true);
  });
});

describe('env', () => {
  it('can be set to server and read back', () => {
    env.current = 'server';
    expect(env.current).toBe('server');
  });

  it('can be set to browser and read back', () => {
    env.current = 'browser';
    expect(env.current).toBe('browser');
  });
});
