import type { Context } from 'hono';
import {
  deleteCookie,
  getSignedCookie,
  setSignedCookie,
} from 'hono/cookie';
import { upsertUser, type User } from './data.js';

export const DEMO_SESSION_COOKIE = 'demo_session';

// Hardcoded secret for the demo. NOT a real auth pattern; a real app would
// pull this from env/secrets. The demo deploy doesn't carry sensitive data.
export const DEMO_SESSION_SECRET = 'hono-preact-demo-secret-do-not-copy';

// The cookie value is a JSON payload with the user's identity. Storing email
// + name (not just id) lets currentUser re-create the in-memory record on a
// fresh isolate: Workers can swap us onto a new isolate between requests, so
// the data module's seeded store may not contain the user we created at login.
type CookiePayload = { id: string; email: string; name: string };

export async function signIn(
  c: Context,
  user: { id: string; email: string; name: string }
): Promise<void> {
  const payload: CookiePayload = {
    id: user.id,
    email: user.email,
    name: user.name,
  };
  await setSignedCookie(
    c,
    DEMO_SESSION_COOKIE,
    JSON.stringify(payload),
    DEMO_SESSION_SECRET,
    {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      secure: true,
      maxAge: 60 * 60 * 24 * 7, // 1 week
    }
  );
}

export function signOut(c: Context): void {
  deleteCookie(c, DEMO_SESSION_COOKIE, { path: '/' });
}

export async function currentUser(c: Context): Promise<User | null> {
  const raw = await getSignedCookie(c, DEMO_SESSION_SECRET, DEMO_SESSION_COOKIE);
  if (!raw || typeof raw !== 'string') return null;
  let parsed: CookiePayload;
  try {
    parsed = JSON.parse(raw) as CookiePayload;
  } catch {
    return null;
  }
  if (
    typeof parsed?.email !== 'string' ||
    typeof parsed?.name !== 'string'
  ) {
    return null;
  }
  // Self-heal: the in-memory store may not have this user (cold isolate);
  // upsertUser is idempotent on email so this is safe to call on every read.
  return upsertUser(parsed.email, parsed.name);
}
