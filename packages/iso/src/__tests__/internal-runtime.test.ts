import { describe, expect, it } from 'vitest';
import * as runtime from '../internal-runtime.js';
import * as contract from '../internal/contract.js';

const PLUMBING = [
  'installHistoryShim',
  'installNavTransitionScheduler',
  'installStreamRegistry',
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
});
