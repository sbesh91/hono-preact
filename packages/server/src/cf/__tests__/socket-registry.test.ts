import { describe, it, expect, afterEach } from 'vitest';
import type { SocketDef } from '@hono-preact/iso/internal';
import {
  installSocketRegistry,
  getSocketRegistry,
  __resetSocketRegistryForTesting,
} from '../socket-registry.js';

type AnySocketDef = SocketDef<unknown, unknown, unknown>;

afterEach(() => __resetSocketRegistryForTesting());

describe('socket registry seam', () => {
  it('returns undefined when nothing is installed', () => {
    expect(getSocketRegistry()).toBeUndefined();
  });

  it('returns the installed getter', async () => {
    const map = new Map<string, AnySocketDef>([['m::s', {} as AnySocketDef]]);
    installSocketRegistry(() => map);
    const getter = getSocketRegistry();
    expect(getter).toBeDefined();
    expect(await getter!()).toBe(map);
  });

  it('reset clears the installed getter', () => {
    installSocketRegistry(() => new Map());
    __resetSocketRegistryForTesting();
    expect(getSocketRegistry()).toBeUndefined();
  });
});
