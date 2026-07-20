// Hand-authored Hono routes mounted by the framework (the plugin auto-loads
// src/api.ts when present; the default export must be the Hono app).
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono-preact';
import { listAllTasks, listProjects } from './demo/data.js';

const app = new Hono();

app.get('/api/demo/health', (c) =>
  c.json({
    ok: true,
    projects: listProjects().length,
    tasks: listAllTasks().length,
  })
);

// Raw WebSocket route. Works on both adapters: on Cloudflare it upgrades via a
// WebSocketPair in the worker (no Durable Object), firing onOpen for parity
// with Node.
app.get(
  '/api/demo/echo',
  upgradeWebSocket(() => ({
    onOpen(_e, ws) {
      ws.send('ready');
    },
    onMessage(event, ws) {
      ws.send(`echo: ${event.data}`);
    },
  }))
);

export default app;
