import { honoPreact } from 'hono-preact/vite';
import { nodeAdapter } from 'hono-preact/adapter-node';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [honoPreact({ adapter: nodeAdapter() })],
});
