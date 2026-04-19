import { describe, it, expect, vi } from 'vitest';
import { createGuard, runGuards, GuardRedirect } from '../guard.js';
import type { GuardContext } from '../guard.js';

const ctx: GuardContext = { location: {} as any };

describe('createGuard', () => {
  it('returns the function unchanged', () => {
    const fn = async (_ctx: GuardContext, next: () => Promise<any>) => next();
    expect(createGuard(fn)).toBe(fn);
  });
});

describe('runGuards', () => {
  it('resolves to undefined with an empty guard list', async () => {
    const result = await runGuards([], ctx);
    expect(result).toBeUndefined();
  });

  it('single guard returning { redirect } short-circuits', async () => {
    const guard = createGuard(async (_ctx, _next) => ({ redirect: '/login' }));
    const result = await runGuards([guard], ctx);
    expect(result).toEqual({ redirect: '/login' });
  });

  it('single guard returning { render } short-circuits', async () => {
    const ForbiddenPage = () => null;
    const guard = createGuard(async (_ctx, _next) => ({ render: ForbiddenPage }));
    const result = await runGuards([guard], ctx);
    expect(result).toEqual({ render: ForbiddenPage });
  });

  it('single guard calling next() passes through to undefined', async () => {
    const guard = createGuard(async (_ctx, next) => next());
    const result = await runGuards([guard], ctx);
    expect(result).toBeUndefined();
  });

  it('first guard redirect prevents second guard from running', async () => {
    const secondFn = vi.fn();
    const first = createGuard(async (_ctx, _next) => ({ redirect: '/login' }));
    const second = createGuard(async (_ctx, _next) => { secondFn(); return undefined; });
    await runGuards([first, second], ctx);
    expect(secondFn).not.toHaveBeenCalled();
  });

  it('first guard passes, second guard redirects', async () => {
    const first = createGuard(async (_ctx, next) => next());
    const second = createGuard(async (_ctx, _next) => ({ redirect: '/forbidden' }));
    const result = await runGuards([first, second], ctx);
    expect(result).toEqual({ redirect: '/forbidden' });
  });
});

describe('GuardRedirect', () => {
  it('is an Error subclass', () => {
    expect(new GuardRedirect('/login')).toBeInstanceOf(Error);
  });

  it('has the correct location property', () => {
    const err = new GuardRedirect('/login');
    expect(err.location).toBe('/login');
  });

  it('has name set to GuardRedirect', () => {
    const err = new GuardRedirect('/login');
    expect(err.name).toBe('GuardRedirect');
  });

  it('has a descriptive message', () => {
    const err = new GuardRedirect('/login');
    expect(err.message).toBe('Guard redirect to /login');
  });
});
