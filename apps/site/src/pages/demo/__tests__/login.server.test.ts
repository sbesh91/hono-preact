import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createCaller, isDeny, isRedirect } from 'hono-preact';
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

  it('rejects an empty email with a 400 deny', async () => {
    // The action denies (a value outcome through createCaller, not a thrown
    // Error): a plain throw would be masked as 'Action failed' in production.
    const r = await inRequest(async (c) =>
      createCaller(c).call(serverActions.login, { email: '', name: '' })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) {
        expect(r.outcome.status).toBe(400);
        expect(r.outcome.message).toMatch(/email/i);
      }
    }
  });
});
