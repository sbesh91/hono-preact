import { Hono } from 'hono';
import { publish } from 'hono-preact';
import { state, tallyChannel } from './state.js';

const app = new Hono();

// Test-only: bump the shared count and publish. On Cloudflare this runs in the
// action/edge isolate; the publish must reach every live-loader subscription
// (held in other isolates) cross-isolate through the DO.
app.get('/__test_publish', (c) => {
  state.count += 1;
  publish(tallyChannel.key());
  return c.text('ok');
});

export default app;
