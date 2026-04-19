import { describe, it, expect } from 'vitest';
import wrapPromise from '../wrap-promise.js';

describe('wrapPromise', () => {
  it('read() throws a Promise while the original promise is pending', () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const wrapped = wrapPromise(promise);
    let thrown: unknown;
    try { wrapped.read(); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Promise);
    resolve('cleanup');
  });

  it('read() returns the resolved value after the promise settles', async () => {
    const promise = Promise.resolve('hello');
    const wrapped = wrapPromise(promise);
    await promise; // flush the .then() handler registered by wrapPromise
    expect(wrapped.read()).toBe('hello');
  });

  it('read() throws the rejection reason after the promise rejects', async () => {
    const err = new Error('boom');
    const promise = Promise.reject(err);
    const wrapped = wrapPromise(promise);
    await promise.catch(() => {}); // suppress unhandled rejection warning, flush handler
    expect(() => wrapped.read()).toThrow('boom');
  });
});
