import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';

const app = new Hono();
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onMessage(event, ws) {
      ws.send(`echo: ${event.data}`);
    },
  }))
);

export { injectWebSocket };
export default app;
