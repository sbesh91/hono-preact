// Hand-authored Hono routes mounted by the framework (the plugin auto-loads
// src/api.ts when present; the default export must be the Hono app).
import { Hono } from 'hono';
import { listAllTasks, listProjects } from './demo/data.js';

const app = new Hono();

app.get('/api/demo/health', (c) =>
  c.json({
    ok: true,
    projects: listProjects().length,
    tasks: listAllTasks().length,
  })
);

// No raw WebSocket route here: upgradeWebSocket requires the Node adapter's
// upgrader, and this site deploys on the Cloudflare adapter, which does not
// install one (issue #282 finding; the framework's own /__sockets realtime
// path works fine, it rides the Durable Object instead).

export default app;
