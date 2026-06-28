import { defineSocket } from 'hono-preact';

type Incoming = { kind: 'say'; text: string };
type Outgoing = { kind: 'echo'; text: string } | { kind: 'tick'; n: number };

export const serverSockets = {
  // Per-connection: echoes client messages and pushes a tick every second.
  // The interval is per-connection state (no cross-connection fan-out, so it
  // works in-process on Node); the teardown returned by open clears it.
  // socket.data is Readonly<Data>, seeded once at connect time for edge metadata. Per-connection mutable state (the tick count) lives in a closure variable.
  chat: defineSocket<Incoming, Outgoing>({
    open(socket) {
      let n = 0;
      const id = setInterval(() => {
        n += 1;
        socket.send({ kind: 'tick', n });
      }, 1000);
      return () => clearInterval(id);
    },
    message(socket, msg) {
      if (msg.kind === 'say') socket.send({ kind: 'echo', text: msg.text });
    },
  }),
};
