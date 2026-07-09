import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createCaller, isRedirect } from 'hono-preact';
import { serverActions } from '../login.server.js';
import { resetDemoData, findUserByEmail } from '../../../demo/data.js';
import { DEMO_SESSION_COOKIE } from '../../../demo/session.js';

// Run `fn` inside a real Hono request so the action sees a live Context
// (signIn writes the session cookie onto c.res).
async function inRequest<T>(fn: (c: Context) => Promise<T>): Promise<T> {
  const app = new Hono();
  let result!: T;
  app.post('/', async (c) => {
    result = await fn(c);
    return c.text('ok');
  });
  const res = await app.request('/', { method: 'POST' });
  expect(res.status).toBe(200);
  return result;
}

describe('login action', () => {
  beforeEach(() => resetDemoData());

  it('upserts the user, sets a session cookie, and redirects to the projects list', async () => {
    const captured = await inRequest(async (c) => {
      const r = await createCaller(c).call(serverActions.login, {
        email: 'newuser@example.com',
        name: 'New User',
      });
      return { r, cookieSet: c.res.headers.get('set-cookie') };
    });
    expect(captured.r.ok).toBe(false);
    if (!captured.r.ok) {
      expect(isRedirect(captured.r.outcome)).toBe(true);
      if (isRedirect(captured.r.outcome)) {
        expect(captured.r.outcome.to).toBe('/demo/projects');
      }
    }
    expect(findUserByEmail('newuser@example.com')?.name).toBe('New User');
    expect(captured.cookieSet).toMatch(new RegExp(`${DEMO_SESSION_COOKIE}=`));
  });

  it('rejects an empty email', async () => {
    const threw = await inRequest(async (c) => {
      try {
        await createCaller(c).call(serverActions.login, {
          email: '',
          name: '',
        });
        return null;
      } catch (e) {
        return e instanceof Error ? e : new Error(String(e));
      }
    });
    expect(threw).not.toBe(null);
    expect(threw?.message).toMatch(/email/i);
  });
});
