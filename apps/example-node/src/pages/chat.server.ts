import { defineSocket } from 'hono-preact';

type Incoming = { kind: 'say'; text: string };
type Outgoing = { kind: 'echo'; text: string } | { kind: 'tick'; n: number };

export const serverSockets = {
  // Per-connection: echoes client messages and pushes a tick every second.
  // Per-connection mutable state (the tick count) lives in a closure variable
  // captured by open(). No data factory is declared on this socket, so
  // socket.data is unused here.
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
