import { describe, it, expect } from 'vitest';
import { serverRoute } from '../server-route.js';
import { defineAction, _defineRouteAction } from '../action.js';
import { defineServerMiddleware } from '../define-middleware.js';

// Reads `__routeId` off the raw function the same way the server's
// `extractActions` does (a non-enumerable property defineAction attaches).
const routeIdOf = (ref: unknown): unknown =>
  (ref as { __routeId?: unknown }).__routeId;

describe('serverRoute().action', () => {
  it('stamps __routeId onto the action at runtime', () => {
    const fn = async () => ({ ok: true });
    const ref = serverRoute('/things/:id').action(fn);
    // The server reads the raw fn; route-binding must survive as a property.
    expect(routeIdOf(ref)).toBe('/things/:id');
  });

  it('bare defineAction has no __routeId (route-independent)', () => {
    const ref = defineAction(async () => ({ ok: true }));
    expect(routeIdOf(ref)).toBeUndefined();
  });

  it('forwards opts (use/timeoutMs) through alongside __routeId', () => {
    const mw = defineServerMiddleware<'action'>(async (_c, next) => {
      await next();
    });
    const ref = serverRoute('/things/:id').action(async () => ({ ok: true }), {
      use: [mw],
      timeoutMs: 1234,
    });
    const meta = ref as unknown as {
      use?: unknown;
      timeoutMs?: unknown;
      __routeId?: unknown;
    };
    expect(meta.use).toEqual([mw]);
    expect(meta.timeoutMs).toBe(1234);
    expect(meta.__routeId).toBe('/things/:id');
  });

  it('_defineRouteAction threads the route id into the action metadata', () => {
    const ref = _defineRouteAction('/movies/:id', async () => 1);
    expect(routeIdOf(ref)).toBe('/movies/:id');
  });
});
