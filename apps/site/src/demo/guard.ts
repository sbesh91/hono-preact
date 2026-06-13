import {
  defineServerMiddleware,
  defineClientMiddleware,
  redirect,
} from 'hono-preact';
import { currentUser } from './session.js';

// localStorage key used by the client guard to gate intra-app navigation.
// The real session truth lives in the HttpOnly signed cookie; this is a
// client-side hint that gets set/cleared by login + logout views and
// reconciled on every full reload via the server middleware.
export const DEMO_AUTHED_KEY = 'demo:authed';

// Server-side check (SSR / full reload + RPC requests for loaders/actions):
// validates the signed cookie and resolves the user. Declared once as `use`
// on the route tree node in routes.ts; the framework runs it for every render
// and every loader/action RPC under that subtree, so unauthenticated requests
// redirect the same way regardless of entry point.
const requireSessionServer = defineServerMiddleware(async (ctx, next) => {
  const user = await currentUser(ctx.c);
  if (!user) throw redirect('/demo/login');
  await next();
});

// Client-side check (intra-app navigation): reads a localStorage flag set
// by the login view on successful sign-in. If absent we bounce to
// /demo/login. On full reload the server middleware takes over and any
// drift is corrected (an authed user without the flag lands on
// /demo/projects and the flag gets set by useEffect; an unauthed user
// with a stale flag bounces from the server side anyway).
const requireSessionClient = defineClientMiddleware(async (_ctx, next) => {
  if (typeof window === 'undefined') {
    await next();
    return;
  }
  if (!window.localStorage.getItem(DEMO_AUTHED_KEY)) {
    throw redirect('/demo/login');
  }
  await next();
});

// requireSession is declared once as `use` on the /demo/projects route node
// in routes.ts. The dispatcher partitions server vs client members by their
// `runs` tag, so handing the same array to the route node gates both render
// and RPC paths without drift.
export const requireSession = [requireSessionServer, requireSessionClient];
