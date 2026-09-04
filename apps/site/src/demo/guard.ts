import {
  defineServerMiddleware,
  defineClientMiddleware,
  defineSessionChannel,
  redirect,
} from 'hono-preact';
import { currentUser } from './session.js';

// What the server guard tells the client guard on every round-trip. The real
// session truth stays in the HttpOnly signed cookie and the server guard below
// stays authoritative; this is a UX hint so intra-app navigation does not have
// to wait for an RPC to know it will be bounced.
const session = defineSessionChannel<{ signedIn: boolean }>();

// Server-side check (SSR / full reload + RPC requests for loaders/actions):
// validates the signed cookie and resolves the user. Declared once as `use` on
// the route tree node in routes.ts; the framework runs it for every render and
// every loader/action RPC under that subtree, so unauthenticated requests
// redirect the same way regardless of entry point.
const requireSessionServer = defineServerMiddleware(async (ctx, next) => {
  const user = await currentUser(ctx.c);
  if (!user) throw redirect('/demo/login');
  session.publish(ctx, { signedIn: true });
  await next();
});

// Client-side check (intra-app navigation): reads what the last server
// round-trip published. On a full reload the SSR bootstrap carries it; on a
// client navigation it is whatever the most recent loader or action RPC said.
// Logout clears it with no bookkeeping here, because the logout response runs
// this chain and publishes nothing.
const requireSessionClient = defineClientMiddleware(async (ctx, next) => {
  if (!session.read(ctx)?.signedIn) throw redirect('/demo/login');
  await next();
});

// requireSession is declared once as `use` on the /demo/projects route node in
// routes.ts. The dispatcher partitions server vs client members by their `runs`
// tag, so handing the same array to the route node gates both render and RPC
// paths without drift.
export const requireSession = [requireSessionServer, requireSessionClient];
