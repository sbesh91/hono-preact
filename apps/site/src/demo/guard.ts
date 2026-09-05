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
export const session = defineSessionChannel<{ signedIn: boolean }>();

// Publisher for the whole demo subtree (`use` on the /demo node in routes.ts),
// one level above where the session is enforced. Publishing is deliberately
// broader than enforcing: a navigation that starts on any demo page carries a
// real answer into /demo/projects instead of arriving with an empty store.
//
// It is scoped to /demo rather than the app, because a document that carries a
// published snapshot is per-visitor and must not be stored by a shared cache.
// Publishing app-wide would make every docs page uncacheable to buy one demo
// guard a slightly earlier redirect.
//
// The session lookup runs again in requireSessionServer below on the guarded
// subtree. Caching it across the two would mean a per-request memo keyed on the
// Hono context, which the login and logout actions (which change the cookie
// mid-request) would then have to invalidate. A signed-cookie verify plus an
// idempotent in-memory upsert is cheap, so this stays two plain reads.
export const publishSession = defineServerMiddleware(async (ctx, next) => {
  const user = await currentUser(ctx.c);
  session.publish(ctx, { signedIn: Boolean(user) });
  await next();
});

// Server-side check (SSR / full reload + RPC requests for loaders/actions):
// validates the signed cookie and resolves the user. Declared once as `use` on
// the route tree node in routes.ts; the framework runs it for every render and
// every loader/action RPC under that subtree, so unauthenticated requests
// redirect the same way regardless of entry point.
//
// It publishes as well as enforcing, and the publish precedes the redirect
// throw because the redirect response still carries the channel header. An
// expired cookie therefore publishes { signedIn: false } and actively clears
// the client hint, rather than leaving the client leg waving navigations
// through on a stale { signedIn: true }.
const requireSessionServer = defineServerMiddleware(async (ctx, next) => {
  const user = await currentUser(ctx.c);
  session.publish(ctx, { signedIn: Boolean(user) });
  if (!user) throw redirect('/demo/login');
  await next();
});

// Client-side check (intra-app navigation): reads what the last server
// round-trip published. On a full reload hydrateChannelsFromDocument in
// boot-client.ts fills the store from the SSR bootstrap before any client
// chain runs. On a client navigation the value is whatever the most recent
// loader or action RPC published.
//
// The three cases are spelled out rather than folded into one optional chain,
// because "no answer" and "a negative answer" are different facts:
//
//   undefined            no round-trip has published on this channel. That is
//                        UNKNOWN, not unauthorized, and this leg defers: the
//                        navigation proceeds and the loader RPC's server guard
//                        (which is the authority) redirects if it has to. The
//                        cost is a brief shell render for a signed-out visitor
//                        arriving from outside /demo. Redirecting instead would
//                        falsely bounce a genuinely signed-in visitor, which
//                        breaks the app rather than looking untidy.
//   { signedIn: false }  a real answer, from a round-trip that checked. Redirect
//                        immediately; there is nothing to wait for. The logout
//                        action in login.server.ts publishes exactly this after
//                        signOut, which is what clears a stale hint.
//   { signedIn: true }   proceed.
const requireSessionClient = defineClientMiddleware(async (ctx, next) => {
  const hint = session.read(ctx);
  if (hint !== undefined && !hint.signedIn) throw redirect('/demo/login');
  await next();
});

// requireSession is declared once as `use` on the /demo/projects route node in
// routes.ts. The dispatcher partitions server vs client members by their `runs`
// tag, so handing the same array to the route node gates both render and RPC
// paths without drift.
export const requireSession = [requireSessionServer, requireSessionClient];
