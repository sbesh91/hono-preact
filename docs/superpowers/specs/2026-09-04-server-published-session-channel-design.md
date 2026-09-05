# Server-published session channel

Design for issue #398, "Client guards hand-manage auth-hint state". Promoted
from #320, which descends from the #260 DX review.

## The problem

A client guard has no way to learn what the server already decided, so an app
hand-manages auth-hint state. In `apps/site` that state is spread across three
files:

- `src/demo/guard.ts` declares `DEMO_AUTHED_KEY` and reads it in the client
  middleware.
- `src/pages/demo/login.tsx:24-30` writes the flag on submit.
- `src/pages/demo/projects-shell.tsx:70-89` re-writes it on every authed render
  (a self-heal) and clears it on logout.

The server guard is authoritative and has already computed a verdict. The client
re-derives a shadow of it from `localStorage`, and nothing keeps the two in
sync. This is the shape #260 named as its recurring theme: the safe variant of
the API exists, but the obvious spelling is the unsafe one. Here the obvious
spelling is "keep a `localStorage` flag", which drifts from the server's answer.

Security posture is not in question and does not change. The server guard is and
remains authoritative. This is about removing hand-managed duplication on the
client.

## Options considered

### A. A client-session-hint helper

Framework-owned storage plus accessors for a boolean-ish "probably signed in"
hint.

Rejected. What counts as a session hint, when it goes stale, and what to do on a
miss are app-policy judgments; per *think framework-first, not user-space* the
framework should not be making them. Worse, A standardizes the shadow-state
pattern rather than removing it: the app still writes the hint by hand, it just
writes it through a framework function. Every drift failure available today is
still available afterwards.

### B. Let client middleware consult the server verdict

Plumb the server guard's outcome to the client tier so a client guard reads a
real answer.

Rejected as literally stated. The timing crux the issue flagged resolves against
it, and the answer is already in the code. `packages/iso/src/internal/page-middleware-host.tsx`
picks one of two strategies per mount:

- `DeferredHost`, on the initial document load, runs the client chain *after*
  hydration. The server ran its guard for this exact URL, so a verdict does
  exist here.
- `SuspenseHost`, on every subsequent client navigation, dispatches the client
  chain before any loader RPC for the target route. No server verdict for that
  target exists yet.

Client navigation is the case the client guard exists for. Consulting a verdict
there means awaiting the RPC, which is exactly the flash the client guard is
meant to prevent. B reduces to "wait for the RPC".

### C. Server-published session channel (chosen)

B is framed around the wrong subject. The client guard does not need the verdict
for the *target route*. It needs the last thing the server said about the
*session*, and that always exists on a client navigation, because every SSR
document and every loader/action RPC has just come back through the server
chain.

So the framework carries an app-defined value on the server round-trips it
already makes. The app's own server middleware decides what the value is and
what it means, so no app policy moves into the framework. The client middleware
reads it off `ctx` instead of off `localStorage`.

C gets B's framing, which is deleting the shadow state rather than blessing it,
without A's app-policy problem. It is the framework-first answer.

## Design

### Shape

One channel declaration, referenced by both tiers of an existing middleware
pair:

```ts
const sessionChannel = defineSessionChannel<{ signedIn: boolean }>();

const requireSessionServer = defineServerMiddleware(async (ctx, next) => {
  const user = await currentUser(ctx.c);
  if (!user) throw redirect('/demo/login');
  sessionChannel.publish(ctx, { signedIn: true });
  await next();
});

const requireSessionClient = defineClientMiddleware(async (ctx, next) => {
  if (!sessionChannel.read(ctx)?.signedIn) throw redirect('/demo/login');
  await next();
});

export const requireSession = [requireSessionServer, requireSessionClient];
```

`read` returns `T | undefined`. `undefined` means no server round-trip has
published on this channel yet, which a guard treats as "not authorized" exactly
as an absent flag does today.

### Why not a merged `defineGuard({ server, client })` factory

That spelling reads as the more paired one, and it was the first candidate. It
loses to a build constraint.

`packages/vite/src/guard-strip.ts` removes wrong-env middleware from each bundle
by matching `defineServerMiddleware(...)` and `defineClientMiddleware(...)`
**call expressions by name** and replacing the entire call with an inert brand
object, so the user's function body and everything it imports tree-shake out. A
merged factory is a single call containing both tiers, so a whole-call
replacement would delete the tier that must survive. Stripping it correctly
requires new property-level rewriting in the plugin.

