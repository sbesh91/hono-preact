import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_SECRET,
  signIn,
  signOut,
  currentUser,
} from '../session.js';
import { resetDemoData, upsertUser } from '../data.js';

function makeApp() {
  const app = new Hono();
  app.post('/sign-in', async (c) => {
    const user = upsertUser('alice@example.com', 'Alice');
    await signIn(c, user);
    return c.text('ok');
  });
  app.post('/sign-out', async (c) => {
    signOut(c);
    return c.text('ok');
  });
  app.get('/who', async (c) => {
    const user = await currentUser(c);
    return c.json({ user });
  });
  return app;
}

describe('demo session', () => {
  beforeEach(() => resetDemoData());

  it('sets a signed cookie on sign-in', async () => {
    const app = makeApp();
    const res = await app.request('/sign-in', { method: 'POST' });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toMatch(new RegExp(`${DEMO_SESSION_COOKIE}=`));
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
  });

  it('currentUser returns the signed-in user when the signed cookie is valid', async () => {
    const app = makeApp();
    const signIn = await app.request('/sign-in', { method: 'POST' });
    const cookie = signIn.headers.get('set-cookie')!;
    const cookieHeader = cookie.split(';')[0];

    const who = await app.request('/who', {
      headers: { cookie: cookieHeader },
    });
    const body = (await who.json()) as { user: { name: string } | null };
    expect(body.user?.name).toBe('Alice');
  });

  it('currentUser returns null when there is no cookie', async () => {
    const app = makeApp();
    const who = await app.request('/who');
    const body = (await who.json()) as { user: unknown };
    expect(body.user).toBe(null);
  });

  it('signOut clears the cookie', async () => {
    const app = makeApp();
    const res = await app.request('/sign-out', { method: 'POST' });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toMatch(new RegExp(`${DEMO_SESSION_COOKIE}=;`));
  });

  it('uses a non-empty secret', () => {
    expect(typeof DEMO_SESSION_SECRET).toBe('string');
    expect(DEMO_SESSION_SECRET.length).toBeGreaterThan(0);
  });
});
