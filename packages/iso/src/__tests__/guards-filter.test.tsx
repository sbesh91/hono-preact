// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import {
  defineServerGuard,
  defineClientGuard,
} from '../guard.js';
import { Guards } from '../internal/guards.js';
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

describe('Guards env filter', () => {
  it('runs server guards on the server, skips client guards', async () => {
    env.current = 'server';
    const calls: string[] = [];
    const sg = defineServerGuard(async (_c, next) => {
      calls.push('server');
      return next();
    });
    const cg = defineClientGuard(async (_c, next) => {
      calls.push('client');
      return next();
    });
    render(
      <LocationProvider>
        <Guards guards={[sg, cg]} location={loc}>
          <div data-testid="page">ok</div>
        </Guards>
      </LocationProvider>,
    );
    await screen.findByTestId('page');
    expect(calls).toEqual(['server']);
  });

  it('runs client guards on the client, skips server guards', async () => {
    env.current = 'browser';
    const calls: string[] = [];
    const sg = defineServerGuard(async (_c, next) => {
      calls.push('server');
      return next();
    });
    const cg = defineClientGuard(async (_c, next) => {
      calls.push('client');
      return next();
    });
    render(
      <LocationProvider>
        <Guards guards={[sg, cg]} location={loc}>
          <div data-testid="page">ok</div>
        </Guards>
      </LocationProvider>,
    );
    await screen.findByTestId('page');
    expect(calls).toEqual(['client']);
  });

  it('preserves array order across env filter', async () => {
    env.current = 'browser';
    const calls: string[] = [];
    const a = defineClientGuard(async (_c, next) => {
      calls.push('a');
      return next();
    });
    const b = defineServerGuard(async (_c, next) => {
      calls.push('b-server');
      return next();
    });
    const c = defineClientGuard(async (_c, next) => {
      calls.push('c');
      return next();
    });
    render(
      <LocationProvider>
        <Guards guards={[a, b, c]} location={loc}>
          <div data-testid="page">ok</div>
        </Guards>
      </LocationProvider>,
    );
    await screen.findByTestId('page');
    expect(calls).toEqual(['a', 'c']);
  });
});
