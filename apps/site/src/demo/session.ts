import type { Context } from 'hono';
import {
  deleteCookie,
  getSignedCookie,
  setSignedCookie,
} from 'hono/cookie';
import { getUser, type User } from './data.js';

export const DEMO_SESSION_COOKIE = 'demo_session';

// Hardcoded secret for the demo. NOT a real auth pattern; a real app would
// pull this from env/secrets. The demo deploy doesn't carry sensitive data.
export const DEMO_SESSION_SECRET = 'hono-preact-demo-secret-do-not-copy';

export async function signIn(c: Context, userId: string): Promise<void> {
  await setSignedCookie(c, DEMO_SESSION_COOKIE, userId, DEMO_SESSION_SECRET, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    // The demo deploy is HTTPS; flag the cookie secure unconditionally.
    secure: true,
    maxAge: 60 * 60 * 24 * 7, // 1 week
  });
}

export function signOut(c: Context): void {
  deleteCookie(c, DEMO_SESSION_COOKIE, { path: '/' });
}

export async function currentUser(c: Context): Promise<User | null> {
  const raw = await getSignedCookie(c, DEMO_SESSION_SECRET, DEMO_SESSION_COOKIE);
  if (!raw || typeof raw !== 'string') return null;
  return getUser(raw);
}
