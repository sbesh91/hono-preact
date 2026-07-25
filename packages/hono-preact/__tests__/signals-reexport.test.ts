import { describe, it, expect } from 'vitest';
import * as hp from 'hono-preact';
import * as sig from '@preact/signals';

describe('hono-preact re-exports @preact/signals first-party', () => {
  it('re-exports the primitive set, identical to @preact/signals', () => {
    for (const name of [
      'signal',
      'computed',
      'effect',
      'batch',
      'untracked',
      'useSignal',
      'useComputed',
      'useSignalEffect',
    ] as const) {
      expect(hp[name]).toBe(sig[name]);
    }
  });

  it('a re-exported signal/computed works through the framework entry', () => {
    const a = hp.signal(1);
    const b = hp.computed(() => a.value + 1);
    expect(b.value).toBe(2);
    a.value = 10;
    expect(b.value).toBe(11);
  });
});
