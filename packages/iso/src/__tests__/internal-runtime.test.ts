import { describe, expect, it } from 'vitest';
import * as runtime from '../internal-runtime.js';
import * as contract from '../internal/contract.js';

const PLUMBING = [
  'installHistoryShim',
  'installNavTransitionScheduler',
  'installPubSubBackend',
  'installStreamRegistry',
  'installWebSocketUpgrader',
  '__$createLoaderStub_hpiso',
] as const;

describe('iso /internal/runtime door', () => {
  it('exposes the framework-emitted plumbing as functions', () => {
    for (const name of PLUMBING) {
      expect(typeof (runtime as Record<string, unknown>)[name]).toBe(
        'function'
      );
    }
  });

  it('re-exports the entire wire-contract constants module', () => {
    for (const key of Object.keys(contract)) {
      expect((runtime as Record<string, unknown>)[key]).toBe(
        (contract as Record<string, unknown>)[key]
      );
    }
  });

  it('exposes the mutable env runtime-mode flag', () => {
    const { env } = runtime;
    expect(typeof env).toBe('object');
    expect(env).toHaveProperty('current');
  });

  it('exports exactly the plumbing set plus the contract module (no drift)', () => {
    const expected = new Set<string>([
      ...PLUMBING,
      'env',
      ...Object.keys(contract),
    ]);
    const actual = new Set(Object.keys(runtime));
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});
