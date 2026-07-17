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

// Raw WebSocket on the framework's single connection: the upgrader resolves
// lazily at request time, so this route only functions under a running
// adapter (dev server / deploy), not in unit tests.
app.get(
  '/api/demo/echo',
  upgradeWebSocket(() => ({
    onMessage(ev, ws) {
      ws.send(`echo:${String(ev.data).toUpperCase()}`);
    },
  }))
);

export default app;
