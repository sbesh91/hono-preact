import { Hono } from 'hono';
import { publish } from 'hono-preact';
import { pingChannel } from './state.js';

const app = new Hono();

// Test-only: publish a wake. On Cloudflare this runs in the action/edge isolate;
// the publish must reach every live-loader subscription (held in other isolates)
// cross-isolate through the DO.
app.get('/__test_publish', (c) => {
  publish(pingChannel.key());
  return c.text('ok');
});

export default app;
