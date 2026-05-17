import { defineClientGuard, defineServerGuard } from 'hono-preact';
import { currentUser } from './session.js';

// localStorage key used by the client guard to gate intra-app navigation.
// The real session truth lives in the HttpOnly signed cookie; this is a
// client-side hint that gets set/cleared by login + logout views and
// reconciled on every full reload via the server guard.
export const DEMO_AUTHED_KEY = 'demo:authed';

// Server-side check (SSR / full reload): validates the signed cookie and
// resolves the user.
const requireSessionServer = defineServerGuard(async (ctx, next) => {
  const user = await currentUser(ctx.c);
  if (!user) return { redirect: '/demo/login' };
  return next();
});

// Client-side check (intra-app navigation): reads a localStorage flag set
// by the login view on successful sign-in. If absent we bounce to /demo/login.
// On full reload the server guard takes over and any drift is corrected
// (an authed user without the flag lands on /demo/projects and the flag gets
// set by useEffect; an unauthed user with a stale flag bounces from the
// server side anyway).
const requireSessionClient = defineClientGuard((_ctx, next) => {
  if (typeof window === 'undefined') return next();
  if (!window.localStorage.getItem(DEMO_AUTHED_KEY)) {
    return { redirect: '/demo/login' };
  }
  return next();
});

export const requireSession = [requireSessionServer, requireSessionClient];
