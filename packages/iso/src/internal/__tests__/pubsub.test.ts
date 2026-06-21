import { describe, it, expect, afterEach } from 'vitest';
import {
  inProcessBackend,
  getPubSubBackend,
  installPubSubBackend,
} from '../pubsub.js';

afterEach(() => installPubSubBackend(inProcessBackend)); // restore default

describe('inProcessBackend', () => {
  it('delivers a published message to every subscriber of the topic', () => {
    const got: unknown[] = [];
    const off1 = inProcessBackend.subscribe('t', (m) => got.push(['a', m]));
    const off2 = inProcessBackend.subscribe('t', (m) => got.push(['b', m]));
    inProcessBackend.publish('t', 42);
    off1();
    off2();
    expect(got).toEqual([
      ['a', 42],
      ['b', 42],
    ]);
  });

  it('isolates topics', () => {
    const got: unknown[] = [];
    const off = inProcessBackend.subscribe('a', (m) => got.push(m));
    inProcessBackend.publish('b', 1);
    inProcessBackend.publish('a', 2);
    off();
    expect(got).toEqual([2]);
  });

  it('stops delivery after unsubscribe', () => {
    const got: unknown[] = [];
    const off = inProcessBackend.subscribe('t', (m) => got.push(m));
    inProcessBackend.publish('t', 1);
    off();
    inProcessBackend.publish('t', 2);
    expect(got).toEqual([1]);
  });

  it('isolates a throwing subscriber from the others', () => {
    const got: unknown[] = [];
    const offBad = inProcessBackend.subscribe('t', () => {
      throw new Error('boom');
    });
    const offGood = inProcessBackend.subscribe('t', (m) => got.push(m));
    expect(() => inProcessBackend.publish('t', 1)).not.toThrow();
    offBad();
    offGood();
    expect(got).toEqual([1]);
  });
});

describe('install seam', () => {
  it('getPubSubBackend returns the in-process backend by default', () => {
    expect(getPubSubBackend()).toBe(inProcessBackend);
  });

  it('installPubSubBackend swaps the active backend', () => {
    const calls: string[] = [];
    const fake: typeof inProcessBackend = {
      publish: (t) => calls.push(`pub:${t}`),
      subscribe: () => () => undefined,
    };
    installPubSubBackend(fake);
    getPubSubBackend().publish('x', 0);
    expect(calls).toEqual(['pub:x']);
  });
});
