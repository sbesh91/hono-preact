import { describe, it, expect } from 'vitest';
import wrapPromise from '../wrap-promise.js';

describe('wrapPromise', () => {
  it('read() throws a Promise while the original promise is pending', () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const wrapped = wrapPromise(promise);
    let thrown: unknown;
    try {
      wrapped.read();
    } catch (e) {
      thrown = e;
    }
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

describe('wrapPromise.peek', () => {
  it('reports pending then success without throwing', async () => {
    let resolve!: (v: number) => void;
    const w = wrapPromise<number>(new Promise((r) => (resolve = r)));
    expect(w.peek().status).toBe('pending');
    resolve(42);
    await w.peek().settled;
    expect(w.peek().status).toBe('success');
    expect(w.read()).toBe(42);
  });

  it('reports error without throwing from peek, and settled still resolves', async () => {
    const err = new Error('boom');
    const w = wrapPromise<number>(Promise.reject(err));
    await w.peek().settled; // resolves, does not reject
    expect(w.peek().status).toBe('error');
    expect(() => w.read()).toThrow(err);
  });

  it('read() throws the suspender while pending', () => {
    const w = wrapPromise<number>(new Promise(() => {}));
    let thrown: unknown;
    try {
      w.read();
    } catch (e) {
      thrown = e;
    }
    expect(typeof (thrown as { then?: unknown }).then).toBe('function');
  });
});
