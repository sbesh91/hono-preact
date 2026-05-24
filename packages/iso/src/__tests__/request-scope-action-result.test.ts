import { describe, expect, it } from 'vitest';
import {
  runRequestScope,
  getActionResultSlot,
  setActionResultSlot,
  type ActionResultSlot,
} from '../cache.js';

describe('action-result slot in request scope', () => {
  it('returns null outside any scope', () => {
    expect(getActionResultSlot()).toBeNull();
  });

  it('returns the value set via setActionResultSlot inside the scope', async () => {
    const slot: ActionResultSlot = {
      module: 'pages/foo.server',
      action: 'submit',
      resolution: { kind: 'success', data: { id: 1 } },
      submittedPayload: { name: 'alice' },
    };
    const seen = await runRequestScope(async () => {
      setActionResultSlot(slot);
      return getActionResultSlot();
    });
    expect(seen).toEqual(slot);
  });

  it('does not leak across scopes', async () => {
    await runRequestScope(async () => {
      setActionResultSlot({
        module: 'a',
        action: 'b',
        resolution: { kind: 'success', data: 1 },
        submittedPayload: null,
      });
    });
    expect(getActionResultSlot()).toBeNull();
  });

  it('inherits a parent store when called inside an existing scope', async () => {
    const slot: ActionResultSlot = {
      module: 'm',
      action: 'a',
      resolution: { kind: 'success' as const, data: 1 },
      submittedPayload: null,
    };
    const seenInside = await runRequestScope(async () => {
      setActionResultSlot(slot);
      // Nested call should see the SAME slot (inherits parent store).
      return await runRequestScope(async () => {
        return getActionResultSlot();
      });
    });
    expect(seenInside).toEqual(slot);
  });
});