That cost lands in the one piece of machinery in this repo whose correctness is
hardest to test, and it buys only a nicer-looking declaration. The channel
object leaves both `define*Middleware` calls untouched, so `guard-strip` needs
no new strategy for them.

`defineSessionChannel()` itself must not survive into the wrong bundle carrying
a live payload, but it holds no user function body, so it does not need the
tree-shaking treatment the middleware factories get.

### Transport

The published value has to reach the client on both kinds of server round-trip:

1. **SSR document load.** Serialized into the bootstrap payload the document
   shell already emits.
2. **Loader and action RPC.** A response header (`X-HP-Channels`, a JSON
   object) set by `loaders-handler.ts` and `page-actions-handler.ts`.

   A header rather than a field on the response body, for two reasons. The
   loader RPC has two response shapes, a JSON body and an SSE stream
   (`c.json(result)` and the streaming path in `loaders-handler.ts`), and a body
   field covers only the first. And on the action side the body is
   `ActionEnvelope`, a discriminated union, so a sibling field would have to be
   intersected onto every arm. A header is uniform across all of these and
   reshapes no wire type.

Both are required. SSR-only would mean a logout performed through an action does
not refresh the channel until a full reload, which puts the app back to
reconciling state on the next page load. Carrying it on RPC responses is what
lets an action clear the hint in the same round-trip that ends the session.

Clearing is an explicit publish of a falsy value, not an inferred absence. The
logout action publishes `{ signedIn: false }`. An absent header means "this
response says nothing about channels" and deliberately leaves the store alone,
because a node can carry several unrelated middlewares and silence from one of
them is not a statement about the channel.

### Client storage

An in-memory module-level store, keyed by channel id. Explicitly **not**
`localStorage` or any other persistence.

This is the property that makes the whole design work. A cold load always
arrives with a server-authored value in the SSR bootstrap, so there is nothing
to persist across sessions and therefore nothing that can be stale across
sessions. The store is written once at bootstrap and overwritten by every
subsequent RPC response that publishes; a response that publishes nothing is a
no-op against it.

### Channel identity

Both tiers need a stable id for the channel that agrees across the server and
client bundles. It cannot be derived at runtime, since the two bundles construct
separate objects.

The Vite plugin already parses these modules for `guard-strip`, so it injects
the id at the `defineSessionChannel()` call site, derived from the module path
plus declaration order within the module. A runtime fallback id is needed for
the non-Vite paths (unit tests, the in-process `call()` path); those never cross
a bundle boundary, so a monotonic counter suffices there.

Channel identity is the main implementation risk in this design and should be
the first thing the implementation plan proves out.

### What this deletes in `apps/site`

- `DEMO_AUTHED_KEY` and the `localStorage` read in `src/demo/guard.ts`.
- The `markAuthed` writer and its `try`/`catch` in `login.tsx`.
- The self-heal `useEffect` and the logout `onSuccess` clear in
  `projects-shell.tsx`, along with that file's import of the guard module.

The demo is the design's own proof: if the three write sites do not all delete,
the design has not solved #398.

## Not in scope

**The untransmitted server outcome.** `DeferredHost` documents a related
pre-existing gap: if a server middleware renders an alternative so that the SSR
markup is not `children`, and the client chain produces no matching outcome, the
client renders `children` and the mismatch is on the user. The framework does
not transmit the server outcome to the client.

The transport designed here is the mechanism that would close that gap, and it
should be built so it can carry an outcome later. Closing it is deliberately
left to a separate change, so that #398 stays reviewable as one thing. This is
recorded because it is the second customer for the transport, and having two
customers is what justifies building a general channel rather than something
auth-specific.

**Security semantics.** Unchanged. The published value ships to the client on
every response and must be documented as non-secret: a channel payload is
app-authored data the app has chosen to expose, and a client guard remains a UX
affordance, never a security boundary.

## Overlap check

The issue asked whether this overlaps the loader/action gate work or the
`RegisteredEnv`-style registration pattern.

`RegisteredEnv` does not exist in this repo; it is an aspirational pattern named
in a sibling issue, so there is nothing to reconcile against. The genuinely
adjacent machinery is the `TDeny` inference in `defineServerMiddleware`, which
already flows a server-authored payload type outward from a middleware to a
consumer. This design deliberately does not extend it: `TDeny` is inferable
because it sits in the function's return position and has to union across a
whole `use` array, whereas a channel payload is declared once and read by one
paired middleware. An explicit type argument on the channel is the honest
spelling, and the repo has already learned that a type-argument spelling is
inference-dead.
