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

  it('a held peek() result reflects the LIVE status after settling', async () => {
    // The status is a getter, not a snapshot: a caller that caches peek() and
    // re-reads `.status` after awaiting `.settled` must see 'success', not a
    // stale 'pending'.
    let resolve!: (v: number) => void;
    const w = wrapPromise<number>(new Promise((r) => (resolve = r)));
    const held = w.peek();
    expect(held.status).toBe('pending');
    resolve(7);
    await held.settled;
    expect(held.status).toBe('success');
  });
});
