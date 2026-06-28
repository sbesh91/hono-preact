# Release note: realtime cross-runtime trap enforcement (#181)

Two breaking changes harden the realtime API against silent cross-runtime
divergence. Both turn a runtime footgun into a compile error.

## `socket.data` and `conn.data` are now read-only

The per-connection `.data` bag is typed `Readonly<Data>` on both sockets and
rooms. On Cloudflare the Durable Object is hibernatable, so each event re-reads
the connect-time value and an in-place mutation silently vanishes; the read-only
type makes that mutation a compile error instead.

**Migration:** for Node-only mutable per-connection state, capture a closure
variable in `open()` (sockets) or `onJoin()` (rooms) instead of writing to
`.data`. For state that must evolve and broadcast, use `setPresence` (rooms).

## A factory-less room's `conn.data` is now `undefined` (was `{}`)

A room defined without a `data` factory now yields `conn.data === undefined`,
matching `socket.data` and the Cloudflare resolution path. The `defineRoom`
`Data` generic defaults to `undefined`.

**Migration:** if you read `conn.data` in a factory-less room, either add a
`data` factory or guard the access. With the new default, `conn.data.foo` is a
compile error rather than a runtime `undefined`.

## Also: Node dev warning for the 6KB forward budget

Not breaking. The Node dev server now warns when a `data` factory result exceeds
the 6KB forward-header budget that throws at connect time on Cloudflare, so the
limit surfaces locally instead of only on deploy.
