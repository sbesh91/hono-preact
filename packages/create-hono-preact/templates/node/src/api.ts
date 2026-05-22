import { Hono } from 'hono';

// Your custom HTTP routes and Hono middleware go here. The framework
// mounts this app ahead of its reserved /__loaders and /__actions paths
// and the SSR catch-all. See https://framework.sbesh.com/docs/hono-middleware
const app = new Hono();

app.get('/healthz', (c) => c.text('ok'));

export default app;
