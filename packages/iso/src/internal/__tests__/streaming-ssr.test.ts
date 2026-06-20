import { describe, it, expect } from 'vitest';
import { runRequestScope } from '../../cache.js';
import {
  registerServerStreamingLoader,
  takeServerStreamingLoaders,
} from '../streaming-ssr.js';

async function* emptyGen(): AsyncGenerator<unknown, unknown, unknown> {}

describe('streaming-ssr registry', () => {
  it('registers per-request, takes once in order, then clears', async () => {
    await runRequestScope(async () => {
      const genA = emptyGen();
      const genB = emptyGen();
      registerServerStreamingLoader('A', genA);
      registerServerStreamingLoader('B', genB);

      const taken = takeServerStreamingLoaders();
      expect(taken.map((s) => s.loaderId)).toEqual(['A', 'B']);
      expect(taken[0]?.gen).toBe(genA);
      expect(taken[1]?.gen).toBe(genB);

      // Ownership transferred: a second take sees an empty registry.
      expect(takeServerStreamingLoaders()).toEqual([]);
    });
  });

  it('isolates registries across separate request scopes', async () => {
    await runRequestScope(async () => {
      registerServerStreamingLoader('only-here', emptyGen());
    });
    // A fresh scope must not see the previous scope's registration.
    await runRequestScope(async () => {
      expect(takeServerStreamingLoaders()).toEqual([]);
    });
  });

  it('no-ops outside any request scope (e.g. the client)', () => {
    registerServerStreamingLoader('X', emptyGen());
    expect(takeServerStreamingLoaders()).toEqual([]);
  });
});
