import { describe, it, expect } from 'vitest';
import { defineSocket } from '../define-socket.js';

describe('defineSocket', () => {
  it('returns the handler object (server def doubles as the ref)', () => {
    const open = () => undefined;
    const ref = defineSocket<{ a: 1 }, { b: 2 }, undefined>({ open });
    // The runtime value is the handler (server reads .open/.message/.use).
    expect((ref as { open?: unknown }).open).toBe(open);
  });
});
