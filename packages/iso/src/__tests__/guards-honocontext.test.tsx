// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import type { Context } from 'hono';
import { HonoRequestContext } from '../internal/contexts.js';
import { Guards } from '../internal/guards.js';
import { defineServerGuard } from '../guard.js';
import { env } from '../is-browser.js';

vi.mock('preact-iso', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useLocation: () => ({ route: () => {} }) };
});

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const originalEnv = env.current;
afterEach(() => {
  env.current = originalEnv;
  cleanup();
});

describe('<Guards> server-side', () => {
  it('throws when a server guard is present but no Provider wraps the tree', () => {
    env.current = 'server';
    const probe = defineServerGuard(async (_ctx, next) => next());
    expect(() =>
      render(
        <LocationProvider>
          <Guards guards={[probe]} location={loc}>
            <div />
          </Guards>
        </LocationProvider>,
      ),
    ).toThrow(/HonoContext\.Provider/);
  });

  it('passes HonoContext.context as ctx.c to server guards', async () => {
    env.current = 'server';
    let observed: unknown = null;
    const probe = defineServerGuard(async (ctx, next) => {
      observed = ctx.c;
      return next();
    });
    const fakeC = { req: {}, header: () => {}, var: {} } as unknown as Context;

    render(
      <HonoRequestContext.Provider value={{ context: fakeC }}>
        <LocationProvider>
          <Guards guards={[probe]} location={loc}>
            <div data-testid="child">child</div>
          </Guards>
        </LocationProvider>
      </HonoRequestContext.Provider>
    );

    await screen.findByTestId('child');
    expect(observed).toBe(fakeC);
  });
});
