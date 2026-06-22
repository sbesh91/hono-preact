import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono-preact';

const app = new Hono();

app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onMessage(event, ws) {
      ws.send(`echo: ${event.data}`);
    },
  }))
);

export default app;
