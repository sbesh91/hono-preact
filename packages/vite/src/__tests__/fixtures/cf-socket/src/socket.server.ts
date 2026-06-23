import { defineSocket, defineServerMiddleware, deny } from 'hono-preact';

type Incoming = { kind: 'say'; text: string };
type Outgoing = { kind: 'echo'; text: string; who: string };

// A guard that always denies (the canonical auth-deny shape). On Cloudflare the
// worker must close 4403 via the connector deny WITHOUT contacting the DO.
const denyAll = defineServerMiddleware(async () => {
  throw deny('forbidden', 403);
});

export const serverSockets = {
  // Echoes each client message back on the SAME connection, tagged with the
  // edge-captured `who`. `who` proves the data factory ran at the edge and rode
  // to the DO; the echo proves the full duplex round-trip through the DO. One
  // DO per connection, no fan-out.
  echo: defineSocket<Incoming, Outgoing, { who: string }>({
    data: (c) => ({ who: c.req.query('u') ?? 'anon' }),
    message(socket, msg) {
      if (msg.kind === 'say') {
        socket.send({ kind: 'echo', text: msg.text, who: socket.data.who });
      }
    },
  }),
  // A socket whose guard always denies; on CF must close 4403 with no DO contact.
  deniedSocket: defineSocket<Incoming, Outgoing, undefined>({
    use: [denyAll],
    message() {},
  }),
};
