import { describe, it, expect } from 'vitest';
import { serverRoute } from '../server-route.js';
import { defineLoader } from '../define-loader.js';

describe('runtime route marker', () => {
  it('serverRoute().loader stamps __routeId at runtime', () => {
    const ref = serverRoute('/movies/:id').loader(async () => 1);
    expect(ref.__routeId).toBe('/movies/:id');
  });
  it('bare defineLoader has no __routeId (route-independent)', () => {
    const ref = defineLoader(async () => 1);
    expect(ref.__routeId).toBeUndefined();
  });
});
