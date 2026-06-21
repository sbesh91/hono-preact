import { defineSocket } from 'hono-preact';

type Incoming = { kind: 'say'; text: string };
type Outgoing = { kind: 'echo'; text: string } | { kind: 'tick'; n: number };

export const serverSockets = {
  // Per-connection: echoes client messages and pushes a tick every second.
  // The interval is per-connection state (no cross-connection fan-out, so it
  // works in-process on Node); the teardown returned by open clears it.
  chat: defineSocket<Incoming, Outgoing, { n: number }>({
    open(socket) {
      socket.data.n = 0;
      const id = setInterval(() => {
        socket.data.n += 1;
        socket.send({ kind: 'tick', n: socket.data.n });
      }, 1000);
      return () => clearInterval(id);
    },
    message(socket, msg) {
      if (msg.kind === 'say') socket.send({ kind: 'echo', text: msg.text });
    },
  }),
};
