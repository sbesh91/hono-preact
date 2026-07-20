import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono-preact';

const app = new Hono();

app.get(
  '/ws',
  upgradeWebSocket(() => ({
    // onOpen fires on CF via the framework upgrader (parity with Node);
    // hono/cloudflare-workers would silently skip it.
    onOpen(_e, ws) {
      ws.send('ready');
    },
    onMessage(event, ws) {
      ws.send(`echo: ${event.data}`);
    },
  }))
);

export default app;
