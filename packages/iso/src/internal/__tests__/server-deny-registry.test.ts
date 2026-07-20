import { describe, it, expect } from 'vitest';
import { runRequestScope } from '../../cache.js';
import {
  recordServerDeny,
  takeServerDeny,
} from '../server-deny-registry.js';

describe('server-deny-registry', () => {
  it('records and takes a deny within a request scope', async () => {
    await runRequestScope(async () => {
      recordServerDeny({ status: 404, headers: { 'x-a': '1' } });
      const taken = takeServerDeny();
      expect(taken).toEqual({ status: 404, headers: { 'x-a': '1' } });
    });
  });

  it('is first-write-wins: a second record is ignored', async () => {
    await runRequestScope(async () => {
      recordServerDeny({ status: 404, headers: undefined });
      recordServerDeny({ status: 403, headers: undefined });
      expect(takeServerDeny()).toEqual({ status: 404, headers: undefined });
    });
  });

  it('take clears the slot (second take is null)', async () => {
    await runRequestScope(async () => {
      recordServerDeny({ status: 500, headers: undefined });
      expect(takeServerDeny()?.status).toBe(500);
      expect(takeServerDeny()).toBeNull();
    });
  });

  it('does not leak across request scopes', async () => {
    await runRequestScope(async () => {
      recordServerDeny({ status: 404, headers: undefined });
    });
    await runRequestScope(async () => {
      expect(takeServerDeny()).toBeNull();
    });
  });

  it('is a no-op outside any request scope', () => {
    recordServerDeny({ status: 404, headers: undefined });
    expect(takeServerDeny()).toBeNull();
  });
});
